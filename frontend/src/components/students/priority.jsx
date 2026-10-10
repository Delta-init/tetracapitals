import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ChevronDown, Loader2 } from 'lucide-react';
import { isAdminRole } from '@/components/utils/roles';
import { isStudentOf } from '@/components/students/common';

/* ────────────────────────────────────────────────────────────────────────────
   A student's priority (the user, 2026-10-10): High, Medium, Normal — also
   when none is set — or Valli, the lowest. Set from the Students table and the
   student page by whoever may change their enrolment (their CS, a CS they are
   Common with, the people above them, admin roles — the server checks);
   anyone else sees the badge. Each change goes in the student's history.
──────────────────────────────────────────────────────────────────────────── */

export const PRIORITY = {
  high: { label: 'High', cls: 'border-rose-200 bg-rose-50 text-rose-700', dot: 'bg-rose-500' },
  medium: { label: 'Medium', cls: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  normal: { label: 'Normal', cls: 'border-slate-200 bg-slate-50 text-slate-600', dot: 'bg-slate-400' },
  valli: { label: 'Valli', cls: 'border-violet-200 bg-violet-50 text-violet-700', dot: 'bg-violet-500' },
};
export const PRIORITY_KEYS = Object.keys(PRIORITY);
export const priorityOf = (s) => (PRIORITY[s?.priority] ? s.priority : 'normal');

const mayChange = (user, student) =>
  !!user && (isAdminRole(user.app_role) || isStudentOf(student, user.id) || ['chief_mentor', 'cs_manager'].includes(user.app_role));
const stop = (e) => e.stopPropagation();   // also in clickable table rows

/** The priority badge — a menu to change it for whoever may. */
export function PriorityPicker({ student, currentUser }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const k = priorityOf(student);
  const badge = (
    <Badge variant="outline" className={`${PRIORITY[k].cls} gap-1 whitespace-nowrap`}>
      {busy && <Loader2 className="h-3 w-3 animate-spin" />}{PRIORITY[k].label}
      {mayChange(currentUser, student) && <ChevronDown className="h-3 w-3 opacity-60" />}
    </Badge>
  );
  if (!mayChange(currentUser, student)) return badge;
  const setTo = async (to) => {
    if (to === k) return;
    setBusy(true);
    try {
      await base44.functions.invoke('setStudentPriority', { studentId: student.id, priority: to });
      queryClient.setQueriesData({ queryKey: ['students', 'page'] }, (d) => (d?.rows ? { ...d, rows: d.rows.map(s => (s.id === student.id ? { ...s, priority: to } : s)) } : d));
      queryClient.invalidateQueries({ queryKey: ['students'] });
      queryClient.invalidateQueries({ queryKey: ['student', student.id] });
      queryClient.invalidateQueries({ queryKey: ['student-history', student.id] });
      toast.success(`Priority: ${PRIORITY[to].label}`);
    } catch (err) {
      toast.error(err?.message || "The priority couldn't be changed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={stop}>
        <button type="button" className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400" title="Priority" disabled={busy}>{badge}</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={stop}>
        {PRIORITY_KEYS.map(p => (
          <DropdownMenuItem key={p} onSelect={() => setTo(p)} className={p === k ? 'font-semibold' : ''}>
            <span className={`mr-2 inline-block h-2 w-2 rounded-full ${PRIORITY[p].dot}`} />
            {PRIORITY[p].label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
