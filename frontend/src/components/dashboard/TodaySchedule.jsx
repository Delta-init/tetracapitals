import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CalendarDays, Loader2, MapPin, MonitorPlay, Users, Video } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
   Today's LMS classes and mentor meetings (the user, 2026-10-28) — for the
   mentors (their own) and the Chief Mentors (every mentor's, as on the Mentor
   Report, with "Mine only") and the Super Admins (every mentor's, 2026-10-28): on the Dashboard, and in a window the first time
   the portal is opened each day on this device. From the Mentor Report's own
   lists for today (getMentorReportDetails), so nothing new on the server.
──────────────────────────────────────────────────────────────────────────── */

export const TODAY_ROLES = ['super_admin', 'chief_mentor', 'senior_mentor', 'junior_mentor', 'subjunior_mentor'];
const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;
const todayDubai = () => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
const clock = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dubai' });
const SEEN_KEY = 'today-schedule-seen';

function untilText(start, mins) {
  const s = new Date(start).getTime(), e = s + (Number(mins) || 0) * 60_000, now = Date.now();
  if (now >= s && now < e) return { label: 'on now', tone: 'bg-emerald-100 text-emerald-800' };
  if (now >= e) return null;
  const m = Math.round((s - now) / 60_000);
  return { label: m < 60 ? `in ${m} min` : `in ${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim(), tone: m <= 30 ? 'bg-amber-100 text-amber-800' : 'bg-sky-50 text-sky-700' };
}
const STATUS = { live: 'Live', ended: 'Held', scheduled: 'Scheduled', cancelled: 'Cancelled' };

/** Today's classes and meetings for this person: { classes, meetings, loading, error, mine, setMine, chief }. */
export function useTodaySchedule(currentUser) {
  // A Super Admin, as a Chief, sees every mentor's — with no "Mine only": they teach no classes.
  const admin = currentUser?.app_role === 'super_admin';
  const chief = currentUser?.app_role === 'chief_mentor' || admin;
  const [mine, setMine] = useState(false);
  const day = todayDubai();
  const own = !admin && (!chief || mine);
  const body = (kind) => ({ kind, from: day, to: day, ...(own && currentUser?.id ? { mentorId: currentUser.id } : {}) });
  const enabled = !!currentUser && TODAY_ROLES.includes(currentUser.app_role);
  const classes = useQuery({ queryKey: ['today-schedule', 'classes', day, own], queryFn: () => fn('getMentorReportDetails', body('classes')), enabled, refetchInterval: 5 * 60_000, retry: false });
  const cancelled = useQuery({ queryKey: ['today-schedule', 'cancelled', day, own], queryFn: () => fn('getMentorReportDetails', body('cancelled_classes')), enabled, refetchInterval: 5 * 60_000, retry: false });
  const meetings = useQuery({ queryKey: ['today-schedule', 'meetings', day, own], queryFn: () => fn('getMentorReportDetails', body('meetings')), enabled, refetchInterval: 5 * 60_000, retry: false });
  const byTime = (a, b) => new Date(a.start) - new Date(b.start);
  return {
    chief, admin, mine, setMine, enabled,
    classes: [...(classes.data?.rows || []), ...(cancelled.data?.rows || [])].sort(byTime),
    meetings: (meetings.data?.rows || []).filter(m => !m.cancelled).sort(byTime),
    lms: classes.data?.lms || meetings.data?.lms,
    loading: classes.isLoading || meetings.isLoading,
    error: classes.error || meetings.error,
    ready: classes.isSuccess && meetings.isSuccess,
  };
}

function Row({ start, mins, title, sub, who, right, dim, cancelled = false }) {
  const u = cancelled ? null : untilText(start, mins);
  return (
    <li className={cn('flex items-start gap-3 py-2.5', dim && 'opacity-60')}>
      <div className="w-20 shrink-0 text-sm font-semibold text-slate-800">{clock(start)}<span className="block text-[11px] font-normal text-slate-400">{mins ? `${mins} min` : ''}</span></div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-900">{title}</p>
        {sub && <p className="truncate text-xs text-slate-500">{sub}</p>}
        {who && <p className="text-xs text-slate-400">{who}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
        {u && <span className={cn('rounded px-1.5 py-0.5 font-medium', u.tone)}>{u.label}</span>}
        {right}
      </div>
    </li>
  );
}

/** The two lists — shared by the Dashboard card and the window. */
export function TodayLists({ s, compact = false }) {
  if (s.loading) return <p className="flex items-center gap-2 py-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading today…</p>;
  if (s.error) return <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{/unknown function|not found|404/i.test(String(s.error?.message)) ? 'This needs the server update (the API deploy).' : s.error.message}</p>;
  if (s.lms && !s.lms.available) return <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{s.lms.message}</p>;
  const showWho = s.chief && !s.mine;
  // On the Dashboard each list scrolls inside its own height rather than stretching the page (the user, 2026-10-28).
  const box = compact ? '' : 'max-h-[520px] overflow-y-auto pr-1';
  return (
    <div className={cn('grid gap-5', !compact && 'lg:grid-cols-2')}>
      <section>
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-700"><MonitorPlay className="h-4 w-4 text-indigo-500" />LMS classes<span className="rounded-full bg-slate-100 px-2 text-xs text-slate-500">{s.classes.length}</span></h3>
        {!s.classes.length ? <p className="py-3 text-sm text-slate-400">No classes today.</p> : (
          <ul className={cn('divide-y divide-slate-100', box)}>
            {s.classes.map(c => (
              <Row key={c.id} start={c.start} mins={c.durationMins} title={c.title}
                sub={[c.program, c.course].filter(Boolean).join(' · ')}
                who={showWho ? c.mentor : null}
                dim={c.status === 'cancelled'} cancelled={c.status === 'cancelled'}
                right={<>
                  <span className={cn('text-slate-500', c.status === 'cancelled' && 'text-rose-600', c.status === 'live' && 'font-semibold text-emerald-700')}>{STATUS[c.status] || c.status}</span>
                  {c.status !== 'cancelled' && <span className="text-slate-400"><Users className="mr-0.5 inline h-3 w-3" />{c.booked || 0} booked{c.attended ? ` · ${c.attended} came` : ''}</span>}
                </>} />
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-700"><CalendarDays className="h-4 w-4 text-emerald-500" />Meetings<span className="rounded-full bg-slate-100 px-2 text-xs text-slate-500">{s.meetings.length}</span></h3>
        {!s.meetings.length ? <p className="py-3 text-sm text-slate-400">No meetings today.</p> : (
          <ul className={cn('divide-y divide-slate-100', box)}>
            {s.meetings.map(m => (
              <Row key={m.id} start={m.start} mins={m.durationMins} title={m.title}
                sub={(m.attendees || []).length ? `With ${m.attendees.join(', ')}` : ''}
                who={showWho ? m.mentor : null}
                dim={new Date(m.start).getTime() + (m.durationMins || 0) * 60_000 < Date.now()}
                right={<span className="text-slate-400">{m.online ? <><Video className="mr-0.5 inline h-3 w-3" />online</> : <><MapPin className="mr-0.5 inline h-3 w-3" />{m.location || 'in person'}</>}</span>} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const MineSwitch = ({ s }) => s.chief && !s.admin && (
  <div className="flex rounded-full border bg-white p-0.5 text-xs">
    {[[false, 'Every mentor'], [true, 'Mine only']].map(([v, l]) => (
      <button key={l} type="button" onClick={() => s.setMine(v)} className={cn('rounded-full px-3 py-1 font-medium', s.mine === v ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-50')}>{l}</button>
    ))}
  </div>
);

/** The Dashboard's card. */
export function TodayScheduleCard({ currentUser }) {
  const s = useTodaySchedule(currentUser);
  if (!s.enabled) return null;
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b py-4">
        <CardTitle className="flex items-center gap-2 text-base text-brand-navy"><CalendarDays className="h-4 w-4" />Today's classes & meetings
          <span className="text-sm font-normal text-slate-500">· {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' })}</span></CardTitle>
        <MineSwitch s={s} />
      </CardHeader>
      <CardContent className="p-4"><TodayLists s={s} /></CardContent>
    </Card>
  );
}

/** The window, the first time the portal is opened today on this device — only when there is something today. */
export function TodaySchedulePopup({ currentUser }) {
  const s = useTodaySchedule(currentUser);
  const [open, setOpen] = useState(false);
  const day = todayDubai();
  const seen = () => { try { return localStorage.getItem(`${SEEN_KEY}:${currentUser?.id}`) === day; } catch { return true; } };
  const something = useMemo(() => s.classes.some(c => c.status !== 'cancelled') || s.meetings.length > 0, [s.classes, s.meetings]);
  useEffect(() => {
    if (s.enabled && s.ready && something && !seen()) setOpen(true);
  }, [s.enabled, s.ready, something]);
  const close = () => {
    try { localStorage.setItem(`${SEEN_KEY}:${currentUser?.id}`, day); } catch { /* the window shows again next time */ }
    setOpen(false);
  };
  if (!s.enabled) return null;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center justify-between gap-2">Today — {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Dubai' })}<MineSwitch s={s} /></DialogTitle>
          <DialogDescription>{s.chief && !s.mine ? "Every mentor's LMS classes and meetings today." : 'Your LMS classes and meetings today.'} It's on your Dashboard too.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-auto"><TodayLists s={s} compact /></div>
        <DialogFooter><Button onClick={close}>Got it</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
