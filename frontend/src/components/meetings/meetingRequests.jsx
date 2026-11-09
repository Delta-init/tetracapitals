import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CalendarClock, CalendarPlus, Loader2, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ringAlarm, showAlert } from '@/components/utils/browserAlerts';
import { STAGE_LABEL } from '@/components/meetings/meetingStage';

/* ────────────────────────────────────────────────────────────────────────────
   Meeting requests (the user, 2026-11-09): a Senior, Junior or Sub-junior
   Mentor asks for a student meeting — the student (any team), what it's for,
   online or in person, how long, a note; never the time. The student's CS (or
   a CS Manager, or a Super Admin) picks the date and time and approves — it's
   booked in the LMS then — or rejects it with a reason (backend
   functions/meetingRequests.ts). Here: the request form, a student's earlier
   meetings, the decide dialog, the CS's popup and Dashboard banner.
──────────────────────────────────────────────────────────────────────────── */

export const ASKS_FOR_MEETINGS = ['senior_mentor', 'junior_mentor', 'subjunior_mentor'];
export const DECIDES_MEETINGS = ['cs', 'cs_manager', 'super_admin', 'admin'];
export const MEETING_CATEGORIES = [['course_pitch', 'Course Pitch'], ['overview', 'Overview'], ['course_upgrade', 'Course Upgradation'], ['other', 'Other']];
export const CATEGORY_LABEL = Object.fromEntries(MEETING_CATEGORIES);
/** The courses a Course Upgradation meeting is about (the portal's course products). */
export const UPGRADE_COURSES = ['DWT', 'MSNR', 'DSLP', 'DSLP PRO', 'DQMP', 'DGMP'];
export const categoryText = (category, course) => (category === 'course_upgrade' && course ? `Course Upgradation · ${course}` : CATEGORY_LABEL[category] || '');
export const STATUS = {
  pending: ['Waiting for the CS', 'bg-amber-50 text-amber-700'],
  booking: ['Booking…', 'bg-sky-50 text-sky-700'],
  approved: ['Approved', 'bg-emerald-50 text-emerald-700'],
  rejected: ['Rejected', 'bg-rose-50 text-rose-700'],
  cancelled: ['Taken back', 'bg-slate-100 text-slate-600'],
};
const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;
const errorText = (e, fallback) => e?.response?.data?.error || e?.data?.error || e?.message || fallback;
export const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dubai' }) : '—');
const selectCls = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring';

export function StatusBadge({ status }) {
  const [label, cls] = STATUS[status] || [status, 'bg-slate-100 text-slate-600'];
  return <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', cls)}>{label}</span>;
}

/** A student's earlier meetings — held (with how it went) and asked for — shown when they're picked. */
export function StudentMeetingHistory({ studentId, className }) {
  const q = useQuery({
    queryKey: ['student-meeting-history', studentId],
    queryFn: () => fn('getStudentMeetingHistory', { studentId }),
    enabled: !!studentId,
  });
  if (!studentId) return null;
  const list = q.data?.meetings || [];
  return (
    <div className={cn('rounded-lg border border-slate-200 bg-slate-50/60 p-3', className)}>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Previous meetings</p>
      {q.isLoading ? <p className="text-xs text-slate-400">Loading…</p>
        : !list.length ? <p className="text-xs text-slate-500">No meetings with this student yet.</p>
          : (
            <ul className="max-h-40 space-y-1.5 overflow-auto text-xs">
              {list.map((m, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-medium text-slate-700">{when(m.at)}</span>
                  <span className="text-slate-600">{m.mentor || 'A mentor'}</span>
                  {categoryText(m.category, m.course) && <span className="rounded bg-violet-50 px-1.5 text-[11px] text-violet-700">{categoryText(m.category, m.course)}</span>}
                  {m.kind === 'held'
                    ? <span className="rounded bg-emerald-50 px-1.5 text-[11px] text-emerald-700">{STAGE_LABEL[m.outcome] || 'held'}</span>
                    : <StatusBadge status={m.status} />}
                  {(m.remark || m.reason) && <span className="w-full text-slate-500">{m.remark || m.reason}</span>}
                </li>
              ))}
            </ul>
          )}
    </div>
  );
}

/** Find a student from any team — name, code, email or phone. */
export function AnyStudentPicker({ value, onPick }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const res = useQuery({
    queryKey: ['meeting-student-search', debounced],
    queryFn: () => fn('searchMeetingStudents', { q: debounced }),
    enabled: debounced.length >= 2 && !value,
  });
  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
        <div className="min-w-0 text-sm">
          <span className="font-medium text-brand-navy">{value.name}</span>
          <span className="ml-1.5 text-xs text-slate-500">{[value.code, value.cs_name && `CS ${value.cs_name}`].filter(Boolean).join(' · ')}</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { onPick(null); setQ(''); }} title="Pick another student"><X className="h-3.5 w-3.5" /></Button>
      </div>
    );
  }
  const list = res.data?.students || [];
  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any student — name, code, email or phone" className="pl-8" autoFocus />
      </div>
      {debounced.length >= 2 && (
        <ul className="max-h-48 overflow-auto rounded-md border border-slate-200 bg-white text-sm">
          {res.isLoading ? <li className="px-3 py-2 text-slate-400">Searching…</li>
            : !list.length ? <li className="px-3 py-2 text-slate-500">No student found.</li>
              : list.map(s => (
                <li key={s.id}>
                  <button type="button" className="w-full px-3 py-2 text-left hover:bg-slate-50" onClick={() => onPick(s)}>
                    <span className="font-medium text-brand-navy">{s.name}</span>
                    <span className="ml-1.5 text-xs text-slate-500">{[s.code, s.cs_name && `CS ${s.cs_name}`].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>
              ))}
        </ul>
      )}
    </div>
  );
}

/** A mentor asks for a meeting with a student — the CS picks the time. `student` pre-picks one ({ id, name, code, cs_name }). */
export function RequestMeetingDialog({ open, onClose, student: initial = null, onStaffMeeting = null }) {
  const qc = useQueryClient();
  const [student, setStudent] = useState(initial);
  const [f, setF] = useState({ category: '', course: '', durationMins: '30', inPerson: false, location: '', notes: '' });
  useEffect(() => { if (open) { setStudent(initial); setF({ category: '', course: '', durationMins: '30', inPerson: false, location: '', notes: '' }); } }, [open, initial?.id]);
  const send = useMutation({
    mutationFn: () => fn('createMeetingRequest', {
      studentId: student?.id, category: f.category, course: f.category === 'course_upgrade' ? f.course : '',
      durationMins: Number(f.durationMins), inPerson: f.inPerson, location: f.inPerson ? f.location.trim() : '', notes: f.notes.trim(),
    }),
    onSuccess: () => {
      toast.success(`Request sent — ${student?.cs_name ? `${student.cs_name} (the CS)` : 'the CS'} picks the time`);
      qc.invalidateQueries({ queryKey: ['meeting-requests'] });
      onClose();
    },
    onError: (e) => toast.error(errorText(e, 'The request could not be sent')),
  });
  const ready = student && f.category && (f.category !== 'course_upgrade' || f.course) && Number(f.durationMins) >= 15 && (!f.inPerson || f.location.trim().length >= 2);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-brand-navy"><CalendarPlus className="h-5 w-5" />Request a meeting</DialogTitle>
          <DialogDescription>The student's CS picks the date and time and approves it — it's booked then, and you're told.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Student *</Label>
            <AnyStudentPicker value={student} onPick={setStudent} />
          </div>
          {student && <StudentMeetingHistory studentId={student.id} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rq-cat">What is it for *</Label>
              <select id="rq-cat" value={f.category} onChange={(e) => setF(x => ({ ...x, category: e.target.value }))} className={selectCls}>
                <option value="">Pick…</option>
                {MEETING_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            {f.category === 'course_upgrade' ? (
              <div className="space-y-1.5">
                <Label htmlFor="rq-course">Which course *</Label>
                <select id="rq-course" value={f.course} onChange={(e) => setF(x => ({ ...x, course: e.target.value }))} className={selectCls}>
                  <option value="">Pick…</option>
                  {UPGRADE_COURSES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="rq-dur">Minutes</Label>
                <Input id="rq-dur" type="number" min={15} max={180} step={15} value={f.durationMins} onChange={(e) => setF(x => ({ ...x, durationMins: e.target.value }))} />
              </div>
            )}
            {f.category === 'course_upgrade' && (
              <div className="space-y-1.5">
                <Label htmlFor="rq-dur2">Minutes</Label>
                <Input id="rq-dur2" type="number" min={15} max={180} step={15} value={f.durationMins} onChange={(e) => setF(x => ({ ...x, durationMins: e.target.value }))} />
              </div>
            )}
            <div className={cn('space-y-1.5', f.category !== 'course_upgrade' && 'sm:col-span-2')}>
              <Label htmlFor="rq-mode">Online or offline</Label>
              <select id="rq-mode" value={f.inPerson ? 'offline' : 'online'} onChange={(e) => setF(x => ({ ...x, inPerson: e.target.value === 'offline' }))} className={selectCls}>
                <option value="online">Online — Google Meet</option>
                <option value="offline">Offline — in person</option>
              </select>
            </div>
            {f.inPerson && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="rq-where">Where *</Label>
                <Input id="rq-where" value={f.location} onChange={(e) => setF(x => ({ ...x, location: e.target.value }))} placeholder="e.g. Dubai office, room 2" />
              </div>
            )}
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="rq-notes">Note for the CS</Label>
              <Input id="rq-notes" value={f.notes} onChange={(e) => setF(x => ({ ...x, notes: e.target.value }))} placeholder="Optional — e.g. best in the evening" />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          {onStaffMeeting && <Button variant="ghost" className="sm:mr-auto" onClick={onStaffMeeting}>A staff meeting instead</Button>}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!ready || send.isPending} onClick={() => send.mutate()}>{send.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Send request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A Dubai wall-clock date + time as an ISO instant. */
const dubaiIso = (date, time) => new Date(`${date}T${time}:00+04:00`).toISOString();
const todayDubai = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
const hm = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Dubai' });

/** The mentor's day: what is booked and when they're not available, so the CS picks a free time. */
function MentorDay({ email, date }) {
  const from = new Date(`${date}T00:00:00+04:00`), to = new Date(from.getTime() + 864e5);
  const q = useQuery({
    queryKey: ['mentors', 'schedule', 'day', date],
    queryFn: () => fn('getMentorSchedule', { from: from.toISOString(), to: to.toISOString() }),
    enabled: !!date,
    staleTime: 30_000,
  });
  const m = (q.data?.mentors || []).find(x => String(x.email || '').toLowerCase() === String(email || '').toLowerCase());
  const items = [
    ...(m?.classes || []).map(c => ({ at: c.startsAt, mins: c.durationMins, text: `Class · ${c.title || ''}` })),
    ...(m?.meetings || []).map(v => ({ at: v.startsAt, mins: v.durationMins, text: `Meeting · ${v.title || ''}` })),
    ...(m?.timeOff || []).map(t => ({ at: t.startsAt, end: t.endsAt, text: 'Not available' })),
  ].filter(i => i.at).sort((a, b) => a.at.localeCompare(b.at));
  const work = m?.work?.days?.[date];
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs">
      <p className="mb-1.5 font-semibold uppercase tracking-wide text-slate-500">The mentor's day</p>
      {q.isLoading ? <p className="text-slate-400">Loading…</p> : !m ? <p className="text-slate-500">Couldn't read the mentor's calendar — the LMS will still refuse a clash.</p> : (
        <>
          {work && <p className="mb-1 text-slate-600">{work.leave ? `On leave${work.leave.half ? ' · half day' : ''}` : work.shifts?.length ? `Works ${work.shifts.map(p => `${p.from}–${p.to}`).join(', ')}` : 'Off that day'}</p>}
          {!items.length ? <p className="text-emerald-700">Nothing booked that day.</p> : (
            <ul className="space-y-0.5">
              {items.map((i, k) => (
                <li key={k} className="text-slate-700">
                  <span className="font-medium">{hm(i.at)}–{i.end ? hm(i.end) : hm(new Date(new Date(i.at).getTime() + (i.mins || 0) * 60e3).toISOString())}</span> {i.text}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** The CS decides: a date and time, then Approve (booked in the LMS) — or Reject with a reason. */
export function DecideMeetingDialog({ request: r, onClose }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayDubai());
  const [time, setTime] = useState('11:00');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => { if (r) { setDate(todayDubai()); setTime('11:00'); setRejecting(false); setReason(''); } }, [r?.id]);
  const done = () => { qc.invalidateQueries({ queryKey: ['meeting-requests'] }); qc.invalidateQueries({ queryKey: ['meeting-requests-waiting'] }); onClose(); };
  const decide = useMutation({
    mutationFn: (body) => fn('decideMeetingRequest', { id: r.id, ...body }),
    onSuccess: (_d, body) => { toast.success(body.action === 'approve' ? `Booked — ${r.mentor.name} and ${r.student.name} are emailed` : 'Rejected — the mentor is told'); done(); },
    onError: (e) => toast.error(errorText(e, "That didn't work")),
  });
  if (!r) return null;
  return (
    <Dialog open={!!r} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-brand-navy"><CalendarClock className="h-5 w-5" />Meeting request — {r.student.name}</DialogTitle>
          <DialogDescription>
            {r.mentor.name} asks for a {categoryText(r.category, r.course) || 'meeting'}, {r.duration_mins} min, {r.in_person ? `in person (${r.location})` : 'online'}.
          </DialogDescription>
        </DialogHeader>
        {r.notes && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">“{r.notes}”</p>}
        <StudentMeetingHistory studentId={r.student.id} />
        {rejecting ? (
          <div className="space-y-1.5">
            <Label htmlFor="rq-reason">Why — the mentor sees it *</Label>
            <Input id="rq-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. the student isn't ready yet" autoFocus />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="rq-date">Date *</Label><Input id="rq-date" type="date" min={todayDubai()} value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="rq-time">Time (Dubai) *</Label><Input id="rq-time" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} /></div>
            </div>
            {date && <MentorDay email={r.mentor.email} date={date} />}
          </>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          {rejecting ? (
            <>
              <Button variant="outline" onClick={() => setRejecting(false)}>Back</Button>
              <Button variant="destructive" disabled={!reason.trim() || decide.isPending} onClick={() => decide.mutate({ action: 'reject', reason: reason.trim() })}>{decide.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Reject</Button>
            </>
          ) : (
            <>
              <Button variant="outline" className="text-rose-700" onClick={() => setRejecting(true)}>Reject…</Button>
              <Button disabled={!date || !time || decide.isPending} onClick={() => decide.mutate({ action: 'approve', scheduledStart: dubaiIso(date, time) })}>{decide.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Approve &amp; book</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The requests waiting for this person — the sidebar, the Dashboard banner and the popup share it. */
export function useMeetingRequestsWaiting(currentUser) {
  const enabled = !!currentUser?.id && DECIDES_MEETINGS.includes(currentUser.app_role);
  const q = useQuery({
    queryKey: ['meeting-requests-waiting', currentUser?.id],
    queryFn: () => fn('getMeetingRequestsWaiting', {}),
    enabled,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });
  return { ...q, enabled };
}

/** "N meeting requests waiting" on the Dashboard. */
export function MeetingRequestBanner({ currentUser }) {
  const q = useMeetingRequestsWaiting(currentUser);
  const n = q.data?.count || 0;
  if (!q.enabled || !n) return null;
  const names = (q.data?.latest || []).slice(0, 3).map(r => `${r.mentor.name} → ${r.student.name}`);
  return (
    <Link to={createPageUrl('MeetingRequests')} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 transition-colors hover:border-amber-300">
      <div className="flex items-center gap-3">
        <CalendarClock className="h-6 w-6 text-amber-600" />
        <div>
          <p className="font-semibold text-amber-900">{n} meeting request{n === 1 ? '' : 's'} waiting for you</p>
          <p className="text-sm text-amber-800">{names.join(' · ')}{n > 3 ? ` +${n - 3} more` : ''} — pick the time and approve, or reject.</p>
        </div>
      </div>
      <span className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white">Open requests</span>
    </Link>
  );
}

const SEEN_KEY = 'meeting-requests-seen';
const seenIds = (uid) => { try { return JSON.parse(localStorage.getItem(`${SEEN_KEY}:${uid}`) || '[]'); } catch { return []; } };

/** A window when a new request comes in — once each; "Decide now" opens it. */
export function MeetingRequestPopup({ currentUser }) {
  const q = useMeetingRequestsWaiting(currentUser);
  const [open, setOpen] = useState(false);
  const [deciding, setDeciding] = useState(null);
  const latest = q.data?.latest || [];
  const fresh = useMemo(() => { const seen = seenIds(currentUser?.id); return latest.filter(r => !seen.includes(r.id)); }, [latest, currentUser?.id]);
  const key = fresh.map(r => r.id).join(',');
  useEffect(() => {
    if (!q.enabled || !fresh.length) return;
    setOpen(true);
    ringAlarm(`meeting-requests:${key}`);
    showAlert({ key: `meeting-requests:${key}`, title: `Meeting request — ${fresh[0].student.name}`, body: `${fresh[0].mentor.name} asks for a meeting. Pick the time and approve.`, tag: 'meeting-request', url: createPageUrl('MeetingRequests') });
  }, [q.enabled, key]);
  const close = () => {
    try { localStorage.setItem(`${SEEN_KEY}:${currentUser?.id}`, JSON.stringify([...new Set([...seenIds(currentUser?.id), ...latest.map(r => r.id)])].slice(-200))); } catch { /* shows again */ }
    setOpen(false);
  };
  if (!q.enabled) return null;
  return (
    <>
      <Dialog open={open && fresh.length > 0} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-amber-600" />New meeting request{fresh.length === 1 ? '' : 's'}</DialogTitle>
            <DialogDescription>A mentor asks to meet your student. Pick the date and time and approve — or reject it.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-[50vh] space-y-2 overflow-auto">
            {fresh.map(r => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <div className="text-sm">
                  <p className="font-medium text-brand-navy">{r.student.name}</p>
                  <p className="text-xs text-slate-500">{r.mentor.name} · {categoryText(r.category, r.course)} · {r.duration_mins} min · {r.in_person ? 'in person' : 'online'}</p>
                </div>
                <Button size="sm" onClick={() => { close(); setDeciding(r); }}>Decide now</Button>
              </li>
            ))}
          </ul>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" asChild><Link to={createPageUrl('MeetingRequests')} onClick={close}>Open the page</Link></Button>
            <Button variant="outline" onClick={close}>Later</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DecideMeetingDialog request={deciding} onClose={() => setDeciding(null)} />
    </>
  );
}

/** A mentor's own requests — waiting, approved (with the time), rejected (with why); one still waiting can be taken back. */
export function MyMeetingRequests({ onNew }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['meeting-requests', 'mine'],
    queryFn: () => fn('listMeetingRequests', { box: 'mine', status: 'all' }),
    refetchInterval: 60_000,
  });
  const cancel = useMutation({
    mutationFn: (id) => fn('cancelMeetingRequest', { id }),
    onSuccess: () => { toast.success('Taken back'); qc.invalidateQueries({ queryKey: ['meeting-requests'] }); },
    onError: (e) => toast.error(errorText(e, "Couldn't take it back")),
  });
  const list = q.data?.requests || [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Meetings you asked for — the student's CS picks the time and approves them.</p>
        {onNew && <Button size="sm" className="gap-1.5" onClick={onNew}><CalendarPlus className="h-4 w-4" />Request a meeting</Button>}
      </div>
      {q.isLoading ? <p className="text-sm text-slate-400">Loading…</p>
        : q.isError ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{/unknown function|not found|404/i.test(String(q.error?.message)) ? 'This needs the server update (the API deploy).' : q.error?.message}</p>
          : !list.length ? <p className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">No requests yet.</p>
            : (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {list.map(r => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-brand-navy">{r.student.name} <span className="ml-1 text-xs font-normal text-slate-500">{categoryText(r.category, r.course)} · {r.duration_mins} min · {r.in_person ? 'in person' : 'online'}</span></p>
                      <p className="text-xs text-slate-500">
                        Asked {when(r.requested_at)}
                        {r.status === 'approved' && <> · <span className="font-medium text-emerald-700">booked for {when(r.scheduled_start)}</span></>}
                        {r.status === 'rejected' && <> · <span className="text-rose-700">{r.reason}</span></>}
                        {r.decided_by_name && ` · by ${r.decided_by_name}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={r.status} />
                      {r.status === 'pending' && <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)}>Take back</Button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
    </div>
  );
}
