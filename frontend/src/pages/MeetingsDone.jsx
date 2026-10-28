import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, Download, Loader2, Search } from 'lucide-react';
import { PageTitle } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { STAGE_LABEL } from '@/components/meetings/meetingStage';
import { MeetingRowsTable, downloadMeetingsCsv, fn, thisMonth } from '@/components/meetings/meetingsUi';

/**
 * Meetings done (2026-10-28) — every student meeting booked from the Mentor Calendar that is over, one row per student:
 * when, the student, mentor, their CS and team, the outcome the mentor gave (or waiting for it) and the follow-up it
 * set (backend functions/meetingOutcomes.ts getMeetingsDone). Whose: as the follow-ups (a CS their own students,
 * leaders their people's, admins everyone's), and a mentor the meetings they held.
 */
const selectCls = 'h-9 rounded-md border border-slate-200 bg-white px-2 text-sm';
const STATUSES = [['held', 'Held (done + waiting)'], ['done', 'Done'], ['waiting', 'Waiting for mentor'], ['upcoming', 'Upcoming'], ['cancelled', 'Cancelled'], ['all', 'All']];

export default function MeetingsDone() {
  const [days, setDays] = useState(thisMonth);
  const [status, setStatus] = useState('held');
  const [stage, setStage] = useState('all');
  const [mentor, setMentor] = useState('all');
  const [cs, setCs] = useState('all');
  const [team, setTeam] = useState('all');
  const [search, setSearch] = useState('');
  const filters = { ...days, status, stage, mentor, cs, team };
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['meetings-done', filters],
    queryFn: () => fn('getMeetingsDone', filters),
    placeholderData: (prev) => prev,
  });
  const needle = search.trim().toLowerCase();
  const rows = useMemo(() => (data?.rows ?? []).filter(r => !needle
    || [r.student?.name, r.student?.code, r.attendee, r.mentor?.name, r.student?.cs].some(v => String(v ?? '').toLowerCase().includes(needle))), [data, needle]);

  return (
    <div className="min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageTitle eyebrow="Students">Meetings done</PageTitle>
        <p className="text-sm text-slate-500">Student meetings booked from the Mentor Calendar, and what each mentor said after them.</p>
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 text-sm text-slate-600">From <Input type="date" className="h-9 w-40" value={days.from} max={days.to} onChange={e => e.target.value && setDays(d => ({ ...d, from: e.target.value }))} /></label>
              <label className="flex items-center gap-1 text-sm text-slate-600">to <Input type="date" className="h-9 w-40" value={days.to} min={days.from} onChange={e => e.target.value && setDays(d => ({ ...d, to: e.target.value }))} /></label>
              <select className={selectCls} value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
                {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <select className={selectCls} value={stage} onChange={e => setStage(e.target.value)} aria-label="Stage">
                <option value="all">Any stage</option>
                {Object.entries(STAGE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                <option value="waiting">Waiting for mentor</option>
              </select>
              <select className={selectCls} value={mentor} onChange={e => setMentor(e.target.value)} aria-label="Mentor">
                <option value="all">Any mentor</option>
                {(data?.mentors ?? []).map(m => <option key={m.email} value={m.email}>{m.name || m.email}</option>)}
              </select>
              <select className={selectCls} value={cs} onChange={e => setCs(e.target.value)} aria-label="CS">
                <option value="all">Any CS</option>
                {(data?.cses ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="none">No CS</option>
              </select>
              <select className={selectCls} value={team} onChange={e => setTeam(e.target.value)} aria-label="Team">
                <option value="all">Any team</option>
                {(data?.teams ?? []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <Input className="h-9 w-56 pl-8" placeholder="Student, code, mentor, CS" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <Button variant="outline" size="sm" className="ml-auto h-9" disabled={!rows.length} onClick={() => downloadMeetingsCsv(rows, `meetings-${days.from}-to-${days.to}.csv`)}>
                <Download className="mr-1 h-4 w-4" /> Export
              </Button>
            </div>
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <CalendarCheck className="h-3.5 w-3.5" />{rows.length} meeting{rows.length === 1 ? '' : 's'}
              {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            </p>
            {isLoading ? <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
              : error ? <p className="py-12 text-center text-sm text-rose-600">{error.message || 'Could not load the meetings'}</p>
              : !rows.length ? <p className="py-12 text-center text-sm text-slate-400">No meetings for these days and filters.</p>
              : <MeetingRowsTable rows={rows} resetKey={JSON.stringify(filters) + needle} />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
