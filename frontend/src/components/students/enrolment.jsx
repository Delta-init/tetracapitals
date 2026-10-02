import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Archive, CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import { isAdminRole } from '@/components/utils/roles';
import { isStudentOf } from '@/components/students/common';

/* ────────────────────────────────────────────────────────────────────────────
   Enrolment: Enrolled (stored "closed" — the "Closed - <course>" tags say
   which course), Not enrolled ("open", or unset), or Old — from a CS's earlier
   list, not enrolled.
   The Delta LMS sets it every hour: an LMS account = Enrolled, none = Not
   enrolled (backend/src/students/lmsEnrolment.ts). It can still be changed on
   the student page and with the Students table's switch, by their CS (or a CS
   they are Common with), the people above them (CS Manager, Chief) and admin
   roles (the server checks); a change against what the LMS says stays until
   the LMS agrees. Each change goes in the student's history.
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

/** The student page's Enrolment: the badge, and a button for each of the other two. */
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
    <span className="inline-flex items-center gap-2">
      <span className="text-sm text-slate-500">Enrolment</span>
      <EnrolmentBadge student={student} />
      {mayChange(currentUser, student) && ['closed', 'old', 'open'].filter(to => to !== k).map(to => (
        <Button key={to} size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={!!busy} onClick={() => change(to)}>
          {busy === to ? <Loader2 className="h-3 w-3 animate-spin" /> : to === 'closed' ? <CheckCircle2 className="h-3 w-3" /> : to === 'open' ? <RotateCcw className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
          {ENROLMENT[to].action}
        </Button>
      ))}
    </span>
  );
}

/**
 * The Students table's Enrolled: a switch (Enrolled ↔ Not enrolled) for whoever may change it, Yes / No for anyone
 * else. It is a button, so clicking it never opens the student.
 */
export function EnrolledSwitch({ student, currentUser }) {
  const set = useSetEnrolment(student);
  const [busy, setBusy] = useState(false);
  const on = isEnrolled(student);
  const title = `${ENROLMENT[enrolmentOf(student)].hint}${lmsNote(student)}${changedBy(student)}`;
  if (!mayChange(currentUser, student)) {
    return <Badge variant="outline" className={on ? ENROLMENT.closed.cls : 'border-slate-200 bg-slate-50 text-slate-500'} title={title}>{on ? 'Yes' : 'No'}</Badge>;
  }
  const flip = async (next) => {
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
    <span className="inline-flex items-center gap-2 whitespace-nowrap" title={title}>
      <Switch checked={on} disabled={busy} onCheckedChange={flip} aria-label={`${student.full_name || 'Student'} enrolled`} />
      <span className={`text-xs ${on ? 'font-medium text-emerald-700' : 'text-slate-500'}`}>{on ? 'Enrolled' : 'Not enrolled'}</span>
      {student.enrolment_manual && <span className="text-[10px] font-medium uppercase tracking-wide text-amber-600">by hand</span>}
    </span>
  );
}
