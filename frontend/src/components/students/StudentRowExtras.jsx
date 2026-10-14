import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Receipt, UserX } from 'lucide-react';
import CourseFeesCard from './CourseFeesCard';
import ZohoInvoicesCard from './ZohoInvoicesCard';
import StudentCoursesCard from './StudentCoursesCard';
import { isStudentOf } from './common';

/* ────────────────────────────────────────────────────────────────────────────
   Two buttons on each Students row (the user, 2026-10-14):
     Fees            — a window with what the student's courses cost and what
                       was paid: their courses, Delta finance's course fees and
                       their Zoho Books invoices, as their page shows them.
     Not a student   — marks them not a student, with why (backend
                       functions/notStudent.ts): gone from every list, kept
                       on Inactive students where they can be marked back.
──────────────────────────────────────────────────────────────────────────── */

/** Whether this person may mark the student not a student: their CS (Common ones too), a CS Manager, an admin. */
export const mayMarkNotStudent = (user, student) =>
  !!user && (['super_admin', 'admin', 'cs_manager'].includes(user.app_role) || isStudentOf(student, user.id));

export function FeesDialog({ studentId, name, open, onOpenChange }) {
  const { data: student, isLoading } = useQuery({
    queryKey: ['student', studentId],
    queryFn: () => base44.entities.Student.get(studentId),
    enabled: open && !!studentId,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Fees — {name || student?.full_name || 'Student'}</DialogTitle>
          <DialogDescription>Their courses, Delta finance's course fees and their Zoho Books invoices.</DialogDescription>
        </DialogHeader>
        {isLoading || !student ? (
          <div className="flex items-center gap-2 py-8 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : (
          <div className="space-y-4">
            <StudentCoursesCard student={student} />
            <CourseFeesCard fees={student.course_fees} />
            <ZohoInvoicesCard studentId={student.id} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function NotStudentDialog({ student, open, onOpenChange, onDone }) {
  const [reason, setReason] = useState('');
  const queryClient = useQueryClient();
  const mark = useMutation({
    mutationFn: async () => (await base44.functions.invoke('markNotStudent', { studentId: student.id, reason })).data,
    onSuccess: () => {
      toast.success(`${student.full_name} marked not a student — on Inactive students now`);
      queryClient.invalidateQueries({ queryKey: ['students'] });
      queryClient.invalidateQueries({ queryKey: ['student', student.id] });
      queryClient.invalidateQueries({ queryKey: ['not-students'] });
      setReason('');
      onOpenChange(false);
      onDone?.();
    },
    onError: (e) => toast.error(/unknown function|not found|404/i.test(String(e?.message)) ? 'This needs the server update (the API deploy)' : e?.message || "Couldn't mark them"),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
        <DialogHeader>
          <DialogTitle>Not a student — {student?.full_name}</DialogTitle>
          <DialogDescription>They leave the Students page and every work list (follow-ups, not onboarded, class completions, balances) and show only on Inactive students, where a CS Manager or admin can mark them a student again. Nothing is deleted.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="not-student-reason">Why *</Label>
          <Textarea id="not-student-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. a duplicate, a parent's number, never enquired…" rows={3} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-red-600 hover:bg-red-700" disabled={!reason.trim() || mark.isPending} onClick={() => mark.mutate()}>
            {mark.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Mark not a student
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The two row buttons. */
export default function StudentRowExtras({ student, currentUser }) {
  const [fees, setFees] = useState(false);
  const [notStudent, setNotStudent] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="View fees" aria-label={`View fees — ${student.full_name}`} onClick={() => setFees(true)}>
        <Receipt className="h-4 w-4" />
      </Button>
      {mayMarkNotStudent(currentUser, student) && (
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-gray-500 hover:bg-red-50 hover:text-red-600" title="Not a student" aria-label={`Mark ${student.full_name} not a student`} onClick={() => setNotStudent(true)}>
          <UserX className="h-4 w-4" />
        </Button>
      )}
      {fees && <FeesDialog studentId={student.id} name={student.full_name} open={fees} onOpenChange={setFees} />}
      {notStudent && <NotStudentDialog student={student} open={notStudent} onOpenChange={setNotStudent} />}
    </>
  );
}
