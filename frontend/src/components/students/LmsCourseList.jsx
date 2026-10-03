import { GraduationCap, Lock, LockOpen } from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────────
   The Delta LMS courses a student is on, under their Enrolled switch — in the
   Students table and on the student page. As the hourly LMS check last kept
   them (backend/src/students/lmsEnrolment.ts → student.lms_courses); the
   student page's Courses card asks the LMS fresh and has the detail. Dropped
   courses are left out here.
──────────────────────────────────────────────────────────────────────────── */

export const PROGRAMME = { '4x-trading': 'FOREX Trading', 'digital-marketing': 'Digital Marketing', ai: 'AI', jura: 'JURA' };
export const ACCESS = { paid: 'Fully paid', partial: 'Part paid', unpaid: 'Not paid' };

/**
 * How many of a course's modules they can open — locked until the fee is paid, or by an admin by hand
 * (the LMS's count). "—" from an LMS that does not say yet; `inline` for one line, and nothing then.
 */
export function LmsModules({ modules: m, inline = false }) {
  if (!m || typeof m.total !== 'number') return inline ? null : <span className="text-slate-400">—</span>;
  if (m.total === 0) return <span className="text-xs text-slate-400">No modules</span>;
  if (!m.locked) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-emerald-700">
        <LockOpen className={inline ? 'h-3 w-3' : 'h-3.5 w-3.5'} />All {m.total} {inline ? 'modules ' : ''}unlocked
      </span>
    );
  }
  if (inline) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-slate-600">
        <Lock className="h-3 w-3 text-amber-600" />{m.unlocked} of {m.total} modules unlocked<span className="text-amber-700">· {m.locked} locked</span>
      </span>
    );
  }
  return (
    <div className="whitespace-nowrap">
      <div className="text-slate-700">{m.unlocked} of {m.total} unlocked</div>
      <div className="flex items-center gap-1 text-xs text-amber-700"><Lock className="h-3 w-3" />{m.locked} locked</div>
    </div>
  );
}

const describe = (c) => [
  c.title,
  PROGRAMME[c.program] || c.program,
  c.academy,
  c.status === 'completed' ? 'Completed' : `${c.progress || 0}% done`,
  ACCESS[c.access],
].filter(Boolean).join(' · ');

export function LmsCourseList({ student, max = 3 }) {
  const courses = (student?.lms_courses || []).filter(c => c.status !== 'dropped');
  if (!courses.length) return null;
  return (
    <div className="mt-1 flex max-w-[280px] flex-col gap-0.5">
      {courses.slice(0, max).map(c => (
        <span key={c.course_id || c.title} className="truncate text-[11px] leading-tight text-slate-600" title={describe(c)}>
          <GraduationCap className="mr-1 inline h-3 w-3 align-[-2px] text-indigo-500" />
          {c.title || 'A course'}
          <span className={c.status === 'completed' ? 'text-emerald-700' : 'text-slate-400'}>
            {' · '}{c.status === 'completed' ? 'completed' : `${c.progress || 0}%`}
          </span>
        </span>
      ))}
      {courses.length > max && (
        <span className="text-[10px] text-slate-400" title={courses.slice(max).map(describe).join('\n')}>+{courses.length - max} more</span>
      )}
    </div>
  );
}
