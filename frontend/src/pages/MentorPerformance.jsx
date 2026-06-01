import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Award, Users, TrendingUp, DollarSign, Target, Calendar, Search } from "lucide-react";
import { getEffectiveUser } from "../components/utils/ImpersonationContext";
import { format } from "date-fns";

export default function MentorPerformance() {
  const [currentUser, setCurrentUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('all');

  useEffect(() => {
    const fetchUser = async () => {
      const realUser = await base44.auth.me();
      setCurrentUser(getEffectiveUser(realUser));
    };
    fetchUser();
  }, []);

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    enabled: !!currentUser
  });

  const { data: students = [] } = useQuery({
    queryKey: ['students'],
    queryFn: () => base44.entities.Student.list(),
    enabled: !!currentUser
  });

  const { data: ledgers = [] } = useQuery({
    queryKey: ['commission-ledgers'],
    queryFn: () => base44.entities.CommissionLedger.list('-created_date'),
    enabled: !!currentUser
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['funding-transactions'],
    queryFn: () => base44.entities.FundingTransaction.list(),
    enabled: !!currentUser
  });

  const { data: targets = [] } = useQuery({
    queryKey: ['mentor-targets'],
    queryFn: () => base44.entities.MentorTarget.list(),
    enabled: !!currentUser
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

  const isAdmin = ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin'].includes(currentUser.app_role);
  const isMentor = ['junior_mentor', 'senior_mentor'].includes(currentUser.app_role);

  // Get all mentors
  let mentors = users.filter(u => ['junior_mentor', 'senior_mentor'].includes(u.app_role));

  // Filter to current user if they're a mentor
  if (isMentor) {
    mentors = mentors.filter(m => m.id === currentUser.id);
  }

  // Apply filters
  if (filterRole !== 'all') {
    mentors = mentors.filter(m => m.app_role === filterRole);
  }

  if (searchTerm) {
    mentors = mentors.filter(m =>
      m.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.email?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }

  // Calculate mentor performance metrics
  const mentorPerformanceData = mentors.map(mentor => {
    // Active students (primary mentor)
    const activeStudents = students.filter(s => 
      s.primary_mentor_id === mentor.id && s.status === 'ACTIVE'
    ).length;

    // All students (primary + senior mentor)
    const allStudents = students.filter(s =>
      s.primary_mentor_id === mentor.id || s.senior_mentor_id === mentor.id
    );

    // Commission ledgers for this mentor
    const mentorLedgers = ledgers.filter(l => l.mentor_id === mentor.id);

    // Total commissions earned (released)
    const totalReleased = mentorLedgers
      .filter(l => l.is_released)
      .reduce((sum, l) => sum + (l.commission_release_usd || 0), 0);

    // Total pending commissions
    const totalPending = mentorLedgers
      .filter(l => !l.is_released)
      .reduce((sum, l) => sum + (l.commission_release_usd || 0), 0);

    // Total buffer
    const totalBuffer = mentorLedgers.reduce((sum, l) => sum + (l.commission_buffer_usd || 0), 0);

    // Total net deposit (all time)
    const totalNetDeposit = mentorLedgers.reduce((sum, l) => sum + (l.net_deposit_usd || 0), 0);

    // Latest quarter performance
    const latestLedger = mentorLedgers[0]; // Already sorted by -created_date

    // Approved transactions count
    const approvedTransactionsCount = transactions.filter(t =>
      t.primary_mentor_id === mentor.id && t.status === 'APPROVED'
    ).length;

    // Current active targets
    const activeTargets = targets.filter(t =>
      t.mentor_id === mentor.id && t.target_status === 'IN_PROGRESS'
    ).length;

    // Achieved targets
    const achievedTargets = targets.filter(t =>
      t.mentor_id === mentor.id && t.target_status === 'ACHIEVED'
    ).length;

    return {
      mentor,
      activeStudents,
      allStudents: allStudents.length,
      totalReleased,
      totalPending,
      totalBuffer,
      totalNetDeposit,
      latestLedger,
      approvedTransactionsCount,
      activeTargets,
      achievedTargets
    };
  });

  // Sort by total released (descending)
  mentorPerformanceData.sort((a, b) => b.totalReleased - a.totalReleased);

  // Calculate aggregate stats for admins
  const aggregateStats = {
    totalMentors: mentorPerformanceData.length,
    totalActiveStudents: mentorPerformanceData.reduce((sum, m) => sum + m.activeStudents, 0),
    totalCommissionsReleased: mentorPerformanceData.reduce((sum, m) => sum + m.totalReleased, 0),
    totalCommissionsPending: mentorPerformanceData.reduce((sum, m) => sum + m.totalPending, 0)
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Mentor Performance Dashboard</h1>
          <p className="text-gray-600 mt-2 text-base">
            {isMentor ? 'Your performance metrics and insights' : 'Comprehensive mentor performance analytics'}
          </p>
        </div>

        {/* Aggregate Stats - Admin only */}
        {isAdmin && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="border-none bg-gradient-to-br from-blue-100 to-indigo-100 shadow-lg">
              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/80 rounded-lg shadow-sm">
                    <Users className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-700">Total Mentors</p>
                    <p className="text-2xl font-bold text-blue-700">{aggregateStats.totalMentors}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none bg-gradient-to-br from-purple-100 to-pink-100 shadow-lg">
              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/80 rounded-lg shadow-sm">
                    <Users className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-700">Active Students</p>
                    <p className="text-2xl font-bold text-purple-700">{aggregateStats.totalActiveStudents}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none bg-gradient-to-br from-emerald-100 to-teal-100 shadow-lg">
              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/80 rounded-lg shadow-sm">
                    <DollarSign className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-700">Total Released</p>
                    <p className="text-2xl font-bold text-emerald-700">
                      ${aggregateStats.totalCommissionsReleased.toFixed(2)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none bg-gradient-to-br from-amber-100 to-orange-100 shadow-lg">
              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/80 rounded-lg shadow-sm">
                    <TrendingUp className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-700">Total Pending</p>
                    <p className="text-2xl font-bold text-amber-700">
                      ${aggregateStats.totalCommissionsPending.toFixed(2)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filters - Admin only */}
        {isAdmin && (
          <Card className="border-gray-200">
            <CardContent className="p-4">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Search by name or email..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>

                <Select value={filterRole} onValueChange={setFilterRole}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Filter by role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                    <SelectItem value="junior_mentor">Junior Mentor</SelectItem>
                    <SelectItem value="senior_mentor">Senior Mentor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Performance Table */}
        <Card className="border-gray-200">
          <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-blue-50">
            <CardTitle className="text-lg font-semibold tracking-tight">Performance Metrics</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="font-semibold">Mentor</TableHead>
                    <TableHead className="font-semibold">Role</TableHead>
                    <TableHead className="font-semibold">Active Students</TableHead>
                    <TableHead className="font-semibold">Total Net Deposit</TableHead>
                    <TableHead className="font-semibold">Total Released</TableHead>
                    <TableHead className="font-semibold">Pending Release</TableHead>
                    <TableHead className="font-semibold">Total Buffer</TableHead>
                    <TableHead className="font-semibold">Approved Txns</TableHead>
                    <TableHead className="font-semibold">Active Targets</TableHead>
                    <TableHead className="font-semibold">Achieved Targets</TableHead>
                    <TableHead className="font-semibold">Latest Quarter</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mentorPerformanceData.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-8 text-gray-500">
                        No mentors found
                      </TableCell>
                    </TableRow>
                  ) : (
                    mentorPerformanceData.map((data) => (
                      <TableRow key={data.mentor.id} className="hover:bg-gray-50 transition-colors">
                        <TableCell>
                          <div>
                            <div className="font-medium">{data.mentor.full_name}</div>
                            <div className="text-xs text-gray-500">{data.mentor.email}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            data.mentor.app_role === 'senior_mentor'
                              ? 'bg-purple-100 text-purple-800 border-purple-200'
                              : 'bg-blue-100 text-blue-800 border-blue-200'
                          }>
                            {data.mentor.app_role === 'senior_mentor' ? 'Senior' : 'Junior'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Users className="h-4 w-4 text-gray-400" />
                            <span className="font-semibold">{data.activeStudents}</span>
                            <span className="text-xs text-gray-500">/ {data.allStudents}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-semibold">
                          ${data.totalNetDeposit.toFixed(2)}
                        </TableCell>
                        <TableCell className="font-semibold text-emerald-600">
                          ${data.totalReleased.toFixed(2)}
                        </TableCell>
                        <TableCell className="font-semibold text-blue-600">
                          ${data.totalPending.toFixed(2)}
                        </TableCell>
                        <TableCell className="font-semibold text-amber-600">
                          ${data.totalBuffer.toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Award className="h-4 w-4 text-gray-400" />
                            <span className="font-medium">{data.approvedTransactionsCount}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Target className="h-4 w-4 text-blue-500" />
                            <span className="font-medium text-blue-600">{data.activeTargets}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Award className="h-4 w-4 text-emerald-500" />
                            <span className="font-medium text-emerald-600">{data.achievedTargets}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {data.latestLedger ? (
                            <div>
                              <div className="text-xs font-semibold text-blue-600">
                                {data.latestLedger.quarter}
                              </div>
                              <div className="text-xs text-gray-500">
                                ${data.latestLedger.net_deposit_usd?.toFixed(0)} → ${data.latestLedger.commission_release_usd?.toFixed(0)}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">No data</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Individual Mentor Details - For Mentor view */}
        {isMentor && mentorPerformanceData.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Historical Performance */}
            <Card className="border-gray-200">
              <CardHeader className="border-b border-gray-100">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-blue-600" />
                  Historical Performance
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="space-y-3">
                  {ledgers
                    .filter(l => l.mentor_id === currentUser.id)
                    .slice(0, 5)
                    .map((ledger) => (
                      <div key={ledger.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div>
                          <div className="font-semibold text-sm">{ledger.quarter}</div>
                          <div className="text-xs text-gray-500">
                            Net Deposit: ${ledger.net_deposit_usd?.toFixed(2)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold text-emerald-600">
                            ${ledger.commission_release_usd?.toFixed(2)}
                          </div>
                          <Badge variant="outline" className={
                            ledger.is_released
                              ? 'bg-emerald-100 text-emerald-800 border-emerald-200 text-xs'
                              : 'bg-blue-100 text-blue-800 border-blue-200 text-xs'
                          }>
                            {ledger.is_released ? 'Released' : 'Pending'}
                          </Badge>
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>

            {/* Student Performance Highlights */}
            <Card className="border-gray-200">
              <CardHeader className="border-b border-gray-100">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Users className="h-5 w-5 text-purple-600" />
                  Student Highlights
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="space-y-3">
                  {students
                    .filter(s => s.primary_mentor_id === currentUser.id && s.status === 'ACTIVE')
                    .slice(0, 5)
                    .map((student) => {
                      const studentTransactions = transactions.filter(
                        t => t.student_id === student.id && t.status === 'APPROVED'
                      );
                      const totalDeposits = studentTransactions
                        .filter(t => t.type === 'DEPOSIT')
                        .reduce((sum, t) => sum + (t.amount_usd || 0), 0);
                      const totalWithdrawals = studentTransactions
                        .filter(t => t.type === 'WITHDRAWAL')
                        .reduce((sum, t) => sum + (t.amount_usd || 0), 0);
                      const netDeposit = totalDeposits - totalWithdrawals;

                      return (
                        <div key={student.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div>
                            <div className="font-semibold text-sm">{student.full_name}</div>
                            <div className="text-xs text-gray-500">{student.student_code}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-blue-600">
                              ${netDeposit.toFixed(2)}
                            </div>
                            <div className="text-xs text-gray-500">
                              {studentTransactions.length} txns
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  {students.filter(s => s.primary_mentor_id === currentUser.id && s.status === 'ACTIVE').length === 0 && (
                    <p className="text-sm text-gray-500 text-center py-4">No active students yet</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}