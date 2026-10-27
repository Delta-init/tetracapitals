import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Search, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
   What is behind each number of the Mentor Report (the user, 2026-10-27: "each
   count we can break down … the classes, bookings, students, reviews of the
   class, cancellations — which ones; a programs report and a meeting report").
   One window for any number — the team's, one mentor's, one day's or one
   Program's (backend getMentorReportDetails → the LMS) — and the Programs and
   Meetings tabs, each number of which opens it too.
──────────────────────────────────────────────────────────────────────────── */

const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '—');
const usd = (v) => `$${(Number(v) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const CATEGORY = { course_pitch: 'Course pitch', overview: 'Overview', other: 'Other', '': 'No category' };
const STATUS_TONE = { attended: 'bg-emerald-50 text-emerald-700', missed: 'bg-amber-50 text-amber-700', cancelled: 'bg-rose-50 text-rose-700', booked: 'bg-sky-50 text-sky-700' };

export const KIND_TITLE = {
  classes: 'Classes', cancelled_classes: 'Cancelled classes', bookings: 'Bookings', cancelled_bookings: 'Cancelled bookings',
  attended: 'Attended', missed: 'Missed', students: 'Students', meetings: 'Meetings', cancelled_meetings: 'Cancelled meetings',
  programs: 'Programs', commission: 'Commission',
  late_joins: 'Joined late', not_joined: 'No join recorded', attendance: 'Clock-in and out', late_clockins: 'Late clock-ins',
};

const Muted = ({ children }) => <span className="block text-xs text-slate-400">{children}</span>;
const Pill = ({ tone, children }) => <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', tone)}>{children}</span>;
function Rating({ avg, n }) {
  if (!n) return <span className="text-slate-300">—</span>;
  return <span className="inline-flex items-center gap-1 whitespace-nowrap"><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />{avg}<span className="text-slate-400">({n})</span></span>;
}

/** Each kind's columns: [header, cell, text for the search]. */
const COLUMNS = {
  classes: [
    ['When', r => when(r.start)],
    ['Class', r => <>{r.title}<Muted>{[r.program, r.course].filter(Boolean).join(' · ') || '—'}</Muted></>, r => `${r.title} ${r.program} ${r.course}`],
    ['Mentor', r => r.mentor, r => r.mentor],
    ['Booked', r => r.booked], ['Came', r => <span className="text-emerald-600">{r.attended}</span>], ['Missed', r => <span className="text-amber-600">{r.missed}</span>],
    ['Cancelled', r => <span className="text-rose-600">{r.cancelled}</span>], ['Reviews', r => <Rating avg={r.avgRating} n={r.reviews} />],
  ],
  bookings: [
    ['Student', r => <>{r.student || 'A student'}<Muted>{r.studentEmail}</Muted></>, r => `${r.student} ${r.studentEmail}`],
    ['Class', r => <>{r.class}<Muted>{when(r.classStart)}{r.program ? ` · ${r.program}` : ''}</Muted></>, r => `${r.class} ${r.program}`],
    ['Mentor', r => r.mentor, r => r.mentor],
    ['Status', r => <Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill>, r => r.status],
    ['Booked', r => when(r.bookedAt)],
    ['Came / cancelled', r => (r.status === 'cancelled' ? <span className="text-rose-600">{when(r.cancelledAt)}</span> : r.attendedAt ? when(r.attendedAt) : '—')],
  ],
  students: [
    ['Student', r => <>{r.student || 'A student'}<Muted>{r.studentEmail}</Muted></>, r => `${r.student} ${r.studentEmail}`],
    ['Booked', r => r.booked], ['Came', r => <span className="text-emerald-600">{r.attended}</span>], ['Missed', r => <span className="text-amber-600">{r.missed}</span>],
    ['Cancelled', r => <span className="text-rose-600">{r.cancelled}</span>], ['Classes', r => r.classes],
    ['Mentors', r => (r.mentors || []).join(', '), r => (r.mentors || []).join(' ')], ['Last class', r => when(r.lastClass)],
  ],
  meetings: [
    ['When', r => <>{when(r.start)}<Muted>{r.durationMins} min · {r.online ? 'online' : r.location || 'in person'}</Muted></>],
    ['Meeting', r => <>{r.title}<Muted>{CATEGORY[r.category] ?? r.category} · {r.meetingKind}</Muted></>, r => `${r.title} ${CATEGORY[r.category] ?? ''} ${r.meetingKind}`],
    ['Mentor', r => r.mentor, r => r.mentor],
    ['With', r => (r.attendees || []).join(', ') || '—', r => (r.attendees || []).join(' ')],
    ['Status', r => (r.cancelled ? <Pill tone={STATUS_TONE.cancelled}>cancelled {when(r.cancelledAt)}</Pill> : <Pill tone={new Date(r.start) < new Date() ? STATUS_TONE.attended : STATUS_TONE.booked}>{new Date(r.start) < new Date() ? 'held' : 'booked'}</Pill>)],
    ['Booked by', r => <>{r.bookedBy || '—'}<Muted>{r.bookedVia === 'portal' ? 'from this portal' : r.bookedVia === 'lms' ? 'in the LMS' : ''}</Muted></>, r => r.bookedBy],
  ],
  programs: [
    ['Program', r => <>{r.title}<Muted>{r.course}{r.status === 'stopped' ? ' · stopped' : ''} · {r.startDate} → {r.endDate}</Muted></>, r => `${r.title} ${r.course}`],
    ['Mentor', r => <>{r.mentor}{r.coMentors?.length ? <Muted>with {r.coMentors.join(', ')}</Muted> : null}</>, r => `${r.mentor} ${(r.coMentors || []).join(' ')}`],
    ['Students', r => r.students], ['Held', r => r.held], ['Cancelled', r => <span className="text-rose-600">{r.cancelled}</span>],
    ['Bookings', r => r.bookings], ['Came', r => <span className="text-emerald-600">{r.attended}</span>], ['Missed', r => <span className="text-amber-600">{r.missed}</span>],
    ['Attendance', r => (r.attendancePct == null ? '—' : `${r.attendancePct}%`)], ['Reviews', r => <Rating avg={r.avgRating} n={r.reviews} />],
  ],
  commission: [
    ['When', r => when(r.at)], ['Mentor', r => r.mentor, r => r.mentor],
    ['Student', r => <>{r.student || '—'}<Muted>{r.studentCode}</Muted></>, r => `${r.student} ${r.studentCode}`],
    ['From', r => <>{r.request || '—'}<Muted>{r.method}{r.pool ? ' · pool share' : ''}</Muted></>, r => `${r.request} ${r.method}`],
    ['Commission', r => <span className="font-semibold text-emerald-700">{usd(r.usd)}</span>],
  ],
};
/* Late to class (LMS: joined more than 5 minutes after the start) and the HRMS's clock-ins (2026-10-27). */
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '—');
const hm = (mins) => (mins ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m` : '—');
const HRMS_STATUS = { present: 'bg-emerald-50 text-emerald-700', late: 'bg-amber-50 text-amber-700', absent: 'bg-rose-50 text-rose-700', on_leave: 'bg-sky-50 text-sky-700', half_day: 'bg-violet-50 text-violet-700', early_out: 'bg-orange-50 text-orange-700' };
COLUMNS.late_joins = [
  ['Class', r => <>{r.title}<Muted>{[r.program, r.course].filter(Boolean).join(' · ') || '—'}</Muted></>, r => `${r.title} ${r.program} ${r.course}`],
  ['Mentor', r => r.mentor, r => r.mentor],
  ['Starts', r => when(r.start)],
  ['Joined', r => (r.joinedAt ? when(r.joinedAt) : <span className="text-rose-600">no join recorded</span>)],
  ['Late', r => (r.lateMins ? <span className="font-semibold text-amber-700">{r.lateMins} min</span> : '—')],
  ['Booked', r => r.booked], ['Came', r => <span className="text-emerald-600">{r.attended}</span>],
];
COLUMNS.not_joined = COLUMNS.late_joins;
COLUMNS.attendance = [
  ['Day', r => r.day, r => r.day], ['Mentor', r => r.mentor, r => r.mentor],
  ['Shift', r => (r.shift ? <>{r.shift.from}–{r.shift.to}{!r.shift.assigned && <Muted>HRMS default</Muted>}</> : '—')],
  ['Clock in', r => <>{clock(r.firstIn)}{r.lateMinutes > 0 && <Muted><span className="text-amber-700">{r.lateMinutes} min late</span></Muted>}</>],
  ['Clock out', r => (r.firstIn && !r.lastOut ? <span className="text-sky-700">still in</span> : clock(r.lastOut))],
  ['Worked', r => hm(r.workedMinutes)],
  ['Status', r => (r.status ? <Pill tone={HRMS_STATUS[r.status] || 'bg-slate-100 text-slate-600'}>{String(r.status).replace(/_/g, ' ')}{r.leave ? ` · ${r.leave.type}` : ''}{r.wfh ? ' · WFH' : ''}</Pill> : '—'), r => r.status],
  ['Sessions', r => (r.sessions?.length > 1 ? r.sessions.map(x => `${clock(x.in)}–${x.out ? clock(x.out) : '…'}`).join(', ') : '')],
];
COLUMNS.late_clockins = COLUMNS.attendance;
COLUMNS.cancelled_classes = COLUMNS.classes;
COLUMNS.cancelled_bookings = COLUMNS.bookings;
COLUMNS.attended = COLUMNS.bookings;
COLUMNS.missed = COLUMNS.bookings;
COLUMNS.cancelled_meetings = COLUMNS.meetings;

export function useDetails({ kind, from, to, mentorId, programId }, enabled = true) {
  return useQuery({
    queryKey: ['mentor-report-details', kind, from, to, mentorId || '', programId || ''],
    queryFn: () => fn('getMentorReportDetails', { kind, from, to, ...(mentorId ? { mentorId } : {}), ...(programId ? { programId } : {}) }),
    enabled: enabled && !!kind, retry: false,
  });
}

/** The rows of one kind, with a search — in the window or on a tab. */
export function DetailTable({ kind, data, isLoading, error, maxHeight = 'max-h-[60vh]' }) {
  const [q, setQ] = useState('');
  const cols = COLUMNS[kind] || [];
  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => (data?.rows ?? []).filter(r => !needle || cols.some(([, , text]) => text && String(text(r) ?? '').toLowerCase().includes(needle))), [data, needle, cols]);
  if (isLoading) return <p className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>;
  if (error) return <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{/unknown function|not found|404/i.test(String(error?.message)) ? 'This needs the server update (the API deploy).' : error.message}</p>;
  if (data?.lms && !data.lms.available) return <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{data.lms.message}</p>;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Find…" className="h-9 pl-9" />
        </div>
        <span className="ml-auto text-sm text-slate-500">{rows.length}{data?.total > (data?.rows?.length ?? 0) ? ` of the first ${data.rows.length} (${data.total} in all)` : ''}</span>
      </div>
      <div className={cn('overflow-auto rounded-lg border border-slate-200', maxHeight)}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
            <tr>{cols.map(([h]) => <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!rows.length && <tr><td colSpan={cols.length} className="px-3 py-8 text-center text-slate-400">Nothing here.</td></tr>}
            {rows.map(r => <tr key={r.id} className="align-top hover:bg-slate-50">{cols.map(([h, cell]) => <td key={h} className="px-3 py-2">{cell(r)}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The window: `spec` = { kind, title, from, to, mentorId?, programId? } or null. */
export function BreakdownDialog({ spec, onClose }) {
  const q = useDetails(spec || {}, !!spec);
  return (
    <Dialog open={!!spec} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{spec?.title}</DialogTitle>
          {spec && <p className="text-sm text-slate-500">{spec.from === spec.to ? spec.from : `${spec.from} – ${spec.to}`} · Dubai time</p>}
        </DialogHeader>
        {spec && <DetailTable kind={spec.kind} {...q} />}
      </DialogContent>
    </Dialog>
  );
}

/** A number that opens what is behind it. */
export function Opens({ value, onOpen, className, children }) {
  if (!value) return <span className="text-slate-300">{children ?? 0}</span>;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} className={cn('underline-offset-2 hover:underline', className)}>
      {children ?? value}
    </button>
  );
}

/** Programs (2026-10-27): each Program of the team running in the dates — every number opens its list. */
export function ProgramsTab({ from, to, onOpen }) {
  const q = useDetails({ kind: 'programs', from, to });
  const rows = q.data?.rows ?? [];
  const sum = rows.reduce((t, r) => { for (const k of ['students', 'held', 'cancelled', 'bookings', 'attended', 'missed']) t[k] += r[k] || 0; return t; }, { students: 0, held: 0, cancelled: 0, bookings: 0, attended: 0, missed: 0 });
  const open = (r, kind, label) => onOpen({ kind, title: `${r.title} — ${label}`, from, to, programId: r.id });
  const cards = [['Programs', rows.length], ['Students on them', sum.students], ['Classes held', sum.held], ['Cancelled', sum.cancelled],
    ['Attendance', sum.attended + sum.missed ? `${Math.round((sum.attended / (sum.attended + sum.missed)) * 100)}%` : '—']];
  if (q.isLoading || q.error || (q.data?.lms && !q.data.lms.available)) return <DetailTable kind="programs" {...q} />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map(([l, v]) => <Card key={l}><CardContent className="p-4"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{l}</p><p className="mt-1 text-2xl font-bold text-slate-900">{v}</p></CardContent></Card>)}
      </div>
      <Card className="overflow-hidden"><CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
            <tr>{['Program', 'Mentor', 'Students', 'Held', 'Cancelled', 'Bookings', 'Booking cancelled', 'Came', 'Missed', 'Attendance', 'Reviews'].map(h => <th key={h} className="whitespace-nowrap px-3 py-3 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!rows.length && <tr><td colSpan={11} className="px-4 py-10 text-center text-slate-400">No Programs running in these dates.</td></tr>}
            {rows.map(r => (
              <tr key={r.id} className="align-top hover:bg-slate-50">
                <td className="px-3 py-2.5"><p className="font-medium text-slate-900">{r.title}</p><Muted>{r.course}{r.status === 'stopped' ? ' · stopped' : ''} · {r.repeat} · {r.startDate} → {r.endDate}</Muted></td>
                <td className="px-3 py-2.5">{r.mentor}{r.coMentors?.length ? <Muted>with {r.coMentors.join(', ')}</Muted> : null}</td>
                <td className="px-3 py-2.5"><Opens value={r.students} onOpen={() => open(r, 'students', 'students who booked')} /></td>
                <td className="px-3 py-2.5"><Opens value={r.held} onOpen={() => open(r, 'classes', 'classes')} className="font-semibold" /></td>
                <td className="px-3 py-2.5"><Opens value={r.cancelled} onOpen={() => open(r, 'cancelled_classes', 'cancelled classes')} className="text-rose-600" /></td>
                <td className="px-3 py-2.5"><Opens value={r.bookings} onOpen={() => open(r, 'bookings', 'bookings')} /></td>
                <td className="px-3 py-2.5"><Opens value={r.bookingsCancelled} onOpen={() => open(r, 'cancelled_bookings', 'cancelled bookings')} className="text-rose-600" /></td>
                <td className="px-3 py-2.5"><Opens value={r.attended} onOpen={() => open(r, 'attended', 'who came')} className="text-emerald-600" /></td>
                <td className="px-3 py-2.5"><Opens value={r.missed} onOpen={() => open(r, 'missed', 'who missed')} className="text-amber-600" /></td>
                <td className="px-3 py-2.5">{r.attendancePct == null ? '—' : `${r.attendancePct}%`}</td>
                <td className="px-3 py-2.5"><Opens value={r.reviews} onOpen={() => open(r, 'classes', 'classes and their reviews')}><Rating avg={r.avgRating} n={r.reviews} /></Opens></td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}

/** Meetings (2026-10-27): every meeting of the team in the dates — by mentor and by category, each count a filter. */
export function MeetingsTab({ from, to }) {
  const q = useDetails({ kind: 'meetings', from, to });
  const [filter, setFilter] = useState({ mentor: '', category: null, cancelled: null });
  const all = q.data?.rows ?? [];
  const byMentor = useMemo(() => {
    const m = new Map();
    for (const r of all) {
      const x = m.get(r.mentor) ?? { mentor: r.mentor, total: 0, cancelled: 0, course_pitch: 0, overview: 0, other: 0, '': 0 };
      x.total++;
      if (r.cancelled) x.cancelled++; else x[r.category ?? ''] = (x[r.category ?? ''] || 0) + 1;
      m.set(r.mentor, x);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [all]);
  const shown = { ...q.data, rows: all.filter(r => (!filter.mentor || r.mentor === filter.mentor) && (filter.cancelled === null || r.cancelled === filter.cancelled) && (filter.category === null || (!r.cancelled && (r.category ?? '') === filter.category))) };
  const set = (f) => setFilter({ mentor: '', category: null, cancelled: null, ...f });
  const count = (n, f, tone) => <Opens value={n} onOpen={() => set(f)} className={tone} />;
  if (q.isLoading || q.error || (q.data?.lms && !q.data.lms.available)) return <DetailTable kind="meetings" {...q} />;
  const t = byMentor.reduce((s, x) => { for (const k of ['total', 'cancelled', 'course_pitch', 'overview', 'other', '']) s[k] += x[k] || 0; return s; }, { total: 0, cancelled: 0, course_pitch: 0, overview: 0, other: 0, '': 0 });
  const filtered = filter.mentor || filter.category !== null || filter.cancelled !== null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {[['Meetings', t.total, {}], ['Held or booked', t.total - t.cancelled, { cancelled: false }], ['Cancelled', t.cancelled, { cancelled: true }],
          ['Course pitch', t.course_pitch, { category: 'course_pitch' }], ['Overview', t.overview, { category: 'overview' }], ['Other', t.other, { category: 'other' }]].map(([l, v, f]) => (
          <button key={l} type="button" onClick={() => set(f)} className="text-left">
            <Card className="transition-colors hover:border-brand-navy/40"><CardContent className="p-4"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{l}</p><p className="mt-1 text-2xl font-bold text-slate-900">{v}</p></CardContent></Card>
          </button>
        ))}
      </div>
      <Card className="overflow-hidden"><CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
            <tr>{['Mentor', 'Meetings', 'Course pitch', 'Overview', 'Other', 'No category', 'Cancelled'].map(h => <th key={h} className="whitespace-nowrap px-3 py-3 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!byMentor.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No meetings in these dates.</td></tr>}
            {byMentor.map(x => (
              <tr key={x.mentor} className={cn('hover:bg-slate-50', filter.mentor === x.mentor && 'bg-slate-50')}>
                <td className="px-3 py-2.5 font-medium text-slate-900">{x.mentor || '—'}</td>
                <td className="px-3 py-2.5">{count(x.total, { mentor: x.mentor }, 'font-semibold')}</td>
                <td className="px-3 py-2.5">{count(x.course_pitch, { mentor: x.mentor, category: 'course_pitch' })}</td>
                <td className="px-3 py-2.5">{count(x.overview, { mentor: x.mentor, category: 'overview' })}</td>
                <td className="px-3 py-2.5">{count(x.other, { mentor: x.mentor, category: 'other' })}</td>
                <td className="px-3 py-2.5">{count(x[''], { mentor: x.mentor, category: '' })}</td>
                <td className="px-3 py-2.5">{count(x.cancelled, { mentor: x.mentor, cancelled: true }, 'text-rose-600')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
      <div>
        <p className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
          {filtered ? [filter.mentor, filter.cancelled === true ? 'cancelled' : filter.cancelled === false ? 'held or booked' : null, filter.category !== null ? CATEGORY[filter.category] : null].filter(Boolean).join(' · ') : 'Every meeting'}
          {filtered && <button type="button" onClick={() => set({})} className="text-xs font-normal text-brand-navy hover:underline">Show all</button>}
        </p>
        <DetailTable kind="meetings" {...q} data={shown} maxHeight="max-h-[70vh]" />
      </div>
    </div>
  );
}
