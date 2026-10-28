import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { PageTitle } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Clock, Crown, Loader2, Star, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createPageUrl } from '@/utils';

/* ────────────────────────────────────────────────────────────────────────────
   The mentors' leaderboard (the user, 2026-10-28), opened from the Mentor
   Report: every mentor for the dates, ranked by what is picked — students who
   came (the default), classes held, attendance %, rating, meetings, and
   commission for those who see it (admins, Chiefs). A podium for the top
   three with their HRMS photos, everyone else below; late joins and late
   clock-ins shown beside, not counted (backend getMentorLeaderboard).
──────────────────────────────────────────────────────────────────────────── */

const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;
const dubai = (ms = Date.now()) => new Date(ms + 4 * 3_600_000).toISOString().slice(0, 10);
const PRESETS = [
  ['today', 'Today', () => [dubai(), dubai()]],
  ['week', 'Last 7 days', () => [dubai(Date.now() - 6 * 86_400_000), dubai()]],
  ['month', 'This month', () => [`${dubai().slice(0, 8)}01`, dubai()]],
];
const ROLE = { chief_mentor: 'Chief Mentor', senior_mentor: 'Senior Mentor', junior_mentor: 'Junior Mentor', subjunior_mentor: 'Sub-junior Mentor' };
const usd = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const METRICS = [
  { key: 'attended', label: 'Students attended', show: (m) => m.attended, hint: (m) => `of ${m.bookings} booked` },
  { key: 'held', label: 'Classes held', show: (m) => m.held, hint: (m) => `of ${m.classes} scheduled` },
  { key: 'attendance_pct', label: 'Attendance %', show: (m) => (m.attendance_pct == null ? '—' : `${m.attendance_pct}%`), hint: (m) => `${m.attended} came · ${m.missed} missed`, note: 'Mentors with at least 5 students due' },
  { key: 'rating', label: 'Rating', show: (m) => (m.rating == null ? '—' : <span className="inline-flex items-center gap-1"><Star className="h-4 w-4 fill-amber-400 text-amber-400" />{m.rating}</span>), hint: (m) => `${m.reviews} review${m.reviews === 1 ? '' : 's'}`, note: 'Mentors with at least 3 reviews' },
  { key: 'meetings', label: 'Meetings', show: (m) => m.meetings, hint: () => 'held or booked' },
  { key: 'commission_usd', label: 'Commission', show: (m) => usd(m.commission_usd), hint: () => 'credited', money: true },
];

function Avatar({ m, size = 'h-12 w-12', ring = '' }) {
  const initials = String(m.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return m.photo
    ? <img src={m.photo} alt="" className={cn(size, 'rounded-full object-cover', ring)} />
    : <div className={cn(size, 'flex items-center justify-center rounded-full bg-gradient-to-br from-slate-200 to-slate-300 font-semibold text-slate-600', ring)}>{initials}</div>;
}
const Late = ({ m }) => (m.late_joins || m.late_clock_ins) ? (
  <span className="inline-flex items-center gap-1 text-[11px] text-amber-700" title="Late joins to class · late clock-ins (HRMS) — not counted in the ranking">
    <Clock className="h-3 w-3" />{m.late_joins} late join{m.late_joins === 1 ? '' : 's'} · {m.late_clock_ins} late in
  </span>
) : null;

const PODIUM = [
  { place: 2, h: 'h-28', tone: 'from-slate-200 to-slate-300', ring: 'ring-4 ring-slate-300', text: 'text-slate-600' },
  { place: 1, h: 'h-36', tone: 'from-amber-300 to-amber-400', ring: 'ring-4 ring-amber-400', text: 'text-amber-700' },
  { place: 3, h: 'h-20', tone: 'from-orange-200 to-orange-300', ring: 'ring-4 ring-orange-300', text: 'text-orange-700' },
];

export default function MentorLeaderboard() {
  const [preset, setPreset] = useState('month');
  const [range, setRange] = useState(() => PRESETS[2][2]());
  const [metric, setMetric] = useState('attended');
  const [q, setQ] = useState('');
  const [from, to] = range;
  const { data, isLoading, error } = useQuery({ queryKey: ['mentor-leaderboard', from, to], queryFn: () => fn('getMentorLeaderboard', { from, to }), retry: false });
  const metrics = METRICS.filter(x => !x.money || data?.commission);
  const M = metrics.find(x => x.key === metric) || metrics[0];
  const ranked = useMemo(() => {
    const value = (m) => (m[M.key] == null ? -1 : Number(m[M.key]) || 0);
    return [...(data?.mentors || [])]
      .sort((a, b) => value(b) - value(a) || b.attended - a.attended || String(a.name).localeCompare(String(b.name)))
      .map((m, i, all) => ({ ...m, rank: i > 0 && value(m) === value(all[i - 1]) ? null : i + 1, value: value(m) }));
  }, [data, M]);
  // Equal values share a place.
  let last = 0;
  const placed = ranked.map(m => { if (m.rank) last = m.rank; return { ...m, place: last }; });
  const top = placed.filter(m => m.value > 0).slice(0, 3);
  const needle = q.trim().toLowerCase();
  const rest = placed.filter(m => !needle || String(m.name).toLowerCase().includes(needle));
  const setDay = (i, v) => { if (!v) return; setPreset('custom'); setRange(r => { const n = [...r]; n[i] = v; if (n[0] > n[1]) n[i === 0 ? 1 : 0] = v; return n; }); };

  return (
    <div className="min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link to={createPageUrl('MentorReport')} className="mb-1 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-navy"><ArrowLeft className="h-4 w-4" />Mentor Report</Link>
            <PageTitle eyebrow="Overview" icon={Trophy}>Mentor Leaderboard</PageTitle>
            <p className="mt-2 text-sm text-slate-500">Every mentor, ranked for the dates — from the LMS (Dubai time).</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-full border border-slate-200 bg-white p-0.5">
              {PRESETS.map(([k, l, r]) => (
                <button key={k} type="button" onClick={() => { setPreset(k); setRange(r()); }}
                  className={cn('rounded-full px-3 py-1.5 text-sm font-medium', preset === k ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-50')}>{l}</button>
              ))}
            </div>
            <Input type="date" value={from} max={to} onChange={e => setDay(0, e.target.value)} className="h-9 w-[9.5rem]" />
            <span className="text-slate-400">–</span>
            <Input type="date" value={to} min={from} onChange={e => setDay(1, e.target.value)} className="h-9 w-[9.5rem]" />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {metrics.map(x => (
            <button key={x.key} type="button" onClick={() => setMetric(x.key)}
              className={cn('rounded-full border px-3.5 py-1.5 text-sm font-medium', M.key === x.key ? 'border-brand-navy bg-brand-navy text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>{x.label}</button>
          ))}
        </div>
        {M.note && <p className="-mt-2 text-xs text-slate-400">{M.note}.</p>}

        {error ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{/unknown function|not found|404/i.test(String(error?.message)) ? 'The leaderboard needs the server update (the API deploy).' : error.message}</p>
        ) : isLoading ? (
          <p className="flex items-center justify-center gap-2 py-20 text-sm text-slate-400"><Loader2 className="h-5 w-5 animate-spin" />Ranking…</p>
        ) : <>
          {data?.lms && !data.lms.available && <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">LMS figures aren’t available: {data.lms.message}.</p>}

          {/* The podium: 2 · 1 · 3 */}
          {top.length > 0 && (
            <div className="rounded-3xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 px-4 pb-0 pt-6 shadow-soft">
              <div className="mx-auto grid max-w-3xl grid-cols-3 items-end gap-3">
                {PODIUM.map(p => {
                  const m = top[p.place - 1];
                  if (!m) return <div key={p.place} />;
                  return (
                    <div key={p.place} className="flex flex-col items-center text-center">
                      {p.place === 1 && <Crown className="mb-1 h-7 w-7 fill-amber-400 text-amber-500" />}
                      <Avatar m={m} size={p.place === 1 ? 'h-20 w-20' : 'h-16 w-16'} ring={p.ring} />
                      <p className="mt-2 line-clamp-1 font-semibold text-slate-900">{m.name}{m.me && <span className="ml-1 text-xs font-normal text-brand-navy">(you)</span>}</p>
                      <p className="text-lg font-bold text-slate-900">{M.show(m)}</p>
                      <p className="text-xs text-slate-500">{M.hint(m)}</p>
                      <div className={cn('mt-2 flex w-full items-start justify-center rounded-t-2xl bg-gradient-to-b pt-2 text-3xl font-black', p.h, p.tone, p.text)}>{m.place}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft">
            <div className="flex items-center gap-2 border-b px-4 py-2.5">
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a mentor…" className="h-9 max-w-xs" />
              <span className="ml-auto text-sm text-slate-500">{placed.length} mentors</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
                <tr><th className="w-14 px-4 py-2.5 font-semibold">#</th><th className="px-3 py-2.5 font-semibold">Mentor</th><th className="px-3 py-2.5 text-right font-semibold">{M.label}</th>
                  <th className="hidden px-3 py-2.5 text-right font-semibold md:table-cell">Classes</th><th className="hidden px-3 py-2.5 text-right font-semibold md:table-cell">Came</th><th className="hidden px-3 py-2.5 text-right font-semibold lg:table-cell">Rating</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!rest.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No mentors.</td></tr>}
                {rest.map(m => (
                  <tr key={m.id} className={cn('hover:bg-slate-50', m.me && 'bg-sky-50/60')}>
                    <td className="px-4 py-2.5"><span className={cn('inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold', m.place === 1 ? 'bg-amber-100 text-amber-700' : m.place === 2 ? 'bg-slate-200 text-slate-700' : m.place === 3 ? 'bg-orange-100 text-orange-700' : 'text-slate-500')}>{m.value > 0 ? m.place : '—'}</span></td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-3">
                        <Avatar m={m} size="h-9 w-9" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{m.name}{m.me && <span className="ml-1 text-xs font-normal text-brand-navy">(you)</span>}</p>
                          <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-400">{ROLE[m.role] || (m.role ? m.role : 'LMS only')}<Late m={m} /></p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right"><span className="text-base font-bold text-slate-900">{M.show(m)}</span><span className="block text-xs text-slate-400">{M.hint(m)}</span></td>
                    <td className="hidden px-3 py-2.5 text-right text-slate-600 md:table-cell">{m.held}<span className="text-slate-400"> / {m.classes}</span></td>
                    <td className="hidden px-3 py-2.5 text-right text-emerald-700 md:table-cell">{m.attended}</td>
                    <td className="hidden px-3 py-2.5 text-right lg:table-cell">{m.rating == null ? <span className="text-slate-300">—</span> : <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />{m.rating}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400">Late joins (LMS) and late clock-ins (HRMS) are shown, not counted.</p>
          <div><Link to={createPageUrl('MentorReport')}><Button variant="outline"><ArrowLeft className="mr-1.5 h-4 w-4" />Back to the Mentor Report</Button></Link></div>
        </>}
      </div>
    </div>
  );
}
