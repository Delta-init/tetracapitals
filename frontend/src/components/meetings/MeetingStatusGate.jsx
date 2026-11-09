import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarClock, CheckCircle2, Loader2, PlayCircle, XCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { ringAlarm } from '@/components/utils/browserAlerts';

/* ────────────────────────────────────────────────────────────────────────────
   What became of the meeting (the user, 2026-11-09): 10 minutes after a student
   meeting starts, its CS answers — Ongoing (asked again at its end), Completed,
   or Cancelled with the reason and, if they like, a new date and time (a new
   meeting is booked then). On every page; it cannot be closed, clicked away or
   escaped until answered (backend functions/meetingStatus.ts). One at a time,
   oldest first.
──────────────────────────────────────────────────────────────────────────── */

const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;
const errorText = (e, fallback) => e?.response?.data?.error || e?.data?.error || e?.message || fallback;
const TZ = 'Asia/Dubai';
const t = (iso) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
const dayText = (iso) => new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const todayDubai = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);

export default function MeetingStatusGate() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['meeting-status-checks'],
    queryFn: () => fn('getMeetingStatusChecks', {}),
    refetchInterval: 60_000,
    staleTime: 20_000,
    retry: false,
  });
  const m = q.data?.pending?.[0];
  const [choice, setChoice] = useState('');
  const [reason, setReason] = useState('');
  // Who called it off (2026-11-09): only the mentor's own count against them in Root's mentor KPIs.
  const [cancelledBy, setCancelledBy] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  useEffect(() => { setChoice(''); setReason(''); setCancelledBy(''); setDate(''); setTime(''); if (m) ringAlarm(`meeting-status:${m.id}:${m.again ? 2 : 1}`); }, [m?.id, m?.again]);
  // Nothing closes it: Escape is swallowed while it shows.
  useEffect(() => {
    if (!m) return undefined;
    const stop = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); } };
    window.addEventListener('keydown', stop, true);
    return () => window.removeEventListener('keydown', stop, true);
  }, [m?.id]);
  const save = useMutation({
    mutationFn: () => fn('answerMeetingStatus', {
      id: m.id, status: choice, reason: choice === 'cancelled' ? reason.trim() : undefined,
      cancelledBy: choice === 'cancelled' ? cancelledBy : undefined,
      rescheduleAt: choice === 'cancelled' && date && time ? new Date(`${date}T${time}:00+04:00`).toISOString() : undefined,
    }),
    onSuccess: (d) => {
      toast.success(choice === 'ongoing' ? 'Noted — you\'ll be asked again when it should be over'
        : choice === 'completed' ? 'Marked completed'
          : d?.new_meeting ? 'Cancelled — the new meeting is booked and they are invited' : 'Cancelled — the mentor is told');
      qc.invalidateQueries({ queryKey: ['meeting-status-checks'] });
      qc.invalidateQueries({ queryKey: ['meetings-done'] });
    },
    onError: (e) => toast.error(errorText(e, "That didn't save")),
  });
  if (!m) return null;
  const who = m.student?.name || (m.attendees || []).join(', ') || m.title;
  const halfReschedule = (date && !time) || (!date && time);
  const ready = choice && (choice !== 'cancelled' || (reason.trim().length >= 3 && !!cancelledBy && !halfReschedule));
  const left = (q.data?.pending?.length || 1) - 1;
  const opt = (k, label, Icon, cls) => (
    <button type="button" onClick={() => setChoice(k)}
      className={cn('flex flex-1 flex-col items-center gap-1 rounded-xl border px-3 py-3 text-sm font-semibold transition-colors', choice === k ? cls : 'border-slate-200 text-slate-700 hover:bg-slate-50')}>
      <Icon className="h-5 w-5" />{label}
    </button>
  );
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="meeting-status-title">
      <div className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-700"><CalendarClock className="h-4 w-4" />{m.again ? 'Should be over now' : 'Meeting time has come'}{left > 0 ? ` · ${left} more after this` : ''}</p>
          <h2 id="meeting-status-title" className="mt-1 text-lg font-semibold text-brand-navy">{m.again ? 'Was the meeting completed?' : "What's the status of the meeting?"}</h2>
          <p className="mt-1 text-sm text-slate-600">
            <span className="font-medium text-slate-900">{who}</span>{m.student?.code ? ` · ${m.student.code}` : ''} with <span className="font-medium text-slate-900">{m.mentor?.name || 'the mentor'}</span>
            <br />{dayText(m.starts_at)} · {t(m.starts_at)}–{t(m.ends_at)} · {m.in_person ? `in person${m.location ? ` — ${m.location}` : ''}` : 'online'}
          </p>
        </div>
        <div className="flex gap-2">
          {!m.again && opt('ongoing', 'Ongoing', PlayCircle, 'border-sky-500 bg-sky-50 text-sky-800')}
          {opt('completed', 'Completed', CheckCircle2, 'border-emerald-500 bg-emerald-50 text-emerald-800')}
          {opt('cancelled', 'Cancelled', XCircle, 'border-rose-500 bg-rose-50 text-rose-800')}
        </div>
        {choice === 'cancelled' && (
          <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50/40 p-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-700">Why was it cancelled? *</span>
              <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. the student didn't join — not reachable" autoFocus />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-700">Who called it off? *</span>
              <select value={cancelledBy} onChange={(e) => setCancelledBy(e.target.value)} aria-label="Who called it off"
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
                <option value="">Choose…</option>
                <option value="student">The student</option>
                <option value="mentor">The mentor</option>
                <option value="cs">The CS</option>
                <option value="other">Something else</option>
              </select>
            </label>
            <div>
              <span className="mb-1 block text-xs font-semibold text-slate-700">Reschedule to (optional)</span>
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" min={todayDubai()} value={date} onChange={(e) => setDate(e.target.value)} aria-label="New date" />
                <Input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} aria-label="New time (Dubai)" />
              </div>
              <p className="mt-1 text-xs text-slate-500">{date && time ? `A new meeting with ${m.mentor?.name || 'the mentor'} is booked then (Dubai time) — they and the student are invited.` : halfReschedule ? 'Give both the date and the time — or neither.' : 'Leave empty if it is not being moved.'}</p>
            </div>
            <p className="text-xs text-slate-500">It's cancelled quietly — nobody is emailed — and the mentor won't be asked how it went.</p>
          </div>
        )}
        <div className="flex justify-end">
          <Button disabled={!ready || save.isPending} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save</Button>
        </div>
      </div>
    </div>
  );
}
