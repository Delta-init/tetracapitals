import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Paged, TablePagination } from '@/components/common/TablePagination';
import { MeetingStageBadge, FOLLOW_UP_LABEL } from './meetingStage';

/* The meetings booked from here, shared by the student's Meetings tab, Meetings done and the Meetings report
   (backend functions/meetingOutcomes.ts getMeetingsDone / getMeetingsReport / getStudentMeetings, 2026-10-28). */

const TZ = 'Asia/Dubai';
export const dubaiDay = (d = new Date()) => new Date(d.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
/** This month in Dubai, as days (YYYY-MM-DD). */
export function thisMonth() {
  const today = dubaiDay();
  const [y, m] = today.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-${String(last).padStart(2, '0')}` };
}
export const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;

export const MEETING_STATUS = {
  done: { label: 'Done', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  waiting: { label: 'Waiting for mentor', cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  upcoming: { label: 'Upcoming', cls: 'border-sky-200 bg-sky-50 text-sky-700' },
  cancelled: { label: 'Cancelled', cls: 'border-slate-200 bg-slate-100 text-slate-500' },
};
export function MeetingStatusBadge({ status }) {
  const s = MEETING_STATUS[status] ?? MEETING_STATUS.upcoming;
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}
export const CATEGORY = { course_pitch: 'Course pitch', overview: 'Overview', other: 'Other' };

/** What goes with a filled outcome, as rows of [label, value]. */
export function outcomeDetails(o) {
  switch (o?.stage) {
    case 'interested': return [['Course', o.courseTitle], ['Payment date', o.paymentDate], ['Payment mode', o.paymentMode]];
    case 'follow_up': return [['Follow-up', FOLLOW_UP_LABEL[o.followUpKind] ?? o.followUpKind], ['Date', o.followUpDate]];
    case 'meeting_with': return [['Mentor', o.withMentorName]];
    case 'revision': return [['Course', o.courseTitle], ['Module', o.moduleTitle], ['Preferred mentor', o.withMentorName]];
    case 'not_interested': return [['Why', o.reason]];
    default: return [];
  }
}

/** The meetings as a table: when, student, mentor, CS, where it stands, the outcome. */
export function MeetingRowsTable({ rows, resetKey = '' }) {
  return (
    <Paged items={rows} resetKey={resetKey}>
      {(pageRows, bar) => (<>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">When</th><th className="px-3 py-2">Student</th><th className="px-3 py-2">Mentor</th>
                <th className="px-3 py-2">CS · team</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Outcome</th><th className="px-3 py-2">Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(r => (
                <tr key={r.id} className="border-b align-top last:border-0">
                  <td className="whitespace-nowrap px-3 py-2">{when(r.starts_at)}<div className="text-xs text-slate-400">{CATEGORY[r.category] ?? r.title}</div></td>
                  <td className="px-3 py-2">
                    {r.student
                      ? <Link to={`${createPageUrl('StudentDetail')}?id=${r.student.id}&tab=meetings`} className="font-medium text-blue-700 hover:underline">{r.student.name || r.attendee}</Link>
                      : <span className="text-slate-600">{r.attendee || '—'}</span>}
                    {r.student?.code && <div className="font-mono text-xs text-slate-400">{r.student.code}</div>}
                  </td>
                  <td className="px-3 py-2">{r.mentor?.name || '—'}</td>
                  <td className="px-3 py-2">{r.student?.cs || '—'}{r.student?.team ? <div className="text-xs text-slate-400">{r.student.team}</div> : null}</td>
                  <td className="px-3 py-2"><MeetingStatusBadge status={r.status} /></td>
                  <td className="max-w-[320px] px-3 py-2">
                    {r.stage ? <><MeetingStageBadge stage={r.stage} /><div className="mt-1 text-xs text-slate-600">{r.summary}</div></> : <span className="text-slate-300">—</span>}
                    {r.outcome?.concern && <div className="mt-1 text-xs text-slate-500">Concern: {r.outcome.concern}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{r.reminder?.date || <span className="text-slate-300">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination {...bar} />
      </>)}
    </Paged>
  );
}

/** The rows as a CSV file, downloaded. */
export function downloadMeetingsCsv(rows, name) {
  const head = ['When', 'Student', 'Code', 'Mentor', 'CS', 'Team', 'Status', 'Stage', 'Outcome', 'Concern', 'Remark', 'Follow-up'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map(r => [when(r.starts_at), r.student?.name || r.attendee, r.student?.code, r.mentor?.name, r.student?.cs, r.student?.team,
    MEETING_STATUS[r.status]?.label ?? r.status, r.stage, r.summary, r.outcome?.concern, r.outcome?.remark, r.reminder?.date].map(cell).join(','));
  const blob = new Blob([[head.map(cell).join(','), ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** The meetings behind a number of the report: the same days, one filter more. */
export function MeetingRowsDialog({ open, onClose, title, days, filter }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['meetings-done', days, filter],
    queryFn: () => fn('getMeetingsDone', { ...days, ...filter }),
    enabled: open,
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{days.from} to {days.to}</DialogDescription>
        </DialogHeader>
        {isLoading ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
          : error ? <p className="py-8 text-center text-sm text-rose-600">{error.message}</p>
          : !(data?.rows ?? []).length ? <p className="py-8 text-center text-sm text-slate-400">None.</p>
          : <MeetingRowsTable rows={data.rows} resetKey={JSON.stringify(filter)} />}
      </DialogContent>
    </Dialog>
  );
}
