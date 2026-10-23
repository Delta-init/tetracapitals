import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { PageTitle } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ChevronDown, ClipboardList, Loader2, Search, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
   Mentor Report (the user, 2026-10-23) — each mentor of the team, from the LMS:
   classes held and cancelled, students' bookings and how many cancelled,
   attended, missed, their 1:1 meetings and the reviews of the day — with the
   commission credited to them. A row opens their days. Chiefs see their own
   team, Super Admins everyone (backend functions/mentorReport.ts).
──────────────────────────────────────────────────────────────────────────── */

const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;
const dubaiToday = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
const shift = (day, n) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const PRESETS = [
  ['today', 'Today', () => { const t = dubaiToday(); return [t, t]; }],
  ['yesterday', 'Yesterday', () => { const y = shift(dubaiToday(), -1); return [y, y]; }],
  ['week', 'Last 7 days', () => { const t = dubaiToday(); return [shift(t, -6), t]; }],
  ['month', 'This month', () => { const t = dubaiToday(); return [`${t.slice(0, 8)}01`, t]; }],
];
const usd = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const dayLabel = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const ROLE = { chief_mentor: 'Chief Mentor', senior_mentor: 'Senior Mentor', junior_mentor: 'Junior Mentor', subjunior_mentor: 'Sub-junior Mentor', assistance: 'Assistance' };

function Rating({ avg, reviews, low }) {
  if (!reviews) return <span className="text-slate-300">—</span>;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
      <span className="font-semibold">{avg}</span>
      <span className="text-slate-400">({reviews}{low ? <span className="text-rose-500"> · {low} low</span> : null})</span>
    </span>
  );
}

const n = (v, tone) => <span className={cn(!v ? 'text-slate-300' : tone)}>{v || 0}</span>;

/** The figures of one row — a mentor's total or one of their days. */
function Cells({ r }) {
  return (
    <>
      <td className="px-3 py-2.5 text-right">{n(r.held, 'font-semibold text-slate-800')}<span className="text-slate-400"> / {r.classes || 0}</span></td>
      <td className="px-3 py-2.5 text-right">{n(r.classesCancelled, 'text-rose-600')}</td>
      <td className="px-3 py-2.5 text-right">{n(r.bookings, 'font-semibold text-slate-800')}</td>
      <td className="px-3 py-2.5 text-right">{n(r.bookingsCancelled, 'text-rose-600')}</td>
      <td className="px-3 py-2.5 text-right">{n(r.attended, 'text-emerald-600')}</td>
      <td className="px-3 py-2.5 text-right">{n(r.missed, 'text-amber-600')}</td>
      <td className="px-3 py-2.5 text-right">{n((r.meetings || 0) - (r.meetingsCancelled || 0), 'text-slate-800')}{r.meetingsCancelled ? <span className="text-rose-500"> · {r.meetingsCancelled}✕</span> : null}</td>
      <td className="px-3 py-2.5"><Rating avg={r.avgRating} reviews={r.reviews} low={r.lowRatings} /></td>
      <td className={cn('px-3 py-2.5 text-right font-semibold', r.commission_usd ? 'text-emerald-700' : 'text-slate-300')}>{usd(r.commission_usd)}</td>
    </>
  );
}

export default function MentorReport() {
  const [preset, setPreset] = useState('today');
  const [range, setRange] = useState(() => PRESETS[0][2]());
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [from, to] = range;
  const { data, isLoading, error } = useQuery({
    queryKey: ['mentor-report', from, to], retry: false,
    queryFn: () => fn('getMentorReport', { from, to }),
  });
  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => (data?.mentors ?? []).filter(m => !needle || `${m.name} ${m.email}`.toLowerCase().includes(needle)), [data, needle]);
  const sum = useMemo(() => {
    const t = { held: 0, classes: 0, classesCancelled: 0, bookings: 0, bookingsCancelled: 0, attended: 0, missed: 0, meetings: 0, meetingsCancelled: 0, reviews: 0, ratingSum: 0, commission_usd: 0 };
    for (const m of rows) {
      for (const k of Object.keys(t)) if (k !== 'ratingSum') t[k] += Number(m.total?.[k]) || 0;
      t.ratingSum += (Number(m.total?.avgRating) || 0) * (Number(m.total?.reviews) || 0);
    }
    return t;
  }, [rows]);

  const pick = (key) => { const p = PRESETS.find(x => x[0] === key); setPreset(key); setRange(p[2]()); setOpen(null); };
  const setDay = (i, v) => { if (!v) return; setPreset('custom'); setRange(r => { const next = [...r]; next[i] = v; if (next[0] > next[1]) next[i === 0 ? 1 : 0] = v; return next; }); };

  const cards = [
    ['Classes held', `${sum.held} / ${sum.classes}`, `${sum.classesCancelled} cancelled`],
    ['Bookings', sum.bookings, `${sum.bookingsCancelled} cancelled · ${sum.attended} attended`],
    ['Meetings', sum.meetings - sum.meetingsCancelled, `${sum.meetingsCancelled} cancelled`],
    ['Reviews', sum.reviews, sum.reviews ? `★ ${Math.round((sum.ratingSum / sum.reviews) * 10) / 10} average` : 'none yet'],
    ['Commission', usd(sum.commission_usd), 'credited, pool shares included'],
  ];

  return (
    <div className="min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <PageTitle eyebrow="Overview" icon={ClipboardList}>Mentor Report</PageTitle>
            <p className="mt-2 text-sm text-slate-500">
              {data?.everyone ? 'Every mentor' : 'Your team’s mentors'} — classes, bookings, cancellations, meetings and reviews from the LMS, with their commission. Open a row for each day (Dubai time).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-full border border-slate-200 bg-white p-0.5">
              {PRESETS.map(([k, l]) => (
                <button key={k} type="button" onClick={() => pick(k)}
                  className={cn('rounded-full px-3 py-1.5 text-sm font-medium', preset === k ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-50')}>{l}</button>
              ))}
            </div>
            <Input type="date" value={from} max={to} onChange={e => setDay(0, e.target.value)} className="h-9 w-[9.5rem]" />
            <span className="text-slate-400">–</span>
            <Input type="date" value={to} min={from} onChange={e => setDay(1, e.target.value)} className="h-9 w-[9.5rem]" />
          </div>
        </div>

        {data?.lms && !data.lms.available && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">LMS figures aren’t available: {data.lms.message}. Commission still shows.</p>
        )}

        {error ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{/unknown function|not found|404/i.test(String(error?.message)) ? 'This page needs the server update (the API deploy).' : error.message}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {cards.map(([label, value, sub]) => (
                <Card key={label}><CardContent className="p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{isLoading ? '…' : value}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-400">{sub}</p>
                </CardContent></Card>
              ))}
            </div>

            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="flex items-center gap-2 border-b border-slate-100 p-3">
                  <div className="relative w-full max-w-xs">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a mentor…" className="h-9 pl-9" />
                  </div>
                  <span className="ml-auto text-sm text-slate-500">{rows.length} mentor{rows.length === 1 ? '' : 's'}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Mentor</th>
                        <th className="px-3 py-3 text-right font-semibold" title="Classes held / scheduled">Classes held</th>
                        <th className="px-3 py-3 text-right font-semibold" title="Classes cancelled">Class cancelled</th>
                        <th className="px-3 py-3 text-right font-semibold" title="Students' bookings on their classes">Bookings</th>
                        <th className="px-3 py-3 text-right font-semibold" title="Bookings the students cancelled">Booking cancelled</th>
                        <th className="px-3 py-3 text-right font-semibold">Attended</th>
                        <th className="px-3 py-3 text-right font-semibold">Missed</th>
                        <th className="px-3 py-3 text-right font-semibold" title="1:1 meetings held or booked · cancelled">Meetings</th>
                        <th className="px-3 py-3 font-semibold" title="Reviews students left (average, how many, low = 1–2★)">Reviews</th>
                        <th className="px-3 py-3 text-right font-semibold" title="Commission credited in these dates">Commission</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {isLoading && <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
                      {!isLoading && !rows.length && <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-400">No mentors to show.</td></tr>}
                      {rows.map(m => {
                        const key = m.email || m.id;
                        const isOpen = open === key;
                        return (
                          <Fragment key={key}>
                            <tr className={cn('cursor-pointer hover:bg-slate-50', isOpen && 'bg-slate-50')} onClick={() => setOpen(isOpen ? null : key)}>
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2">
                                  <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', isOpen && 'rotate-180')} />
                                  <div className="min-w-0">
                                    <p className="truncate font-medium text-slate-900">{m.name}</p>
                                    <p className="truncate text-xs text-slate-400">{ROLE[m.role] || (m.role ? m.role : 'LMS only')}{!m.in_lms && m.role ? ' · no LMS activity' : ''}</p>
                                  </div>
                                </div>
                              </td>
                              <Cells r={m.total} />
                            </tr>
                            {isOpen && (m.days.length ? m.days.map(d => (
                              <tr key={d.day} className="bg-slate-50/60 text-[13px]">
                                <td className="py-2 pl-12 pr-4 text-slate-600">{dayLabel(d.day)}</td>
                                <Cells r={d} />
                              </tr>
                            )) : (
                              <tr className="bg-slate-50/60"><td colSpan={10} className="py-3 pl-12 text-sm text-slate-400">Nothing in these dates.</td></tr>
                            ))}
                          </Fragment>
                        );
                      })}
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
