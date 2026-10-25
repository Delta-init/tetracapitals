import { GraduationCap, Presentation } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
   A student's categories (the user, 2026-10-25), kept by the server by itself:
     Class Completion — attended a live class that ended (students/classCompletions.ts);
     Program Completion — attended every held class of an LMS program that has ended (students/lmsEnrolment.ts,
     program_completions with attended / held).
──────────────────────────────────────────────────────────────────────────── */

export const STUDENT_CATEGORIES = [
  ['class_completion', 'Class Completion'],
  ['program_completion', 'Program Completion'],
];

export function StudentCategoryTags({ student, className = '' }) {
  const cats = Array.isArray(student?.categories) ? student.categories : [];
  if (!cats.length) return null;
  const programs = (student.program_completions || []).filter(p => p.completed).map(p => `${p.title} (${p.attended}/${p.held})`);
  return (
    <span className={cn('inline-flex flex-wrap gap-1', className)}>
      {cats.includes('class_completion') && (
        <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700"
          title={student.class_completion_at ? `Last class completed ${new Date(student.class_completion_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Attended a class that ended'}>
          <Presentation className="h-3 w-3" /> Class Completion
        </span>
      )}
      {cats.includes('program_completion') && (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
          title={programs.length ? `Completed: ${programs.join(', ')}` : 'Completed an LMS program'}>
          <GraduationCap className="h-3 w-3" /> Program Completion
        </span>
      )}
    </span>
  );
}
