import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CalendarClock, CalendarPlus, ChevronRight, Loader2, Search, ShieldAlert, X } from 'lucide-react';
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
  blocked: ['Blocked — 7-day rule', 'bg-rose-50 text-rose-700'],
};
const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;
const errorText = (e, fallback) => e?.response?.data?.error || e?.data?.error || e?.message || fallback;
/** Online, in person (where), or left to the CS to confirm with the student (2026-11-09). */
export const modeText = (r, withPlace = true) => (r.mode === 'cs' ? 'CS to confirm online or in person' : r.in_person ? (withPlace && r.location ? `in person — ${r.location}` : 'in person') : 'online');
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
  const blank = { category: '', course: '', durationMins: '30', mode: 'online', location: '', notes: '' };
  const [f, setF] = useState(blank);
  useEffect(() => { if (open) { setStudent(initial); setF(blank); } }, [open, initial?.id]);
  const send = useMutation({
    mutationFn: () => fn('createMeetingRequest', {
      studentId: student?.id, category: f.category, course: f.category === 'course_upgrade' ? f.course : '',
      durationMins: Number(f.durationMins), mode: f.mode, location: f.mode === 'offline' ? f.location.trim() : '', notes: f.notes.trim(),
    }),
    onSuccess: (d) => {
      if (d?.blocked) toast.error(`Blocked by the 7-day rule — ${d.message}`, { duration: 10000 });
      else toast.success(`Request sent — ${student?.cs_name ? `${student.cs_name} (the CS)` : 'the CS'} picks the time`);
      qc.invalidateQueries({ queryKey: ['meeting-requests'] });
      onClose();
    },
    onError: (e) => toast.error(errorText(e, 'The request could not be sent')),
  });
  const ready = student && f.category && (f.category !== 'course_upgrade' || f.course) && Number(f.durationMins) >= 15 && (f.mode !== 'offline' || f.location.trim().length >= 2) && f.notes.trim().length >= 3;
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
              <select id="rq-mode" value={f.mode} onChange={(e) => setF(x => ({ ...x, mode: e.target.value }))} className={selectCls}>
                <option value="online">Online — Google Meet</option>
                <option value="offline">Offline — in person</option>
                <option value="cs">Let the CS confirm with the student</option>
              </select>
            </div>
            {f.mode === 'offline' && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="rq-where">Where *</Label>
                <Input id="rq-where" value={f.location} onChange={(e) => setF(x => ({ ...x, location: e.target.value }))} placeholder="e.g. Dubai office, room 2" />
              </div>
            )}
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="rq-notes">Reason for the meeting request *</Label>
              <Textarea id="rq-notes" rows={3} value={f.notes} onChange={(e) => setF(x => ({ ...x, notes: e.target.value }))} placeholder="Why you want to meet the student — the CS sees it" />
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

/** Where a request stands in the inbox (backend viewsOf) — its tab and badge. */
export const VIEWS = [
  ['needs_review', 'Needs review', 'bg-amber-50 text-amber-700'],
  ['escalated', 'Escalated', 'bg-orange-50 text-orange-700'],
  ['scheduled', 'Meeting scheduled', 'bg-sky-50 text-sky-700'],
  ['held', 'Held', 'bg-slate-100 text-slate-700'],
  ['follow_up', 'Follow-up', 'bg-violet-50 text-violet-700'],
  ['converted', 'Converted', 'bg-emerald-50 text-emerald-700'],
  ['blocked', 'Blocked', 'bg-rose-50 text-rose-700'],
  ['rejected', 'Rejected', 'bg-rose-50 text-rose-700'],
  ['cancelled', 'Taken back', 'bg-slate-100 text-slate-600'],
  ['meeting_cancelled', 'Meeting cancelled', 'bg-rose-50 text-rose-700'],
];
const VIEW = Object.fromEntries(VIEWS.map(([k, l, c]) => [k, [l, c]]));
export function ViewBadge({ view }) {
  const [label, cls] = VIEW[view] || [view, 'bg-slate-100 text-slate-600'];
  return <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', cls)}>{label}</span>;
}
const Row = ({ label, children }) => (
  <div className="flex items-start justify-between gap-3 py-1 text-sm"><span className="text-slate-500">{label}</span><span className="text-right font-medium text-slate-900">{children}</span></div>
);

/** The automatic 7-day check (backend eligibilityOf), worked out now. */
function Eligibility({ e }) {
  if (!e) return null;
  return (
    <div className={cn('rounded-lg border p-3', e.blocked ? 'border-rose-200 bg-rose-50/50' : 'border-emerald-200 bg-emerald-50/40')}>
      <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900"><ShieldAlert className={cn('h-4 w-4', e.blocked ? 'text-rose-600' : 'text-emerald-600')} />Automatic eligibility review</p>
      <Row label="Last meeting">{e.last ? `${e.last.days_ago === 0 ? 'today' : `${e.last.days_ago} day${e.last.days_ago === 1 ? '' : 's'} ago`} · ${e.last.mentor}` : 'none'}</Row>
      <Row label="7-day rule"><span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', e.blocked ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700')}>{e.blocked ? 'Blocked' : 'OK'}</span></Row>
      <Row label="Booked ahead">{e.upcoming?.length ? e.upcoming.map(u => `${when(u.at)} · ${u.mentor}`).join(', ') : 'No'}</Row>
      <p className="mt-1 text-xs text-slate-600">{e.message}{e.lms_checked === false ? ' (The LMS could not be asked — meetings booked there may be missing.)' : ''}</p>
    </div>
  );
}

/**
 * A request opened (the user, 2026-11-09): who, what, the mentor's reason and the 7-day check. Whoever decides it picks
 * the date, time and online / in person and approves — or rejects; a blocked one only a CS Manager approves anyway,
 * with a reason. The mentor who asked sees it read-only (and takes back one still waiting).
 */
export function DecideMeetingDialog({ request: initial, onClose }) {
  const qc = useQueryClient();
  const id = initial?.id;
  const rev = useQuery({ queryKey: ['meeting-request-review', id], queryFn: () => fn('getMeetingRequestReview', { id }), enabled: !!id, retry: false });
  const r = rev.data?.request || initial;
  const e = rev.data?.eligibility;
  const [date, setDate] = useState(todayDubai());
  const [time, setTime] = useState('11:00');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState('');
  const [place, setPlace] = useState('');
  const [why, setWhy] = useState('');
  // Handing it to the CS Managers (2026-11-09).
  const [escalating, setEscalating] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => { if (initial) { setDate(todayDubai()); setTime('11:00'); setRejecting(false); setReason(''); setWhy(''); setEscalating(false); setNote(''); setMode(initial.mode === 'cs' ? '' : initial.in_person ? 'offline' : 'online'); setPlace(initial.location || ''); } }, [id]);
  const done = () => { qc.invalidateQueries({ queryKey: ['meeting-requests'] }); qc.invalidateQueries({ queryKey: ['meeting-requests-waiting'] }); qc.invalidateQueries({ queryKey: ['meeting-request-review', id] }); onClose(); };
  const decide = useMutation({
    mutationFn: (body) => fn('decideMeetingRequest', { id, ...body }),
    onSuccess: (_d, body) => { toast.success(body.action === 'approve' ? `Booked — ${r.mentor.name} and ${r.student.name} are emailed` : 'Rejected — the mentor is told'); done(); },
    onError: (err) => { toast.error(errorText(err, "That didn't work")); qc.invalidateQueries({ queryKey: ['meeting-request-review', id] }); },
  });
  const escalate = useMutation({
    mutationFn: () => fn('escalateMeetingRequest', { id, note: note.trim() }),
    onSuccess: () => { toast.success('Escalated — the CS Managers decide it now'); done(); },
    onError: (err) => toast.error(errorText(err, "Couldn't escalate it")),
  });
  const takeBack = useMutation({
    mutationFn: () => fn('cancelMeetingRequest', { id }),
    onSuccess: () => { toast.success('Taken back'); done(); },
    onError: (err) => toast.error(errorText(err, "Couldn't take it back")),
  });
  if (!initial) return null;
  const open = ['pending', 'blocked'].includes(r.status);
  const decides = !!rev.data?.may_decide && open;
  const blocked = r.status === 'blocked' || !!e?.blocked;
  const mayOverride = !!rev.data?.may_override;
  const mine = !rev.data?.may_decide;
  return (
    <Dialog open={!!initial} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2 pr-6 text-brand-navy">
            <span className="flex items-center gap-2"><CalendarClock className="h-5 w-5" />Request review</span>
            <ViewBadge view={r.view || (r.status === 'pending' ? 'needs_review' : r.status)} />
          </DialogTitle>
          <DialogDescription>{r.number} · asked {when(r.requested_at)}</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
          <Row label="Student">{r.student.name}{r.student.code ? ` · ${r.student.code}` : ''}</Row>
          <Row label="Requesting mentor">{r.mentor.name}</Row>
          <Row label="Assigned CS">{r.student.cs_name || '—'}</Row>
          <Row label="For">{categoryText(r.category, r.course) || '—'}</Row>
          <Row label="Length · where">{r.duration_mins} min · {modeText(r)}</Row>
          {r.notes && <div className="mt-1 border-t border-slate-200 pt-2"><p className="text-xs text-slate-500">Mentor's reason</p><p className="whitespace-pre-wrap text-sm text-slate-900">{r.notes}</p></div>}
        </div>
        {rev.isLoading ? <p className="text-xs text-slate-400">Checking the 7-day rule…</p> : <Eligibility e={e} />}
        {r.escalated && open && <p className="rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-900">Escalated to the CS Managers by {r.escalated.by_name} · {when(r.escalated.at)}{r.escalated.note ? ` — ${r.escalated.note}` : ''}</p>}
        {r.status === 'blocked' && r.blocked?.reason && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">Blocked when asked: {r.blocked.reason}</p>}
        {r.status === 'approved' && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Booked for {when(r.scheduled_start)}{r.decided_by_name ? ` by ${r.decided_by_name}` : ''}.{r.override_reason ? ` Approved anyway by ${r.override_by_name}: ${r.override_reason}` : ''}</p>}
        {r.status === 'rejected' && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">Rejected{r.decided_by_name ? ` by ${r.decided_by_name}` : ''}: {r.reason}</p>}
        <StudentMeetingHistory studentId={r.student.id} />

        {decides && (escalating ? (
          <div className="space-y-1.5">
            <Label htmlFor="rq-esc">Note for the CS Manager</Label>
            <Textarea id="rq-esc" rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Optional — why you're handing it on" autoFocus />
          </div>
        ) : rejecting ? (
          <div className="space-y-1.5">
            <Label htmlFor="rq-reason">Why — the mentor sees it *</Label>
            <Input id="rq-reason" value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. the student isn't ready yet" autoFocus />
          </div>
        ) : blocked && !mayOverride ? (
          <div className="rounded-lg border border-slate-200 p-3 text-sm">
            <p className="font-semibold text-slate-900">Restricted action</p>
            <p className="mt-1 text-slate-600">Another mentor met this student in the last 7 days or has a meeting booked with them, so it can't be approved here. {r.escalated ? 'It is with the CS Managers now.' : 'Escalate it to the CS Manager — they can approve an exception, with the reason kept.'}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="rq-date">Date *</Label><Input id="rq-date" type="date" min={todayDubai()} value={date} onChange={(ev) => setDate(ev.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="rq-time">Time (Dubai) *</Label><Input id="rq-time" type="time" step={900} value={time} onChange={(ev) => setTime(ev.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rq-dmode">Online or in person *</Label>
                <select id="rq-dmode" value={mode} onChange={(ev) => setMode(ev.target.value)} className={selectCls}>
                  {!mode && <option value="">Confirm with the student…</option>}
                  <option value="online">Online — Google Meet</option>
                  <option value="offline">Offline — in person</option>
                </select>
              </div>
              {mode === 'offline' && <div className="space-y-1.5"><Label htmlFor="rq-place">Where *</Label><Input id="rq-place" value={place} onChange={(ev) => setPlace(ev.target.value)} placeholder="e.g. Dubai office" /></div>}
            </div>
            {r.mode === 'cs' && <p className="text-xs text-amber-700">The mentor left this to you — confirm online or in person with the student.</p>}
            {blocked && (
              <div className="space-y-1.5">
                <Label htmlFor="rq-why">Why approve it anyway — kept with it *</Label>
                <Textarea id="rq-why" rows={2} value={why} onChange={(ev) => setWhy(ev.target.value)} placeholder="The exception to the 7-day rule" />
              </div>
            )}
            {date && <MentorDay email={r.mentor.email} date={date} />}
          </>
        ))}
        <DialogFooter className="gap-2 sm:gap-0">
          {decides ? (escalating ? (
            <>
              <Button variant="outline" onClick={() => setEscalating(false)}>Back</Button>
              <Button className="bg-orange-600 hover:bg-orange-700" disabled={escalate.isPending} onClick={() => escalate.mutate()}>{escalate.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Escalate to CS Manager</Button>
            </>
          ) : rejecting ? (
            <>
              <Button variant="outline" onClick={() => setRejecting(false)}>Back</Button>
              <Button variant="destructive" disabled={!reason.trim() || decide.isPending} onClick={() => decide.mutate({ action: 'reject', reason: reason.trim() })}>{decide.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Reject</Button>
            </>
          ) : (
            <>
              {!mayOverride && !r.escalated && <Button variant="outline" className="gap-1.5 text-orange-700" onClick={() => setEscalating(true)}><ShieldAlert className="h-4 w-4" />Escalate to CS Manager</Button>}
              {(r.status === 'pending' || mayOverride) && <Button variant="outline" className="text-rose-700" onClick={() => setRejecting(true)}>Reject…</Button>}
              {(!blocked || mayOverride) && (
                <Button disabled={!date || !time || !mode || (mode === 'offline' && place.trim().length < 2) || (blocked && why.trim().length < 3) || decide.isPending}
                  onClick={() => decide.mutate({ action: 'approve', scheduledStart: dubaiIso(date, time), mode, location: mode === 'offline' ? place.trim() : '', ...(blocked ? { override: true, overrideReason: why.trim() } : {}) })}>
                  {decide.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {blocked ? 'Approve anyway & book' : 'Approve & book'}
                </Button>
              )}
            </>
          )) : (
            <>
              {mine && r.status === 'pending' && <Button variant="outline" className="text-rose-700" disabled={takeBack.isPending} onClick={() => takeBack.mutate()}>Take back</Button>}
              <Button variant="outline" onClick={onClose}>Close</Button>
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
                  <p className="text-xs text-slate-500">{r.mentor.name} · {categoryText(r.category, r.course)} · {r.duration_mins} min · {modeText(r, false)}</p>
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

/**
 * The meeting request inbox (the user, 2026-11-09): search, a tab for where each stands with its count, and a card
 * per request; a card opens its review. box "mine": a mentor's own; "to_decide": the ones this person decides.
 */
export function MeetingRequestInbox({ box, onNew }) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState(box === 'to_decide' ? 'needs_review' : 'all');
  const [opened, setOpened] = useState(null);
  const res = useQuery({
    queryKey: ['meeting-requests', box, 'all'],
    queryFn: () => fn('listMeetingRequests', { box, status: 'all' }),
    refetchInterval: 60_000,
  });
  const all = res.data?.requests || [];
  const counts = res.data?.counts || {};
  const needle = q.trim().toLowerCase();
  const list = all.filter(r => (tab === 'all' || r.view === tab)
    && (!needle || [r.student.name, r.student.code, r.number, r.mentor.name, r.student.cs_name, categoryText(r.category, r.course)].some(v => String(v || '').toLowerCase().includes(needle))));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Search student, request or mentor" className="h-9 rounded-full pl-9" />
        </div>
        {onNew && <Button size="sm" className="gap-1.5" onClick={onNew}><CalendarPlus className="h-4 w-4" />Request a meeting</Button>}
      </div>
      <div className="flex flex-wrap gap-2">
        {[['all', 'All'], ...VIEWS.map(([k, l]) => [k, l === 'Meeting scheduled' ? 'Scheduled' : l])].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={cn('rounded-full border px-3 py-1 text-sm font-medium', tab === k ? 'border-brand-navy bg-brand-navy text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}>
            {l}{counts[k] ? <span className={cn('ml-1.5 text-xs', tab === k ? 'text-white/80' : 'text-slate-400')}>{counts[k]}</span> : null}
          </button>
        ))}
      </div>
      {res.isLoading ? <p className="text-sm text-slate-400">Loading…</p>
        : res.isError ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{/unknown function|not found|404/i.test(String(res.error?.message)) ? 'This needs the server update (the API deploy).' : res.error?.message}</p>
          : !list.length ? <p className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">{all.length ? 'Nothing here.' : 'No meeting requests yet.'}</p>
            : (
              <div className="grid gap-3 md:grid-cols-2">
                {list.map(r => (
                  <button key={r.id} type="button" onClick={() => setOpened(r)}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:border-brand-navy/40">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-brand-navy">{r.student.name}</span><ViewBadge view={r.view} /></div>
                      <p className="text-xs text-slate-500">{[r.number, r.student.code].filter(Boolean).join(' · ')}</p>
                      <p className="text-sm text-slate-800">{r.mentor.name}{box === 'mine' && r.student.cs_name ? <span className="text-slate-500"> · CS {r.student.cs_name}</span> : null}</p>
                      <p className="text-xs text-slate-500">{categoryText(r.category, r.course)} · {r.duration_mins} min · {modeText(r, false)}{r.scheduled_start ? ` · ${when(r.scheduled_start)}` : ''}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                  </button>
                ))}
              </div>
            )}
      <DecideMeetingDialog request={opened} onClose={() => setOpened(null)} />
    </div>
  );
}

/** A mentor's own requests — the inbox (kept by this name for the Mentor Calendar's tab). */
export function MyMeetingRequests({ onNew }) {
  return <MeetingRequestInbox box="mine" onNew={onNew} />;
}
