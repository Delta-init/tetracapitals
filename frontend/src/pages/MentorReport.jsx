import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { PageTitle } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ChevronDown, ClipboardList, Loader2, Search, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BreakdownDialog, Opens, ProgramsTab, MeetingsTab } from '@/components/reports/MentorBreakdown';

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

const STAR_TONE = { 5: 'bg-emerald-500', 4: 'bg-emerald-400', 3: 'bg-amber-400', 2: 'bg-orange-500', 1: 'bg-rose-500' };
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '');

/** A mentor's reviews in the dates (2026-10-23): how many of each star, and every review — the student, class, words. */
function MentorReviews({ m, from, to }) {
  const counts = m.total.ratingCounts || {};
  const max = Math.max(1, ...[1, 2, 3, 4, 5].map(k => counts[k] || 0));
  const [pages, setPages] = useState(1);
  const queries = useQuery({
    queryKey: ['mentor-reviews', m.lms_id, from, to, pages], retry: false, enabled: !!m.lms_id,
    queryFn: async () => {
      const all = [];
      let total = 0;
      for (let page = 1; page <= pages; page++) {
        const r = await fn('getInstructorReviewList', { instructorId: m.lms_id, from, to, page });
        all.push(...(r?.reviews ?? []));
        total = r?.total ?? all.length;
      }
      return { reviews: all, total };
    },
  });
  const reviews = queries.data?.reviews ?? [];
  return (
    <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-[220px_1fr]">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Reviews</p>
        <p className="mt-1 flex items-center gap-1.5 text-2xl font-bold text-slate-900">
          <Star className="h-5 w-5 fill-amber-400 text-amber-400" />{m.total.avgRating ?? '—'}
          <span className="text-sm font-normal text-slate-400">· {m.total.reviews} review{m.total.reviews === 1 ? '' : 's'}</span>
        </p>
        <div className="mt-3 space-y-1.5">
          {[5, 4, 3, 2, 1].map(k => (
            <div key={k} className="flex items-center gap-2 text-xs text-slate-500">
              <span className="flex w-7 items-center gap-0.5">{k}<Star className="h-3 w-3 fill-amber-400 text-amber-400" /></span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <span className={cn('block h-full rounded-full', STAR_TONE[k])} style={{ width: `${((counts[k] || 0) / max) * 100}%` }} />
              </span>
              <span className="w-6 text-right tabular-nums">{counts[k] || 0}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="min-w-0">
        {!m.lms_id ? <p className="text-sm text-slate-400">Not matched to an LMS instructor.</p>
          : queries.isLoading ? <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading the reviews…</p>
          : queries.error ? <p className="text-sm text-amber-700">{/not found|404|route/i.test(String(queries.error?.message)) ? 'The reviews need the LMS update.' : queries.error.message}</p>
          : !reviews.length ? <p className="text-sm text-slate-400">No reviews in these dates.</p>
          : (
            <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto pr-1">
              {reviews.map(v => (
                <div key={v._id || v.id} className="py-2.5 first:pt-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                    <span className="inline-flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map(i => <Star key={i} className={cn('h-3.5 w-3.5', v.rating >= i ? 'fill-amber-400 text-amber-400' : 'text-slate-200')} />)}
                    </span>
                    <span className="font-medium text-slate-800">{v.studentId?.name || 'A student'}</span>
                    {v.liveClassId?.title && <span className="text-xs text-slate-500">· {v.liveClassId.title}</span>}
                    {/* Which kind (2026-10-25): a mentor rating, or the feedback left after the class. */}
                    {v.kind && (
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', v.kind === 'class_feedback' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600')}>
                        {v.kind === 'class_feedback' ? 'Class feedback' : 'Mentor rating'}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-slate-400">{when(v.createdAt)}</span>
                  </div>
                  {v.comment && <p className="mt-1 text-sm text-slate-700">{v.comment}</p>}
                  {v.classComment && <p className="mt-1 text-sm text-slate-700"><span className="text-xs font-medium text-sky-700">After the class: </span>{v.classComment}</p>}
                  {!v.comment && !v.classComment && <p className="mt-1 text-xs italic text-slate-400">No comment</p>}
                </div>
              ))}
              {queries.data?.total > reviews.length && (
                <button type="button" onClick={() => setPages(p => p + 1)} className="w-full py-2 text-center text-xs font-medium text-brand-navy hover:underline">
                  Show more ({queries.data.total - reviews.length} left)
                </button>
              )}
            </div>
          )}
      </div>
    </div>
  );
}

/** The meetings by category (2026-10-25, LMS): "Pitch 2 · Overview 1 · Other 1 · — 1". */
const meetingCats = (r) => [['Pitch', r.mCoursePitch], ['Overview', r.mOverview], ['Other', r.mOther], ['—', r.mNone]]
  .filter(([, v]) => v > 0).map(([l, v]) => `${l} ${v}`).join(' · ');


/**
 * The figures of one row — a mentor's total or one of their days. Each number opens what is behind it (2026-10-27):
 * `open(kind, label)`. A day row has no different-students count (only the whole dates do).
 */
function Cells({ r, open, total }) {
  const o = (v, kind, label, tone) => <Opens value={v} onOpen={() => open(kind, label)} className={tone}>{v || 0}</Opens>;
  return (
    <>
      <td className="px-3 py-2.5 text-right">{o(r.held, 'classes', 'classes', 'font-semibold text-slate-800')}<span className="text-slate-400"> / {r.classes || 0}</span></td>
      <td className="px-3 py-2.5 text-right">{o(r.classesCancelled, 'cancelled_classes', 'cancelled classes', 'text-rose-600')}</td>
      <td className="px-3 py-2.5 text-right">{o(r.bookings, 'bookings', 'bookings', 'font-semibold text-slate-800')}</td>
      <td className="px-3 py-2.5 text-right">{o(r.bookingsCancelled, 'cancelled_bookings', 'cancelled bookings', 'text-rose-600')}</td>
      <td className="px-3 py-2.5 text-right">
        {total ? <>{o(r.students, 'students', 'students', 'text-slate-800')}<span className="text-slate-400"> · {r.studentsAttended || 0} came</span></> : <span className="text-slate-300">·</span>}
      </td>
      <td className="px-3 py-2.5 text-right">{o(r.attended, 'attended', 'who came', 'text-emerald-600')}</td>
      <td className="px-3 py-2.5 text-right">{o(r.missed, 'missed', 'who missed', 'text-amber-600')}</td>
      <td className="px-3 py-2.5 text-right">
        {o((r.meetings || 0) - (r.meetingsCancelled || 0), 'meetings', 'meetings', 'text-slate-800')}
        {r.meetingsCancelled ? <span className="text-rose-500"> · <Opens value={r.meetingsCancelled} onOpen={() => open('cancelled_meetings', 'cancelled meetings')} className="text-rose-500">{r.meetingsCancelled}✕</Opens></span> : null}
        {meetingCats(r) && <div className="whitespace-nowrap text-[10px] text-slate-400" title="Course Pitch · Overview · Other · no category">{meetingCats(r)}</div>}
      </td>
      <td className="px-3 py-2.5"><Opens value={r.reviews} onOpen={() => open('classes', 'classes and their reviews')}><Rating avg={r.avgRating} reviews={r.reviews} low={r.lowRatings} /></Opens></td>
      <td className={cn('px-3 py-2.5 text-right font-semibold', r.commission_usd ? 'text-emerald-700' : 'text-slate-300')}>
        <Opens value={r.commission_usd} onOpen={() => open('commission', 'commission')} className="text-emerald-700">{usd(r.commission_usd)}</Opens>
      </td>
    </>
  );
}

export default function MentorReport() {
  const [preset, setPreset] = useState('today');
  const [range, setRange] = useState(() => PRESETS[0][2]());
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  // Mentors, Programs or Meetings (2026-10-27), and the breakdown window that is open, if any.
  const [tab, setTab] = useState('mentors');
  const [spec, setSpec] = useState(null);
  const [from, to] = range;
  const { data, isLoading, error } = useQuery({
    queryKey: ['mentor-report', from, to], retry: false,
    queryFn: () => fn('getMentorReport', { from, to }),
  });
  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => (data?.mentors ?? []).filter(m => !needle || `${m.name} ${m.email}`.toLowerCase().includes(needle)), [data, needle]);
  const sum = useMemo(() => {
    const t = { held: 0, classes: 0, classesCancelled: 0, bookings: 0, bookingsCancelled: 0, attended: 0, missed: 0, meetings: 0, meetingsCancelled: 0, mCoursePitch: 0, mOverview: 0, mOther: 0, mNone: 0, reviews: 0, ratingSum: 0, commission_usd: 0 };
    for (const m of rows) {
      for (const k of Object.keys(t)) if (k !== 'ratingSum') t[k] += Number(m.total?.[k]) || 0;
      t.ratingSum += (Number(m.total?.avgRating) || 0) * (Number(m.total?.reviews) || 0);
    }
    return t;
  }, [rows]);

  const pick = (key) => { const p = PRESETS.find(x => x[0] === key); setPreset(key); setRange(p[2]()); setOpen(null); };
  const setDay = (i, v) => { if (!v) return; setPreset('custom'); setRange(r => { const next = [...r]; next[i] = v; if (next[0] > next[1]) next[i === 0 ? 1 : 0] = v; return next; }); };

  // The whole list's — or, searched, the mentors shown (one mentor: theirs alone).
  const one = needle && rows.length === 1 ? rows[0] : null;
  const scope = one ? { mentorId: one.lms_id || one.id, who: one.name } : { who: needle ? null : (data?.everyone ? 'Every mentor' : 'Your team') };
  const openKind = (kind, label, extra = {}) => setSpec({ kind, from, to, ...(scope.mentorId ? { mentorId: scope.mentorId } : {}), title: `${scope.who ? `${scope.who} — ` : ''}${label}`, ...extra });
  const attendance = sum.attended + sum.missed ? Math.round((sum.attended / (sum.attended + sum.missed)) * 100) : null;
  const students = one ? { booked: one.total?.students, attended: one.total?.studentsAttended } : data?.students;
  // Each card opens what is behind it (2026-10-27) — [label, value, under it, kind].
  const cards = [
    ['Classes held', `${sum.held} / ${sum.classes}`, 'held / scheduled', 'classes', sum.classes],
    ['Classes cancelled', sum.classesCancelled, 'which, and how many had booked', 'cancelled_classes', sum.classesCancelled],
    ['Bookings', sum.bookings, `${sum.bookingsCancelled} cancelled`, 'bookings', sum.bookings],
    ['Bookings cancelled', sum.bookingsCancelled, 'by the students', 'cancelled_bookings', sum.bookingsCancelled],
    ['Students', students?.booked ?? '—', students ? `${students.attended ?? 0} came — each once` : 'needs the LMS update', 'students', students?.booked],
    ['Attended', sum.attended, attendance === null ? '—' : `${attendance}% of those due`, 'attended', sum.attended],
    ['Missed', sum.missed, 'booked, didn’t come', 'missed', sum.missed],
    ['Meetings', sum.meetings - sum.meetingsCancelled, [meetingCats(sum), `${sum.meetingsCancelled} cancelled`].filter(Boolean).join(' · '), 'meetings', sum.meetings],
    ['Reviews', sum.reviews, sum.reviews ? `★ ${Math.round((sum.ratingSum / sum.reviews) * 10) / 10} average · by class` : 'none yet', 'classes', sum.reviews],
    ['Commission', usd(sum.commission_usd), 'credited, pool shares included', 'commission', sum.commission_usd],
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
            {/* Mentors, Programs, Meetings (2026-10-27). */}
            <div className="flex w-max gap-1 rounded-full border border-slate-200 bg-white p-0.5">
              {[['mentors', 'Mentors'], ['programs', 'Programs'], ['meetings', 'Meetings']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => setTab(k)}
                  className={cn('rounded-full px-4 py-1.5 text-sm font-medium', tab === k ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-50')}>{l}</button>
              ))}
            </div>
            {tab === 'programs' && <ProgramsTab from={from} to={to} onOpen={setSpec} />}
            {tab === 'meetings' && <MeetingsTab from={from} to={to} />}
            {tab === 'mentors' && <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {cards.map(([label, value, sub, kind, has]) => (
                <button key={label} type="button" disabled={!has || isLoading}
                  onClick={() => (kind === 'meetings' && !one ? setTab('meetings') : openKind(kind, label.toLowerCase()))} className="text-left disabled:cursor-default">
                  <Card className={cn('h-full transition-colors', has && 'hover:border-brand-navy/40')}><CardContent className="p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">{isLoading ? '…' : value}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-400">{sub}</p>
                  </CardContent></Card>
                </button>
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
                        <th className="px-3 py-3 text-right font-semibold" title="Different students who booked · who came">Students</th>
                        <th className="px-3 py-3 text-right font-semibold">Attended</th>
                        <th className="px-3 py-3 text-right font-semibold">Missed</th>
                        <th className="px-3 py-3 text-right font-semibold" title="1:1 meetings held or booked · cancelled">Meetings</th>
                        <th className="px-3 py-3 font-semibold" title="Reviews students left (average, how many, low = 1–2★)">Reviews</th>
                        <th className="px-3 py-3 text-right font-semibold" title="Commission credited in these dates">Commission</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {isLoading && <tr><td colSpan={11} className="px-4 py-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
                      {!isLoading && !rows.length && <tr><td colSpan={11} className="px-4 py-10 text-center text-slate-400">No mentors to show.</td></tr>}
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
                              <Cells r={m.total} total open={(kind, label) => setSpec({ kind, from, to, mentorId: m.lms_id || m.id, title: `${m.name} — ${label}` })} />
                            </tr>
                            {isOpen && (m.days.length ? m.days.map(d => (
                              <tr key={d.day} className="bg-slate-50/60 text-[13px]">
                                <td className="py-2 pl-12 pr-4 text-slate-600">{dayLabel(d.day)}</td>
                                <Cells r={d} open={(kind, label) => setSpec({ kind, from: d.day, to: d.day, mentorId: m.lms_id || m.id, title: `${m.name} — ${label}, ${dayLabel(d.day)}` })} />
                              </tr>
                            )) : (
                              <tr className="bg-slate-50/60"><td colSpan={11} className="py-3 pl-12 text-sm text-slate-400">Nothing in these dates.</td></tr>
                            ))}
                            {isOpen && m.total.reviews > 0 && (
                              <tr className="bg-slate-50/60"><td colSpan={11} className="px-4 pb-4 pt-1 sm:pl-12"><MentorReviews m={m} from={from} to={to} /></td></tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
            </>}
          </>
        )}
        <BreakdownDialog spec={spec} onClose={() => setSpec(null)} />
      </div>
    </div>
  );
}
