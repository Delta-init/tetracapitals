import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { PageTitle } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { CalendarClock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUrlState } from '@/components/utils/urlState';
import { DecideMeetingDialog, StatusBadge, categoryText, when } from '@/components/meetings/meetingRequests';

/* ────────────────────────────────────────────────────────────────────────────
   Meeting Requests (the user, 2026-11-09): the meetings mentors ask for with
   this person's students — a CS their own, a CS Manager their location's, a
   Super Admin all. Waiting: pick the date and time and approve (it's booked in
   the LMS then), or reject with a reason. Decided: what became of them.
──────────────────────────────────────────────────────────────────────────── */

export default function MeetingRequests() {
  const [tab, setTab] = useUrlState('tab', 'waiting');
  const [deciding, setDeciding] = useState(null);
  const q = useQuery({
    queryKey: ['meeting-requests', 'to_decide', tab],
    queryFn: async () => (await base44.functions.invoke('listMeetingRequests', { box: 'to_decide', status: tab === 'decided' ? 'decided' : 'pending' })).data,
    refetchInterval: 60_000,
  });
  const list = q.data?.requests || [];
  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <PageTitle eyebrow="Students" icon={CalendarClock}>Meeting Requests</PageTitle>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">Mentors ask to meet your students. You pick the date and time — it's booked in the LMS only when you approve, and the mentor and student get the invitation then.</p>
        </div>
        <div className="flex rounded-md border bg-white p-0.5 text-sm w-fit" role="tablist">
          {[['waiting', 'Waiting'], ['decided', 'Decided']].map(([v, l]) => (
            <button key={v} type="button" role="tab" aria-selected={tab === v} onClick={() => setTab(v)}
              className={cn('rounded px-3 py-1.5 font-medium', tab === v ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-50')}>{l}</button>
          ))}
        </div>
        {q.isLoading ? <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>
          : q.isError ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{/unknown function|not found|404/i.test(String(q.error?.message)) ? 'This page needs the server update (the API deploy).' : q.error?.message}</p>
            : !list.length ? <p className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">{tab === 'waiting' ? 'No meeting requests waiting.' : 'Nothing decided yet.'}</p>
              : (
                <div className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white shadow-soft">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr>{['Asked', 'Student', 'Mentor', 'For', 'Length · where', 'Note', tab === 'waiting' ? '' : 'Decision'].map(h => <th key={h} className="whitespace-nowrap px-4 py-2.5">{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {list.map(r => (
                        <tr key={r.id} className="align-top">
                          <td className="whitespace-nowrap px-4 py-3 text-slate-600">{when(r.requested_at)}</td>
                          <td className="px-4 py-3"><div className="font-medium text-brand-navy">{r.student.name}</div><div className="text-xs text-slate-400">{[r.student.code, r.student.cs_name && `CS ${r.student.cs_name}`].filter(Boolean).join(' · ')}</div></td>
                          <td className="px-4 py-3 text-slate-700">{r.mentor.name}</td>
                          <td className="px-4 py-3"><span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs text-violet-700">{categoryText(r.category, r.course)}</span></td>
                          <td className="px-4 py-3 text-slate-600">{r.duration_mins} min · {r.in_person ? `in person — ${r.location}` : 'online'}</td>
                          <td className="max-w-[220px] px-4 py-3 text-slate-600">{r.notes || '—'}</td>
                          <td className="whitespace-nowrap px-4 py-3">
                            {tab === 'waiting'
                              ? <Button size="sm" onClick={() => setDeciding(r)}>Pick time &amp; decide</Button>
                              : (
                                <div className="space-y-0.5">
                                  <StatusBadge status={r.status} />
                                  {r.status === 'approved' && <div className="text-xs text-slate-600">{when(r.scheduled_start)}</div>}
                                  {r.reason && <div className="max-w-[200px] whitespace-normal text-xs text-slate-500">{r.reason}</div>}
                                  {r.decided_by_name && <div className="text-xs text-slate-400">by {r.decided_by_name}</div>}
                                </div>
                              )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
      </div>
      <DecideMeetingDialog request={deciding} onClose={() => setDeciding(null)} />
    </div>
  );
}
