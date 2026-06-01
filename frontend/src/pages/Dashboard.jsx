import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import StatsCard from "../components/dashboard/StatsCard";
import { Users, TrendingUp, DollarSign, Target, AlertCircle, Award, Wallet, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import TransactionTable from "../components/transactions/TransactionTable";
import { canViewAllStudents, isMentorRole, canApproveTransactions } from "../components/utils/DataMasking";
import { getEffectiveUser } from "../components/utils/ImpersonationContext";
import { 
  filterFundingTransactionsByRole, 
  canProcessFundingTransaction 
} from "../components/utils/FundingAccessControl";
import { calculateQuarterlyNetDepositAndCommission } from "../components/utils/CommissionUtils";
import { AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function Dashboard() {
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    const fetchUser = async () => {
      const realUser = await base44.auth.me();
      setCurrentUser(getEffectiveUser(realUser));
    };
    fetchUser();
  }, []);

  const { data: students = [] } = useQuery({
    queryKey: ['students'],
    queryFn: () => base44.entities.Student.list(),
    enabled: !!currentUser
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => base44.entities.Transaction.list('-created_date', 100),
    enabled: !!currentUser
  });

  const { data: commissions = [] } = useQuery({
    queryKey: ['commissions'],
    queryFn: () => base44.entities.Commission.list(),
    enabled: !!currentUser
  });

  const { data: targets = [] } = useQuery({
    queryKey: ['targets'],
    queryFn: () => base44.entities.Target.list(),
    enabled: !!currentUser
  });

  const { data: fundingTransactions = [] } = useQuery({
    queryKey: ['funding-transactions'],
    queryFn: () => base44.entities.FundingTransaction.list('-requested_at', 9999),
    enabled: !!currentUser
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    enabled: !!currentUser
  });

  const { data: studentRequests = [] } = useQuery({
    queryKey: ['student-requests'],
    queryFn: () => base44.entities.StudentRequest.list('-created_date'),
    enabled: !!currentUser && ['academic_admin', 'academic_head', 'broker_admin'].includes(currentUser.app_role)
  });

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Filter data based on user role
  const filteredStudents = canViewAllStudents(currentUser.app_role)
    ? students
    : currentUser.app_role === 'academic_admin'
    ? (() => {
        // Academic admin sees students from their approved requests
        const approvedRequestStudentIds = studentRequests
          .filter(r => r.requested_by_id === currentUser.id && r.created_student_id)
          .map(r => r.created_student_id);
        return students.filter(s => approvedRequestStudentIds.includes(s.id));
      })()
    : isMentorRole(currentUser.app_role)
    ? students.filter(s => {
        if (currentUser.app_role === 'senior_mentor') {
          // Senior mentors see their students + junior mentors' students
          return s.senior_mentor_id === currentUser.id || 
                 s.primary_mentor_id === currentUser.id;
        }
        return s.primary_mentor_id === currentUser.id;
      })
    : [];

  const filteredTransactions = isMentorRole(currentUser.app_role)
    ? transactions.filter(t => t.primary_mentor_id === currentUser.id)
    : transactions;

  const pendingTransactions = filteredTransactions.filter(t => t.status === 'pending');
  
  const myFundingTransactions = filterFundingTransactionsByRole(currentUser, fundingTransactions, students, allUsers);
  const pendingFundingRequests = myFundingTransactions.filter(t => t.status === 'PENDING').length;

  // Admin net deposit (all approved transactions visible to them)
  const approvedFundingTransactions = myFundingTransactions.filter(t => t.status === 'APPROVED');
  const totalNetDeposit = approvedFundingTransactions.filter(t => t.type === 'DEPOSIT').reduce((sum, t) => sum + (t.amount_usd || 0), 0)
    - approvedFundingTransactions.filter(t => t.type === 'WITHDRAWAL').reduce((sum, t) => sum + (t.amount_usd || 0), 0);

  // For mentors: use same filter as Funding Activities page (initiating_mentor_id or primary_mentor_id)
  const mentorOwnTransactions = isMentorRole(currentUser.app_role)
    ? fundingTransactions.filter(t =>
        t.initiating_mentor_id === currentUser.id ||
        t.primary_mentor_id === currentUser.id
      )
    : [];

  // Quarter commission — sourced from mentor's own transactions (matches Funding Activities)
  const quarterCommission = isMentorRole(currentUser.app_role)
    ? calculateQuarterlyNetDepositAndCommission(mentorOwnTransactions, currentUser)
    : null;

  // Prepare chart data - Last 6 months transaction trend
  const now = new Date();
  const last6Months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    return {
      month: d.toLocaleDateString('en-US', { month: 'short' }),
      deposits: 0,
      withdrawals: 0
    };
  });

  myFundingTransactions
    .filter(t => t.status === 'APPROVED' && t.requested_at)
    .forEach(t => {
      const txDate = new Date(t.requested_at);
      const monthsAgo = Math.floor((now - txDate) / (1000 * 60 * 60 * 24 * 30));
      if (monthsAgo >= 0 && monthsAgo < 6) {
        const idx = 5 - monthsAgo;
        if (t.type === 'DEPOSIT') {
          last6Months[idx].deposits += t.amount_usd || 0;
        } else {
          last6Months[idx].withdrawals += t.amount_usd || 0;
        }
      }
    });

  // Status distribution for pie chart
  const statusData = [
    { name: 'Pending', value: myFundingTransactions.filter(t => t.status === 'PENDING').length, color: '#f59e0b' },
    { name: 'Approved', value: myFundingTransactions.filter(t => t.status === 'APPROVED').length, color: '#10b981' },
    { name: 'Rejected', value: myFundingTransactions.filter(t => t.status === 'REJECTED').length, color: '#ef4444' }
  ].filter(s => s.value > 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/50 to-indigo-100/40 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="relative overflow-hidden bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600 rounded-3xl shadow-2xl p-8 border-none">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full -mr-32 -mt-32"></div>
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-white opacity-5 rounded-full -ml-24 -mb-24"></div>
          <div className="relative z-10">
            <h1 className="text-4xl font-bold text-white">
              Welcome back, {currentUser.full_name}
            </h1>
            <div className="flex items-center gap-2 mt-3">
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-white/20 text-white backdrop-blur-sm">
                <Activity className="h-4 w-4 mr-1.5" />
                {currentUser.app_role?.replace(/_/g, ' ')}
              </span>
              <span className="text-blue-100">•</span>
              <span className="text-blue-100 text-sm">{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-in fade-in duration-500">
          <StatsCard
            title="Total Students"
            value={filteredStudents.length}
            icon={Users}
            color="blue"
            trend={`${filteredStudents.filter(s => s.status === 'ACTIVE').length} active`}
            trendUp={true}
          />
          {isMentorRole(currentUser.app_role) ? (
            <>
              <StatsCard
                title="Quarter Net Deposit"
                value={`$${quarterCommission?.netDepositUsd?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}`}
                icon={DollarSign}
                color="emerald"
                trend="Current quarter"
                trendUp={quarterCommission?.netDepositUsd > 0}
              />
              <StatsCard
                title="Quarter Gross Commission"
                value={`$${quarterCommission?.grossCommissionUsd?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}`}
                icon={Award}
                color="purple"
                trend="4% of net deposit"
                trendUp={quarterCommission?.grossCommissionUsd > 0}
              />
              <StatsCard
                title="Pending Requests"
                value={pendingFundingRequests}
                icon={Wallet}
                color="amber"
                trend="Awaiting approval"
              />
            </>
          ) : (
            <>
              <StatsCard
                title="Net Deposits"
                value={`$${totalNetDeposit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                icon={DollarSign}
                color="emerald"
                trend="All students"
                trendUp={totalNetDeposit > 0}
              />
              {canProcessFundingTransaction(currentUser.app_role) && (
                <StatsCard
                  title="Pending Funding Requests"
                  value={fundingTransactions.filter(t => t.status === 'PENDING').length}
                  icon={Wallet}
                  color="amber"
                  trend="Needs review"
                />
              )}
              {['academic_head', 'broker_admin'].includes(currentUser.app_role) && (
                <StatsCard
                  title="Student Requests"
                  value={studentRequests.filter(r => 
                    currentUser.app_role === 'academic_head' 
                      ? r.status === 'PENDING_ACADEMIC_APPROVAL' 
                      : ['PENDING_ACADEMIC_APPROVAL', 'PENDING_BROKER_APPROVAL'].includes(r.status)
                  ).length}
                  icon={Users}
                  color="purple"
                  trend="Needs approval"
                />
              )}
            </>
          )}
        </div>

        {/* Charts Section */}
        {myFundingTransactions.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in duration-700 delay-200">
            {/* Transaction Trend Chart */}
            <Card className="lg:col-span-2 border-none shadow-xl bg-white/80 backdrop-blur-sm hover:shadow-2xl transition-shadow duration-300">
              <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-blue-600" />
                  Transaction Trends (Last 6 Months)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={last6Months}>
                    <defs>
                      <linearGradient id="colorDeposits" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.9}/>
                        <stop offset="50%" stopColor="#34d399" stopOpacity={0.5}/>
                        <stop offset="95%" stopColor="#6ee7b7" stopOpacity={0.1}/>
                      </linearGradient>
                      <linearGradient id="colorWithdrawals" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.9}/>
                        <stop offset="50%" stopColor="#f87171" stopOpacity={0.5}/>
                        <stop offset="95%" stopColor="#fca5a5" stopOpacity={0.1}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.5} />
                    <XAxis 
                      dataKey="month" 
                      tick={{ fill: '#6b7280', fontSize: 12, fontWeight: 600 }}
                      tickLine={{ stroke: '#e5e7eb' }}
                      axisLine={{ stroke: '#d1d5db' }}
                    />
                    <YAxis 
                      tick={{ fill: '#6b7280', fontSize: 12, fontWeight: 600 }}
                      tickLine={{ stroke: '#e5e7eb' }}
                      axisLine={{ stroke: '#d1d5db' }}
                      tickFormatter={(value) => `$${value.toLocaleString()}`}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '12px',
                        boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
                        padding: '12px',
                        fontWeight: 500
                      }}
                      labelStyle={{ color: '#111827', fontWeight: 700, marginBottom: '8px', fontSize: '13px' }}
                      itemStyle={{ padding: '4px 0', fontSize: '13px' }}
                      formatter={(value) => [`$${value.toLocaleString()}`, '']}
                    />
                    <Legend 
                      wrapperStyle={{ paddingTop: '20px' }}
                      iconType="circle"
                      formatter={(value) => <span style={{ color: '#6b7280', fontWeight: 600, fontSize: '13px' }}>{value}</span>}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="deposits" 
                      stroke="#10b981" 
                      strokeWidth={3}
                      fillOpacity={1} 
                      fill="url(#colorDeposits)" 
                      name="Deposits"
                      animationDuration={1500}
                      animationBegin={0}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="withdrawals" 
                      stroke="#ef4444" 
                      strokeWidth={3}
                      fillOpacity={1} 
                      fill="url(#colorWithdrawals)" 
                      name="Withdrawals"
                      animationDuration={1500}
                      animationBegin={200}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Status Distribution Chart */}
            <Card className="border-none shadow-xl bg-white/80 backdrop-blur-sm hover:shadow-2xl transition-shadow duration-300">
              <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Activity className="h-5 w-5 text-blue-600" />
                  Status Distribution
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 flex items-center justify-center">
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={statusData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={90}
                      innerRadius={55}
                      fill="#8884d8"
                      dataKey="value"
                      animationBegin={0}
                      animationDuration={1000}
                      paddingAngle={2}
                    >
                      {statusData.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={entry.color}
                          style={{ 
                            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))',
                            transition: 'all 0.3s ease'
                          }}
                        />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '12px',
                        boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
                        padding: '12px',
                        fontWeight: 500
                      }}
                      labelStyle={{ color: '#111827', fontWeight: 700, marginBottom: '4px', fontSize: '13px' }}
                      formatter={(value) => [`${value} transactions`, '']}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Recent Transactions - Hidden for academic_admin */}
        {currentUser.app_role !== 'academic_admin' && (
          <Card className="border-none shadow-xl bg-white/80 backdrop-blur-sm hover:shadow-2xl transition-shadow duration-300 animate-in fade-in duration-700 delay-300">
            <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
              <CardTitle className="text-xl font-semibold flex items-center gap-2">
                <Activity className="h-5 w-5 text-blue-600" />
                Recent Transactions
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Student</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {myFundingTransactions.slice(0, 10).map((tx) => (
                      <tr key={tx.id} className="hover:bg-gray-50 transition-colors duration-200">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {tx.student_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            tx.type === 'DEPOSIT' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {tx.type}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                          ${(tx.amount_usd || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            tx.status === 'APPROVED' ? 'bg-green-100 text-green-800' : 
                            tx.status === 'PENDING' ? 'bg-yellow-100 text-yellow-800' : 
                            'bg-red-100 text-red-800'
                          }`}>
                            {tx.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {tx.requested_at ? new Date(tx.requested_at).toLocaleDateString() : '-'}
                        </td>
                      </tr>
                    ))}
                    {myFundingTransactions.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">
                          No transactions yet
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}