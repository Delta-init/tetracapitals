import { useState, useEffect, useRef } from 'react';
import { PriorityPicker } from '@/components/students/priority';
import { LanguagePicker } from '@/components/students/languagePicker';
import { PageTitle } from '@/components/common/PageHeader';
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ArrowLeft, CalendarPlus, Edit, IdCard, ListChecks, Phone, MessageCircle, Wallet, GraduationCap,
  Presentation, LifeBuoy, Link2, CandlestickChart, History as HistoryIcon,
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { createPageUrl } from "../utils";
import StudentForm from "../components/students/StudentForm";
import { EditDetailsButton } from "@/components/students/EditDetails";
import MT5AccountSection from "../components/students/MT5AccountSection";
import { Mt5Logins } from "../components/students/mt5Accounts";
import CourseFeesCard from "../components/students/CourseFeesCard";
import ZohoInvoicesCard from "../components/students/ZohoInvoicesCard";
import StudentCoursesCard from "../components/students/StudentCoursesCard";
import { SalesCrmBadge, salesCrmOfStudent } from "@/components/students/salesCrm";
import { BonusPendingBadge, useStudentBonusPending } from "@/components/students/bonusPending";
import { BangaloreBadge } from "@/components/common/LocationFilter";
import StudentHistory, { useStudentHistory } from "../components/students/StudentHistory";
import StudentFollowupsSection from "@/components/followups/StudentFollowupsSection";
import StudentCallsSection from "@/components/calls/StudentCallsSection";
import StudentWhatsAppCard from "@/components/students/StudentWhatsAppCard";
import PaymentLinksCard from "@/components/students/PaymentLinksCard";
import StudentClassesCard from "@/components/students/StudentClassesCard";
import StudentLmsCoursesCard from "@/components/students/StudentLmsCoursesCard";
import StudentLmsSupportCards from "@/components/students/StudentLmsSupportCards";
import StudentFundingCard from "@/components/students/StudentFundingCard";
import { ViewInLmsButton, canViewInLms, mayViewInLms, mayActInLms } from "@/components/students/ViewInLms";
import { CallButton } from "@/components/followups/CallFlow";
import { EnrolmentControl } from "@/components/students/enrolment";
import { OnboardingControl } from "@/components/students/onboarding";
import { isStudentOf } from "@/components/students/common";
import { StudentTagsEditor } from "@/components/students/tags";
import { isMentorRole as isMentorTier, readsClosedOnly } from "@/components/utils/roles";
import { closedByMe, ClosedByList } from "@/components/students/closedBy";
import { canEditStudent, applyStudentMasking } from "../components/utils/StudentAccessControl";
import { getEffectiveUser } from "../components/utils/ImpersonationContext";
import { toast } from "sonner";
import { format } from "date-fns";

// The student page's tabs, in this order (the user, 2026-10-05) — Details opens first. Only the open tab is
// mounted, so only its cards load. `empty`: what a tab says when its card has nothing to show.
const TABS = [
  { key: 'details', label: 'Details', icon: IdCard },
  { key: 'followups', label: 'Follow-ups', icon: ListChecks },
  { key: 'calls', label: 'Calls', icon: Phone },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, empty: 'No WhatsApp chats with this student yet.' },
  { key: 'funding', label: 'Funding', icon: Wallet },
  { key: 'courses', label: 'Courses & fees', icon: GraduationCap, empty: 'No course fees, invoices or LMS courses for this student yet.' },
  { key: 'classes', label: 'Classes', icon: Presentation, empty: 'No LMS classes to show for this student.' },
  { key: 'support', label: 'Support & assignments', icon: LifeBuoy, empty: 'No support tickets or assignments to show.' },
  { key: 'payment-links', label: 'Payment links', icon: Link2, empty: 'No payment links for this student.' },
  { key: 'mt5', label: 'MT5 accounts', icon: CandlestickChart },
  { key: 'history', label: 'History', icon: HistoryIcon },
];
const TOP_BAR = 64;   // the app's top bar (Layout.jsx, h-16): the tab bar sticks just under it
// A card that has nothing to show renders nothing; its tab then says so (data-empty) rather than stand blank —
// a moment late, so it doesn't flash while the card is still loading.
const EMPTY_NOTE = 'empty:py-12 empty:text-center empty:text-sm empty:text-slate-500 empty:before:content-[attr(data-empty)] empty:before:[animation:page-rise_0.4s_0.8s_both]';

export default function StudentDetail() {
  const navigate = useNavigate();
  // A page of this app before this one: go back to it, as the browser would. None (a fresh tab): the link's own Students.
  const backToList = (e) => { if ((window.history.state?.idx ?? 0) > 0) { e.preventDefault(); navigate(-1); } };
  const [currentUser, setCurrentUser] = useState(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const urlParams = new URLSearchParams(window.location.search);
  const studentId = urlParams.get('id');

  // The Sales role: the students they closed, to read — no WhatsApp from here (the server says the same).
  const salesOnly = readsClosedOnly(currentUser);
  const shownTabs = TABS.filter(t => !(salesOnly && t.key === 'whatsapp'));
  // The open tab, kept in the address (…&tab=funding): a refresh, or Back from another page, opens it again.
  const [params, setParams] = useSearchParams();
  const tab = shownTabs.some(t => t.key === params.get('tab')) ? params.get('tab') : 'details';
  const rootRef = useRef(null);
  const listRef = useRef(null);

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

  // A Chief Mentor or CS Manager opens their team's students — those of the CSs under them (2026-10-08).
  const leads = ['chief_mentor', 'cs_manager'].includes(currentUser?.app_role);
  const { data: myTeam } = useQuery({
    queryKey: ['my-team-cs-ids', currentUser?.id],
    queryFn: async () => (await base44.functions.invoke('getMyTeamCsIds', {})).data,
    enabled: leads,
    staleTime: 5 * 60_000,
  });
  const teamIds = myTeam?.ids || [];

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

  // Every funding request of theirs — deposits, withdrawals, bonuses — once the Funding tab is open.
  const { data: transactions = [], isLoading: loadingFunding } = useQuery({
    queryKey: ['funding-transactions', studentId],
    queryFn: () => base44.entities.FundingTransaction.filter({ student_id: studentId }, '-requested_at'),
    enabled: !!studentId && !!currentUser && tab === 'funding'
  });

  // A bonus not decided yet — with finance or waiting for a broker admin — beside their name on every tab.
  const { data: bonusPending } = useStudentBonusPending(studentId, !!currentUser);

  // Team, who received them first, where they came from — for the Details tab (the History tab loads its own).
  const { data: history } = useStudentHistory(studentId, !!currentUser && tab === 'details');

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

  // On a phone the tab bar scrolls sideways: the open tab is kept in sight — there at once when the page opens,
  // gliding over when another is tapped.
  const placedRef = useRef(false);
  useEffect(() => {
    const list = listRef.current;
    const on = list?.querySelector('[data-state="active"]');
    if (!on) return;
    list.scrollTo({ left: on.offsetLeft - (list.clientWidth - on.offsetWidth) / 2, behavior: placedRef.current ? 'smooth' : 'auto' });
    placedRef.current = true;
  }, [tab, student?.id]);

  const changeTab = (key) => {
    setParams(p => {
      const next = new URLSearchParams(p);
      if (key === 'details') next.delete('tab'); else next.set('tab', key);
      return next;
    }, { replace: true });
    // Far down a long tab: the next one starts at its top, just under the tab bar.
    const root = rootRef.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top + window.scrollY - TOP_BAR;
    if (window.scrollY > top) window.scrollTo({ top });
  };

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

  const ofMyTeam = leads && teamIds.some(id => isStudentOf(student, id));
  const hasAccess = isAdminRole ||
    // Every CS Manager reads every student's page, in all teams (2026-10-09).
    currentUser.app_role === 'cs_manager' ||
    isStudentOf(student, currentUser.id) ||
    ofMyTeam ||
    currentUser.id === student.senior_mentor_id ||
    isCoMentor ||
    (salesOnly && closedByMe(student, currentUser));

  // A leader's team is still on its way: wait for it rather than say "no access".
  if (isMentorRole && !hasAccess && leads && !myTeam) {
    return <div className="flex min-h-screen items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-b-2 border-blue-600" /></div>;
  }
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

  // A tab's panel: spaced under the tab bar, and saying so when its card has nothing to show.
  const panel = (key) => {
    const empty = TABS.find(t => t.key === key)?.empty;
    return { value: key, className: `mt-4 space-y-6 ${empty ? EMPTY_NOTE : ''}`, ...(empty ? { 'data-empty': empty } : {}) };
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header — stays above every tab */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            {/* Back as the browser's Back (the user, 2026-10-10): to the list just left, its filters and page with it.
                Opened on its own (a new tab, a link from elsewhere): Students. */}
            <Link to={createPageUrl('Students')} className="shrink-0" onClick={backToList}>
              <Button variant="ghost" size="icon" title="Back">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="min-w-0">
              <PageTitle eyebrow="Students">Student Details</PageTitle>
              <p className="mt-2 flex max-w-3xl flex-wrap items-center gap-2 text-sm text-slate-500 sm:text-base">
                {/* Who this is, whichever tab is open */}
                <span className="font-semibold text-slate-800">{displayStudent.full_name}</span>
                <span className="font-mono font-semibold text-blue-600">
                  {displayStudent.student_code}
                </span>
                {/* Which sales CRM they came through */}
                <SalesCrmBadge crm={salesCrmOfStudent(displayStudent)} />
                {/* A bonus not decided yet, and where it waits — opens their Funding tab */}
                <BonusPendingBadge info={bonusPending} onClick={() => changeTab('funding')} />
              </p>
              {/* Open, or Closed = enrolled */}
              <div className="mt-2"><EnrolmentControl student={student} currentUser={currentUser} /></div>
              {/* Onboarded: the welcome email / WhatsApp sent, or marked so */}
              <div className="mt-2"><OnboardingControl student={student} currentUser={currentUser} /></div>
              <div className="mt-2"><StudentTagsEditor student={student} currentUser={currentUser} /></div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:max-w-[60%] lg:justify-end">
            {/* Call with 3CX, then log it against the student's follow-up */}
            <CallButton student={displayStudent} className="h-9 px-4 text-sm" />
            {/* Time with a mentor, in the LMS's diary — the Mentor Calendar, filled in for this student */}
            <Link to={`${createPageUrl('MentorCalendar')}?student=${displayStudent.id}`}>
              <Button variant="outline" className="h-9">
                <CalendarPlus className="h-4 w-4 mr-2" />
                Book mentor session
              </Button>
            </Link>
            {/* Their own LMS as they see it, read-only — for their own CS and the Super Admin */}
            {mayViewInLms(currentUser, student, teamIds) && student.email && (
              <ViewInLmsButton studentId={student.id} name={displayStudent.full_name} className="h-9" />
            )}
            {mayActInLms(currentUser, student, teamIds) && student.email && (
              <ViewInLmsButton studentId={student.id} name={displayStudent.full_name} className="h-9" mode="write" />
            )}
            {canEdit ? (
              <Button onClick={() => setShowEditDialog(true)} className="bg-blue-600 hover:bg-blue-700">
                <Edit className="h-4 w-4 mr-2" />
                Edit Student
              </Button>
            ) : (
              // Their CS and the people above them: name, email, phone and country
              <EditDetailsButton student={student} currentUser={currentUser} label="Edit details" />
            )}
          </div>
        </div>

        <Tabs ref={rootRef} value={tab} onValueChange={changeTab}>
          {/* One tab per part of the student — it sticks under the top bar. On a phone or tablet it scrolls sideways;
              on a computer, where all eleven don't fit in a row either, they wrap so none is out of sight. */}
          <div className="sticky top-16 z-20 bg-background/95 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <TabsList
              ref={listRef}
              className="relative flex h-auto w-full justify-start gap-y-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex-wrap lg:overflow-visible"
            >
              {shownTabs.map(({ key, label, icon: Icon }) => (
                <TabsTrigger key={key} value={key} className="shrink-0 gap-1.5">
                  <Icon className="h-4 w-4" />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent {...panel('details')}>
            {/* Student Information Card */}
            <Card className="border-gray-200">
              <CardHeader className="border-b border-gray-100 bg-slate-50/70">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl font-semibold tracking-tight">Student Information</CardTitle>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Priority</span>
                    <PriorityPicker student={displayStudent} currentUser={currentUser} />
                    <span className="text-xs text-slate-500">Language</span>
                    <LanguagePicker student={displayStudent} currentUser={currentUser} />
                    <Badge variant="outline" className={getStatusColor(displayStudent.status)}>
                      {displayStudent.status}
                    </Badge>
                  </div>
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
                    <p className="mt-1 text-base text-gray-900 break-all">
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

                  {/* Their MT5 accounts — from the call log, their funding requests, or added on the MT5 accounts tab */}
                  <div>
                    <label className="text-sm font-medium text-gray-500">MT5 Account</label>
                    <Mt5Logins studentId={student.id} />
                  </div>

                  {/* The language they study in, from their close in the sales CRM (or set here) */}
                  <div>
                    <label className="text-sm font-medium text-gray-500">Language</label>
                    <p className="mt-1 text-base text-gray-900">
                      {displayStudent.language || '-'}
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
                      {/* Dubai / Bangalore: their team's, or with no team the academy they arrived for */}
                      <BangaloreBadge location={history?.location || (displayStudent.location === 'bangalore' ? 'bangalore' : 'dubai')} className="ml-1.5" />
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

                  {/* The sales person who closed them in the sales CRM — one per course they sold */}
                  <div>
                    <label className="text-sm font-medium text-gray-500">Closed By</label>
                    <ClosedByList student={displayStudent} />
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-500">Senior Mentor</label>
                    <p className="mt-1 text-base font-semibold text-gray-900">
                      {displayStudent.senior_mentor_name || '-'}
                    </p>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-500">Student Level</label>
                    <div className="mt-1">
                      <Badge variant="outline" className={displayStudent.student_level === 'LEVEL_2' ? 'bg-purple-100 text-purple-800 border-purple-200' : 'bg-blue-100 text-blue-800 border-blue-200'}>
                        {displayStudent.student_level === 'LEVEL_2' ? 'Level 2' : 'Level 1'}
                      </Badge>
                    </div>
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
          </TabsContent>

          {/* Follow-ups: stage, what they said, next date, click-to-call */}
          <TabsContent {...panel('followups')}>
            <StudentFollowupsSection student={displayStudent} />
          </TabsContent>

          {/* Calls with them through 3CX, with the recordings */}
          <TabsContent {...panel('calls')}>
            <StudentCallsSection student={displayStudent} />
          </TabsContent>

          {/* Each CS's own chats — not the Sales role's to read */}
          {!salesOnly && (
            <TabsContent {...panel('whatsapp')}>
              <StudentWhatsAppCard student={displayStudent} />
            </TabsContent>
          )}

          {/* Every funding request — deposits, withdrawals, bonuses — pending, approved and rejected, with the totals */}
          <TabsContent {...panel('funding')}>
            <StudentFundingCard student={student} transactions={transactions} loading={loadingFunding} />
          </TabsContent>

          {/* What each course cost and what was paid, as Delta finance approved it, and their courses in the Delta LMS */}
          <TabsContent {...panel('courses')}>
            {/* CSE courses: what they have, and upgrades — full or installments, with the MT5 bonus */}
            <StudentCoursesCard student={displayStudent} />
            <CourseFeesCard fees={displayStudent.course_fees} />
            {/* Their Zoho Books invoices, 2024 – Jun 2026 — apart from Delta finance's course fees */}
            <ZohoInvoicesCard studentId={student.id} />
            <StudentLmsCoursesCard student={displayStudent} canManage={canViewInLms(currentUser) && !!student.email} />
          </TabsContent>

          {/* Their live classes in the Delta LMS: attended, missed, upcoming */}
          <TabsContent {...panel('classes')}>
            <StudentClassesCard student={displayStudent} />
          </TabsContent>

          {/* Their Delta LMS support tickets, with the conversation, and class assignments, with the reviews */}
          <TabsContent {...panel('support')}>
            <StudentLmsSupportCards student={displayStudent} />
          </TabsContent>

          {/* Payment links: their CS asks, a Super Admin adds the link */}
          <TabsContent {...panel('payment-links')}>
            <PaymentLinksCard student={displayStudent} />
          </TabsContent>

          {/* MT5 Accounts Section */}
          <TabsContent {...panel('mt5')}>
            <MT5AccountSection student={student} currentUser={currentUser} />
          </TabsContent>

          {/* Everything that happened to this student */}
          <TabsContent {...panel('history')}>
            <StudentHistory studentId={studentId} enabled={!!currentUser} />
          </TabsContent>
        </Tabs>

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
