import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import { isAdminRole } from '@/components/utils/roles';

/* ────────────────────────────────────────────────────────────────────────────
   Enrolment: Open, or Closed — the student has enrolled. Unset is Open.
   Changed on the student page by their CS, the people above them (CS Manager,
   Chief) and admin roles (the server checks); each change goes in the
   student's history.
──────────────────────────────────────────────────────────────────────────── */

export const enrolmentOf = (s) => (s?.enrolment_status === 'closed' ? 'closed' : 'open');
export const ENROLMENT = {
  open: { label: 'Open', cls: 'border-slate-200 bg-slate-50 text-slate-600' },
  closed: { label: 'Closed', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
};
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

export function EnrolmentBadge({ student }) {
  const k = enrolmentOf(student);
  const title = k === 'closed'
    ? `Closed — enrolled${student?.enrolment_updated_at ? ` · ${day(student.enrolment_updated_at)}` : ''}${student?.enrolment_updated_by_name ? ` by ${student.enrolment_updated_by_name}` : ''}`
    : 'Open — not enrolled yet';
  return <Badge variant="outline" className={ENROLMENT[k].cls} title={title}>{ENROLMENT[k].label}</Badge>;
}

/** Shown to whoever the server would let change it; anyone else just sees the badge. */
const mayChange = (user, student) =>
  !!user && (isAdminRole(user.app_role) || student?.primary_mentor_id === user.id || ['chief_mentor', 'cs_manager'].includes(user.app_role));

/** The student page's Enrolment: the badge, and Mark as enrolled / Reopen. */
export function EnrolmentControl({ student, currentUser }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const k = enrolmentOf(student);
  const change = async () => {
    setBusy(true);
    try {
      await base44.functions.invoke('setEnrolment', { studentId: student.id, status: k === 'closed' ? 'open' : 'closed' });
      toast.success(k === 'closed' ? 'Enrolment reopened' : 'Marked as enrolled');
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
      {mayChange(currentUser, student) && (
        <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={busy} onClick={change}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : k === 'closed' ? <RotateCcw className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
          {k === 'closed' ? 'Reopen' : 'Mark as enrolled'}
        </Button>
      )}
    </span>
  );
}
