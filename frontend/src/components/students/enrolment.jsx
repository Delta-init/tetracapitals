import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Archive, CheckCircle2, ChevronDown, Loader2, Lock, LockOpen, RotateCcw } from 'lucide-react';
import { isAdminRole } from '@/components/utils/roles';
import { isStudentOf } from '@/components/students/common';
import { courseLabel } from '@/components/utils/studentProducts';
import { LmsCourseList, LmsModules } from '@/components/students/LmsCourseList';

/* ────────────────────────────────────────────────────────────────────────────
   Enrolment: Enrolled (stored "closed" — the "Closed - <course>" tags say
   which course), Not enrolled ("open", or unset), or Old — from a CS's earlier
   list, not enrolled.
   The Delta LMS sets it every hour: an LMS account = Enrolled, none = Not
   enrolled (backend/src/students/lmsEnrolment.ts). By hand — on the student
   page and with the Students table's switch, by their CS (or a CS they are
   Common with), the people above them (CS Manager, Chief) and admin roles (the
   server checks) — a student can be marked Not enrolled or Old, never
   Enrolled: courses, and so enrolment, come through finance and the LMS (the
   user, 2026-10-03). The switch opens the student's courses, view only — the
   ones they are on, with how far they are in the LMS — and "Mark as not
   enrolled" lives there. A change against what the LMS says stays until the
   LMS agrees. Each change goes in the student's history.
──────────────────────────────────────────────────────────────────────────── */

export const enrolmentOf = (s) => (s?.enrolment_status === 'closed' || s?.enrolment_status === 'old' ? s.enrolment_status : 'open');
export const isEnrolled = (s) => enrolmentOf(s) === 'closed';
export const ENROLMENT = {
  open: { label: 'Not enrolled', cls: 'border-slate-200 bg-slate-50 text-slate-600', hint: 'Not enrolled yet', action: 'Mark as not enrolled' },
  closed: { label: 'Enrolled', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700', hint: 'Enrolled', action: 'Mark as enrolled' },
  old: { label: 'Old', cls: 'border-amber-200 bg-amber-50 text-amber-700', hint: "Old — from a CS's earlier list, not enrolled", action: 'Mark as old' },
};
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const changedBy = (s) => `${s?.enrolment_updated_at ? ` · ${day(s.enrolment_updated_at)}` : ''}${s?.enrolment_updated_by_name ? ` by ${s.enrolment_updated_by_name}` : ''}`;
/** What the LMS says about them, and whether a person set it against that. */
const lmsNote = (s) => {
  const acc = s?.lms_account;
  const lms = !acc ? '' : acc.exists ? ' · has a Delta LMS account' : ' · no Delta LMS account';
  return `${lms}${s?.enrolment_manual ? ' · set by hand — kept until the LMS agrees' : ''}`;
};
const DONE = { closed: 'marked as enrolled', open: 'marked as not enrolled', old: 'marked as old' };

export function EnrolmentBadge({ student }) {
  const k = enrolmentOf(student);
  return <Badge variant="outline" className={ENROLMENT[k].cls} title={`${ENROLMENT[k].hint}${lmsNote(student)}${changedBy(student)}`}>{ENROLMENT[k].label}</Badge>;
}

/** Shown to whoever the server would let change it; anyone else just sees the badge. */
const mayChange = (user, student) =>
  !!user && (isAdminRole(user.app_role) || isStudentOf(student, user.id) || ['chief_mentor', 'cs_manager'].includes(user.app_role));

/** Sets a student's enrolment and refreshes whatever shows it. */
function useSetEnrolment(student) {
  const queryClient = useQueryClient();
  return async (to) => {
    await base44.functions.invoke('setEnrolment', { studentId: student.id, status: to });
    // The Students list shows it at once (its pages from the server); the server's copy follows.
    queryClient.setQueriesData({ queryKey: ['students', 'page'] }, (d) => (d?.rows ? { ...d, rows: d.rows.map(s => (s.id === student.id ? { ...s, enrolment_status: to } : s)) } : d));
    queryClient.invalidateQueries({ queryKey: ['students'] });
    queryClient.invalidateQueries({ queryKey: ['student', student.id] });
    queryClient.invalidateQueries({ queryKey: ['student-history', student.id] });
  };
}

const CLOSED_PREFIX = 'Closed - ';
const stop = (e) => e.stopPropagation();   // also opened from clickable table rows

/**
 * The student's courses — opened by the Enrolled switch. View only (the user, 2026-10-03): the courses they are on —
 * their "Closed - <course>" tags, and the Delta LMS courses they are on without one — each with how far they are in
 * the LMS and which of its modules they can open ("Show modules" lists each). Nobody adds a course here: courses come
 * through finance. On an enrolled student this is where "Mark as not enrolled" lives, since the switch opens it
 * rather than turning enrolment off.
 */
function StudentCoursesDialog({ student, open, onOpenChange }) {
  const set = useSetEnrolment(student);
  const enrolled = isEnrolled(student);
  const name = student?.full_name || 'Student';
  const { data: lms, isLoading: lmsLoading } = useQuery({
    queryKey: ['student-lms-courses', student?.id],
    queryFn: async () => (await base44.functions.invoke('getStudentLmsCourses', { studentId: student.id })).data,
    enabled: open && !!student?.id,
    staleTime: 60_000,
  });

  const own = (Array.isArray(student?.tags) ? student.tags : []).filter(t => t.startsWith(CLOSED_PREFIX)).sort((a, b) => a.localeCompare(b));
  const lmsCourses = (lms?.courses || []).filter(c => c.status !== 'dropped');
  const tagOf = (c) => CLOSED_PREFIX + courseLabel(c.title);
  const lmsByTag = new Map(lmsCourses.map(c => [tagOf(c), c]));
  // On in the LMS under a course they have no tag for: shown too.
  const lmsOnly = lmsCourses.filter(c => !own.includes(tagOf(c)));
  const [saving, setSaving] = useState(false);
  const close = () => { if (!saving) onOpenChange(false); };

  const unenrol = async () => {
    setSaving(true);
    try {
      await set('open');
      toast.success(`${name} ${DONE.open}`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e?.message || 'Could not change the enrolment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-lg" onClick={stop}>
        <DialogHeader>
          <DialogTitle>{name}'s courses</DialogTitle>
          <DialogDescription>The courses they are on, with how far they are in the Delta LMS. Courses are added through finance, not here.</DialogDescription>
        </DialogHeader>
        {lmsLoading ? (
          <p className="text-xs text-slate-400">Asking the LMS how far they are…</p>
        ) : lms?.configured && !lms.available ? (
          <p className="text-xs text-amber-700">{lms.message || 'The LMS could not be asked'}</p>
        ) : null}
        <div className="max-h-[440px] space-y-1.5 overflow-y-auto pr-1">
          {own.map(tag => <CourseRow key={tag} label={tag.slice(CLOSED_PREFIX.length)} have course={lmsByTag.get(tag)} />)}
          {lmsOnly.map(c => (
            <CourseRow key={c.enrolmentId || c.title} label={c.title || 'A course'} course={c} note="On it in the LMS — no course tag names it" />
          ))}
          {!lmsLoading && !own.length && !lmsOnly.length && <p className="py-4 text-center text-sm text-slate-400">No courses yet — they come through finance.</p>}
        </div>
        <DialogFooter className="gap-2 sm:justify-between sm:gap-0">
          {enrolled ? (
            <Button variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800" onClick={unenrol} disabled={saving}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1.5 h-4 w-4" />}{ENROLMENT.open.action}
            </Button>
          ) : <span />}
          <Button variant="outline" onClick={close} disabled={saving}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One course they are on: how far they are in the LMS when it knows. */
function CourseRow({ label, have = false, course, note }) {
  const [showModules, setShowModules] = useState(false);
  const list = course?.modules?.list;
  return (
    <div className={`rounded-lg border px-3 py-2 ${have ? 'border-emerald-200 bg-emerald-50/50' : 'border-indigo-200 bg-indigo-50/40'}`}>
      <div className="flex items-start gap-2.5">
        <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${have ? 'text-emerald-600' : 'text-indigo-500'}`} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-slate-900">{label}</span>
            {have && <Badge variant="outline" className={ENROLMENT.closed.cls}>Enrolled</Badge>}
            {!have && course && <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">On it in the LMS</Badge>}
          </span>
          {note && <span className="mt-0.5 block text-xs text-slate-400">{note}</span>}
        </span>
      </div>
      {course && (
        <div className="mt-1.5 pl-[26px]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, Math.max(0, course.progress || 0))}%` }} />
              </span>
              {course.status === 'completed' ? 'Completed' : `${course.progress || 0}% done`}
            </span>
            <LmsModules modules={course.modules} inline />
            {Array.isArray(list) && list.length > 0 && (
              <button type="button" onClick={() => setShowModules(v => !v)} className="inline-flex items-center gap-0.5 font-medium text-indigo-600 hover:underline">
                {showModules ? 'Hide modules' : 'Show modules'}
                <ChevronDown className={`h-3 w-3 transition-transform ${showModules ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>
          {showModules && Array.isArray(list) && (
            <ol className="mt-1.5 grid gap-0.5 text-xs">
              {list.map((m, i) => (
                <li key={i} className={`flex items-center gap-1.5 ${m.locked ? 'text-amber-800' : 'text-slate-700'}`}>
                  {m.locked ? <Lock className="h-3 w-3 shrink-0 text-amber-600" /> : <LockOpen className="h-3 w-3 shrink-0 text-emerald-600" />}
                  <span className="truncate">{i + 1}. {m.title || 'Untitled module'}</span>
                  <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-slate-400">{m.locked ? 'Locked' : 'Open'}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

/** The student page's Enrolment: the badge, and Mark as not enrolled / Mark as old — never enrolled by hand. */
export function EnrolmentControl({ student, currentUser }) {
  const set = useSetEnrolment(student);
  const [busy, setBusy] = useState(false);
  const k = enrolmentOf(student);
  const change = async (to) => {
    setBusy(to);
    try {
      await set(to);
      toast.success(`${student.full_name || 'Student'} ${DONE[to]}`);
    } catch (e) {
      toast.error(e?.message || 'Could not change the enrolment');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <span className="inline-flex items-center gap-2">
        <span className="text-sm text-slate-500">Enrolment</span>
        <EnrolmentBadge student={student} />
        {mayChange(currentUser, student) && ['old', 'open'].filter(to => to !== k).map(to => (
          <Button key={to} size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={!!busy} onClick={() => change(to)}>
            {busy === to ? <Loader2 className="h-3 w-3 animate-spin" /> : to === 'open' ? <RotateCcw className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
            {ENROLMENT[to].action}
          </Button>
        ))}
      </span>
      {/* Their Delta LMS courses, under the enrolment */}
      <LmsCourseList student={student} max={6} />
    </div>
  );
}

/**
 * The Students table's Enrolled: a switch for whoever may change it, Yes / No for anyone else, and under it the
 * student's Delta LMS courses. On or off, the switch opens the student's courses, view only — with "Mark as not
 * enrolled" for one who is enrolled. The switch is a button, so clicking it never opens the student.
 */
export function EnrolledSwitch({ student, currentUser }) {
  const [asking, setAsking] = useState(false);
  const on = isEnrolled(student);
  const title = `${ENROLMENT[enrolmentOf(student)].hint}${lmsNote(student)}${changedBy(student)}`;
  if (!mayChange(currentUser, student)) {
    return (
      <div>
        <Badge variant="outline" className={on ? ENROLMENT.closed.cls : 'border-slate-200 bg-slate-50 text-slate-500'} title={title}>{on ? 'Yes' : 'No'}</Badge>
        <LmsCourseList student={student} />
      </div>
    );
  }
  return (
    <div>
      <span className="inline-flex items-center gap-2 whitespace-nowrap" title={title}>
        <Switch checked={on} onCheckedChange={() => setAsking(true)} aria-label={`${student.full_name || 'Student'} enrolled — their courses`} />
        <span className={`text-xs ${on ? 'font-medium text-emerald-700' : 'text-slate-500'}`}>{on ? 'Enrolled' : 'Not enrolled'}</span>
        {student.enrolment_manual && <span className="text-[10px] font-medium uppercase tracking-wide text-amber-600">by hand</span>}
        {asking && <StudentCoursesDialog student={student} open onOpenChange={setAsking} />}
      </span>
      <LmsCourseList student={student} />
    </div>
  );
}
