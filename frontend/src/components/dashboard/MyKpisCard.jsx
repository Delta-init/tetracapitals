import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Gauge } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/* My KPIs on a mentor's Dashboard (2026-11-09): this month's points from Root, the weakest KPIs and the last three
   months — no ranking — and the way to all of it (My KPIs). Shows nothing until Root has opened them, or when the
   mentor isn't in the month's figures. */

const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;
const dubaiMonth = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 7);
const monthLabel = (m) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));
const when = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso)) : '');
const fmt = (v) => (v == null ? '—' : Number(v).toFixed(1));
const tone = (v) => (v == null ? 'text-slate-400' : v >= 85 ? 'text-emerald-600' : v >= 60 ? 'text-amber-600' : 'text-rose-600');
const bar = (v) => (v == null ? 'bg-slate-200' : v >= 85 ? 'bg-emerald-500' : v >= 60 ? 'bg-amber-500' : 'bg-rose-500');

export function MyKpisCard() {
  const month = dubaiMonth();
  const q = useQuery({ queryKey: ['my-kpis', 'own', month], queryFn: () => fn('getMyKpis', { month }), retry: false, staleTime: 60_000 });
  const d = q.data;
  if (q.isLoading || q.isError || !d || d.closed || d.missing || !d.mentor) return null;
  const weakest = d.mentor.categories.flatMap((c) => c.subs.flatMap((s) => s.kpis))
    .filter((k) => k.mode === 'scored' && k.score != null).sort((a, b) => a.score - b.score).slice(0, 3);
  return (
    <Link to={createPageUrl('MyKpis')} className="block">
      <Card className="transition-colors hover:bg-slate-50">
        <CardContent className="flex flex-wrap items-center gap-6 pt-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Gauge className="h-5 w-5" /></div>
            <div>
              <p className="text-sm font-semibold text-slate-800">My KPIs — {monthLabel(month)}</p>
              <p className="text-xs text-slate-500">Observation only{d.observationUntil ? ` until ${when(d.observationUntil)}` : ''} — not used for pay</p>
            </div>
          </div>
          <p className={cn('text-3xl font-semibold tabular-nums', tone(d.mentor.score))}>{fmt(d.mentor.score)}</p>
          <p className="min-w-[200px] flex-1 text-xs text-slate-500">
            {weakest.length ? <>To work on: {weakest.map((k) => `${k.name} (${fmt(k.score)})`).join(' · ')}</> : 'Nothing scored yet this month.'}
          </p>
          <div className="flex h-10 items-end gap-1.5">
            {(d.trend ?? []).map((t) => <div key={t.month} title={`${monthLabel(t.month)}: ${fmt(t.score)}`} className={cn('w-5 rounded', bar(t.score))} style={{ height: `${Math.max(4, t.score ?? 0)}%` }} />)}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
