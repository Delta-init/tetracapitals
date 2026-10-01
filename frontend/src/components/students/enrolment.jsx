import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Archive, CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import { isAdminRole } from '@/components/utils/roles';
import { isStudentOf } from '@/components/students/common';

/* ────────────────────────────────────────────────────────────────────────────
   Enrolment: Open; Closed — the student has enrolled; or Old — from a CS's
   earlier list, not enrolled. Unset is Open.
   Changed on the student page by their CS (or a CS they are Common with), the people above them (CS Manager,
   Chief) and admin roles (the server checks); each change goes in the
   student's history.
──────────────────────────────────────────────────────────────────────────── */

export const enrolmentOf = (s) => (s?.enrolment_status === 'closed' || s?.enrolment_status === 'old' ? s.enrolment_status : 'open');
export const ENROLMENT = {
  open: { label: 'Open', cls: 'border-slate-200 bg-slate-50 text-slate-600', hint: 'Open — not enrolled yet', action: 'Set to Open' },
  closed: { label: 'Closed', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700', hint: 'Closed — enrolled', action: 'Mark as enrolled' },
  old: { label: 'Old', cls: 'border-amber-200 bg-amber-50 text-amber-700', hint: "Old — from a CS's earlier list, not enrolled", action: 'Mark as old' },
};
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

export function EnrolmentBadge({ student }) {
  const k = enrolmentOf(student);
  const title = `${ENROLMENT[k].hint}${student?.enrolment_updated_at ? ` · ${day(student.enrolment_updated_at)}` : ''}${student?.enrolment_updated_by_name ? ` by ${student.enrolment_updated_by_name}` : ''}`;
  return <Badge variant="outline" className={ENROLMENT[k].cls} title={title}>{ENROLMENT[k].label}</Badge>;
}

/** Shown to whoever the server would let change it; anyone else just sees the badge. */
const mayChange = (user, student) =>
  !!user && (isAdminRole(user.app_role) || isStudentOf(student, user.id) || ['chief_mentor', 'cs_manager'].includes(user.app_role));

/** The student page's Enrolment: the badge, and a button for each of the other two. */
export function EnrolmentControl({ student, currentUser }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const k = enrolmentOf(student);
  const change = async (to) => {
    setBusy(to);
    try {
      await base44.functions.invoke('setEnrolment', { studentId: student.id, status: to });
      toast.success(to === 'closed' ? 'Marked as enrolled' : to === 'old' ? 'Marked as old' : 'Enrolment set to Open');
      queryClient.invalidateQueries({ queryKey: ['student', student.id] });
      queryClient.invalidateQueries({ queryKey: ['student-history', student.id] });
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
          {to === 'open' && k === 'closed' ? 'Reopen' : ENROLMENT[to].action}
        </Button>
      ))}
    </span>
  );
}
