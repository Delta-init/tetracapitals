import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, Copy, FileCheck } from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────────
   LMS exams here (the user, 2026-10-10), read from the LMS (backend
   functions/lmsExams.ts): the Exams page lists an academy's exams with their
   address to copy; a student's Exams tab shows where they stand in each and a
   link made for them — one tap signs them in and opens the exam (24 hours).
──────────────────────────────────────────────────────────────────────────── */

const STATUS = {
  not_started: { label: 'Not started', cls: 'border-slate-200 bg-slate-50 text-slate-600' },
  in_progress: { label: 'In progress', cls: 'border-sky-200 bg-sky-50 text-sky-700' },
  submitted: { label: 'Submitted · awaiting marks', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  suspended: { label: 'Suspended', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  graded: { label: 'Graded', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
};
const day = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '');

/** When it is open: "Open until 31 Dec 2026", "Opens 1 Nov…", or nothing when always open. */
export const openText = (e) => [e.availableFrom && `from ${day(e.availableFrom)}`, e.availableTo && `until ${day(e.availableTo)}`].filter(Boolean).join(' ');

export function ExamStatus({ exam }) {
  const s = STATUS[exam.status] || STATUS.not_started;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant="outline" className={s.cls}>{s.label}</Badge>
      {exam.status === 'graded' && exam.totalMarks != null && (
        <span className="text-sm font-medium text-slate-800">
          {exam.totalMarks}/{exam.maxMarks}
          {exam.passed != null && <span className={exam.passed ? 'ml-1 text-emerald-700' : 'ml-1 text-rose-700'}>· {exam.passed ? 'Passed' : 'Not passed'}</span>}
        </span>
      )}
      {exam.status === 'suspended' && exam.suspendedReason && <span className="text-xs text-rose-700">{exam.suspendedReason}</span>}
    </span>
  );
}

/** Copies a link, and says so. */
export function CopyLinkButton({ link, label = 'Copy link', title }) {
  const [done, setDone] = useState(false);
  const copy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(link);
      setDone(true);
      toast.success('Link copied');
      setTimeout(() => setDone(false), 2000);
    } catch {
      window.prompt('Copy this link', link);
    }
  };
  return (
    <Button type="button" size="sm" variant="outline" onClick={copy} disabled={!link} title={title || link}>
      {done ? <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-600" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}{label}
    </Button>
  );
}

/** The student page's Exams tab: their exams in the LMS, where they stand, and their own sign-in link to each. */
export function StudentExamsCard({ student }) {
  const q = useQuery({
    queryKey: ['student-lms-exams', student.id],
    queryFn: async () => (await base44.functions.invoke('getStudentLmsExams', { studentId: student.id })).data,
    retry: false,
    staleTime: 10 * 60_000,   // each look makes them fresh sign-in links: not on every focus
    refetchOnWindowFocus: false,
  });
  const d = q.data;
  return (
    <Card className="border-gray-200">
      <CardHeader className="border-b border-gray-100 bg-slate-50/70">
        <CardTitle className="flex items-center gap-2 text-lg"><FileCheck className="h-5 w-5 text-blue-600" />Exams</CardTitle>
        <p className="text-xs text-slate-500">From the Delta LMS. "Copy link" gives a link made for this student: one tap signs them in and opens the exam — for 24 hours, so send it, don't share it with others.</p>
      </CardHeader>
      <CardContent className="p-0">
        {q.isLoading ? <div className="p-4"><Skeleton className="h-24 w-full" /></div>
          : q.isError ? <p className="p-4 text-sm text-slate-500">{q.error?.message || "The exams couldn't be loaded."}</p>
            : d?.configured === false ? <p className="p-4 text-sm text-slate-500">The LMS isn't connected on this server.</p>
              : d?.account === false ? <p className="p-4 text-sm text-slate-500">This student has no Delta LMS account (by their email).</p>
                : !d?.exams?.length ? <p className="p-4 text-sm text-slate-500">No exams on this student's courses yet.</p>
                  : (
                    <ul className="divide-y divide-slate-100">
                      {d.exams.map(e => (
                        <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900">{e.title}</p>
                            <p className="text-xs text-slate-500">{[e.course, `${e.durationMinutes} min`, `${e.questionCount} questions`, `pass ${e.passPercent}%`, openText(e)].filter(Boolean).join(' · ')}</p>
                            <div className="mt-1"><ExamStatus exam={e} /></div>
                          </div>
                          <CopyLinkButton link={e.link} label="Copy their link" title="Signs this student in and opens the exam — 24 hours" />
                        </li>
                      ))}
                    </ul>
                  )}
      </CardContent>
    </Card>
  );
}
