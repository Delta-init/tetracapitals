import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Award, BookOpen } from 'lucide-react';
import { PROGRAMME, ACCESS, LmsModules } from '@/components/students/LmsCourseList';
import { CourseAccessButton } from '@/components/students/LmsCourseAccess';

/* ────────────────────────────────────────────────────────────────────────────
   The Delta LMS courses the student is on, fresh from the LMS by their email,
   across both academies (backend/src/functions/lmsCourses.ts → the LMS's
   /service/enrolments): each course, how they were put on it, how much of it
   the fee has opened, how many of its modules they can open and how many are
   locked (by the fee, or by an admin by hand), their progress, and whether
   they finished it — with the certificate — or dropped it. The Students table
   shows the same courses under the Enrolled switch, as the hourly LMS check
   last saw them. Their CS (and leaders) and the Super Admin can put them on a
   Forex course and open or lock its modules here — Course access
   (components/students/LmsCourseAccess.jsx).
──────────────────────────────────────────────────────────────────────────── */

const HOW = { purchase: 'Bought', finance: 'Finance invoice', admin: 'By admin', script: 'By script', free: 'Free' };
const STATUS = {
  active: { label: 'Active', cls: 'border-sky-200 bg-sky-50 text-sky-700' },
  completed: { label: 'Completed', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  dropped: { label: 'Dropped', cls: 'border-slate-200 bg-slate-100 text-slate-500' },
};
const ACCESS_CLS = { paid: 'text-emerald-700', partial: 'text-amber-700', unpaid: 'text-rose-700' };
const day = (iso) => (iso ? format(new Date(iso), 'd MMM yyyy') : '—');

export default function StudentLmsCoursesCard({ student, canManage = false }) {
  const { data, isLoading } = useQuery({
    queryKey: ['student-lms-courses', student?.id],
    queryFn: async () => (await base44.functions.invoke('getStudentLmsCourses', { studentId: student.id })).data,
    enabled: !!student?.id,
    staleTime: 60_000,
  });
  if (!isLoading && (!data || !data.configured)) return null;   // no LMS link on this server
  const courses = data?.courses || [];
  const active = courses.filter(c => c.status === 'active').length;
  const completed = courses.filter(c => c.status === 'completed').length;

  return (
    <Card className="overflow-hidden border-gray-200">
      <CardHeader className="border-b border-gray-100 py-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-lg font-semibold">
          <span className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-indigo-600" />Courses (Delta LMS)</span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs font-normal">
            {data?.available && courses.length > 0 && (
              <>
                <Badge variant="outline" className={STATUS.active.cls}>Active {active}</Badge>
                <Badge variant="outline" className={STATUS.completed.cls}>Completed {completed}</Badge>
              </>
            )}
            {canManage && data?.available && data?.has_account !== false && (
              <CourseAccessButton studentId={student.id} name={student.full_name} size="sm" className="h-8 px-2.5 text-xs" />
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">Asking the LMS…</p>
        ) : !data.available ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">{data.message || 'The LMS could not be asked'}</p>
        ) : courses.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">
            {data.message || (data.has_account ? 'On no course in the LMS yet.' : 'No Delta LMS account with this email.')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5">Course</th><th className="px-4 py-2.5">Enrolled</th><th className="px-4 py-2.5">Fee</th>
                  <th className="px-4 py-2.5">Progress</th><th className="px-4 py-2.5">Modules</th><th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {courses.map(c => {
                  const s = STATUS[c.status] || STATUS.active;
                  return (
                    <tr key={c.enrolmentId} className={`border-b border-slate-100 align-top ${c.status === 'dropped' ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-900">{c.title || '—'}</div>
                        <div className="text-xs text-slate-500">{[PROGRAMME[c.program] || c.program, c.academy].filter(Boolean).join(' · ') || '—'}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                        {day(c.enrolledAt)}
                        <div className="text-xs text-slate-400">{HOW[c.how] || '—'}</div>
                      </td>
                      <td className={`whitespace-nowrap px-4 py-2.5 ${ACCESS_CLS[c.access] || 'text-slate-400'}`}>{ACCESS[c.access] || '—'}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, Math.max(0, c.progress || 0))}%` }} />
                          </div>
                          <span className="text-xs text-slate-600">{c.progress || 0}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5"><LmsModules modules={c.modules} /></td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className={s.cls}>{s.label}</Badge>
                        {c.status === 'completed' && (
                          <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                            {c.certificate && <Award className="h-3 w-3 text-amber-500" />}
                            {day(c.completedAt)}{c.certificate ? ' · certificate' : ''}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
