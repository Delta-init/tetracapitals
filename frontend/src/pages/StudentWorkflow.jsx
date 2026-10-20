import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/common/PageHeader';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import { useUrlState } from '@/components/utils/urlState';
import { createPageUrl } from '@/utils';

/* ────────────────────────────────────────────────────────────────────────────
   Student workflow (the user, 2026-10-20: "the same workflow chart as the
   sales CRMs, for the CS portal"): the students that came in over a period
   and where each went — assigned or in the open pool, onboarded (or still
   within the 6 hours, or late), then enrolled in the LMS, contacted, a first
   deposit, moved by hand — and their follow-up stage now. Per team and per CS
   under it. Click any box, stage or row for the students behind it. Whose
   students this person sees is the Reports section's rule (backend
   students/studentWorkflow.ts): everyone, their location, their team, or
   their own.
──────────────────────────────────────────────────────────────────────────── */

const PERIODS = [['month', 'This month'], ['quarter', 'This quarter'], ['year', 'This year'], ['all', 'All time'], ['custom', 'From … to']];
const STAGE_COLOR = {
  'No follow-up': 'bg-slate-400', New: 'bg-violet-500', Contacted: 'bg-teal-500', Qualified: 'bg-sky-500',
  'Session with CM': 'bg-amber-500', 'Objection Stage': 'bg-orange-500', Converted: 'bg-emerald-600', Lost: 'bg-rose-500',
};
const SOURCE = { finance: 'finance', lms: 'LMS', sheet: 'sheets', manual: 'by hand' };
const TONE = {
  neutral: 'border-slate-200 bg-white',
  good: 'border-emerald-200 bg-emerald-50/60',
  bad: 'border-rose-200 bg-rose-50/60',
};
const pct = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : '0%');
const day = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '—');
const BOX_TITLE = {
  came: 'Came in', assigned: 'Assigned to a CS', pool: 'Open pool', onboarded: 'Onboarded', waiting: 'Waiting — within 6 hours', late: 'Late — not onboarded',
  enrolled: 'Enrolled in the LMS', contacted: 'Contacted', deposited: 'First deposit', moved: 'Moved by hand', moved_inactivity: 'Moved for no deposit',
  bonus_pending: 'Bonus pending',
};
/* Why a bonus waits (2026-10-20, backend students/bonusPending.ts), in the order a CS can act on them. */
const BONUS_REASON = {
  sent_back: 'sent back to the CS',
  after_payment: 'waiting for full payment',
  needs_call: 'needs a connected call',
  with_finance: 'with finance',
  waiting_broker: 'waiting for a broker admin',
};
const usd = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

function Box({ n, label, tone = 'neutral', onClick, sub }) {
  return (
    <button type="button" onClick={onClick}
      className={`min-w-0 flex-1 rounded-xl border px-3 py-3 text-center transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-navy/30 ${TONE[tone]}`}>
      <div className={`text-2xl font-semibold tabular-nums ${tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-rose-700' : 'text-slate-900'}`}>{n ?? 0}</div>
      <div className="truncate text-xs text-slate-600">{label}</div>
      {sub ? <div className="mt-0.5 truncate text-[11px] text-slate-500">{sub}</div> : null}
    </button>
  );
}

export default function StudentWorkflow() {
  const [period, setPeriod] = useUrlState('period', 'month');
  const [from, setFrom] = useUrlState('from', '');
  const [to, setTo] = useUrlState('to', '');
  const [location, setLocation] = useUrlState('location', 'all');
  const [team, setTeam] = useUrlState('team', 'all');
  const [cs, setCs] = useUrlState('cs', 'all');
  const [open, setOpen] = useState(null); // { title, pick }

  const filters = useQuery({
    queryKey: ['report-filters'],
    queryFn: async () => (await base44.functions.invoke('getReportFilters', {})).data,
    staleTime: 5 * 60_000, retry: false,
  });
  const custom = period === 'custom';
  const ready = !custom || (from && to);
  const ask = { period, ...(custom ? { from, to } : {}), ...(location !== 'all' ? { location } : {}), ...(team !== 'all' ? { team } : {}), ...(cs !== 'all' ? { cs } : {}) };
  const q = useQuery({
    queryKey: ['student-workflow', ask],
    queryFn: async () => (await base44.functions.invoke('getStudentWorkflow', ask)).data,
    enabled: !!ready, retry: false,
  });
  const d = q.data;
  const t = d?.totals || {};
  const people = useMemo(() => (filters.data?.people || []).filter(p => team === 'all' || p.team_id === team), [filters.data, team]);
  const show = (title, pick) => setOpen({ title, pick });
  const stageTotal = (d?.stages || []).reduce((n, s) => n + s.count, 0);
  const sources = (d?.sources || []).map(s => `${SOURCE[s.source] || s.source} ${s.count}`).join(' · ');

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader eyebrow="Students" title="Student workflow"
          description="The students that came in, and where each went — onboarding, the LMS, contact, a first deposit, moves — and their follow-up stage now. Click anything for the students behind it." />

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/70 bg-white p-3 shadow-soft">
          <div className="flex flex-wrap rounded-md border bg-white p-0.5 text-xs" role="group" aria-label="Period">
            {PERIODS.map(([v, l]) => (
              <button key={v} type="button" onClick={() => setPeriod(v)}
                className={`rounded px-2.5 py-1.5 font-medium ${period === v ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>
            ))}
          </div>
          {custom && (
            <>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" aria-label="From" />
              <span className="text-xs text-slate-400">to</span>
              <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" aria-label="To" />
            </>
          )}
          {filters.data?.locked_location ? (
            <span className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800">{filters.data.locked_location === 'bangalore' ? 'Bangalore' : 'Dubai'} only</span>
          ) : (
            <Select value={location} onValueChange={(v) => v && setLocation(v)}>
              <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All locations</SelectItem><SelectItem value="dubai">Dubai</SelectItem><SelectItem value="bangalore">Bangalore</SelectItem></SelectContent>
            </Select>
          )}
          {filters.data?.scope !== 'own' && (
            <>
              <Select value={team} onValueChange={(v) => { if (v) { setTeam(v); setCs('all'); } }}>
                <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Team" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All teams</SelectItem>
                  {(filters.data?.teams || []).map(x => <SelectItem key={x.id} value={x.id}>{x.name}{x.location === 'bangalore' ? ' · Bangalore' : ''}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={cs} onValueChange={(v) => v && setCs(v)}>
                <SelectTrigger className="h-9 w-48"><SelectValue placeholder="CS" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  {people.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </>
          )}
        </div>

        {q.isError && <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{q.error?.message || 'The workflow did not load'}</p>}
        {!ready && <p className="text-sm text-slate-500">Pick a from and a to date.</p>}
        {q.isLoading && ready && <Skeleton className="h-96 w-full rounded-2xl" />}

        {d && (
          <div className="space-y-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-soft">
            <div className="text-sm font-semibold text-slate-800">
              Students that came in{d.since ? ` · ${new Date(d.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' })} – ${d.until ? new Date(new Date(d.until).getTime() - 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' }) : 'now'}` : ' · all time'}
            </div>
            <div className="mx-auto flex max-w-xs"><Box n={t.came} label="came in" sub={sources} onClick={() => show(BOX_TITLE.came, { box: 'came' })} /></div>
            <div className="mx-auto flex max-w-2xl gap-3">
              <Box n={t.assigned} label={`assigned to a CS · ${pct(t.assigned, t.came)}`} onClick={() => show(BOX_TITLE.assigned, { box: 'assigned' })} />
              <Box n={t.pool} tone={t.pool ? 'bad' : 'neutral'} label={`no CS · open pool · ${pct(t.pool, t.came)}`} onClick={() => show(BOX_TITLE.pool, { box: 'pool' })} />
            </div>
            <div className="mx-auto flex max-w-4xl gap-3">
              <Box n={t.onboarded} tone="good" label={`onboarded · ${pct(t.onboarded, t.came)}`} onClick={() => show(BOX_TITLE.onboarded, { box: 'onboarded' })} />
              <Box n={t.waiting} label={`waiting · within ${d.wait_hours ?? 6} h`} onClick={() => show(BOX_TITLE.waiting, { box: 'waiting' })} />
              <Box n={t.late} tone={t.late ? 'bad' : 'neutral'} label="late · not onboarded" onClick={() => show(BOX_TITLE.late, { box: 'late' })} />
            </div>
            <div className="flex flex-wrap gap-3 sm:flex-nowrap">
              <Box n={t.enrolled} tone="good" label={`enrolled in LMS · ${pct(t.enrolled, t.came)}`} onClick={() => show(BOX_TITLE.enrolled, { box: 'enrolled' })} />
              <Box n={t.contacted} tone="good" label={`contacted · ${pct(t.contacted, t.came)}`} onClick={() => show(BOX_TITLE.contacted, { box: 'contacted' })} />
              <Box n={t.deposited} tone="good" label="first deposit" onClick={() => show(BOX_TITLE.deposited, { box: 'deposited' })} />
              <Box n={t.moved} tone={t.moved ? 'bad' : 'neutral'} label="moved by hand"
                sub={t.moved_inactivity ? `+ ${t.moved_inactivity} for no deposit` : undefined} onClick={() => show(BOX_TITLE.moved, { box: 'moved' })} />
            </div>

            {d.bonus && (
              <div className={`rounded-xl border p-3 ${d.bonus.students ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-white'}`}>
                <button type="button" onClick={() => show(BOX_TITLE.bonus_pending, { box: 'bonus_pending' })} className="flex w-full items-baseline justify-center gap-2 hover:underline">
                  <span className={`text-2xl font-semibold tabular-nums ${d.bonus.students ? 'text-amber-700' : 'text-slate-900'}`}>{d.bonus.students}</span>
                  <span className="text-sm text-slate-600">bonus pending · {usd(d.bonus.usd)}</span>
                </button>
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  {(d.bonus.reasons || []).map(r => (
                    <button key={r.reason} type="button" disabled={!r.students}
                      onClick={() => show(`Bonus pending — ${BONUS_REASON[r.reason] || r.reason}`, { box: `bonus_${r.reason}` })}
                      className={`rounded-full border px-3 py-1 text-xs ${r.students ? 'border-amber-200 bg-white text-amber-800 hover:bg-amber-50' : 'border-slate-200 text-slate-400'}`}>
                      {BONUS_REASON[r.reason] || r.reason} · <span className="font-semibold tabular-nums">{r.students}</span>{r.students ? ` · ${usd(r.usd)}` : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 text-xs font-medium text-slate-500">Where they stand now (follow-up stage)</div>
              <div className="flex h-4 w-full overflow-hidden rounded-full bg-slate-100">
                {(d.stages || []).map(s => (
                  <button key={s.stage} type="button" title={`${s.stage} ${s.count}`} onClick={() => show(`Follow-up stage: ${s.stage}`, { stage: s.stage })}
                    className={`${STAGE_COLOR[s.stage] || 'bg-slate-300'} h-full`} style={{ width: `${stageTotal ? (s.count / stageTotal) * 100 : 0}%` }} />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                {(d.stages || []).map(s => (
                  <button key={s.stage} type="button" onClick={() => show(`Follow-up stage: ${s.stage}`, { stage: s.stage })} className="flex items-center gap-1.5 hover:underline">
                    <span className={`h-2.5 w-2.5 rounded-full ${STAGE_COLOR[s.stage] || 'bg-slate-300'}`} />{s.stage} <span className="font-semibold tabular-nums">{s.count}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {d && <Table title="By team" rows={d.teams || []} first={(r) => r.name} sub={(r) => (r.id ? (r.location === 'bangalore' ? 'Bangalore' : 'Dubai') : '')}
          onRow={(r) => show(`${r.name} — came in`, { box: 'came', teamId: r.id ?? '' })} />}
        {d && <Table title="By CS" rows={d.people || []} first={(r) => r.name} sub={(r) => r.team}
          onRow={(r) => show(`${r.name} — came in`, { box: 'came', csId: r.id })} />}
      </div>

      {open && <Breakdown open={open} ask={ask} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Table({ title, rows, first, sub, onRow }) {
  const cols = [['came', 'Came in'], ['onboarded', 'Onboarded'], ['late', 'Late'], ['enrolled', 'LMS'], ['contacted', 'Contacted'], ['deposited', 'Deposit'], ['bonus_pending', 'Bonus pending'], ['moved', 'Moved']];
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white shadow-soft">
      <div className="border-b px-4 py-3 text-sm font-semibold text-slate-800">{title}</div>
      <table className="w-full min-w-[640px] text-sm">
        <thead><tr className="text-left text-xs text-slate-500">
          <th className="px-4 py-2 font-medium">{title === 'By team' ? 'Team' : 'CS'}</th>
          {cols.map(([, l]) => <th key={l} className="px-3 py-2 text-right font-medium">{l}</th>)}
        </tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={cols.length + 1} className="px-4 py-6 text-center text-slate-500">No students came in.</td></tr>}
          {rows.map((r) => (
            <tr key={r.id ?? 'pool'} className="cursor-pointer border-t hover:bg-slate-50" onClick={() => onRow(r)}>
              <td className="px-4 py-2"><span className="font-medium text-slate-900">{first(r)}</span>{sub(r) ? <span className="block text-xs text-slate-500">{sub(r)}</span> : null}</td>
              {cols.map(([k]) => (
                <td key={k} className={`px-3 py-2 text-right tabular-nums ${k === 'late' && r[k] ? 'text-rose-700 font-semibold' : k === 'bonus_pending' && r[k] ? 'text-amber-700 font-semibold' : 'text-slate-700'}`}>
                  {r[k] || 0}{k === 'onboarded' && r.came ? <span className="ml-1 text-xs text-slate-400">{pct(r[k], r.came)}</span> : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Breakdown({ open, ask, onClose }) {
  const q = useQuery({
    queryKey: ['student-workflow-students', ask, open.pick],
    queryFn: async () => (await base44.functions.invoke('getStudentWorkflowStudents', { ...ask, ...open.pick })).data,
    retry: false,
  });
  const rows = q.data?.students || [];
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{open.title}</DialogTitle>
          <DialogDescription>{q.data ? `${q.data.total} student${q.data.total === 1 ? '' : 's'}${q.data.total > rows.length ? ` — the newest ${rows.length} shown` : ''}` : 'Loading…'}</DialogDescription>
        </DialogHeader>
        {q.isLoading && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
        {q.isError && <p className="text-sm text-rose-700">{q.error?.message || 'The students did not load'}</p>}
        {q.data && (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 bg-white"><tr className="text-left text-xs text-slate-500">
                <th className="py-2 pr-3 font-medium">Student</th><th className="py-2 pr-3 font-medium">CS</th><th className="py-2 pr-3 font-medium">Came in</th>
                <th className="py-2 pr-3 font-medium">Onboarded</th><th className="py-2 pr-3 font-medium">Stage</th><th className="py-2 pr-3 font-medium">Bonus pending</th><th className="py-2 font-medium">Flags</th>
              </tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-500">Nobody here.</td></tr>}
                {rows.map(s => (
                  <tr key={s.id} className="border-t align-top">
                    <td className="py-2 pr-3">
                      <Link to={`${createPageUrl('StudentDetail')}?id=${s.id}`} className="font-medium text-blue-700 hover:underline">{s.name || '—'}</Link>
                      <span className="block text-xs text-slate-500">{[s.code, SOURCE[s.source] || s.source, s.location === 'bangalore' ? 'Bangalore' : null].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td className="py-2 pr-3">{s.cs ? <>{s.cs.name}<span className="block text-xs text-slate-500">{s.cs.team}</span></> : <span className="text-rose-700">Open pool</span>}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{day(s.came_at)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{s.onboarded_at ? day(s.onboarded_at) : <span className={s.late ? 'font-medium text-rose-700' : 'text-slate-500'}>{s.late ? 'Late' : 'Not yet'}</span>}</td>
                    <td className="py-2 pr-3">{s.stage}</td>
                    <td className="py-2 pr-3">{s.bonus ? <><span className="font-medium text-amber-700">{usd(s.bonus.usd)}</span><span className="block text-xs text-slate-500">{(s.bonus.reasons || [s.bonus.reason]).map(x => BONUS_REASON[x] || x).join(' · ')}</span></> : <span className="text-slate-400">—</span>}</td>
                    <td className="py-2 text-xs text-slate-600">{[s.enrolled && 'LMS', s.contacted && 'contacted', s.deposited && 'deposit', s.moved && 'moved'].filter(Boolean).join(' · ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
