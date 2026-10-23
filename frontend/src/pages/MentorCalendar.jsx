import { showsInr } from '@/components/utils/displayCurrency';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { PageTitle } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, CircleSlash, Clock, Loader2, Plus, Search, UserRound, Users2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createPageUrl } from '@/utils';
import { TablePagination, usePagination } from '@/components/common/TablePagination';
import { ClassInfoSection } from '@/components/classes/ClassInfo';

/* ────────────────────────────────────────────────────────────────────────────
   Mentor Calendar — the Sales CRM's Mentors page, ported. When the academy's
   mentors are free (the muted band: a weekly pattern each mentor sets in the
   LMS) and what is already booked into it (classes, meetings). A week at a
   time; a phone gets one day at a time. Everything is read from and booked
   into the LMS, so the CRM, the Root portal and this page share one diary.

   Every time here is the academy's zone, never the browser's: the weekly
   slots are bare "HH:MM" that only mean anything there.

   ?student=<id> (the "Book mentor session" button on a student's page) fills
   the booking in for that student. Typing a name in "Who they are meeting"
   offers the students you can see on the Students page; picking one fills
   their name and address. A meeting is online (a link, or a Google Meet the
   LMS makes) or in person (a place, and no link).

   Time off (the user, 2026-10-23): a mentor marks when they're not available —
   a chief mentor for their team, an admin for anyone (may_mark_time_off) —
   and nobody can book them then, here or anywhere (the LMS refuses it). It
   shows as amber "Not available"; its reason only to whoever may mark it.
──────────────────────────────────────────────────────────────────────────── */

const KIND_LABEL = { staff: 'Staff', student: 'Student', client: 'Client' };

/* ── Working hours and leave from the HRMS (backend/src/students/mentorHours.ts), in Dubai time ── */
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** [0,1,2,3,4,5] → "Sun–Fri"; days with gaps → "Sun, Tue, Thu". */
const daysText = (days = []) => {
  const set = new Set(days);
  if (set.size === 7) return 'Every day';
  if (!set.size) return 'No work days';
  const start = [...set].find(d => !set.has((d + 6) % 7)) ?? days[0];
  let run = 0;
  while (run < 7 && set.has((start + run) % 7)) run++;
  if (run === set.size) return run === 1 ? DAY_NAMES[start] : `${DAY_NAMES[start]}–${DAY_NAMES[(start + run - 1) % 7]}`;
  return [...set].sort((a, b) => a - b).map(d => DAY_NAMES[d]).join(', ');
};
const leaveName = (t) => String(t || 'leave').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

/** Under a mentor's name: their HRMS shift and days, in Dubai time. */
function WorkLine({ work, hrms }) {
  if (!hrms?.available) return null;
  if (!work) return <p className="mt-1 text-[11px] text-slate-400">No HRMS schedule</p>;
  const s = work.schedule;
  const title = [
    `${s.name || 'Work schedule'}${s.assigned ? '' : ' — none assigned, so the HRMS default'}`,
    s.timeZone && s.timeZone !== 'Asia/Dubai' ? `set in ${s.timeZone}, shown in Dubai time` : '',
    s.mode === 'duration' && s.requiredHours ? `${s.requiredHours} hours within ${s.from}–${s.to}` : '',
    s.halfDays?.length ? `half days: ${daysText(s.halfDays)}` : '',
  ].filter(Boolean).join(' · ');
  return (
    <p className="mt-1 text-[11px] leading-snug text-teal-800" title={title}>
      <Clock className="mr-1 inline h-3 w-3 align-[-2px]" />
      {s.from}–{s.to} · {daysText(s.workDays)}{s.assigned ? '' : <span className="text-slate-400"> (HRMS default)</span>}
    </p>
  );
}

/** A day's working hours: on leave, off, or the shift (half day noted). */
function WorkChip({ day }) {
  if (day.leave) {
    return (
      <div className="rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700">
        On leave · {leaveName(day.leave.type)}{day.leave.half ? ' · half day' : ''}
      </div>
    );
  }
  if (!day.shifts?.length) return <div className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-500">Off</div>;
  return (
    <div className="rounded border border-dashed border-teal-300 bg-white px-1.5 py-0.5 text-[11px] text-teal-800" title="Working hours, from the HRMS">
      <Clock className="mr-1 inline h-3 w-3 align-[-2px]" />
      <span className="tabular">{day.shifts.map(p => `${p.from}–${p.to}`).join(', ')}</span>{day.half ? ' · half day' : ''}
    </div>
  );
}
const SLOT_MINUTES = 30;
const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;
const errorText = (e, fallback) => e?.message || fallback;
const selectCls = 'h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm';

/** Midnight on the Sunday of whatever week this date falls in. */
const weekStart = (d) => {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
};

/** A column is a calendar date, read straight off its own year, month and day (no zone). */
const columnKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A wall-clock date and time in `tz` as an instant — whatever zone the browser itself is in. */
const wallInZone = (dateKey, hhmm, tz) => {
  const guess = new Date(`${dateKey}T${hhmm}:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(guess);
  const get = (t) => Number(parts.find(p => p.type === t)?.value ?? 0);
  // What that instant reads as on the zone's clock, taken as if it were UTC: the difference is the zone's offset.
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return new Date(guess.getTime() - (asIfUtc - guess.getTime()));
};
/** "Fri 24 Oct, 14:00–18:00", "Fri 24 Oct (all day)", "Fri 24 Oct – Sun 26 Oct". */
const timeOffLabel = (t, tz) => {
  const day = (d) => d.toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' });
  const hm = (d) => d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  const a = new Date(t.startsAt), b = new Date(t.endsAt);
  if (t.allDay) { const last = new Date(b.getTime() - 1); return day(a) === day(last) ? `${day(a)} (all day)` : `${day(a)} – ${day(last)}`; }
  return day(a) === day(b) ? `${day(a)}, ${hm(a)}–${hm(b)}` : `${day(a)}, ${hm(a)} – ${day(b)}, ${hm(b)}`;
};

const emptyForm = { title: '', kind: 'staff', time: '10:00', durationMins: '30', inPerson: false, location: '', meetingUrl: '', notes: '' };

export default function MentorCalendar() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const studentId = new URLSearchParams(useLocation().search).get('student');
  const [offset, setOffset] = useState(0);
  // The phone's day, as an index into the week, so stepping the week keeps the weekday.
  const [dayIndex, setDayIndex] = useState(() => new Date().getDay());

  const { from, to, days } = useMemo(() => {
    const start = weekStart(new Date());
    start.setDate(start.getDate() + offset * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    // A day of slack either side: the window is browser-local, the diary is the academy's.
    const pad = 864e5;
    return {
      from: new Date(start.getTime() - pad).toISOString(),
      to: new Date(end.getTime() + pad).toISOString(),
      days: Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; }),
    };
  }, [offset]);

  const schedule = useQuery({
    queryKey: ['mentors', 'schedule', from, to],
    retry: false,
    queryFn: () => fn('getMentorSchedule', { from, to }),
  });
  const tz = schedule.data?.timezone || 'Asia/Dubai';
  const tzName = tz.replace('_', ' ');

  // Booking for a student (from their page).
  const { data: forStudent } = useQuery({
    queryKey: ['mentor-calendar-student', studentId],
    enabled: !!studentId,
    queryFn: () => base44.entities.Student.get(studentId),
  });
  const studentName = forStudent ? String(forStudent.full_name || forStudent.student_code || 'the student') : '';
  const backToStudent = () => navigate(`${createPageUrl('StudentDetail')}?id=${studentId}`);

  // A meeting is a real instant: which day it falls on *there*.
  const sameDay = (iso, day) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz }) === columnKey(day);
  const at = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  /** The part of a time off on this column's day, in the zone's minutes: { from, to, label } or null. */
  const offOnDay = (t, day) => {
    const dayFrom = wallInZone(columnKey(day), '00:00', tz).getTime(), dayTo = dayFrom + 864e5;
    const a = Math.max(new Date(t.startsAt).getTime(), dayFrom), b = Math.min(new Date(t.endsAt).getTime(), dayTo);
    if (b <= a) return null;
    const from = Math.round((a - dayFrom) / 60_000), to = Math.round((b - dayFrom) / 60_000);
    return { from, to, label: from === 0 && to >= 1440 ? 'All day' : `${at(new Date(a).toISOString())}–${b === dayTo ? '24:00' : at(new Date(b).toISOString())}` };
  };

  // The person looking, when they are one of the mentors (same email): their own week first (the user, 2026-10-08).
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => base44.auth.me(), staleTime: 5 * 60_000 });
  const myEmail = String(me?.email || '').trim().toLowerCase();
  const myMentor = useMemo(() => (schedule.data?.mentors ?? []).find(m => String(m.email || '').trim().toLowerCase() === myEmail) || null, [schedule.data, myEmail]);
  const [onlyMe, setOnlyMe] = useState(false);

  /* Search the sessions — a class by its title, course or module, a booked session by its title or who it is with —
     and narrow the classes to a course and its module (the user, 2026-10-09). Booked sessions belong to no course,
     so the course and module leave them be. */
  const [find, setFind] = useState('');
  const [course, setCourse] = useState('');
  const [mod, setMod] = useState('');
  const { courses, modules } = useMemo(() => {
    const cs = new Map(), ms = new Map();
    for (const m of schedule.data?.mentors ?? []) for (const c of m.classes ?? []) {
      if (c.courseId) cs.set(c.courseId, c.course || 'Course');
      if (c.courseId === course && c.moduleId) ms.set(c.moduleId, c.module || 'Module');
    }
    const sorted = (m) => [...m].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    return { courses: sorted(cs), modules: sorted(ms) };
  }, [schedule.data, course]);
  const needle = find.trim().toLowerCase();
  const filtering = !!(needle || course);
  const has = (...vs) => vs.some(v => String(v ?? '').toLowerCase().includes(needle));
  const classShown = (c) => (!course || c.courseId === course) && (!mod || c.moduleId === mod) && (!needle || (c.mine && has(c.title, c.course, c.module)));
  const meetingShown = (v) => !needle || has(v.title, ...(v.attendeeNames ?? []));

  const myItems = useMemo(() => {
    if (!myMentor) return [];
    const now = Date.now();
    return [
      ...myMentor.classes.filter(c => c.mine && c.status !== 'cancelled' && classShown(c)).map(c => ({ id: `c${c.id}`, startsAt: c.startsAt, mins: c.durationMins, what: c.title || 'Class', sub: `Class · ${c.booked}/${c.capacity} booked`, kind: 'class' })),
      ...myMentor.meetings.filter(meetingShown).map(v => ({ id: `m${v.id}`, startsAt: v.startsAt, mins: v.durationMins, what: v.title, sub: `${KIND_LABEL[v.kind] ?? v.kind}${v.attendeeNames?.length ? ` · with ${v.attendeeNames.join(', ')}` : ''}${v.inPerson ? ` · in person, ${v.location}` : ''}`, kind: 'meeting' })),
      ...(myMentor.timeOff ?? []).map(t => ({ id: `o${t.id}`, startsAt: t.startsAt, mins: Math.round((new Date(t.endsAt) - new Date(t.startsAt)) / 60_000), what: 'Not available', sub: `${timeOffLabel(t, tz)}${t.reason ? ` · ${t.reason}` : ''}`, kind: 'off' })),
    ].filter(i => new Date(i.startsAt).getTime() + (i.mins || 0) * 60_000 > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [myMentor, needle, course, mod]);

  const [query, setQuery] = useState('');
  /* Both academies' mentors (the user, 2026-10-15): Dubai's and Bangalore's, each with a badge; this filter starts on
     the viewer's own location (a Bangalore team's people Bangalore, everyone else Dubai). Each mentor is under the
     academy they belong to. */
  const [academy, setAcademy] = useState(() => (showsInr() ? 'bangalore' : 'dubai'));
  const academyOf = (m) => (/bangal|banglo|bengal/i.test(String(m.academy?.name ?? '')) ? 'bangalore' : 'dubai');
  const bothAcademies = (schedule.data?.mentors ?? []).some(m => m.academy && academyOf(m) === 'bangalore');
  const shown = useMemo(() => {
    const all = (schedule.data?.mentors ?? []).filter(m => !bothAcademies || academy === 'all' || academyOf(m) === academy);
    const q = query.trim().toLowerCase();
    const people = onlyMe && myMentor ? [myMentor]
      : q ? all.filter(m => String(m.name || '').toLowerCase().includes(q) || String(m.email || '').toLowerCase().includes(q)) : all;
    // Searching or narrowing: only the mentors with something that matches this week.
    return filtering
      ? people.filter(m => (m.classes ?? []).some(c => c.status !== 'cancelled' && classShown(c)) || (m.meetings ?? []).some(meetingShown))
      : people;
  }, [schedule.data, query, onlyMe, myMentor, needle, course, mod, academy, bothAcademies]);
  // One page for both layouts. Stepping the week keeps the page: the mentors are the same.
  const { pageItems: pageShown, bar } = usePagination(shown, { resetKey: `${query}|${onlyMe}|${needle}|${course}|${mod}|${academy}` });

  /* ── booking: opened from the day it is for, with that mentor already chosen ── */
  const [booking, setBooking] = useState(null); // { mentor, day }
  const [form, setForm] = useState(emptyForm);
  const [guests, setGuests] = useState([{ name: '', email: '' }]);
  const [viewing, setViewing] = useState(null);
  const [viewingClass, setViewingClass] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const detail = useQuery({
    queryKey: ['mentors', 'meeting', viewing],
    enabled: Boolean(viewing),
    retry: false,
    queryFn: () => fn('getMentorMeeting', { meetingId: viewing }),
  });
  const classDetail = useQuery({
    queryKey: ['mentors', 'class', viewingClass],
    enabled: Boolean(viewingClass),
    retry: false,
    queryFn: () => fn('getMentorClass', { classId: viewingClass }),
  });

  const cancelMeeting = useMutation({
    mutationFn: (id) => fn('cancelMentorMeeting', { meetingId: id }),
    onSuccess: () => {
      toast.success('Cancelled — everybody has been told');
      setConfirmCancel(false);
      setViewing(null);
      qc.invalidateQueries({ queryKey: ['mentors', 'schedule'] });
    },
    onError: (e) => toast.error(errorText(e, 'Could not cancel that')),
  });

  /* ── time off: marked for a mentor this person may (their own; a chief mentor's team; an admin anyone's) ── */
  const [timeOffFor, setTimeOffFor] = useState(null); // { mentor, day? }
  const removeTimeOff = useMutation({
    mutationFn: (body) => fn('removeMentorTimeOff', body),
    onSuccess: () => { toast.success('Taken away — they can be booked then again'); qc.invalidateQueries({ queryKey: ['mentors', 'schedule'] }); },
    onError: (e) => toast.error(errorText(e, 'Could not take that away')),
  });
  const openTimeOff = (mentor, day) => setTimeOffFor({ mentor, day: day ?? null });

  const openBooking = (mentor, day) => {
    setBooking({ mentor, day });
    if (forStudent) {
      setForm({ ...emptyForm, title: `Session with ${studentName}`, kind: 'student' });
      setGuests([{ name: studentName, email: String(forStudent.email || '') }]);
    } else {
      setForm(emptyForm);
      setGuests([{ name: '', email: '' }]);
    }
    setEditingId(null);
  };

  // A student picked from the suggestions: their name and address — and so a meeting with a student.
  const pickStudent = (i, s) => {
    const name = String(s.full_name || s.student_code || '').trim();
    setGuests(rows => rows.map((r, j) => (j === i ? { name, email: String(s.email || '').trim() } : r)));
    setForm(f => ({ ...f, kind: 'student', title: f.title.trim() ? f.title : `Session with ${name}` }));
  };

  // Edit reuses the booking form, filled in.
  const openEdit = (mentor, d) => {
    const when = new Date(d.startsAt);
    setBooking({ mentor, day: when });
    setForm({
      title: d.title,
      kind: d.kind,
      time: when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }),
      durationMins: String(d.durationMins),
      inPerson: Boolean(d.inPerson),
      location: d.location || '',
      meetingUrl: d.meetingUrl || '',
      notes: d.notes || '',
    });
    setGuests(d.attendees?.length ? d.attendees.map(a => ({ name: a.name, email: a.email || '' })) : [{ name: '', email: '' }]);
    setEditingId(d.id);
    setViewing(null);
  };

  const minutesInZone = (iso) => {
    const [h, m] = new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };

  /*
   * The half-hours of the chosen day and what is already in each — from the
   * week in hand, nothing fetched. Taken slots say what is in the way; outside
   * the mentor's hours is marked, never disabled (the hours are a pattern, not
   * a contract — the LMS does not enforce them either).
   */
  const slotList = useMemo(() => {
    if (!booking) return [];
    const { mentor, day } = booking;
    const duration = Number(form.durationMins) || SLOT_MINUTES;
    const busy = [
      ...mentor.classes
        .filter(c => sameDay(c.startsAt, day) && c.status !== 'cancelled')
        .map(c => { const f = minutesInZone(c.startsAt); return { from: f, to: f + (c.durationMins || 0), what: c.mine ? (c.title || 'a class') : 'another academy' }; }),
      ...mentor.meetings
        .filter(v => sameDay(v.startsAt, day) && v.id !== editingId)
        .map(v => { const f = minutesInZone(v.startsAt); return { from: f, to: f + (v.durationMins || 0), what: v.attendeeNames?.join(', ') || v.title }; }),
      // Their time off: never offered (the LMS refuses it anyway).
      ...(mentor.timeOff ?? []).map(t => offOnDay(t, day)).filter(Boolean).map(o => ({ from: o.from, to: o.to, what: 'Not available' })),
    ];
    const free = mentor.slots.filter(sl => sl.dayOfWeek === day.getDay());
    const inHours = (start) => free.length === 0 || free.some(sl => {
      const [fh, fm] = sl.startTime.split(':').map(Number);
      const [th, tm] = sl.endTime.split(':').map(Number);
      return start >= (fh ?? 0) * 60 + (fm ?? 0) && start + duration <= (th ?? 0) * 60 + (tm ?? 0);
    });
    const out = [];
    for (let m = 0; m < 24 * 60; m += SLOT_MINUTES) {
      const value = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const clash = busy.find(b => m < b.to && b.from < m + duration);
      out.push({ value, taken: clash ? clash.what : '', outside: !inHours(m) });
    }
    return out;
  }, [booking, form.durationMins, tz, schedule.data, editingId]);

  /* Nothing free on the day (a whole day off, say): the start left on a taken time — Book stays off. */
  const chosenTaken = booking ? (slotList.find(sl => sl.value === form.time)?.taken || '') : '';

  // Stretching a meeting can take away its start: then the next free slot is picked.
  useEffect(() => {
    if (!booking || !slotList.length) return;
    const current = slotList.find(sl => sl.value === form.time);
    if (current && !current.taken) return;
    const next = slotList.find(sl => !sl.taken);
    if (next) setForm(f => ({ ...f, time: next.value }));
  }, [slotList, booking, form.time]);

  const book = useMutation({
    mutationFn: async () => {
      if (!booking) throw new Error('Nothing to book');
      // The chosen day at the chosen wall-clock time, in the academy's zone.
      const [h, min] = form.time.split(':').map(Number);
      const local = new Date(booking.day);
      local.setHours(h ?? 0, min ?? 0, 0, 0);
      const asIfThere = new Date(local.toLocaleString('en-US', { timeZone: tz }));
      const startsAt = new Date(local.getTime() + (local.getTime() - asIfThere.getTime()));
      const payload = {
        mentorEmail: booking.mentor.email,
        title: form.title.trim(),
        kind: form.kind,
        scheduledStart: startsAt.toISOString(),
        durationMins: Number(form.durationMins),
        attendees: guests.map(g => ({ name: g.name.trim(), email: g.email.trim() })).filter(g => g.name),
        // In person: where, and no link. Online: a pasted link, or blank for a Google Meet.
        inPerson: form.inPerson,
        location: form.inPerson ? form.location.trim() : undefined,
        meetingUrl: form.inPerson ? undefined : form.meetingUrl.trim() || undefined,
        notes: form.notes.trim() || undefined,
      };
      return editingId ? fn('updateMentorMeeting', { meetingId: editingId, ...payload }) : fn('bookMentorMeeting', payload);
    },
    onSuccess: (d) => {
      const emailed = guests.filter(g => g.name.trim() && g.email.trim()).length;
      const who = `the mentor${emailed ? ` and ${emailed} guest${emailed > 1 ? 's' : ''}` : ''}`;
      const message = d?.linkNote ?? (editingId ? `Updated — ${who} told` : `Booked — ${who} emailed`);
      toast.success(message, forStudent && !editingId ? { action: { label: `Back to ${studentName}`, onClick: backToStudent } } : undefined);
      setBooking(null);
      qc.invalidateQueries({ queryKey: ['mentors', 'schedule'] });
    },
    onError: (e) => toast.error(errorText(e, 'Could not book that')),
  });

  /* One mentor's day: their HRMS hours or leave, the pattern they set, the classes in it, the meetings booked into it. */
  const dayCell = (m, day) => {
    const work = m.work?.days?.[columnKey(day)];
    const slots = m.slots.filter(s => s.dayOfWeek === day.getDay());
    const classes = m.classes.filter(c => sameDay(c.startsAt, day) && classShown(c));
    const meetings = m.meetings.filter(v => sameDay(v.startsAt, day) && meetingShown(v));
    const offs = (m.timeOff ?? []).map(t => ({ t, on: offOnDay(t, day) })).filter(x => x.on);
    if (!work && !slots.length && !classes.length && !meetings.length && !offs.length) return null;
    return (
      <div className="space-y-1">
        {work && <WorkChip day={work} />}
        {offs.map(({ t, on }) => (
          <div key={t.id} onClick={(e) => e.stopPropagation()}
            title={`Not available ${timeOffLabel(t, tz)}${t.reason ? ` — ${t.reason}` : ''}${t.createdByName ? ` · marked by ${t.createdByName}` : ''} — nobody can book ${m.name || 'them'} then`}
            className="flex cursor-default items-start justify-between gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">
            <span><span className="tabular">{on.label}</span> · Not available{t.reason ? <span className="block truncate text-[10px] opacity-75">{t.reason}</span> : null}</span>
            {m.may_mark_time_off && (
              <button type="button" aria-label="Take this time off away" className="opacity-60 hover:opacity-100" disabled={removeTimeOff.isPending}
                onClick={() => { if (window.confirm(`Take away "${timeOffLabel(t, tz)}"? ${m.name || 'They'} can be booked then again.`)) removeTimeOff.mutate({ mentorEmail: m.email, timeOffId: t.id }); }}>
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        {slots.map((s, i) => (
          <div key={`${s.startTime}-${i}`} className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">
            {s.startTime}–{s.endTime}
          </div>
        ))}
        {classes.map(c => (
          <button
            type="button"
            key={c.id}
            disabled={!c.mine}
            onClick={(e) => { e.stopPropagation(); if (c.mine) setViewingClass(c.id); }}
            title={c.mine ? `${c.title ?? 'Class'} · ${c.booked}/${c.capacity} booked · ${c.status}` : 'A class for the other academy — the time is taken, the subject is not shown'}
            className={cn(
              'w-full rounded border px-1.5 py-0.5 text-left text-[11px]',
              c.status === 'cancelled'
                ? 'border-slate-200 bg-slate-50 text-slate-400 line-through'
                : c.mine
                  ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                  : 'border-slate-200 bg-slate-100 text-slate-500',
            )}
          >
            <span className="tabular">{at(c.startsAt)}</span> {c.mine ? (c.title || 'Class') : 'Booked elsewhere'}
            {c.mine && c.course && <span className="block truncate text-[10px] opacity-70">{c.course}{c.module ? ` · ${c.module}` : ''}</span>}
          </button>
        ))}
        {meetings.map(v => (
          <button
            type="button"
            key={v.id}
            onClick={(e) => { e.stopPropagation(); setViewing(v.id); }}
            title={`${v.title} · with ${v.attendeeNames?.join(', ')} · ${v.durationMins} minutes${v.inPerson ? ` · in person, ${v.location}` : ''}`}
            className="w-full rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-left text-[11px] text-violet-700 hover:bg-violet-100"
          >
            <span className="tabular">{at(v.startsAt)}</span> {KIND_LABEL[v.kind] ?? v.kind}{v.inPerson ? ' · in person' : ''} · {v.attendeeNames?.join(', ')}
          </button>
        ))}
      </div>
    );
  };

  const hrms = schedule.data?.hrms;
  const legend = [
    ...(hrms?.available ? [['border-dashed border-teal-300 bg-white', 'Working hours (HRMS)'], ['border-rose-200 bg-rose-50', 'Leave (HRMS)']] : []),
    ['border-emerald-200 bg-emerald-50', 'Free hours'],
    ['border-blue-200 bg-blue-50', 'Class'],
    ['border-violet-200 bg-violet-50', 'Meeting'],
    ['border-slate-200 bg-slate-100', 'Other academy'],
    ['border-amber-300 bg-amber-50', 'Not available — can\'t be booked'],
  ];

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <PageTitle eyebrow="Students" icon={CalendarDays}>Mentor Calendar</PageTitle>
            <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
              When the academy's mentors are free, and what is already booked — the LMS's diary, shared with the Sales CRM.{' '}
              <span className="whitespace-nowrap">All times {tzName}.</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name or email…" className="h-9 pl-9" />
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setOffset(o => o - 1)} aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></Button>
              <Button variant="outline" size="sm" className="h-9 min-w-28 gap-1.5" onClick={() => setOffset(0)}>
                <CalendarDays className="h-3.5 w-3.5" />
                {offset === 0 ? 'This week' : days[0].toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
              </Button>
              <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setOffset(o => o + 1)} aria-label="Next week"><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </div>

        {studentId && (
          <div className="flex flex-col gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-2">
              <UserRound className="h-4 w-4 flex-shrink-0" />
              {forStudent ? <>Booking a session for <strong>{studentName}</strong> — pick a mentor's day, then a free time.</> : 'Loading the student…'}
            </span>
            <span className="flex gap-2">
              <Button size="sm" variant="outline" className="h-8 bg-white" onClick={backToStudent}><ArrowLeft className="h-3.5 w-3.5" /> Back to the student</Button>
              <Button size="sm" variant="ghost" className="h-8" onClick={() => navigate(createPageUrl('MentorCalendar'))}>Not for a student</Button>
            </span>
          </div>
        )}

        {/* Your own classes and sessions still to come this week — when you are one of the mentors. */}
        {myMentor && (
          <Card className="border-blue-200">
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">Your schedule{offset === 0 ? ' this week' : ''} · {myItems.length ? `${myItems.length} coming up` : 'nothing booked'}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-50" onClick={() => openTimeOff(myMentor)}><CircleSlash className="h-3.5 w-3.5" /> I'm not available…</Button>
                  <Button size="sm" variant={onlyMe ? 'default' : 'outline'} className="h-8" onClick={() => setOnlyMe(v => !v)}>{onlyMe ? 'Showing only you — show everyone' : 'Only me'}</Button>
                </div>
              </div>
              {myItems.length > 0 && (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {myItems.map(i => (
                    <li key={i.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
                      <span className="w-40 shrink-0 tabular-nums text-slate-600">{new Date(i.startsAt).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz })}</span>
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', i.kind === 'class' ? 'bg-blue-500' : i.kind === 'off' ? 'bg-amber-500' : 'bg-violet-500')} />
                      <span className="font-medium text-slate-900">{i.what}</span>
                      <span className="text-xs text-slate-500">{i.kind === 'off' ? i.sub : `${i.sub} · ${i.mins} min`}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-slate-400">You're told in the bell when a session is booked with you, moved or cancelled, and 30 minutes before each class or session.</p>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          {legend.map(([cls, label]) => (
            <span key={label} className="inline-flex items-center gap-1.5"><span className={cn('h-3 w-5 rounded border', cls)} /> {label}</span>
          ))}
          {schedule.isFetching && !schedule.isPending && <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Refreshing…</span>}
          {hrms?.configured && !hrms.available && <span className="text-amber-700">Working hours from the HRMS are not showing: {hrms.message || 'it did not answer'}</span>}
        </div>

        {/* Search and narrow the sessions — booked sessions have no course, so the course and module keep them. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={find} onChange={e => setFind(e.target.value)} placeholder="Search sessions — title, course, module, who it's with…" className="h-9 pl-9" />
          </div>
          {bothAcademies && (
            <select value={academy} onChange={e => setAcademy(e.target.value)} aria-label="Academy"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm">
              <option value="dubai">Dubai mentors</option>
              <option value="bangalore">Bangalore mentors</option>
              <option value="all">Both academies</option>
            </select>
          )}
          <select value={course} onChange={e => { setCourse(e.target.value); setMod(''); }} aria-label="Course"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm">
            <option value="">All courses</option>
            {courses.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
          </select>
          <select value={mod} onChange={e => setMod(e.target.value)} aria-label="Module" disabled={!course || !modules.length}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50">
            <option value="">{course && !modules.length ? 'No modules' : 'All modules'}</option>
            {modules.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
          </select>
          {filtering && <Button variant="ghost" size="sm" className="h-9" onClick={() => { setFind(''); setCourse(''); setMod(''); }}>Clear</Button>}
        </div>

        {schedule.isPending && (
          <Card><CardContent className="space-y-3 py-6">{[0, 1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}</CardContent></Card>
        )}

        {/* The LMS being unreachable says so, rather than an empty week that reads as "nobody works here". */}
        {schedule.isError && (
          <Card className="border-rose-200 bg-rose-50">
            <CardContent className="py-6 text-sm text-rose-700">{errorText(schedule.error, 'The LMS could not be reached, so there is no schedule to show.')}</CardContent>
          </Card>
        )}

        {schedule.data && shown.length === 0 && (
          <Card><CardContent className="py-16 text-center">
            <Users2 className="mx-auto h-8 w-8 text-slate-300" />
            {query.trim() || filtering ? (
              <>
                <p className="mt-3 text-sm font-medium text-slate-700">{filtering ? 'Nothing this week matches' : 'Nobody matches that'}</p>
                <button onClick={() => { setQuery(''); setFind(''); setCourse(''); setMod(''); }} className="mt-2 text-xs text-cyan-700 hover:underline">Clear the search</button>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm font-medium text-slate-700">No mentors in this academy</p>
                <p className="mt-1 text-sm text-slate-500">Anybody given the instructor role in the LMS appears here.</p>
              </>
            )}
          </CardContent></Card>
        )}

        {/* A phone gets one day at a time: seven columns at 375px are narrower than the times in them. */}
        {schedule.data && shown.length > 0 && (
          <div className="space-y-3 md:hidden">
            <div className="flex items-center justify-between rounded-lg border bg-white px-2 py-1.5">
              <Button variant="ghost" size="sm" className="h-8 px-2" aria-label="Previous day"
                onClick={() => { if (dayIndex > 0) setDayIndex(dayIndex - 1); else { setOffset(offset - 1); setDayIndex(6); } }}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <p className="text-sm font-medium text-slate-800">{days[dayIndex]?.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</p>
              <Button variant="ghost" size="sm" className="h-8 px-2" aria-label="Next day"
                onClick={() => { if (dayIndex < 6) setDayIndex(dayIndex + 1); else { setOffset(offset + 1); setDayIndex(0); } }}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            {pageShown.map(m => {
              const day = days[dayIndex];
              const cell = dayCell(m, day);
              return (
                <Card key={m.id} className="overflow-hidden">
                  <div className="flex items-start justify-between gap-2 border-b px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{m.name || m.email}</p>
                      <p className="truncate text-xs text-slate-400">{m.email}</p>
                      <WorkLine work={m.work} hrms={hrms} />
                    </div>
                    {bothAcademies && m.academy && <Badge variant="outline" className={cn('shrink-0 text-[10px]', academyOf(m) === 'bangalore' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-sky-200 bg-sky-50 text-sky-800')}>{academyOf(m) === 'bangalore' ? 'Bangalore' : 'Dubai'}</Badge>}
                  </div>
                  <div className="space-y-2 px-3 py-2.5">
                    {cell ?? <p className="text-xs text-slate-400">Nothing on this day.</p>}
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => openBooking(m, day)}><Plus className="h-3.5 w-3.5" /> Book time</Button>
                      {m.may_mark_time_off && <Button variant="outline" size="sm" className="gap-1.5 border-amber-300 text-amber-800" onClick={() => openTimeOff(m, day)}><CircleSlash className="h-3.5 w-3.5" /> Not available</Button>}
                    </div>
                  </div>
                </Card>
              );
            })}
            <TablePagination {...bar} className="rounded-lg border" />
          </div>
        )}

        {schedule.data && shown.length > 0 && (
          <Card className="hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead>
                  <tr className="border-b bg-slate-50/80">
                    <th className="w-48 px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Mentor</th>
                    {days.map(d => (
                      <th key={d.toISOString()} className={cn('px-2 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500', columnKey(d) === columnKey(new Date()) && 'text-cyan-700')}>
                        {d.toLocaleDateString(undefined, { weekday: 'short' })}{' '}
                        <span className="font-normal normal-case tracking-normal text-slate-400">{d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageShown.map(m => (
                    <tr key={m.id} className="border-b border-slate-100 align-top last:border-0">
                      <td className="px-3 py-2.5">
                        <p className="truncate font-medium text-slate-900">{m.name || m.email}</p>
                        <p className="truncate text-xs text-slate-400">{m.email}</p>
                        <WorkLine work={m.work} hrms={hrms} />
                        {m.may_mark_time_off && (
                          <button type="button" onClick={() => openTimeOff(m)} className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 hover:underline">
                            <CircleSlash className="h-3 w-3" /> Mark not available
                          </button>
                        )}
                        {bothAcademies && m.academy && <Badge variant="outline" className={cn('mt-1 text-[10px]', academyOf(m) === 'bangalore' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-sky-200 bg-sky-50 text-sky-800')}>{academyOf(m) === 'bangalore' ? 'Bangalore' : 'Dubai'}</Badge>}
                      </td>
                      {days.map(day => (
                        <td key={day.toISOString()} className="group/cell cursor-pointer px-2 py-2.5 transition-colors hover:bg-cyan-50/50"
                          title={`Book time with ${m.name || m.email}`} onClick={() => openBooking(m, day)}>
                          {dayCell(m, day) ?? <span className="text-xs text-slate-300 group-hover/cell:hidden">—</span>}
                          <span className="mt-1 hidden text-[11px] font-medium text-cyan-700 group-hover/cell:block">+ Book</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination {...bar} />
          </Card>
        )}
      </div>

      {timeOffFor && (
        <TimeOffDialog mentor={timeOffFor.mentor} day={timeOffFor.day} tz={tz} isMe={String(timeOffFor.mentor.email || '').toLowerCase() === myEmail}
          onClose={() => setTimeOffFor(null)} onSaved={() => qc.invalidateQueries({ queryKey: ['mentors', 'schedule'] })} />
      )}

      {/* Booking — and changing a booking: the same fields either way. */}
      <Dialog open={Boolean(booking)} onOpenChange={(o) => { if (!o) setBooking(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-brand-navy">{editingId ? 'Change this meeting' : `Book time with ${booking?.mentor.name || booking?.mentor.email}`}</DialogTitle>
            <DialogDescription>
              {booking?.day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · times are {tzName}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="mtitle">What is it</Label>
              <Input id="mtitle" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Intro call, weekly catch-up…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mkind">Kind</Label>
              <select id="mkind" value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))} className={selectCls}>
                <option value="staff">Staff meeting</option>
                <option value="student">With a student</option>
                <option value="client">Outside client</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="mtime">Start</Label>
                <select id="mtime" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} className={selectCls}>
                  {slotList.map(sl => (
                    <option key={sl.value} value={sl.value} disabled={Boolean(sl.taken)}>
                      {sl.value}{sl.taken ? ` · ${sl.taken}` : sl.outside ? ' · outside their hours' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mdur">Minutes</Label>
                <Input id="mdur" type="number" min={5} max={600} step={5} value={form.durationMins} onChange={e => setForm(f => ({ ...f, durationMins: e.target.value }))} />
              </div>
            </div>

            {/* Everybody with an address gets the invitation and the joining link, each separately. */}
            <div className="space-y-2 sm:col-span-2">
              <Label>Who they are meeting</Label>
              {guests.map((g, i) => (
                <div key={i} className="flex items-center gap-2">
                  <StudentNameInput
                    value={g.name}
                    onChange={name => setGuests(rows => rows.map((r, j) => (j === i ? { ...r, name } : r)))}
                    onPick={s => pickStudent(i, s)}
                  />
                  <Input type="email" className="min-w-0 flex-1" value={g.email} onChange={e => setGuests(rows => rows.map((r, j) => (j === i ? { ...r, email: e.target.value } : r)))} placeholder="Email, so they get the invite" />
                  <Button variant="ghost" size="icon" className="shrink-0" title="Remove" disabled={guests.length === 1} onClick={() => setGuests(rows => rows.filter((_, j) => j !== i))}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setGuests(rows => [...rows, { name: '', email: '' }])}>
                <Plus className="h-3.5 w-3.5" /> Add another person
              </Button>
            </div>

            {/* Online: a link, or blank for a Google Meet. In person: where — and no link at all. */}
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="mmode">Online or offline</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <select id="mmode" value={form.inPerson ? 'offline' : 'online'} onChange={e => setForm(f => ({ ...f, inPerson: e.target.value === 'offline' }))} className={cn(selectCls, 'sm:w-48 sm:shrink-0')}>
                  <option value="online">Online</option>
                  <option value="offline">Offline — in person</option>
                </select>
                {form.inPerson ? (
                  <Input aria-label="Where" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Where — e.g. Dubai office, room 2" />
                ) : (
                  <Input aria-label="Joining link" value={form.meetingUrl} onChange={e => setForm(f => ({ ...f, meetingUrl: e.target.value }))} placeholder="Joining link — paste one, or leave blank for a Google Meet" />
                )}
              </div>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="mnotes">Anything else</Label>
              <Input id="mnotes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional — goes in the emails" />
            </div>
          </div>

          {chosenTaken && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">No free time left on this day{chosenTaken === 'Not available' ? ` — ${booking?.mentor.name || 'the mentor'} is not available` : ''}. Pick another day.</p>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setBooking(null)}>Cancel</Button>
            <Button disabled={Boolean(chosenTaken) || book.isPending || form.title.trim().length < 3 || !guests.some(g => g.name.trim()) || (form.inPerson && form.location.trim().length < 2)} onClick={() => book.mutate()}>
              {book.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {editingId ? 'Save changes' : 'Book it'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One meeting in full. The LMS only hands it back to whoever may change it. */}
      <Dialog open={Boolean(viewing)} onOpenChange={(o) => { if (!o) { setViewing(null); setConfirmCancel(false); } }}>
        <DialogContent className="sm:max-w-md">
          {detail.isPending && <Skeleton className="h-40 w-full" />}
          {detail.isError && <p className="py-6 text-sm text-slate-500">{errorText(detail.error, 'That meeting could not be opened.')}</p>}
          {detail.data && (() => {
            const d = detail.data;
            const mentor = (schedule.data?.mentors ?? []).find(m => m.email === d.mentorEmail);
            const when = new Date(d.startsAt);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="text-brand-navy">{d.title}</DialogTitle>
                  <DialogDescription>{KIND_LABEL[d.kind] ?? d.kind} · {d.durationMins} minutes · {d.inPerson ? 'In person' : 'Online'}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3 text-sm">
                  <Field label="When">
                    <span className="font-medium">
                      {when.toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: tz, hour12: false })} ({tzName})
                    </span>
                  </Field>
                  <Field label="Mentor">{d.mentorName || d.mentorEmail}</Field>
                  <Field label={d.attendees?.length === 1 ? 'Attendee' : `Attendees (${d.attendees?.length ?? 0})`}>
                    {(d.attendees ?? []).map((a, i) => <div key={i}>{a.name}{a.email && <span className="text-slate-400"> · {a.email}</span>}</div>)}
                  </Field>
                  {d.inPerson && <Field label="Where">In person · {d.location}</Field>}
                  {!d.inPerson && d.meetingUrl && <Field label="Joining link"><a href={d.meetingUrl} target="_blank" rel="noreferrer" className="break-all text-cyan-700 hover:underline">{d.meetingUrl}</a></Field>}
                  {d.notes && <Field label="Notes">{d.notes}</Field>}
                  <p className="pt-1 text-xs text-slate-400">Booked by {d.bookedByEmail}</p>
                </div>
                <DialogFooter className="gap-2">
                  {confirmCancel ? (
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="text-xs text-slate-500">Cancel it? Everybody will be emailed.</span>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(false)}>No</Button>
                        <Button variant="destructive" size="sm" disabled={cancelMeeting.isPending} onClick={() => cancelMeeting.mutate(d.id)}>
                          {cancelMeeting.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Yes, cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Button variant="ghost" onClick={() => setConfirmCancel(true)}>Cancel meeting</Button>
                      <Button disabled={!mentor} title={mentor ? undefined : 'Open the week this meeting is in to edit it'} onClick={() => mentor && openEdit(mentor, d)}>Edit</Button>
                    </>
                  )}
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* One class, as the LMS has it — read-only; a course's session is changed where the course lives. */}
      <Dialog open={Boolean(viewingClass)} onOpenChange={(o) => { if (!o) setViewingClass(null); }}>
        <DialogContent className="sm:max-w-md">
          {classDetail.isPending && <Skeleton className="h-40 w-full" />}
          {classDetail.isError && <p className="py-6 text-sm text-slate-500">{errorText(classDetail.error, 'That class could not be opened.')}</p>}
          {classDetail.data && (() => {
            const c = classDetail.data;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="text-brand-navy">{String(c.title || 'Class')}</DialogTitle>
                  <DialogDescription>{String(c.courseTitle || '')}{c.instructorName ? ` · ${c.instructorName}` : ''}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {c.status && <Badge>{String(c.status)}</Badge>}
                    {c.language && <Badge variant="outline">{String(c.language)}</Badge>}
                    <Badge variant="outline">{c.inPerson ? 'In person' : 'Online'}</Badge>
                  </div>
                  <Field label="When">
                    <span className="font-medium">
                      {new Date(String(c.startsAt)).toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: tz, hour12: false })} ({tzName}) · {String(c.durationMins)} minutes
                    </span>
                  </Field>
                  {c.description && <Field label="Description">{String(c.description)}</Field>}
                  <Field label="Seats">{String(c.booked)} of {String(c.capacity)} booked</Field>
                  {c.inPerson && (c.location || c.room) && <Field label="Where">{[c.location, c.room].filter(Boolean).join(' · ')}</Field>}
                  {!c.inPerson && c.meetingUrl && <Field label="Joining link"><a href={String(c.meetingUrl)} target="_blank" rel="noreferrer" className="break-all text-cyan-700 hover:underline">{String(c.meetingUrl)}</a></Field>}
                  {c.mentorNotes && <Field label="Mentor's notes">{String(c.mentorNotes)}</Field>}
                  {c.recordingUrl && <Field label="Recording"><a href={String(c.recordingUrl)} target="_blank" rel="noreferrer" className="text-cyan-700 hover:underline">Watch it back</a></Field>}
                </div>
                {/* Info: who booked, joined, cancelled and reviewed, and when it started and ended. */}
                <div className="border-t border-slate-100 pt-3">
                  <p className="mb-2 text-sm font-semibold text-slate-900">Info</p>
                  <ClassInfoSection c={c} tz={tz} />
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const Field = ({ label, children }) => (
  <div>
    <p className="text-xs text-slate-400">{label}</p>
    <div className="text-slate-800">{children}</div>
  </div>
);

/**
 * Students you can see on the Students page that match what was typed (name, code, email or phone) — the
 * page's own search: your own students, a leader's team too, everyone for admins. A few, for a short list.
 */
const findStudents = async (q) => {
  const first = await fn('listStudents', { filters: { search: q }, pageSize: 25 });
  const team = first?.tabs?.includes('team') && first?.tab !== 'team'
    ? await fn('listStudents', { tab: 'team', filters: { search: q }, pageSize: 25 })
    : null;
  const seen = new Set();
  return [...(first?.rows ?? []), ...(team?.rows ?? [])].filter(s => !seen.has(s.id) && seen.add(s.id)).slice(0, 8);
};

/**
 * The Name box of "Who they are meeting": any name can be typed — staff, an outside client — and from two
 * letters on it offers the students who match; picking one fills their name and address.
 */
function StudentNameInput({ value, onChange, onPick }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [q, setQ] = useState('');
  // Asked once the typing pauses, not on every key.
  useEffect(() => {
    const t = setTimeout(() => setQ(value.trim()), 250);
    return () => clearTimeout(t);
  }, [value]);
  const found = useQuery({
    queryKey: ['mentor-calendar', 'students', q],
    enabled: open && q.length >= 2,
    staleTime: 30_000,
    retry: false,
    queryFn: () => findStudents(q),
  });
  const list = found.data ?? [];
  const showing = open && q.length >= 2 && !found.isError && (found.isFetching || found.isSuccess);
  const pick = (s) => { onPick(s); setOpen(false); };
  const box = useRef(null);

  // The list floats above the dialog (not clipped by its scrolling), wider than the box, and flips up when there
  // is no room below. Typing stays in the box throughout; Escape closes the list, not the dialog.
  return (
    <Popover open={showing} onOpenChange={o => { if (!o) setOpen(false); }}>
      <PopoverAnchor asChild>
        <div ref={box} className="min-w-0 flex-1">
          <Input
            value={value}
            onChange={e => { onChange(e.target.value); setOpen(true); setActive(0); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={e => {
              if (!showing || !list.length) return;
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, list.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); pick(list[active] ?? list[0]); }
            }}
            placeholder="Name — or type to find a student"
            autoComplete="off"
            role="combobox"
            aria-expanded={showing}
            aria-autocomplete="list"
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        role="listbox"
        className="max-h-72 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-1"
        onOpenAutoFocus={e => e.preventDefault()}
        onCloseAutoFocus={e => e.preventDefault()}
        onInteractOutside={e => { if (box.current?.contains(e.target)) e.preventDefault(); }}
      >
        {!list.length ? (
          <p className="px-2 py-1.5 text-xs text-slate-400">{found.isFetching ? 'Looking…' : 'No student matches — the name is used as typed'}</p>
        ) : list.map((s, i) => (
          <button
            type="button"
            key={s.id}
            role="option"
            aria-selected={i === active}
            // Before the box loses focus, or the click would close the list first.
            onMouseDown={e => { e.preventDefault(); pick(s); }}
            onMouseEnter={() => setActive(i)}
            className={cn('flex w-full items-baseline justify-between gap-3 rounded px-2 py-1.5 text-left', i === active ? 'bg-slate-100' : 'hover:bg-slate-50')}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm text-slate-800">{s.full_name || s.student_code}</span>
              <span className="block truncate text-xs text-slate-400">{s.email || 'no email'}</span>
            </span>
            <span className="shrink-0 text-xs text-slate-400">{s.student_code}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/* "Not available" for a mentor: whole days, or from one time to another (the academy's zone). What was already booked
   inside it is shown back — it stays; whoever booked it moves or cancels it. */
function TimeOffDialog({ mentor, day, tz, isMe, onClose, onSaved }) {
  const first = day ? columnKey(day) : new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const [f, setF] = useState({ allDay: true, fromDate: first < today ? today : first, toDate: first < today ? today : first, fromTime: '14:00', toTime: '18:00', reason: '' });
  const [booked, setBooked] = useState(null);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const span = useMemo(() => {
    if (f.allDay) {
      const end = new Date(`${f.toDate}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 1);
      return { startsAt: wallInZone(f.fromDate, '00:00', tz), endsAt: wallInZone(end.toISOString().slice(0, 10), '00:00', tz) };
    }
    return { startsAt: wallInZone(f.fromDate, f.fromTime, tz), endsAt: wallInZone(f.toDate, f.toTime, tz) };
  }, [f, tz]);
  const valid = !Number.isNaN(span.startsAt.getTime()) && !Number.isNaN(span.endsAt.getTime()) && span.endsAt > span.startsAt;
  const mark = useMutation({
    mutationFn: () => fn('markMentorTimeOff', { mentorEmail: mentor.email, startsAt: span.startsAt.toISOString(), endsAt: span.endsAt.toISOString(), allDay: f.allDay, reason: f.reason.trim() }),
    onSuccess: (d) => {
      onSaved();
      toast.success(`${isMe ? 'You are' : `${mentor.name || mentor.email} is`} marked not available — nobody can book ${isMe ? 'you' : 'them'} then`);
      if (d?.alreadyBooked?.length) setBooked(d.alreadyBooked); else onClose();
    },
    onError: (e) => toast.error(errorText(e, 'Could not mark that')),
  });
  const when = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-brand-navy">{booked ? 'Already booked in that time' : isMe ? "Mark yourself not available" : `Mark ${mentor.name || mentor.email} not available`}</DialogTitle>
          <DialogDescription>
            {booked ? 'These still stand — move or cancel them if they shouldn\'t.' : `Nobody can book ${isMe ? 'you' : 'them'} in this time — no session or class, here, in the LMS or the CRMs. Times ${tz.replace('_', ' ')}.`}
          </DialogDescription>
        </DialogHeader>
        {booked ? (
          <>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
              {booked.map(b => (
                <li key={`${b.kind}-${b.id}`} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="font-medium text-slate-900">{b.title || (b.kind === 'class' ? 'Class' : 'Session')} <span className="text-xs font-normal text-slate-400">{b.kind === 'class' ? 'class' : 'session'}</span></span>
                  <span className="shrink-0 text-xs text-slate-500">{when(b.startsAt)}</span>
                </li>
              ))}
            </ul>
            <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.allDay} onChange={e => set('allDay', e.target.checked)} /> Whole day(s)</label>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label htmlFor="toFrom">From</Label><Input id="toFrom" type="date" min={today} value={f.fromDate} onChange={e => { set('fromDate', e.target.value); if (e.target.value > f.toDate) set('toDate', e.target.value); }} /></div>
                {!f.allDay && <div className="space-y-1.5"><Label htmlFor="toFromT">at</Label><Input id="toFromT" type="time" value={f.fromTime} onChange={e => set('fromTime', e.target.value)} /></div>}
                <div className="space-y-1.5"><Label htmlFor="toTo">{f.allDay ? 'To (included)' : 'To'}</Label><Input id="toTo" type="date" min={f.fromDate} value={f.toDate} onChange={e => set('toDate', e.target.value)} /></div>
                {!f.allDay && <div className="space-y-1.5"><Label htmlFor="toToT">at</Label><Input id="toToT" type="time" value={f.toTime} onChange={e => set('toTime', e.target.value)} /></div>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="toWhy">Reason <span className="font-normal text-slate-400">(optional — only {isMe ? 'you' : 'the mentor'}, their chief and admins see it)</span></Label>
                <Input id="toWhy" maxLength={300} value={f.reason} onChange={e => set('reason', e.target.value)} placeholder="Leave, appointment, training…" />
              </div>
              {valid ? <p className="text-xs text-slate-500">Not available: {timeOffLabel({ startsAt: span.startsAt.toISOString(), endsAt: span.endsAt.toISOString(), allDay: f.allDay }, tz)}</p>
                : <p className="text-xs text-rose-600">The end must be after the start.</p>}
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button disabled={!valid || mark.isPending} onClick={() => mark.mutate()} className="bg-amber-600 hover:bg-amber-700">
                {mark.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Mark not available
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
