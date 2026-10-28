import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import CourseCommissionSummary from "../components/funding/CourseCommissionSummary";
import { AmountCell, PaidCell, studentInfoOf, sourceOf } from "../components/funding/mt5Cells";
import StatsCard from "../components/dashboard/StatsCard";
import LocationTotals from "../components/dashboard/LocationTotals";
import { CsPendingPanel, CsReportPanel, MentorPendingPanel } from "../components/dashboard/TeamPending";
import { TodayScheduleCard } from "../components/dashboard/TodaySchedule";
import { Users, DollarSign, Target, AlertCircle, AlertTriangle, ArrowRight, Award, Wallet, Activity } from "lucide-react";
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
import { localFromAed } from "@/components/utils/displayCurrency";
import { motion } from "framer-motion";
import { EASE, FadeIn, RevealText } from "@/components/motion";

export default function Dashboard() {
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    const fetchUser = async () => {
      const realUser = await base44.auth.me();
      setCurrentUser(getEffectiveUser(realUser));
    };
    fetchUser();
  }, []);

  // Funding requests sent back to them to correct (the user, 2026-10-13) — the sidebar's count, shared.
  const { data: navCounts } = useQuery({
    queryKey: ['nav-counts'],
    queryFn: async () => (await base44.functions.invoke('getNavCounts', {})).data,
    enabled: !!currentUser,
    staleTime: 30_000,
  });
  const toCorrect = Number(navCounts?.funding_sent_back) || 0;

  // A mentor's (a Chief's: their team's) course payments and commission this month, Dubai days — the same figures as
  // Funding Activities' Course upgradation on "This month" (backend functions/courseCommissionSummary.ts, 2026-10-28).
  const monthCourse = useQuery({
    queryKey: ['course-commission-summary', 'dashboard-month'],
    queryFn: async () => {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
      const tomorrow = new Date(`${today}T00:00:00+04:00`);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const from = new Date(`${today.slice(0, 8)}01T00:00:00+04:00`).toISOString();
      return (await base44.functions.invoke('getCourseCommissionSummary', { from, to: tomorrow.toISOString() })).data;
    },
    enabled: !!currentUser && isMentorRole(currentUser.app_role),
    retry: false,
  });

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
    // A CS Manager: every student (they read them all, 2026-10-09); a CS: their own and the ones Common with them.
    : currentUser.app_role === 'cs_manager'
    ? students
    : currentUser.app_role === 'cs'
    ? students.filter(s => s.primary_mentor_id === currentUser.id || (Array.isArray(s.common_cs) && s.common_cs.some(c => c?.id === currentUser.id)))
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

  const firstName = (currentUser.full_name || '').split(' ')[0] || currentUser.full_name;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

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

        {/* Sent back to correct — red, under the hero, until corrected */}
        {toCorrect > 0 && (
          <Link to={currentUser?.app_role === 'cs_manager' ? `${createPageUrl('MyFundingRequests')}?tab=team&sent_back=1` : createPageUrl('MyFundingRequests')}
            className="flex items-center gap-3 rounded-2xl border border-rose-300 bg-rose-50 px-5 py-4 text-rose-800 shadow-soft transition hover:bg-rose-100">
            <AlertTriangle className="h-6 w-6 flex-shrink-0 text-rose-600" />
            <div className="flex-1">
              {currentUser?.app_role === 'cs_manager' ? (
                <>
                  <p className="font-semibold">{toCorrect === 1 ? 'A CS has a funding request sent back to correct' : `${toCorrect} funding requests are sent back to your CSs to correct`}</p>
                  <p className="text-sm text-rose-700">See them on Funding Activities — you can correct them too.</p>
                </>
              ) : (
                <>
                  <p className="font-semibold">{toCorrect === 1 ? 'A funding request was sent back to you to correct' : `${toCorrect} funding requests were sent back to you to correct`}</p>
                  <p className="text-sm text-rose-700">Correct it on Funding Activities and it goes straight back for approval.</p>
                </>
              )}
            </div>
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white">Correct now <ArrowRight className="h-4 w-4" /></span>
          </Link>
        )}

        {/* Stats Grid — the Super Admin's is Dubai and Bangalore side by side (the user, 2026-10-10) */}
        {currentUser.app_role === 'super_admin' ? (
          <LocationTotals />
        ) : (
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
            {['cs', 'cs_manager'].includes(currentUser.app_role) ? (
              // A CS / CS Manager: what waits for a decision (every CS's for a CS Manager) — their money is in Course
              // upgradation below, not the old deposit figures (2026-10-13).
              <StatsCard
                title="Pending Requests"
                value={Number(navCounts?.funding_pending) || 0}
                icon={Wallet}
                color="amber"
                trend={currentUser.app_role === 'cs_manager' ? "Every CS's, awaiting approval" : 'Awaiting approval'}
                delay={0.17}
              />
            ) : isMentorRole(currentUser.app_role) ? (
              <>
                {/* As Funding Activities' Course upgradation, this month: the team's course payments (a Chief's) and
                    what was credited to them — not the deposits they raised themselves (the user, 2026-10-28). */}
                <StatsCard
                  title="Collected this month"
                  value={monthCourse.isLoading ? '…' : localFromAed(monthCourse.data?.collected?.course_payments_aed)}
                  icon={DollarSign}
                  color="emerald"
                  trend={monthCourse.data?.collected?.pending_count > 0
                    ? `+ ${localFromAed(monthCourse.data.collected.pending_aed)} waiting approval`
                    : `${monthCourse.data?.collected?.count ?? 0} course payments`}
                  trendUp={Number(monthCourse.data?.collected?.course_payments_aed) > 0}
                  delay={0.17}
                />
                <StatsCard
                  title="Your commission this month"
                  value={monthCourse.isLoading ? '…' : localFromAed(monthCourse.data?.commission?.aed)}
                  icon={Award}
                  color="cyan"
                  trend={`${monthCourse.data?.commission?.count ?? 0} credits, pool shares included`}
                  trendUp={Number(monthCourse.data?.commission?.aed) > 0}
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
        )}

        {/* A CS / CS Manager: their course payments and commission, as on Funding Activities (2026-10-13) */}
        {['cs', 'cs_manager'].includes(currentUser.app_role) && <CourseCommissionSummary isManager={currentUser.app_role === 'cs_manager'} />}

        {/* Mentors and Chiefs: today's LMS classes and meetings (2026-10-28) */}
        <TodayScheduleCard currentUser={currentUser} />

        {/* Root's CS pending and CS report, their own CSs only — a Super Admin every CS, a CS Manager their location's, a
            Chief Mentor their team's — and what waits on every mentor for Super Admins and Chiefs (2026-10-28). */}
        {['super_admin', 'admin', 'cs_manager', 'chief_mentor'].includes(currentUser.app_role) && (
          <div className="space-y-6">
            <CsPendingPanel />
            <CsReportPanel />
            {['super_admin', 'admin', 'chief_mentor'].includes(currentUser.app_role) && <MentorPendingPanel />}
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
                        {['Student', 'Type', 'Amount to credit', 'Paid by the student', 'Status', 'Date'].map(h => (
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
                              tx.type === 'DEPOSIT' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100'
                                : tx.type === 'BONUS' ? 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-100'
                                : 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-100'
                            }`}>
                              {tx.type}
                            </span>
                          </td>
                          {/* As Funding Requests shows it (components/funding/mt5Cells.jsx, 2026-10-13) */}
                          <td className="tabular whitespace-nowrap px-4 py-3.5 text-sm sm:px-6">
                            <AmountCell t={{ ...tx, student: studentInfoOf(students.find(s => s.id === tx.student_id)), source: sourceOf(tx) }}
                              original={tx.amount_currency && tx.amount_currency !== 'USD' && tx.amount_original ? `${tx.amount_currency} ${Number(tx.amount_original).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : null} />
                          </td>
                          <td className="min-w-[170px] px-4 py-3.5 text-xs sm:px-6">
                            <PaidCell t={{ ...tx, student: studentInfoOf(students.find(s => s.id === tx.student_id)), source: sourceOf(tx) }} title={tx.student_name} />
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
                          <td colSpan={6} className="px-6 py-12 text-center text-sm text-slate-400">
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
