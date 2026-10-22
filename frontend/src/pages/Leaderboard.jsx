import { localFromAed, displayCurrency } from '@/components/utils/displayCurrency';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { PageTitle } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Medal, Monitor, Trophy, Users } from 'lucide-react';
import { toast } from 'sonner';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
   Leaderboard (the user, 2026-10-13): the CSs only — no mentors — ranked by the
   course payments they collected (AED, approved, never a sales close) in the
   period, with how many and the commission they earned; filtered by team. And
   the teams, their CSs added up. backend functions/csLeaderboard.ts. (The old
   mentor points board is gone.)
──────────────────────────────────────────────────────────────────────────── */

/** In the viewer's currency — INR on a Bangalore team (2026-10-14). */
const AED = (n) => localFromAed(n);
const dubaiDay = (ms = Date.now()) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
const dubaiStart = (day, plus = 0) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return undefined;
  const d = new Date(`${day}T00:00:00+04:00`);
  d.setUTCDate(d.getUTCDate() + plus);
  return d.toISOString();
};
const PERIODS = [
  { key: 'month', label: 'This month', range: () => [`${dubaiDay().slice(0, 8)}01`, dubaiDay()] },
  { key: 'quarter', label: 'This quarter', range: () => { const t = dubaiDay(); const m = Math.floor((Number(t.slice(5, 7)) - 1) / 3) * 3 + 1; return [`${t.slice(0, 4)}-${String(m).padStart(2, '0')}-01`, t]; } },
  { key: 'year', label: 'This year', range: () => [`${dubaiDay().slice(0, 4)}-01-01`, dubaiDay()] },
  { key: 'all', label: 'All time', range: () => ['', ''] },
];
const MEDAL = ['text-amber-500', 'text-slate-400', 'text-orange-500'];

export default function Leaderboard() {
  const { data: me } = useQuery({ queryKey: ['me-effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()) });
  const [view, setView] = useState('cs');
  const [period, setPeriod] = useState('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [team, setTeam] = useState('all');
  // Dubai and Bangalore each have their own board (2026-10-14): staff see their own; admins pick.
  const [place, setPlace] = useState('dubai');
  const [a, b] = period === 'custom' ? [from, to] : PERIODS.find(p => p.key === period).range();
  const { data, isLoading, error } = useQuery({
    queryKey: ['cs-leaderboard', a, b, place],
    queryFn: async () => (await base44.functions.invoke('getCsLeaderboard', { from: dubaiStart(a), to: dubaiStart(b, 1), location: place })).data,
    retry: false,
  });
  const teams = data?.teams || [];
  const cs = (data?.cs || []).filter(r => team === 'all' || r.team_id === team);
  const list = view === 'cs' ? cs : teams;
  const top = list.slice(0, 3);

  return (
    <div className="min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div>
          <PageTitle eyebrow="Overview" icon={Trophy}>Leaderboard{data?.location && <span className="ml-2 align-middle text-base font-medium text-slate-500">· {data.location === 'bangalore' ? 'Bangalore' : 'Dubai'}</span>}</PageTitle>
          {me?.app_role === 'super_admin' && <TvLinks />}
          <p className="mt-2 text-sm text-slate-500">CSs ranked by the course payments they collected — approved, in {displayCurrency()} — with the commission they earned. Teams are their CSs added up.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border border-slate-200 bg-white p-0.5">
            {[['cs', 'CS leaderboard'], ['teams', 'Team leaderboard']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setView(k)}
                className={cn('rounded-full px-3 py-1.5 text-sm font-medium', view === k ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-50')}>{l}</button>
            ))}
          </div>
          {data && !data.locked && (
            <div className="flex rounded-full border border-slate-200 bg-white p-0.5">
              {[['dubai', 'Dubai'], ['bangalore', 'Bangalore']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => { setPlace(k); setTeam('all'); }}
                  className={cn('rounded-full px-3 py-1.5 text-sm font-medium', place === k ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-50')}>{l}</button>
              ))}
            </div>
          )}
          {view === 'cs' && teams.length > 1 && (
            <Select value={team} onValueChange={setTeam}>
              <SelectTrigger className="h-9 w-48 bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every team</SelectItem>
                {teams.filter(t => t.id).map(t => <SelectItem key={t.id} value={t.id}>{t.team}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-1">
            {[...PERIODS, { key: 'custom', label: 'Custom' }].map(p => (
              <button key={p.key} type="button" onClick={() => setPeriod(p.key)}
                className={cn('rounded-lg border px-2.5 py-1 text-xs', period === p.key ? 'border-blue-300 bg-blue-100 font-semibold text-blue-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>{p.label}</button>
            ))}
            {period === 'custom' && (
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-8 w-[140px] bg-white text-xs" aria-label="From" />
                to
                <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-8 w-[140px] bg-white text-xs" aria-label="To" />
              </span>
            )}
          </div>
        </div>

        {error ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{/unknown function|not found|404/i.test(String(error?.message)) ? 'The leaderboard needs the server update (the API deploy).' : error.message}</p>
        ) : isLoading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Ranking…</div>
        ) : (
          <>
            {/* The top three */}
            <div className="grid gap-4 md:grid-cols-3">
              {top.map((r, i) => (
                <Card key={r.id || r.team} className={cn('border-2', i === 0 ? 'border-amber-300 bg-amber-50/50' : i === 1 ? 'border-slate-300 bg-slate-50/60' : 'border-orange-200 bg-orange-50/40')}>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2">
                      {i === 0 ? <Trophy className={cn('h-6 w-6', MEDAL[i])} /> : <Medal className={cn('h-6 w-6', MEDAL[i])} />}
                      <span className="text-sm text-slate-500">#{r.rank}</span>
                    </div>
                    <p className="mt-2 text-lg font-bold text-brand-navy">{view === 'cs' ? r.name : r.team}</p>
                    <p className="text-xs text-slate-500">{view === 'cs' ? r.team : `${r.cs_count} CS · ${r.location === 'bangalore' ? 'Bangalore' : 'Dubai'}`}</p>
                    <p className="mt-3 text-2xl font-bold text-slate-900">{AED(r.collected_aed)}</p>
                    <p className="text-xs text-slate-500">{r.payments} payment{r.payments === 1 ? '' : 's'} · commission {AED(r.commission_aed)}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Rank</th>
                        <th className="px-4 py-3 font-semibold">{view === 'cs' ? 'CS' : 'Team'}</th>
                        <th className="px-4 py-3 font-semibold">{view === 'cs' ? 'Team' : 'CSs'}</th>
                        <th className="px-4 py-3 text-right font-semibold">Collected</th>
                        <th className="px-4 py-3 text-right font-semibold">Payments</th>
                        <th className="px-4 py-3 text-right font-semibold">Commission</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {!list.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">Nobody to rank yet.</td></tr>}
                      {list.map((r) => (
                        <tr key={r.id || r.team} className={cn(view === 'cs' && r.id === me?.id ? 'bg-blue-50/70' : 'hover:bg-slate-50')}>
                          <td className="px-4 py-2.5 font-semibold text-slate-700">#{r.rank}</td>
                          <td className="px-4 py-2.5 font-medium text-slate-900">{view === 'cs' ? r.name : r.team}{view === 'cs' && r.id === me?.id && <span className="ml-1.5 text-xs text-blue-700">(you)</span>}</td>
                          <td className="px-4 py-2.5 text-slate-600">{view === 'cs' ? r.team : <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{r.cs_count} · {r.location === 'bangalore' ? 'Bangalore' : 'Dubai'}</span>}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-slate-900">{AED(r.collected_aed)}</td>
                          <td className="px-4 py-2.5 text-right text-slate-700">{r.payments}</td>
                          <td className="px-4 py-2.5 text-right text-emerald-700">{AED(r.commission_aed)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

/* The office TV board's links (the user, 2026-10-22: pages/CsTv.jsx) — open: /cs/dubai and /cs/bangalore. */
function TvLinks() {
  const copy = async (location) => {
    const link = `${window.location.origin}/cs/${location}`;
    try { await navigator.clipboard?.writeText(link); toast.success(`${location === 'bangalore' ? 'Bangalore' : 'Dubai'} TV link copied`, { description: link }); }
    catch { toast.message(link); }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1 text-slate-500"><Monitor className="h-3.5 w-3.5" />Office TV:</span>
      <button type="button" onClick={() => copy('dubai')} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 hover:bg-slate-50">Copy Dubai link</button>
      <button type="button" onClick={() => copy('bangalore')} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 hover:bg-slate-50">Copy Bangalore link</button>
    </div>
  );
}
