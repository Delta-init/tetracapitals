import React, { useState, useEffect } from 'react';
import { PageTitle } from '@/components/common/PageHeader';
import { Paged, TablePagination } from '@/components/common/TablePagination';
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, CalendarPlus, Edit, TrendingUp, TrendingDown } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "../utils";
import StudentForm from "../components/students/StudentForm";
import MT5AccountSection from "../components/students/MT5AccountSection";
import CourseFeesCard from "../components/students/CourseFeesCard";
import StudentHistory, { useStudentHistory } from "../components/students/StudentHistory";
import StudentFollowupsSection from "@/components/followups/StudentFollowupsSection";
import StudentCallsSection from "@/components/calls/StudentCallsSection";
import StudentWhatsAppCard from "@/components/students/StudentWhatsAppCard";
import TabbyLinksCard from "@/components/students/TabbyLinksCard";
import StudentClassesCard from "@/components/students/StudentClassesCard";
import { CallButton } from "@/components/followups/CallFlow";
import { EnrolmentControl } from "@/components/students/enrolment";
import { isStudentOf } from "@/components/students/common";
import { StudentTagsEditor } from "@/components/students/tags";
import { isMentorRole as isMentorTier } from "@/components/utils/roles";
import { 
  canEditStudent, 
  applyStudentMasking,
  filterStudentsByRole 
} from "../components/utils/StudentAccessControl";
import { getEffectiveUser } from "../components/utils/ImpersonationContext";
import { toast } from "sonner";
import { format } from "date-fns";

export default function StudentDetail() {
  const [currentUser, setCurrentUser] = useState(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const urlParams = new URLSearchParams(window.location.search);
  const studentId = urlParams.get('id');

  const queryClient = useQueryClient();

  useEffect(() => {
    const fetchUser = async () => {
      const realUser = await base44.auth.me();
      // Honor impersonation — when an admin is impersonating a mentor, all the
      // role-gated UI on this page (Edit Student button, masking, action visibility)
      // should reflect the impersonated role, not the underlying admin token.
      setCurrentUser(getEffectiveUser(realUser));
    };
    fetchUser();
  }, []);

  const { data: student, isLoading } = useQuery({
    queryKey: ['student', studentId],
    queryFn: async () => {
      // Try direct get first (bypasses list-level RLS)
      try {
        const s = await base44.entities.Student.get(studentId);
        if (s) return s;
      } catch(_) {}
      // Fallback: list and find
      const students = await base44.entities.Student.list();
      return students.find(s => s.id === studentId);
    },
    enabled: !!studentId && !!currentUser
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: async () => { const r = await base44.functions.invoke('getAllUsers', {}); return r.data?.users || []; },
    enabled: !!currentUser
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['funding-transactions', studentId],
    queryFn: async () => {
      const allTransactions = await base44.entities.FundingTransaction.list('-requested_at');
      return allTransactions.filter(t => t.student_id === studentId);
    },
    enabled: !!studentId && !!currentUser
  });

  // Team, who received them first, where they came from — and the history card below.
  const { data: history } = useStudentHistory(studentId, !!currentUser);

  // Opened by the person it was given to: no longer new for them (the sidebar's count goes down).
  useEffect(() => {
    if (!student?.id || !currentUser?.id || student.new_for_id !== currentUser.id) return;
    base44.functions.invoke('markStudentSeen', { id: student.id })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['nav-counts'] });
        queryClient.invalidateQueries({ queryKey: ['students'] });
      })
      .catch(() => { /* still new — counted until it is marked */ });
  }, [student?.id, student?.new_for_id, currentUser?.id]);

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Student.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student', studentId] });
      queryClient.invalidateQueries({ queryKey: ['student-history', studentId] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
      setShowEditDialog(false);
      toast.success('Student updated successfully');
    }
  });

  const handleUpdate = (formData) => {
    updateMutation.mutate({ id: studentId, data: formData });
  };

  if (isLoading || !currentUser) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardContent className="p-12 text-center">
              <p className="text-gray-500">Student not found</p>
              <Link to={createPageUrl('Students')}>
                <Button className="mt-4">Back to Students</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Check if current user has access to this student
  const isMentorRole = isMentorTier(currentUser.app_role);
  const isAdminRole = ['super_admin', 'broker_admin', 'academic_head', 'academic_admin', 'admin_supervisor', 'assistance', 'draw_admin', 'finance_admin'].includes(currentUser.app_role);

  const isCoMentor = (() => {
    if (!student.co_mentors_details) return false;
    try {
      const co = typeof student.co_mentors_details === 'string'
        ? JSON.parse(student.co_mentors_details)
        : student.co_mentors_details;
      return Array.isArray(co) && co.some(cm => cm.mentor_id === currentUser.id);
    } catch (_) { return false; }
  })();

  const hasAccess = isAdminRole ||
    isStudentOf(student, currentUser.id) ||
    currentUser.id === student.senior_mentor_id ||
    isCoMentor;

  if (isMentorRole && !hasAccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardContent className="p-12 text-center">
              <p className="text-gray-500">You do not have access to view this student</p>
              <Link to={createPageUrl('Students')}>
                <Button className="mt-4">Back to Students</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const displayStudent = applyStudentMasking(student, currentUser.app_role);
  const canEdit = canEditStudent(currentUser.app_role);

  const parsedCoMentors = (() => {
    if (!student?.co_mentors_details) return [];
    try {
      const co = typeof student.co_mentors_details === 'string'
        ? JSON.parse(student.co_mentors_details)
        : student.co_mentors_details;
      return Array.isArray(co) ? co : [];
    } catch (_) { return []; }
  })();

  const getStatusColor = (status) => {
    return status === 'ACTIVE' 
      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
      : 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getTransactionStatusColor = (status) => {
    switch (status) {
      case 'PENDING': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'APPROVED': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'REJECTED': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const deposits = transactions.filter(t => t.type === 'DEPOSIT');
  const withdrawals = transactions.filter(t => t.type === 'WITHDRAWAL');
  const totalDeposits = deposits.filter(t => t.status === 'APPROVED').reduce((sum, t) => sum + (t.amount_usd || 0), 0);
  const totalWithdrawals = withdrawals.filter(t => t.status === 'APPROVED').reduce((sum, t) => sum + (t.amount_usd || 0), 0);
  const netDeposit = totalDeposits - totalWithdrawals;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to={createPageUrl('Students')}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <PageTitle eyebrow="Students">Student Details</PageTitle>
              <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
                <span className="font-mono font-semibold text-blue-600">
                  {displayStudent.student_code}
                </span>
              </p>
              {/* Open, or Closed = enrolled */}
              <div className="mt-2"><EnrolmentControl student={student} currentUser={currentUser} /></div>
              <div className="mt-2"><StudentTagsEditor student={student} currentUser={currentUser} /></div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Call with 3CX, then log it against the student's follow-up */}
            <CallButton student={displayStudent} className="h-9 px-4 text-sm" />
            {/* Time with a mentor, in the LMS's diary — the Mentor Calendar, filled in for this student */}
            <Link to={`${createPageUrl('MentorCalendar')}?student=${displayStudent.id}`}>
              <Button variant="outline" className="h-9">
                <CalendarPlus className="h-4 w-4 mr-2" />
                Book mentor session
              </Button>
            </Link>
            {canEdit && (
              <Button onClick={() => setShowEditDialog(true)} className="bg-blue-600 hover:bg-blue-700">
                <Edit className="h-4 w-4 mr-2" />
                Edit Student
              </Button>
            )}
          </div>
        </div>

        {/* Student Information Card */}
        <Card className="border-gray-200">
          <CardHeader className="border-b border-gray-100 bg-slate-50/70">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl font-semibold tracking-tight">Student Information</CardTitle>
              <Badge variant="outline" className={getStatusColor(displayStudent.status)}>
                {displayStudent.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="text-sm font-medium text-gray-500">Full Name</label>
                <p className="mt-1 text-base font-semibold text-gray-900">
                  {displayStudent.full_name}
                </p>
              </div>
              
              <div>
                <label className="text-sm font-medium text-gray-500">Email</label>
                <p className="mt-1 text-base text-gray-900">
                  {displayStudent.email}
                </p>
              </div>
              
              <div>
                <label className="text-sm font-medium text-gray-500">Phone</label>
                <p className="mt-1 text-base font-mono text-gray-900">
                  {displayStudent.phone}
                </p>
              </div>
              
              <div>
                <label className="text-sm font-medium text-gray-500">Country</label>
                <p className="mt-1 text-base text-gray-900">
                  {displayStudent.country || '-'}
                </p>
              </div>
              
              <div>
                <label className="text-sm font-medium text-gray-500">CS</label>
                <p className="mt-1 text-base font-semibold text-gray-900">
                  {displayStudent.primary_mentor_name || '-'}
                </p>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-500">Team</label>
                <p className="mt-1 text-base font-semibold text-gray-900">
                  {history?.team?.name || displayStudent.team_name || '-'}
                </p>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-500">First Received By</label>
                <p className="mt-1 text-base font-semibold text-gray-900">
                  {history?.firstReceivedBy?.name
                    ? `${history.firstReceivedBy.name}${history.firstReceivedBy.role ? ` (${history.firstReceivedBy.role})` : ''}`
                    : '-'}
                </p>
                {history?.firstReceivedBy?.name && (
                  <p className="text-xs text-gray-500">
                    {history.firstReceivedBy.at ? format(new Date(history.firstReceivedBy.at), 'MMMM d, yyyy') : ''}
                    {history.firstReceivedBy.fromRecords ? ' · from earlier records' : ''}
                  </p>
                )}
              </div>

              <div>
                <label className="text-sm font-medium text-gray-500">Came From</label>
                <p className="mt-1 text-base text-gray-900">
                  {history?.cameFrom?.label || '-'}
                </p>
                {(history?.cameFrom?.invoice || history?.cameFrom?.course || history?.cameFrom?.academy) && (
                  <p className="text-xs text-gray-500">
                    {[history.cameFrom.course, history.cameFrom.academy, history.cameFrom.invoice && `invoice ${history.cameFrom.invoice}`].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              
              <div>
                <label className="text-sm font-medium text-gray-500">Senior Mentor</label>
                <p className="mt-1 text-base font-semibold text-gray-900">
                  {displayStudent.senior_mentor_name || '-'}
                </p>
              </div>
              
              <div>
                <label className="text-sm font-medium text-gray-500">Student Level</label>
                <p className="mt-1">
                  <Badge variant="outline" className={displayStudent.student_level === 'LEVEL_2' ? 'bg-purple-100 text-purple-800 border-purple-200' : 'bg-blue-100 text-blue-800 border-blue-200'}>
                    {displayStudent.student_level === 'LEVEL_2' ? 'Level 2' : 'Level 1'}
                  </Badge>
                </p>
              </div>
              
              <div>
                <label className="text-sm font-medium text-gray-500">Created Date</label>
                <p className="mt-1 text-base text-gray-900">
                  {displayStudent.created_date 
                    ? format(new Date(displayStudent.created_date), 'MMMM d, yyyy')
                    : '-'}
                </p>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-500">Co-Mentor(s)</label>
                <p className="mt-1 text-base font-semibold text-gray-900">
                  {parsedCoMentors.length > 0
                    ? parsedCoMentors.map(cm => cm.mentor_name).join(', ')
                    : '-'}
                </p>
              </div>
              
              {displayStudent.notes && (
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-500">Notes</label>
                  <p className="mt-1 text-base text-gray-700 whitespace-pre-wrap">
                    {displayStudent.notes}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* What each course cost and what was paid, as Delta finance approved it */}
        <CourseFeesCard fees={displayStudent.course_fees} />

        {/* Their live classes in the Delta LMS: attended, missed, upcoming */}
        <StudentClassesCard student={displayStudent} />

        {/* Follow-ups: stage, what they said, next date, click-to-call */}
        <StudentFollowupsSection student={displayStudent} />

        {/* Calls with them through 3CX, with the recordings */}
        <StudentCallsSection student={displayStudent} />

        {/* Tabby payment links sent to them */}
        <TabbyLinksCard student={displayStudent} />

        <StudentWhatsAppCard student={displayStudent} />

        {/* Everything that happened to this student */}
        <StudentHistory studentId={studentId} enabled={!!currentUser} />

        {/* MT5 Accounts Section */}
        <MT5AccountSection student={student} currentUser={currentUser} />

        {/* Funding Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-none bg-gradient-to-br from-blue-100 to-blue-200 shadow-lg">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-blue-900">Total Deposits</p>
                  <p className="text-2xl font-bold text-blue-900 mt-1">${totalDeposits.toFixed(2)}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-blue-700" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-none bg-gradient-to-br from-purple-100 to-purple-200 shadow-lg">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-purple-900">Total Withdrawals</p>
                  <p className="text-2xl font-bold text-purple-900 mt-1">${totalWithdrawals.toFixed(2)}</p>
                </div>
                <TrendingDown className="h-8 w-8 text-purple-700" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-none bg-gradient-to-br from-emerald-100 to-emerald-200 shadow-lg">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-emerald-900">Net Deposit</p>
                  <p className="text-2xl font-bold text-emerald-900 mt-1">${netDeposit.toFixed(2)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Deposits Section */}
        <Card className="border-gray-200">
          <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-blue-600" />
              Deposits ({deposits.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Paged items={deposits} resetKey={studentId}>
              {(pageRows, bar) => (<>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50 border-b">
                        <th className="text-left p-3 text-sm font-semibold text-gray-700">Date</th>
                        <th className="text-left p-3 text-sm font-semibold text-gray-700">Amount</th>
                        <th className="text-left p-3 text-sm font-semibold text-gray-700">Payment Method</th>
                        <th className="text-left p-3 text-sm font-semibold text-gray-700">MT5 Login</th>
                        <th className="text-left p-3 text-sm font-semibold text-gray-700">Transaction ID</th>
                        <th className="text-left p-3 text-sm font-semibold text-gray-700">Added By</th>
                        <th className="text-left p-3 text-sm font-semibold text-gray-700">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deposits.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center py-8 text-gray-500">No deposits found</td>
                        </tr>
                      ) : (
                        pageRows.map((txn) => (
                          <tr key={txn.id} className="border-b hover:bg-gray-50">
                            <td className="p-3 text-sm">{txn.requested_at ? format(new Date(txn.requested_at), 'MMM d, yyyy HH:mm') : '-'}</td>
                            <td className="p-3 text-sm font-semibold text-gray-900">${txn.amount_usd?.toFixed(2)}</td>
                            <td className="p-3 text-sm">{txn.payment_method}</td>
                            <td className="p-3 text-sm font-mono">{txn.mt5_login || '-'}</td>
                            <td className="p-3 text-sm font-mono">{txn.transaction_id || '-'}</td>
                            <td className="p-3 text-sm">
                              {txn.initiating_mentor_name ? (
                                <>
                                  {txn.initiating_mentor_name}
                                  {txn.initiating_mentor_id === student.primary_mentor_id && <span className="text-xs text-gray-500 block">(Primary)</span>}
                                  {txn.initiating_mentor_id === student.senior_mentor_id && <span className="text-xs text-gray-500 block">(Senior)</span>}
                                  {(() => {
                                    try {
                                      const co = typeof student.co_mentors_details === 'string' ? JSON.parse(student.co_mentors_details) : student.co_mentors_details;
                                      return Array.isArray(co) && co.some(cm => cm.mentor_id === txn.initiating_mentor_id) ? <span className="text-xs text-gray-500 block">(Co-Mentor)</span> : null;
                                    } catch (_) { return null; }
                                  })()}
                                </>
                              ) : '-'}
                            </td>
                            <td className="p-3">
                              <Badge variant="outline" className={getTransactionStatusColor(txn.status)}>
                                {txn.status}
                              </Badge>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <TablePagination {...bar} />
              </>)}
            </Paged>
          </CardContent>
        </Card>

        {/* Withdrawals Section */}
        <Card className="border-gray-200">
          <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-purple-50 to-pink-50">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-purple-600" />
              Withdrawals ({withdrawals.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Paged items={withdrawals} resetKey={studentId}>
              {(pageRows, bar) => (<>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50 border-b">
                        <th className="text-left p-3 text-sm font-semibold text-gray-700">Date</th>
                        <th className="text-left p-3 text-sm font-semibold text-gray-700">Amount</th>
                        <th className="text-left p-3 text-sm font-semibold text-gray-700">Payment Method</th>
                        <th className="text-left p-3 text-sm font-semibold text-gray-700">MT5 Login</th>
                        <th className="text-left p-3 text-sm font-semibold text-gray-700">Transaction ID</th>
                        <th className="text-left p-3 text-sm font-semibold text-gray-700">Added By</th>
                        <th className="text-left p-3 text-sm font-semibold text-gray-700">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {withdrawals.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center py-8 text-gray-500">No withdrawals found</td>
                        </tr>
                      ) : (
                        pageRows.map((txn) => (
                          <tr key={txn.id} className="border-b hover:bg-gray-50">
                            <td className="p-3 text-sm">{txn.requested_at ? format(new Date(txn.requested_at), 'MMM d, yyyy HH:mm') : '-'}</td>
                            <td className="p-3 text-sm font-semibold text-gray-900">${txn.amount_usd?.toFixed(2)}</td>
                            <td className="p-3 text-sm">{txn.payment_method}</td>
                            <td className="p-3 text-sm font-mono">{txn.mt5_login || '-'}</td>
                            <td className="p-3 text-sm font-mono">{txn.transaction_id || '-'}</td>
                            <td className="p-3 text-sm">
                              {txn.initiating_mentor_name ? (
                                <>
                                  {txn.initiating_mentor_name}
                                  {txn.initiating_mentor_id === student.primary_mentor_id && <span className="text-xs text-gray-500 block">(Primary)</span>}
                                  {txn.initiating_mentor_id === student.senior_mentor_id && <span className="text-xs text-gray-500 block">(Senior)</span>}
                                  {(() => {
                                    try {
                                      const co = typeof student.co_mentors_details === 'string' ? JSON.parse(student.co_mentors_details) : student.co_mentors_details;
                                      return Array.isArray(co) && co.some(cm => cm.mentor_id === txn.initiating_mentor_id) ? <span className="text-xs text-gray-500 block">(Co-Mentor)</span> : null;
                                    } catch (_) { return null; }
                                  })()}
                                </>
                              ) : '-'}
                            </td>
                            <td className="p-3">
                              <Badge variant="outline" className={getTransactionStatusColor(txn.status)}>
                                {txn.status}
                              </Badge>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <TablePagination {...bar} />
              </>)}
            </Paged>
          </CardContent>
        </Card>

        {/* Edit Dialog */}
        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Student</DialogTitle>
            </DialogHeader>
            <StudentForm
              student={student}
              onSubmit={handleUpdate}
              onCancel={() => setShowEditDialog(false)}
              isSubmitting={updateMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}