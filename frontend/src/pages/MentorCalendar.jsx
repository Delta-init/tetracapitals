import React, { useEffect, useMemo, useState } from 'react';
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
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Loader2, Plus, Search, UserRound, Users2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createPageUrl } from '@/utils';
import { TablePagination, usePagination } from '@/components/common/TablePagination';

/* ────────────────────────────────────────────────────────────────────────────
   Mentor Calendar — the Sales CRM's Mentors page, ported. When the academy's
   mentors are free (the muted band: a weekly pattern each mentor sets in the
   LMS) and what is already booked into it (classes, meetings). A week at a
   time; a phone gets one day at a time. Everything is read from and booked
   into the LMS, so the CRM, the Root portal and this page share one diary.

   Every time here is the academy's zone, never the browser's: the weekly
   slots are bare "HH:MM" that only mean anything there.

   ?student=<id> (the "Book mentor session" button on a student's page) fills
   the booking in for that student.
──────────────────────────────────────────────────────────────────────────── */

const KIND_LABEL = { staff: 'Staff', student: 'Student', client: 'Client' };
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

const emptyForm = { title: '', kind: 'staff', time: '10:00', durationMins: '30', meetingUrl: '', notes: '' };

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

  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const all = schedule.data?.mentors ?? [];
    const q = query.trim().toLowerCase();
    return q ? all.filter(m => String(m.name || '').toLowerCase().includes(q) || String(m.email || '').toLowerCase().includes(q)) : all;
  }, [schedule.data, query]);
  // One page for both layouts. Stepping the week keeps the page: the mentors are the same.
  const { pageItems: pageShown, bar } = usePagination(shown, { resetKey: query });

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

  // Edit reuses the booking form, filled in.
  const openEdit = (mentor, d) => {
    const when = new Date(d.startsAt);
    setBooking({ mentor, day: when });
    setForm({
      title: d.title,
      kind: d.kind,
      time: when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }),
      durationMins: String(d.durationMins),
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
        meetingUrl: form.meetingUrl.trim() || undefined,
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

  /* One mentor's day: the pattern they set, the classes in it, the meetings booked into it. */
  const dayCell = (m, day) => {
    const slots = m.slots.filter(s => s.dayOfWeek === day.getDay());
    const classes = m.classes.filter(c => sameDay(c.startsAt, day));
    const meetings = m.meetings.filter(v => sameDay(v.startsAt, day));
    if (!slots.length && !classes.length && !meetings.length) return null;
    return (
      <div className="space-y-1">
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
          </button>
        ))}
        {meetings.map(v => (
          <button
            type="button"
            key={v.id}
            onClick={(e) => { e.stopPropagation(); setViewing(v.id); }}
            title={`${v.title} · with ${v.attendeeNames?.join(', ')} · ${v.durationMins} minutes`}
            className="w-full rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-left text-[11px] text-violet-700 hover:bg-violet-100"
          >
            <span className="tabular">{at(v.startsAt)}</span> {KIND_LABEL[v.kind] ?? v.kind} · {v.attendeeNames?.join(', ')}
          </button>
        ))}
      </div>
    );
  };

  const legend = [
    ['border-emerald-200 bg-emerald-50', 'Free hours'],
    ['border-blue-200 bg-blue-50', 'Class'],
    ['border-violet-200 bg-violet-50', 'Meeting'],
    ['border-slate-200 bg-slate-100', 'Other academy'],
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

        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          {legend.map(([cls, label]) => (
            <span key={label} className="inline-flex items-center gap-1.5"><span className={cn('h-3 w-5 rounded border', cls)} /> {label}</span>
          ))}
          {schedule.isFetching && !schedule.isPending && <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Refreshing…</span>}
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
            {query.trim() ? (
              <>
                <p className="mt-3 text-sm font-medium text-slate-700">Nobody matches that</p>
                <button onClick={() => setQuery('')} className="mt-2 text-xs text-cyan-700 hover:underline">Clear the search</button>
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
                    </div>
                    {m.shared && <Badge variant="outline" className="shrink-0 text-[10px]">Shared</Badge>}
                  </div>
                  <div className="space-y-2 px-3 py-2.5">
                    {cell ?? <p className="text-xs text-slate-400">Nothing on this day.</p>}
                    <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => openBooking(m, day)}><Plus className="h-3.5 w-3.5" /> Book time</Button>
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
                        {m.shared && <Badge variant="outline" className="mt-1 text-[10px]">Shared</Badge>}
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
                  <Input value={g.name} onChange={e => setGuests(rows => rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} placeholder="Name" />
                  <Input type="email" value={g.email} onChange={e => setGuests(rows => rows.map((r, j) => (j === i ? { ...r, email: e.target.value } : r)))} placeholder="Email, so they get the invite" />
                  <Button variant="ghost" size="icon" className="shrink-0" title="Remove" disabled={guests.length === 1} onClick={() => setGuests(rows => rows.filter((_, j) => j !== i))}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setGuests(rows => [...rows, { name: '', email: '' }])}>
                <Plus className="h-3.5 w-3.5" /> Add another person
              </Button>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="murl">Joining link</Label>
              <Input id="murl" value={form.meetingUrl} onChange={e => setForm(f => ({ ...f, meetingUrl: e.target.value }))} placeholder="Paste one, or leave blank for a Google Meet" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="mnotes">Anything else</Label>
              <Input id="mnotes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional — goes in the emails" />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setBooking(null)}>Cancel</Button>
            <Button disabled={book.isPending || form.title.trim().length < 3 || !guests.some(g => g.name.trim())} onClick={() => book.mutate()}>
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
                  <DialogDescription>{KIND_LABEL[d.kind] ?? d.kind} · {d.durationMins} minutes</DialogDescription>
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
                  {d.meetingUrl && <Field label="Joining link"><a href={d.meetingUrl} target="_blank" rel="noreferrer" className="break-all text-cyan-700 hover:underline">{d.meetingUrl}</a></Field>}
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
