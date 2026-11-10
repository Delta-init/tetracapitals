import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, Download, Loader2, Search } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Paged, TablePagination } from '@/components/common/TablePagination';
import { MeetingStageBadge } from './meetingStage';
import { fn, when } from './meetingsUi';

/* ────────────────────────────────────────────────────────────────────────────
   Meeting commission (the user, 2026-11-10) — Meetings done's third tab: each
   Meeting mentor commission (the Junior / Senior / Sub-junior Mentor who held
   the meeting gets the Junior + Senior % of the course payment) with the
   payment and the meeting it came from — linked on the request, else the
   mentor's last Mentor Calendar meeting with the student before it, else
   "Not booked on the Mentor Calendar". A mentor sees their own, a Chief their
   team's, a CS Manager and admins everyone's (functions/meetingCommissions.ts).
──────────────────────────────────────────────────────────────────────────── */

/** Who gets the tab — the server decides what they see. */
export const seesMeetingCommission = (user) =>
  !!user && (['junior_mentor', 'senior_mentor', 'subjunior_mentor', 'chief_mentor', 'cs_manager', 'super_admin', 'admin'].includes(user.app_role));

const selectCls = 'h-9 rounded-md border border-slate-200 bg-white px-2 text-sm';
const aed = (n) => `AED ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const STATUS = {
  accrued: ['Earned', 'bg-amber-50 text-amber-700 border-amber-200'],
  pooled: ['Earned', 'bg-amber-50 text-amber-700 border-amber-200'],
  released: ['Released', 'bg-sky-50 text-sky-700 border-sky-200'],
  paid: ['Paid', 'bg-emerald-50 text-emerald-700 border-emerald-200'],
  cancelled: ['Reversed', 'bg-slate-100 text-slate-500 border-slate-200'],
};
const statusLabel = (s) => STATUS[s]?.[0] ?? s ?? '';
const meetingText = (r) => (r.meeting ? `${when(r.meeting.starts_at)}${r.meeting.how === 'calendar' ? ' (from the Mentor Calendar)' : ''}` : 'Not booked on the Mentor Calendar');

function exportRows(rows, name) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Payment raised', 'Student', 'Code', 'Course', 'Paid (AED)', 'Mentor', '%', 'Commission (AED)', 'Commission status', 'Meeting', 'Meeting stage', 'Payment ref'];
  const lines = [head.map(cell).join(','), ...rows.map(r => [day(r.requested_at), r.student.name, r.student.code, r.course, r.paid_aed, r.mentor.name, r.pct, r.commission_aed, statusLabel(r.status), meetingText(r), r.meeting?.stage || '', r.txn_id].map(cell).join(','))];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function MeetingCommissionTab({ days }) {
  const [mentor, setMentor] = useState('all');
  const [search, setSearch] = useState('');
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['meeting-commissions', days, mentor],
    queryFn: () => fn('getMeetingCommissions', { ...days, mentor }),
    placeholderData: (prev) => prev,
  });
  const needle = search.trim().toLowerCase();
  const rows = useMemo(() => (data?.rows ?? []).filter(r => !needle
    || [r.student.name, r.student.code, r.course, r.mentor.name, r.txn_id].some(v => String(v ?? '').toLowerCase().includes(needle))), [data, needle]);
  const totals = data?.totals;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {data?.sees !== 'own' && (data?.mentors?.length ?? 0) > 0 && (
          <select className={selectCls} value={mentor} onChange={e => setMentor(e.target.value)} aria-label="Mentor">
            <option value="all">Every mentor</option>
            {data.mentors.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input className="h-9 w-56 pl-8" placeholder="Student, code, course, mentor" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Button variant="outline" size="sm" className="ml-auto h-9" disabled={!rows.length} onClick={() => exportRows(rows, `meeting-commission-${days.from}-to-${days.to}.csv`)}>
          <Download className="mr-1 h-4 w-4" /> Export
        </Button>
      </div>

      {totals && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-md border bg-white p-3"><p className="text-xs text-slate-500">Meetings that earned commission</p><p className="text-lg font-semibold text-slate-900">{totals.count}</p></div>
          <div className="rounded-md border bg-white p-3"><p className="text-xs text-slate-500">Commission</p><p className="text-lg font-semibold text-slate-900">{aed(totals.aed)}</p></div>
          {Object.entries(totals.by_status ?? {}).map(([s, v]) => (
            <div key={s} className="rounded-md border bg-white p-3"><p className="text-xs text-slate-500">{statusLabel(s)}</p><p className="text-lg font-semibold text-slate-900">{aed(v)}</p></div>
          ))}
        </div>
      )}

      <p className="flex items-center gap-2 text-xs text-slate-500">
        <CalendarCheck className="h-3.5 w-3.5" />
        The Meeting mentor's commission on each course payment raised in these days{data?.sees === 'own' ? ' — yours' : data?.sees === 'team' ? ' — your team’s' : ''}. Reversed ones are listed but not counted.
        {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      </p>

      {isLoading ? <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        : error ? <p className="py-12 text-center text-sm text-rose-600">{error.message || 'Could not load the commission'}</p>
        : !rows.length ? <p className="py-12 text-center text-sm text-slate-400">No Meeting mentor commission for these days.</p>
        : (
          <Paged items={rows} resetKey={JSON.stringify(days) + mentor + needle}>
            {(pageRows, bar) => (
              <>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Payment</th><th className="px-3 py-2">Student</th><th className="px-3 py-2">Course</th>
                        <th className="px-3 py-2 text-right">Paid</th><th className="px-3 py-2">Mentor</th><th className="px-3 py-2 text-right">Commission</th>
                        <th className="px-3 py-2">Status</th><th className="px-3 py-2">The meeting</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map(r => (
                        <tr key={r.id} className="border-t align-top">
                          <td className="whitespace-nowrap px-3 py-2">{day(r.requested_at)}<div className="font-mono text-xs text-slate-400">{r.txn_id}</div></td>
                          <td className="px-3 py-2">
                            {r.student.id ? <Link to={`${createPageUrl('StudentDetail')}?id=${r.student.id}`} className="font-medium text-slate-900 hover:text-blue-600">{r.student.name || 'Student'}</Link> : <span className="font-medium">{r.student.name || 'Student'}</span>}
                            <div className="font-mono text-xs text-slate-400">{r.student.code}</div>
                          </td>
                          <td className="px-3 py-2">{r.course || '—'}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right">{aed(r.paid_aed)}{r.payment_status && r.payment_status !== 'APPROVED' && <div className="text-xs text-rose-600">{r.payment_status.toLowerCase()}</div>}</td>
                          <td className="px-3 py-2">{r.mentor.name}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right font-medium">{aed(r.commission_aed)}<div className="text-xs font-normal text-slate-400">{r.pct}%</div></td>
                          <td className="px-3 py-2"><span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS[r.status]?.[1] ?? STATUS.cancelled[1]}`}>{statusLabel(r.status)}</span></td>
                          <td className="px-3 py-2">
                            {r.meeting ? (
                              <>
                                <div className="whitespace-nowrap">{when(r.meeting.starts_at)}</div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                                  {r.meeting.stage && <MeetingStageBadge stage={r.meeting.stage} />}
                                  {r.meeting.how === 'calendar' && <span title="The request names no meeting — the mentor's last Mentor Calendar meeting with the student before the payment">from the calendar</span>}
                                </div>
                              </>
                            ) : <span className="text-xs text-slate-400">Not booked on the Mentor Calendar</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TablePagination {...bar} />
              </>
            )}
          </Paged>
        )}
    </div>
  );
}
