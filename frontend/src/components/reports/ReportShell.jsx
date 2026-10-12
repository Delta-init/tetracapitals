import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Loader2 } from 'lucide-react';
import { useUrlState } from '@/components/utils/urlState';
import { downloadExcel } from '@/components/utils/excelExport';

/* ────────────────────────────────────────────────────────────────────────────
   One report page (the user, 2026-10-11 — the Reports section): the filters
   every report shares — period (this month, quarter, year, all time, or from …
   to), location, team, CS — kept in the address; the totals on top; and the
   figures by person, by team and by month, each exportable to Excel. Added up
   by the server (backend functions/reports.ts), which also decides whose
   figures this person sees: everyone, their team, or their own.
──────────────────────────────────────────────────────────────────────────── */

export const usd = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** The portal's fixed rate (2026-10-12: every USD figure on the reports also in AED). */
export const AED_PER_USD = 3.67;
export const aed = (n) => `AED ${((Number(n) || 0) * AED_PER_USD).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** "$4,750.00 · AED 17,432.50" — for a line of text. */
export const usdAed = (n) => `${usd(n)} · ${aed(n)}`;
export const num = (n) => (Number(n) || 0).toLocaleString('en-US');
/** Approved green, pending amber, rejected red (2026-10-12) — for a column or a card that says `tone`. */
const TONE = { approved: 'text-emerald-700', pending: 'text-amber-700', rejected: 'text-rose-700' };
const CARD_TONE = { approved: 'border-emerald-200 bg-emerald-50/50', pending: 'border-amber-200 bg-amber-50/50', rejected: 'border-rose-200 bg-rose-50/50' };
const PERIODS = [['month', 'This month'], ['quarter', 'This quarter'], ['year', 'This year'], ['all', 'All time'], ['custom', 'From … to']];
const VIEWS = [['people', 'By person'], ['teams', 'By team'], ['months', 'By month']];
const monthName = (m) => { const [y, mm] = String(m).split('-').map(Number); return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }); };
const FIRST = {
  people: { key: 'name', label: 'Person', sub: r => [r.team, r.location === 'bangalore' ? 'Bangalore' : null].filter(Boolean).join(' · ') },
  teams: { key: 'team', label: 'Team', sub: r => (r.location === 'bangalore' ? 'Bangalore' : 'Dubai') },
  months: { key: 'month', label: 'Month', fmt: monthName },
};

/**
 * fn: the server function; body: anything else it needs (e.g. { kind }); cards(d): [{ label, value, sub? }];
 * columns: [{ key, label, fmt?, type?: 'money' | 'number', get?(row) }] — the same for every view.
 */
export default function ReportShell({ title, description, fn, body = {}, cards, columns, sortNote }) {
  const [period, setPeriod] = useUrlState('period', 'month');
  const [from, setFrom] = useUrlState('from', '');
  const [to, setTo] = useUrlState('to', '');
  const [location, setLocation] = useUrlState('location', 'all');
  const [team, setTeam] = useUrlState('team', 'all');
  const [cs, setCs] = useUrlState('cs', 'all');
  const [view, setView] = useUrlState('view', 'people');
  const [exporting, setExporting] = useState(false);

  const filters = useQuery({
    queryKey: ['report-filters'],
    queryFn: async () => (await base44.functions.invoke('getReportFilters', {})).data,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const custom = period === 'custom';
  const ready = !custom || (from && to);
  const ask = { ...body, period, ...(custom ? { from, to } : {}), ...(location !== 'all' ? { location } : {}), ...(team !== 'all' ? { team } : {}), ...(cs !== 'all' ? { cs } : {}) };
  const q = useQuery({
    queryKey: ['report', fn, ask],
    queryFn: async () => (await base44.functions.invoke(fn, ask)).data,
    enabled: !!ready,
    retry: false,
  });
  const d = q.data;
  const rows = d?.[view] || [];
  const first = FIRST[view] || FIRST.people;
  const people = useMemo(() => (filters.data?.people || []).filter(p => team === 'all' || p.team_id === team), [filters.data, team]);
  const cell = (c, r) => {
    const v = c.get ? c.get(r) : r[c.key];
    if (c.fmt) return c.fmt(v, r);
    if (c.type === 'money') return <span className="inline-flex flex-col items-end leading-tight">{usd(v)}<span className="text-[11px] font-normal text-slate-400">{aed(v)}</span></span>;
    if (c.type === 'number') return num(v);
    return v ?? '—';
  };

  const exportIt = async () => {
    setExporting(true);
    try {
      // Each money column twice: USD, then AED at 3.67.
      const cols = [{ header: first.label }, ...(view === 'people' ? [{ header: 'Team' }] : []),
        ...columns.flatMap(c => (c.type === 'money' ? [{ header: c.label, type: 'number' }, { header: `${c.label.replace(/\s*\(USD\)/, '')} (AED)`, type: 'number' }] : [{ header: c.label, type: c.type ? 'number' : undefined }]))];
      const out = rows.map(r => [
        first.fmt ? first.fmt(r[first.key]) : r[first.key],
        ...(view === 'people' ? [r.team] : []),
        ...columns.flatMap(c => {
          const v = c.get ? c.get(r) : r[c.key];
          if (c.type === 'money') return [v ?? null, v == null ? null : Math.round((Number(v) || 0) * AED_PER_USD * 100) / 100];
          return [c.type ? (v ?? null) : (c.fmt ? c.fmt(v, r) : v)];
        }),
      ]);
      await downloadExcel({ fileName: `${title} - ${VIEWS.find(v => v[0] === view)[1]}.xlsx`, sheet: title, columns: cols, rows: out });
    } catch (err) {
      toast.error(err?.message || "The export didn't work");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader eyebrow="Reports" title={title} description={description}
          actions={<Button variant="outline" onClick={exportIt} disabled={!rows.length || exporting}>
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Export
          </Button>} />

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
          <Select value={location} onValueChange={(v) => v && setLocation(v)}>
            <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All locations</SelectItem><SelectItem value="dubai">Dubai</SelectItem><SelectItem value="bangalore">Bangalore</SelectItem></SelectContent>
          </Select>
          {filters.data?.scope !== 'own' && (
            <>
              <Select value={team} onValueChange={(v) => { if (v) { setTeam(v); setCs('all'); } }}>
                <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Team" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All teams</SelectItem>
                  {(filters.data?.teams || []).map(t => <SelectItem key={t.id} value={t.id}>{t.name}{t.location === 'bangalore' ? ' · Bangalore' : ''}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={cs} onValueChange={(v) => v && setCs(v)}>
                <SelectTrigger className="h-9 w-48"><SelectValue placeholder="Person" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  {people.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </>
          )}
          {d?.scope && d.scope !== 'all' && <span className="ml-auto text-xs text-slate-500">{d.scope === 'own' ? 'Your own figures' : 'You and your team'}</span>}
        </div>

        {!ready ? <p className="text-sm text-slate-500">Pick a from and a to date.</p>
          : q.isLoading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
            : q.isError ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {/unknown function|not found|404/i.test(String(q.error?.message)) ? 'This report needs the server update (the API deploy).' : (q.error?.message || "The report couldn't be loaded.")}
              </p>
            ) : d && (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {cards(d).map(c => (
                    <div key={c.label} className={`rounded-2xl border p-4 shadow-soft ${CARD_TONE[c.tone] || 'border-slate-200/70 bg-white'}`}>
                      <p className="text-[13px] font-medium text-slate-500">{c.label}</p>
                      <p className={`mt-2 break-words text-2xl font-bold ${TONE[c.tone] || 'text-brand-navy'}`}>{c.usd != null ? usd(c.usd) : c.value}</p>
                      {c.usd != null && <p className="text-sm font-medium text-slate-500">{aed(c.usd)}</p>}
                      {c.sub && <p className="mt-1 text-xs text-slate-500">{c.sub}</p>}
                    </div>
                  ))}
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-soft">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                    <div className="flex rounded-md border bg-white p-0.5 text-xs" role="tablist">
                      {VIEWS.map(([v, l]) => (
                        <button key={v} type="button" onClick={() => setView(v)}
                          className={`rounded px-2.5 py-1.5 font-medium ${view === v ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>
                      ))}
                    </div>
                    {sortNote && <span className="text-xs text-slate-400">{sortNote}</span>}
                  </div>
                  {!rows.length ? <p className="p-6 text-center text-sm text-slate-500">Nothing in this period.</p> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-2.5">{first.label}</th>
                            {columns.map(c => <th key={c.label} className={`whitespace-nowrap px-4 py-2.5 ${c.type ? 'text-right' : ''} ${TONE[c.tone] || ''}`}>{c.label}</th>)}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {rows.map((r, i) => (
                            <tr key={r.id || r.month || i} className="hover:bg-slate-50/60">
                              <td className="px-4 py-2.5">
                                <div className="font-medium text-slate-900">{first.fmt ? first.fmt(r[first.key]) : r[first.key]}</div>
                                {first.sub && first.sub(r) && <div className="text-xs text-slate-500">{first.sub(r)}</div>}
                              </td>
                              {columns.map(c => <td key={c.label} className={`whitespace-nowrap px-4 py-2.5 ${c.type ? 'text-right tabular-nums' : ''} ${TONE[c.tone] || ''}`}>{cell(c, r)}</td>)}
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
                          <tr>
                            <td className="px-4 py-2.5">Total</td>
                            {columns.map(c => <td key={c.label} className={`whitespace-nowrap px-4 py-2.5 ${c.type ? 'text-right tabular-nums' : ''} ${TONE[c.tone] || ''}`}>{cell(c, d.total)}</td>)}
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
      </div>
    </div>
  );
}
