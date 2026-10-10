import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { GraduationCap } from 'lucide-react';
import { Paged, TablePagination } from '@/components/common/TablePagination';
import { ClassInfoDialog } from '@/components/classes/ClassInfo';

/* ────────────────────────────────────────────────────────────────────────────
   The student's live classes in the Delta LMS, by their email, across both
   academies (backend/src/functions/lmsClasses.ts → the LMS's
   /service/class-attendance): only classes of courses they are enrolled in
   (the LMS decides), and of those only the attended, booked and upcoming ones.
──────────────────────────────────────────────────────────────────────────── */

const STATUS = {
  attended: { label: 'Attended', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  missed: { label: 'Missed', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  upcoming: { label: 'Upcoming', cls: 'border-sky-200 bg-sky-50 text-sky-700' },
  booked: { label: 'Booked', cls: 'border-slate-200 bg-slate-50 text-slate-600', hint: 'The class has passed; the LMS has not settled attendance yet' },
  cancelled: { label: 'Cancelled', cls: 'border-slate-200 bg-slate-100 text-slate-500' },
};
const SHOWN = ['attended', 'booked', 'upcoming'];
const when = (iso) => (iso ? format(new Date(iso), 'd MMM yyyy, HH:mm') : '—');

export default function StudentClassesCard({ student }) {
  const [infoFor, setInfoFor] = useState(null);   // the class whose Info is open
  const { data, isLoading } = useQuery({
    queryKey: ['student-classes', student?.id],
    queryFn: async () => (await base44.functions.invoke('getStudentClasses', { studentId: student.id })).data,
    enabled: !!student?.id,
    staleTime: 60_000,
  });
  if (!isLoading && (!data || !data.configured)) return null;   // no LMS link on this server
  const c = data?.counts || {};
  const classes = (data?.classes || []).filter(k => SHOWN.includes(k.status));

  return (
    <Card className="overflow-hidden border-gray-200">
      <CardHeader className="border-b border-gray-100 py-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-lg font-semibold">
          <span className="flex items-center gap-2"><GraduationCap className="h-5 w-5 text-indigo-600" />Classes (Delta LMS)</span>
          {data?.available && (
            <span className="flex flex-wrap gap-1.5 text-xs font-normal">
              {SHOWN.map(k => (
                <Badge key={k} variant="outline" className={STATUS[k].cls} title={STATUS[k].hint}>{STATUS[k].label} {c[k] ?? 0}</Badge>
              ))}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">Asking the LMS…</p>
        ) : !data.available ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">{data.message || 'The LMS could not be asked'}</p>
        ) : classes.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">
            {data.message || (data.has_account ? 'No attended, booked or upcoming classes in their courses.' : 'No Delta LMS account with this email.')}
          </p>
        ) : (
          <Paged items={classes} resetKey={student.id} urlKey="classes_page">
            {(rows, bar) => (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        <th className="px-4 py-2.5">Date</th><th className="px-4 py-2.5">Class</th><th className="px-4 py-2.5">Course</th>
                        <th className="px-4 py-2.5">Mentor</th><th className="px-4 py-2.5">Academy</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(k => {
                        const s = STATUS[k.status] || STATUS.booked;
                        return (
                          <tr key={k.bookingId} className="border-b border-slate-100 align-top">
                            <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{when(k.startsAt)}{k.durationMins ? <div className="text-xs text-slate-400">{k.durationMins} min</div> : null}</td>
                            <td className="px-4 py-2.5 font-medium text-slate-900">{k.title || '—'}</td>
                            <td className="px-4 py-2.5 text-slate-600">{k.course || '—'}</td>
                            <td className="px-4 py-2.5 text-slate-600">{k.mentor || '—'}</td>
                            <td className="px-4 py-2.5 text-slate-500">{k.academy || '—'}</td>
                            <td className="px-4 py-2.5">
                              <Badge variant="outline" className={s.cls} title={k.status === 'attended' && k.attendedAt ? `Attended ${when(k.attendedAt)}` : s.hint}>{s.label}</Badge>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              {k.classId && (
                                <button type="button" onClick={() => setInfoFor(k)} className="text-xs font-medium text-cyan-700 hover:underline">Info</button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <TablePagination {...bar} />
              </>
            )}
          </Paged>
        )}
      </CardContent>
      {infoFor && <ClassInfoDialog classId={infoFor.classId} title={infoFor.title} onClose={() => setInfoFor(null)} />}
    </Card>
  );
}
