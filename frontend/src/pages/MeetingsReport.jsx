import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { PageTitle } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { STAGE_LABEL } from '@/components/meetings/meetingStage';
import { MeetingRowsDialog, fn, thisMonth } from '@/components/meetings/meetingsUi';

/**
 * Meetings report (2026-10-28) — for the days chosen: meetings held (done + waiting for the mentor's outcome), done,
 * waiting, cancelled, upcoming; the done ones by stage; and per mentor, CS and team (backend getMeetingsReport). Every
 * number opens the meetings behind it. For admins, the CS Manager and the chief mentor.
 */
const TOTALS = [
  ['held', 'Held', { status: 'held' }], ['done', 'Outcome filled', { status: 'done' }], ['waiting', 'Waiting for mentor', { status: 'waiting' }],
  ['cancelled', 'Cancelled', { status: 'cancelled' }], ['upcoming', 'Upcoming', { status: 'upcoming' }],
];
const COLS = [['held', 'Held', { status: 'held' }], ['done', 'Done', { status: 'done' }], ['waiting', 'Waiting', { status: 'waiting' }],
  ['interested', 'Interested', { status: 'done', stage: 'interested' }], ['not_interested', 'Not interested', { status: 'done', stage: 'not_interested' }],
  ['cancelled', 'Cancelled', { status: 'cancelled' }]];

function Num({ n, onOpen }) {
  return n ? <button type="button" onClick={onOpen} className="font-semibold text-blue-700 hover:underline">{n}</button> : <span className="text-slate-300">0</span>;
}

function PerTable({ title, rows, keyOf, open }) {
  return (
    <Card>
      <CardHeader className="pb-2"><h3 className="text-sm font-semibold text-slate-800">{title}</h3></CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {!rows?.length ? <p className="p-4 text-sm text-slate-400">None.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2">Name</th>{COLS.map(([k, l]) => <th key={k} className="px-3 py-2 text-right">{l}</th>)}
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-4 py-2">{r.name}</td>
                  {COLS.map(([k, l, f]) => (
                    <td key={k} className="px-3 py-2 text-right"><Num n={r[k]} onOpen={() => open(`${r.name} — ${l}`, { ...f, ...keyOf(r) })} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

export default function MeetingsReport() {
  const [days, setDays] = useState(thisMonth);
  const [opened, setOpened] = useState(null);
  const { data, isLoading, error } = useQuery({ queryKey: ['meetings-report', days], queryFn: () => fn('getMeetingsReport', days), placeholderData: (p) => p });
  const open = (title, filter) => setOpened({ title, filter });

  return (
    <div className="min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageTitle eyebrow="Overview">Meetings report</PageTitle>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-sm text-slate-600">From <Input type="date" className="h-9 w-40" value={days.from} max={days.to} onChange={e => e.target.value && setDays(d => ({ ...d, from: e.target.value }))} /></label>
          <label className="flex items-center gap-1 text-sm text-slate-600">to <Input type="date" className="h-9 w-40" value={days.to} min={days.from} onChange={e => e.target.value && setDays(d => ({ ...d, to: e.target.value }))} /></label>
        </div>
        {isLoading ? <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
          : error ? <p className="py-12 text-center text-sm text-rose-600">{error.message || 'Could not load the report'}</p>
          : (<>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {TOTALS.map(([k, l, f]) => (
                <Card key={k} className={data?.totals?.[k] ? 'cursor-pointer hover:border-blue-300' : ''} onClick={() => data?.totals?.[k] && open(l, f)}>
                  <CardContent className="p-4"><p className="text-xs text-slate-500">{l}</p><p className="text-2xl font-semibold text-slate-900">{data?.totals?.[k] ?? 0}</p></CardContent>
                </Card>
              ))}
            </div>
            <Card>
              <CardHeader className="pb-2"><h3 className="text-sm font-semibold text-slate-800">Where clients stand after the meeting</h3></CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {Object.entries(STAGE_LABEL).map(([k, l]) => (
                  <div key={k} className="rounded-lg border p-3">
                    <p className="text-xs text-slate-500">{l}</p>
                    <p className="text-xl"><Num n={data?.stages?.[k] ?? 0} onOpen={() => open(l, { status: 'done', stage: k })} /></p>
                  </div>
                ))}
              </CardContent>
            </Card>
            <PerTable title="By mentor" rows={data?.mentors} keyOf={(r) => ({ mentor: r.id })} open={open} />
            <PerTable title="By CS" rows={data?.cses} keyOf={(r) => ({ cs: r.id })} open={open} />
            <PerTable title="By team" rows={data?.teams} keyOf={(r) => ({ team: r.id })} open={open} />
          </>)}
        <MeetingRowsDialog open={!!opened} onClose={() => setOpened(null)} title={opened?.title ?? ''} days={days} filter={opened?.filter ?? {}} />
      </div>
    </div>
  );
}
