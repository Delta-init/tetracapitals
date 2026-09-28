import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import StatsCard from "../components/dashboard/StatsCard";
import { Users, TrendingUp, DollarSign, Target, AlertCircle, Award, Wallet, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import TransactionTable from "../components/transactions/TransactionTable";
import { canViewAllStudents, canApproveTransactions } from "../components/utils/DataMasking";
import { isMentorRole, getScope } from "@/components/utils/roles";
import { filterStudentsByRole } from "../components/utils/StudentAccessControl";
import { getEffectiveUser } from "../components/utils/ImpersonationContext";
import { 
  filterFundingTransactionsByRole, 
  canProcessFundingTransaction 
} from "../components/utils/FundingAccessControl";
import { calculateQuarterlyNetDepositAndCommission } from "../components/utils/CommissionUtils";
import { motion } from "framer-motion";
import { EASE, FadeIn, RevealText } from "@/components/motion";
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
    ? (getScope(currentUser)
        // Roles with a visibility setting (own / team / full system)
        ? filterStudentsByRole(students, currentUser, allUsers)
        : students.filter(s => s.primary_mentor_id === currentUser.id))
    : [];

  // A transaction belongs to whoever initiated it — co-managed transactions
  // (raised by a co-mentor on another mentor's client) belong to that co-mentor,
  // not the client's primary mentor. Legacy rows without an initiator fall back
  // to the primary mentor.
  const filteredTransactions = isMentorRole(currentUser.app_role)
    ? transactions.filter(t => (t.initiating_mentor_id || t.primary_mentor_id) === currentUser.id)
    : transactions;

  const pendingTransactions = filteredTransactions.filter(t => t.status === 'pending');
  
  const myFundingTransactions = filterFundingTransactionsByRole(currentUser, fundingTransactions, students, allUsers);
  const pendingFundingRequests = myFundingTransactions.filter(t => t.status === 'PENDING').length;

  // Admin net deposit (all approved transactions visible to them)
  const approvedFundingTransactions = myFundingTransactions.filter(t => t.status === 'APPROVED');
  const totalNetDeposit = approvedFundingTransactions.filter(t => t.type === 'DEPOSIT').reduce((sum, t) => sum + (t.amount_usd || 0), 0)
    - approvedFundingTransactions.filter(t => t.type === 'WITHDRAWAL').reduce((sum, t) => sum + (t.amount_usd || 0), 0);

  // For mentors: transactions they initiated (co-managed ones belong to the
  // co-mentor who raised them, not the client's primary mentor — matching how
  // commission is attributed, so the primary's totals aren't inflated).
  const mentorOwnTransactions = isMentorRole(currentUser.app_role)
    ? fundingTransactions.filter(t => (t.initiating_mentor_id || t.primary_mentor_id) === currentUser.id)
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

  const firstName = (currentUser.full_name || '').split(' ')[0] || currentUser.full_name;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const chartTooltip = {
    contentStyle: {
      backgroundColor: 'white',
      border: '1px solid #e2e8f0',
      borderRadius: '12px',
      boxShadow: '0 16px 40px -12px rgba(0,41,80,0.18)',
      padding: '10px 12px',
      fontWeight: 500,
    },
    labelStyle: { color: '#002950', fontWeight: 700, marginBottom: '6px', fontSize: '13px' },
    itemStyle: { padding: '2px 0', fontSize: '13px' },
  };

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
          className="relative overflow-hidden rounded-3xl bg-brand-navy px-6 py-8 text-white shadow-lift sm:px-10 sm:py-10"
        >
          <motion.div
            className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-brand-cyan/25 blur-[90px]"
            animate={{ x: [0, -40, 0], y: [0, 30, 0] }}
            transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="pointer-events-none absolute -bottom-28 left-1/3 h-72 w-72 rounded-full bg-brand-mint/15 blur-[90px]"
            animate={{ x: [0, 50, 0] }}
            transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:20px_20px]" />

          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/50">
                <span className="h-1.5 w-6 rounded-full bg-brand-gradient" />
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
              <h1 className="mt-4 text-3xl font-bold leading-tight sm:text-5xl">
                <RevealText text={`${greeting},`} />
                <br />
                <span className="font-serif text-4xl font-normal italic text-gradient sm:text-6xl">
                  <RevealText text={firstName} delay={0.2} />
                </span>
              </h1>
            </div>
            <FadeIn delay={0.4} className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold capitalize backdrop-blur-sm">
                <Activity className="h-3.5 w-3.5 text-brand-cyan" />
                {currentUser.app_role?.replace(/_/g, ' ')}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold backdrop-blur-sm">
                <Users className="h-3.5 w-3.5 text-brand-mint" />
                {filteredStudents.length} students
              </span>
            </FadeIn>
          </div>
        </motion.section>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))] lg:gap-6">
          <StatsCard
            title="Total Students"
            value={filteredStudents.length}
            icon={Users}
            color="blue"
            trend={`${filteredStudents.filter(s => s.status === 'ACTIVE').length} active`}
            trendUp={true}
            delay={0.1}
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
                delay={0.17}
              />
              <StatsCard
                title="Quarter Gross Commission"
                value={`$${quarterCommission?.grossCommissionUsd?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}`}
                icon={Award}
                color="cyan"
                trend="4% of net deposit"
                trendUp={quarterCommission?.grossCommissionUsd > 0}
                delay={0.24}
              />
              <StatsCard
                title="Pending Requests"
                value={pendingFundingRequests}
                icon={Wallet}
                color="amber"
                trend="Awaiting approval"
                delay={0.31}
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
                delay={0.17}
              />
              {canProcessFundingTransaction(currentUser.app_role) && (
                <StatsCard
                  title="Pending Funding Requests"
                  value={fundingTransactions.filter(t => t.status === 'PENDING').length}
                  icon={Wallet}
                  color="amber"
                  trend="Needs review"
                  delay={0.24}
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
                  color="cyan"
                  trend="Needs approval"
                  delay={0.31}
                />
              )}
            </>
          )}
        </div>

        {/* Charts Section */}
        {myFundingTransactions.length > 0 && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6">
            {/* Transaction Trend Chart */}
            <FadeIn delay={0.3} className="lg:col-span-2">
              <Card className="h-full">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-base font-semibold text-brand-navy">Transaction Trends</CardTitle>
                    <p className="mt-1 text-xs text-slate-500">Deposits vs withdrawals · last 6 months</p>
                  </div>
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
                    <TrendingUp className="h-4 w-4" />
                  </span>
                </CardHeader>
                <CardContent className="pt-4">
                  <ResponsiveContainer width="100%" height={290}>
                    <AreaChart data={last6Months} margin={{ left: -8, right: 8 }}>
                      <defs>
                        <linearGradient id="colorDeposits" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#1ED2DE" stopOpacity={0.45}/>
                          <stop offset="100%" stopColor="#7CF0B5" stopOpacity={0.02}/>
                        </linearGradient>
                        <linearGradient id="colorWithdrawals" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.28}/>
                          <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.02}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                      <XAxis
                        dataKey="month"
                        tick={{ fill: '#64748b', fontSize: 12, fontWeight: 600 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 600 }}
                        tickLine={false}
                        axisLine={false}
                        width={70}
                        tickFormatter={(value) => `$${value.toLocaleString()}`}
                      />
                      <Tooltip {...chartTooltip} formatter={(value) => [`$${value.toLocaleString()}`, '']} />
                      <Legend
                        wrapperStyle={{ paddingTop: '16px' }}
                        iconType="circle"
                        formatter={(value) => <span style={{ color: '#64748b', fontWeight: 600, fontSize: '12px' }}>{value}</span>}
                      />
                      <Area
                        type="monotone"
                        dataKey="deposits"
                        stroke="#12b8c4"
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#colorDeposits)"
                        name="Deposits"
                        animationDuration={1500}
                        animationBegin={0}
                      />
                      <Area
                        type="monotone"
                        dataKey="withdrawals"
                        stroke="#f43f5e"
                        strokeWidth={2.5}
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
            </FadeIn>

            {/* Status Distribution Chart */}
            <FadeIn delay={0.4}>
              <Card className="h-full">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-base font-semibold text-brand-navy">Status Distribution</CardTitle>
                    <p className="mt-1 text-xs text-slate-500">All funding requests</p>
                  </div>
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                    <Activity className="h-4 w-4" />
                  </span>
                </CardHeader>
                <CardContent className="pt-4">
                  <ResponsiveContainer width="100%" height={230}>
                    <PieChart>
                      <Pie
                        data={statusData}
                        cx="50%"
                        cy="50%"
                        outerRadius={95}
                        innerRadius={66}
                        fill="#8884d8"
                        dataKey="value"
                        animationBegin={0}
                        animationDuration={1000}
                        paddingAngle={3}
                        cornerRadius={6}
                        stroke="none"
                      >
                        {statusData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip {...chartTooltip} formatter={(value) => [`${value} transactions`, '']} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-4 space-y-2">
                    {statusData.map(entry => {
                      const total = statusData.reduce((sum, d) => sum + d.value, 0) || 1;
                      return (
                        <div key={entry.name} className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2 text-slate-600">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                            {entry.name}
                          </span>
                          <span className="tabular font-semibold text-brand-navy">
                            {entry.value} <span className="font-medium text-slate-400">· {Math.round((entry.value / total) * 100)}%</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </FadeIn>
          </div>
        )}

        {/* Recent Transactions - Hidden for academic_admin */}
        {currentUser.app_role !== 'academic_admin' && (
          <FadeIn delay={0.45}>
            <Card className="overflow-hidden">
              <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-slate-100">
                <div>
                  <CardTitle className="text-base font-semibold text-brand-navy">Recent Transactions</CardTitle>
                  <p className="mt-1 text-xs text-slate-500">Latest 10 funding requests</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {myFundingTransactions.length} total
                </span>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50/80">
                      <tr>
                        {['Student', 'Type', 'Amount', 'Status', 'Date'].map(h => (
                          <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 sm:px-6">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {myFundingTransactions.slice(0, 10).map((tx, i) => (
                        <motion.tr
                          key={tx.id}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.4, ease: EASE, delay: 0.5 + i * 0.04 }}
                          className="transition-colors duration-200 hover:bg-brand-cyan/[0.04]"
                        >
                          <td className="whitespace-nowrap px-4 py-3.5 text-sm font-semibold text-brand-navy sm:px-6">
                            {tx.student_name}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3.5 text-sm sm:px-6">
                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              tx.type === 'DEPOSIT' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100' : 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-100'
                            }`}>
                              {tx.type}
                            </span>
                          </td>
                          <td className="tabular whitespace-nowrap px-4 py-3.5 text-sm font-semibold text-slate-900 sm:px-6">
                            ${(tx.amount_usd || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3.5 text-sm sm:px-6">
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              tx.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700' :
                              tx.status === 'PENDING' ? 'bg-amber-50 text-amber-700' :
                              'bg-rose-50 text-rose-700'
                            }`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${
                                tx.status === 'APPROVED' ? 'bg-emerald-500' : tx.status === 'PENDING' ? 'bg-amber-500' : 'bg-rose-500'
                              }`} />
                              {tx.status}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3.5 text-sm text-slate-500 sm:px-6">
                            {tx.requested_at ? new Date(tx.requested_at).toLocaleDateString() : '-'}
                          </td>
                        </motion.tr>
                      ))}
                      {myFundingTransactions.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-6 py-12 text-center text-sm text-slate-400">
                            No transactions yet
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </FadeIn>
        )}
      </div>
    </div>
  );
}
