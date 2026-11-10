import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, Download, Loader2, Search } from 'lucide-react';
import { PageTitle } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { STAGE_LABEL } from '@/components/meetings/meetingStage';
import { fn, thisMonth } from '@/components/meetings/meetingsUi';
import PaymentVerificationTab from '@/components/meetings/PaymentVerificationTab';
import MeetingCommissionTab, { seesMeetingCommission } from '@/components/meetings/MeetingCommissionTab';
import { base44 } from '@/api/base44Client';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import { useUrlState } from '@/components/utils/urlState';
import { cn } from '@/lib/utils';
import { ColumnPicker, FilterPanel, MeetingsDoneTable, applyFilters, exportMeetings, useColumns } from '@/components/meetings/MeetingsDoneTable';

/**
 * Meetings done (2026-10-28) — every student meeting booked from the Mentor Calendar that is over, one row per student:
 * when, the student, mentor, their CS and team, the outcome the mentor gave (or waiting for it) and the follow-up it
 * set (backend functions/meetingOutcomes.ts getMeetingsDone). Whose: as the follow-ups (a CS their own students,
 * leaders their people's, admins everyone's), and a mentor the meetings they held.
 */
const selectCls = 'h-9 rounded-md border border-slate-200 bg-white px-2 text-sm';
// Converted (2026-11-10): an approved course payment came from the meeting — backend functions/meetingOutcomes.ts convertedFor.
const STATUSES = [['held', 'Held (done + waiting)'], ['done', 'Done'], ['waiting', 'Waiting for mentor'], ['converted', 'Converted'], ['upcoming', 'Upcoming'], ['cancelled', 'Cancelled'], ['all', 'All']];

export default function MeetingsDone() {
  const [days, setDays] = useState(thisMonth);
  // Meetings, Payment verification (2026-11-09) — ?view=verification — or Meeting commission (2026-11-10) — ?view=commission.
  const [view, setView] = useUrlState('view', 'meetings');
  const { data: me } = useQuery({ queryKey: ['me-effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()) });
  const tabs = [['meetings', 'Meetings'], ['verification', 'Payment verification'], ...(seesMeetingCommission(me) ? [['commission', 'Meeting commission']] : [])];
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
  // Columns chosen and ordered, and a filter for every field (2026-11-09) — components/meetings/MeetingsDoneTable.jsx.
  const cols = useColumns();
  const [more, setMore] = useState({});
  const searched = useMemo(() => (data?.rows ?? []).filter(r => !needle
    || [r.student?.name, r.student?.code, r.attendee, r.mentor?.name, r.student?.cs].some(v => String(v ?? '').toLowerCase().includes(needle))), [data, needle]);
  const rows = useMemo(() => applyFilters(searched, more), [searched, more]);

  return (
    <div className="min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <PageTitle eyebrow="Students">Meetings done</PageTitle>
        <p className="text-sm text-slate-500">Student meetings booked from the Mentor Calendar, and what each mentor said after them.</p>
        <div className="flex w-fit rounded-md border bg-white p-0.5 text-sm" role="tablist">
          {tabs.map(([v, l]) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={cn('rounded px-3 py-1.5 font-medium', view === v ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-50')}>{l}</button>
          ))}
        </div>
        {view === 'commission' && seesMeetingCommission(me) ? (
          <Card><CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 text-sm text-slate-600">Payments from <Input type="date" className="h-9 w-40" value={days.from} max={days.to} onChange={e => e.target.value && setDays(d => ({ ...d, from: e.target.value }))} /></label>
              <label className="flex items-center gap-1 text-sm text-slate-600">to <Input type="date" className="h-9 w-40" value={days.to} min={days.from} onChange={e => e.target.value && setDays(d => ({ ...d, to: e.target.value }))} /></label>
            </div>
            <MeetingCommissionTab days={days} />
          </CardContent></Card>
        ) : view === 'verification' ? (
          <Card><CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 text-sm text-slate-600">Meetings from <Input type="date" className="h-9 w-40" value={days.from} max={days.to} onChange={e => e.target.value && setDays(d => ({ ...d, from: e.target.value }))} /></label>
              <label className="flex items-center gap-1 text-sm text-slate-600">to <Input type="date" className="h-9 w-40" value={days.to} min={days.from} onChange={e => e.target.value && setDays(d => ({ ...d, to: e.target.value }))} /></label>
            </div>
            <PaymentVerificationTab days={days} />
          </CardContent></Card>
        ) : (
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
              <div className="ml-auto flex gap-2">
                <ColumnPicker cols={cols} />
                <Button variant="outline" size="sm" className="h-9" disabled={!rows.length} onClick={() => exportMeetings(rows, cols.shown, `meetings-${days.from}-to-${days.to}.csv`)}>
                  <Download className="mr-1 h-4 w-4" /> Export
                </Button>
              </div>
            </div>
            <FilterPanel rows={searched} filters={more} setFilters={setMore} />
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <CalendarCheck className="h-3.5 w-3.5" />{rows.length} meeting{rows.length === 1 ? '' : 's'}{rows.length !== searched.length ? ` of ${searched.length}` : ''} · click a row for its full details
              {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            </p>
            {isLoading ? <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
              : error ? <p className="py-12 text-center text-sm text-rose-600">{error.message || 'Could not load the meetings'}</p>
              : !rows.length ? <p className="py-12 text-center text-sm text-slate-400">No meetings for these days and filters.</p>
              : <MeetingsDoneTable rows={rows} columns={cols.shown} resetKey={JSON.stringify(filters) + needle + JSON.stringify(more)} />}
          </CardContent>
        </Card>
        )}
      </div>
    </div>
  );
}
