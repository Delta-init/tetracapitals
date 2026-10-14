import { localFromAed } from '@/components/utils/displayCurrency';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { GraduationCap, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
   Course upgradation (the user, 2026-10-13): a CS's and a CS Manager's summary
   on Funding Activities, instead of the deposit and bonus commission ones —
   for Today, This week, This month or their own dates (Dubai days):
     Collected          approved course payments and upgrade payments (never a
                        sales close), and what still waits approval;
     Commission earned  what was credited to them;
     Still to collect   their students' balances today, and what their % pays
                        on it once collected.
   A CS Manager's figures are every CS's (backend functions/courseCommissionSummary.ts).
──────────────────────────────────────────────────────────────────────────── */

/** In the viewer's currency — INR on a Bangalore team (2026-10-14). */
const AED = (n) => localFromAed(n);
/** A Dubai day (YYYY-MM-DD) as the instant it starts, `plus` days on. */
const dubaiStart = (day, plus = 0) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return undefined;
  const d = new Date(`${day}T00:00:00+04:00`);
  d.setUTCDate(d.getUTCDate() + plus);
  return d.toISOString();
};
const dubaiDay = (ms = Date.now()) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
/** Monday of this week, in Dubai. */
const weekStart = () => {
  const today = dubaiDay();
  const wd = new Date(`${today}T12:00:00+04:00`).getUTCDay();
  return dubaiDay(new Date(`${today}T12:00:00+04:00`).getTime() - ((wd + 6) % 7) * 86_400_000);
};
const PRESETS = [
  { key: 'today', label: 'Today', range: () => [dubaiDay(), dubaiDay()] },
  { key: 'week', label: 'This week', range: () => [weekStart(), dubaiDay()] },
  { key: 'month', label: 'This month', range: () => [`${dubaiDay().slice(0, 8)}01`, dubaiDay()] },
];

function Stat({ label, value, sub, tone, children }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm text-gray-600">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold', tone)}>{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
      {children}
    </div>
  );
}

/** isManager: a CS Manager — every CS's; a Chief Mentor (role chief_mentor) — their team's. */
export default function CourseCommissionSummary({ isManager = false, role = '' }) {
  const chief = role === 'chief_mentor';
  const [preset, setPreset] = useState('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [a, b] = preset === 'custom' ? [from, to] : PRESETS.find(p => p.key === preset).range();
  const { data, isLoading, error } = useQuery({
    queryKey: ['course-commission-summary', a, b],
    queryFn: async () => (await base44.functions.invoke('getCourseCommissionSummary', { from: dubaiStart(a), to: dubaiStart(b, 1) })).data,
    retry: false,
  });
  const c = data?.collected, t = data?.to_collect;
  // In AED only (the user, 2026-10-13): their % of the AED the students paid — course payments (upgrades earn none) —
  // and of what is still to collect.
  const pct = Number(data?.rate?.pct) || 0;
  const earnedAed = ((Number(c?.course_payments_aed) || 0) * pct) / 100;
  const moreAed = ((Number(t?.aed) || 0) * pct) / 100;
  return (
    <Card className="border-gray-200 bg-gradient-to-br from-blue-50 to-indigo-50">
      <CardHeader className="border-b border-blue-100">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-xl font-semibold">
            <GraduationCap className="h-5 w-5 text-blue-600" />
            Course upgradation
            <span className="text-xs font-normal text-gray-500">{chief ? "your team's course payments, and your commission" : isManager ? "every CS's course payments, and your commission" : 'your course payments and commission'}</span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            {[...PRESETS, { key: 'custom', label: 'Custom' }].map(p => (
              <button key={p.key} type="button" onClick={() => setPreset(p.key)}
                className={cn('rounded-lg border px-2.5 py-1 text-xs', preset === p.key ? 'border-blue-300 bg-blue-100 font-semibold text-blue-800' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50')}>
                {p.label}
              </button>
            ))}
            {preset === 'custom' && (
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-8 w-[140px] bg-white text-xs" aria-label="From" />
                to
                <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-8 w-[140px] bg-white text-xs" aria-label="To" />
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-6">
        {error ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{/unknown function|not found|404/i.test(String(error?.message)) ? 'This summary shows after the server update (the API deploy).' : error.message}</p>
        ) : isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Adding it up…</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            <Stat label="Collected" value={AED(c?.course_payments_aed)} tone="text-gray-900">
              <p className="mt-2 text-xs text-gray-400">{c?.count ?? 0} course payment{c?.count === 1 ? '' : 's'}</p>
              {c?.pending_count > 0 && <p className="mt-1 text-xs text-amber-700">+ {AED(c.pending_aed)} waiting approval ({c.pending_count})</p>}
            </Stat>
            <Stat label={chief ? 'Your Chief Mentor commission' : isManager ? 'Your CS Manager commission' : 'Commission earned'} value={AED(earnedAed)} tone="text-emerald-600">
              <p className="mt-2 text-xs text-gray-400">{pct ? `${pct}% of ${AED(c?.course_payments_aed)} collected${chief ? ' by your team' : isManager ? " by every CS" : ''} · ${""}` : 'no commission plan'}</p>
            </Stat>
            <Stat label="Still to collect" value={AED(t?.aed)} sub={`${t?.students ?? 0} student${t?.students === 1 ? '' : 's'}`} tone="text-amber-600">
              {moreAed > 0 && <p className="mt-2 text-xs text-emerald-700">you earn {AED(moreAed)} more when it's paid</p>}
              <p className="mt-1 text-xs text-gray-400">today's balances — not the dates picked</p>
            </Stat>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
