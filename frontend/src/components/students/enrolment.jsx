import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Archive, CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import { isAdminRole } from '@/components/utils/roles';
import { isStudentOf } from '@/components/students/common';
import { useStudentTagCatalog } from '@/components/students/tags';
import { courseLabel } from '@/components/utils/studentProducts';
import { LmsCourseList } from '@/components/students/LmsCourseList';

/* ────────────────────────────────────────────────────────────────────────────
   Enrolment: Enrolled (stored "closed" — the "Closed - <course>" tags say
   which course), Not enrolled ("open", or unset), or Old — from a CS's earlier
   list, not enrolled.
   The Delta LMS sets it every hour: an LMS account = Enrolled, none = Not
   enrolled (backend/src/students/lmsEnrolment.ts). It can still be changed on
   the student page and with the Students table's switch, by their CS (or a CS
   they are Common with), the people above them (CS Manager, Chief) and admin
   roles (the server checks); a change against what the LMS says stays until
   the LMS agrees. Marking a student enrolled asks which course: its
   "Closed - <course>" tag goes on with it. Each change goes in the student's
   history.
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
const NONE = '__none__';
const stop = (e) => e.stopPropagation();   // also opened from clickable table rows

/**
 * "Which course did they enrol in?" — asked whenever a student is marked enrolled. The courses are the
 * "Closed - <course>" tags (products, LMS courses, the tracker's); the one chosen goes on the student with the
 * enrolment. "Not in the list" marks them enrolled without a course.
 */
function EnrolCourseDialog({ student, open, onOpenChange }) {
  const queryClient = useQueryClient();
  const set = useSetEnrolment(student);
  const { data: catalog = [] } = useStudentTagCatalog();
  const courses = catalog.filter(t => t.kind === 'closed' && t.active !== false).map(t => t.name).sort((a, b) => a.localeCompare(b));
  const own = Array.isArray(student?.tags) ? student.tags : [];
  const guess = [CLOSED_PREFIX + courseLabel(student?.lms_course), ...own].find(t => courses.includes(t));
  const [pick, setPick] = useState(null);
  const [saving, setSaving] = useState(false);
  const chosen = pick ?? guess ?? null;
  const save = async () => {
    setSaving(true);
    try {
      if (!isEnrolled(student)) await set('closed');
      if (chosen && chosen !== NONE && !own.includes(chosen)) {
        await base44.functions.invoke('setStudentTag', { studentId: student.id, tag: chosen, on: true });
        queryClient.invalidateQueries({ queryKey: ['students'] });
        queryClient.invalidateQueries({ queryKey: ['student', student.id] });
        queryClient.invalidateQueries({ queryKey: ['student-history', student.id] });
      }
      toast.success(`${student.full_name || 'Student'} marked as enrolled${chosen && chosen !== NONE ? ` — ${chosen.slice(CLOSED_PREFIX.length)}` : ''}`);
      setPick(null);
      onOpenChange(false);
    } catch (e) {
      toast.error(e?.message || 'Could not mark them enrolled');
    } finally {
      setSaving(false);
    }
  };
  const option = (value, label) => (
    <button
      key={value}
      type="button"
      onClick={() => setPick(value)}
      className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${chosen === value ? 'border-emerald-400 bg-emerald-50 font-medium text-emerald-800' : 'border-slate-200 hover:bg-slate-50'}`}
    >
      {label}
    </button>
  );
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) { setPick(null); onOpenChange(o); } }}>
      <DialogContent className="max-w-md" onClick={stop}>
        <DialogHeader>
          <DialogTitle>Which course did {student?.full_name || 'they'} enrol in?</DialogTitle>
          <DialogDescription>On the Delta LMS. The course goes on them as a tag, with Enrolled.</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {courses.map(c => option(c, c.slice(CLOSED_PREFIX.length)))}
          {option(NONE, 'Not in the list — just mark enrolled')}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !chosen}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Mark as enrolled
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The student page's Enrolment: the badge, and a button for each of the other two. */
export function EnrolmentControl({ student, currentUser }) {
  const set = useSetEnrolment(student);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const k = enrolmentOf(student);
  const change = async (to) => {
    if (to === 'closed') { setAsking(true); return; }
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
        {mayChange(currentUser, student) && ['closed', 'old', 'open'].filter(to => to !== k).map(to => (
          <Button key={to} size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={!!busy} onClick={() => change(to)}>
            {busy === to ? <Loader2 className="h-3 w-3 animate-spin" /> : to === 'closed' ? <CheckCircle2 className="h-3 w-3" /> : to === 'open' ? <RotateCcw className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
            {ENROLMENT[to].action}
          </Button>
        ))}
        {asking && <EnrolCourseDialog student={student} open onOpenChange={setAsking} />}
      </span>
      {/* Their Delta LMS courses, under the enrolment */}
      <LmsCourseList student={student} max={6} />
    </div>
  );
}

/**
 * The Students table's Enrolled: a switch (Enrolled ↔ Not enrolled) for whoever may change it, Yes / No for anyone
 * else, and under it the student's Delta LMS courses. The switch is a button, so clicking it never opens the student.
 */
export function EnrolledSwitch({ student, currentUser }) {
  const set = useSetEnrolment(student);
  const [busy, setBusy] = useState(false);
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
  const flip = async (next) => {
    if (next) { setAsking(true); return; }   // enrolled in which course? asked first
    setBusy(true);
    try {
      await set(next ? 'closed' : 'open');
      toast.success(`${student.full_name || 'Student'} ${DONE[next ? 'closed' : 'open']}`);
    } catch (e) {
      toast.error(e?.message || 'Could not change the enrolment');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <span className="inline-flex items-center gap-2 whitespace-nowrap" title={title}>
        <Switch checked={on} disabled={busy} onCheckedChange={flip} aria-label={`${student.full_name || 'Student'} enrolled`} />
        <span className={`text-xs ${on ? 'font-medium text-emerald-700' : 'text-slate-500'}`}>{on ? 'Enrolled' : 'Not enrolled'}</span>
        {student.enrolment_manual && <span className="text-[10px] font-medium uppercase tracking-wide text-amber-600">by hand</span>}
        {asking && <EnrolCourseDialog student={student} open onOpenChange={setAsking} />}
      </span>
      <LmsCourseList student={student} />
    </div>
  );
}
