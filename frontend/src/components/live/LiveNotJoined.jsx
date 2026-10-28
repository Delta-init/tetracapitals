import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CallButton } from '@/components/followups/CallFlow';
import { Radio, UserX } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
   Booked but not joined (the user, 2026-10-28): while an LMS class runs, the
   students who booked it and haven't joined yet — a window at class time and
   the "Not joined yet" page (backend functions/liveNotJoined.ts: a CS their
   students, a CS Manager their location's, a Chief / mentor their team's
   students and their team's classes, Super Admins every class). Checked every
   minute; one request shared by the window, the sidebar count and the page.
──────────────────────────────────────────────────────────────────────────── */

export const LIVE_ROLES = ['super_admin', 'admin', 'cs', 'cs_manager', 'chief_mentor', 'senior_mentor', 'junior_mentor', 'subjunior_mentor'];
const SEEN_KEY = 'live-not-joined-seen';
export const clock = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dubai' });
const minsSince = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));

export function useLiveNotJoined(currentUser) {
  const enabled = !!currentUser?.id && LIVE_ROLES.includes(currentUser.app_role);
  const q = useQuery({
    queryKey: ['live-not-joined', currentUser?.id],
    queryFn: async () => (await base44.functions.invoke('getLiveNotJoined', {})).data,
    enabled,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });
  return { ...q, enabled };
}

/** One class and its students who haven't joined. */
export function NotJoinedClass({ c, showCs = true }) {
  const live = c.live;
  return (
    <div className={cn('rounded-xl border bg-white', live ? 'border-rose-200' : 'border-slate-200')}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <div className="font-semibold text-brand-navy">{c.title || 'A class'}</div>
          <div className="text-xs text-slate-500">
            {[c.course, c.mentor?.name && `Mentor ${c.mentor.name}`, c.language].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="text-right text-xs">
          {live
            ? <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700"><Radio className="h-3 w-3" />Live · started {minsSince(c.startsAt)} min ago</span>
            : <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">Ended {clock(c.endsAt)}</span>}
          <div className="mt-1 text-slate-500">{clock(c.startsAt)} – {clock(c.endsAt)} · {c.joined} of {c.booked} joined</div>
        </div>
      </div>
      <ul className="divide-y divide-slate-100">
        {c.notJoined.map(s => {
          const st = s.student;
          const caller = st ? { id: st.id, full_name: st.name, phone: st.phone || s.phone, call_from: 'live_not_joined' } : null;
          return (
            <li key={s.bookingId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <div className="min-w-0">
                {st
                  ? <Link to={`${createPageUrl('StudentDetail')}?id=${st.id}`} className="font-medium text-slate-900 hover:text-blue-600">{st.name || s.name}</Link>
                  : <span className="font-medium text-slate-900">{s.name}</span>}
                {s.mine && <span className="ml-1.5 rounded bg-brand-mint/40 px-1.5 text-[11px] font-semibold text-brand-navy">yours</span>}
                <div className="text-xs text-slate-500">
                  {[st?.code, showCs && st?.cs_name && `CS ${st.cs_name}`, !st && 'not found here by email', s.email].filter(Boolean).join(' · ')}
                </div>
              </div>
              {caller && <CallButton student={caller} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const seenOf = (uid, day) => {
  try {
    const v = JSON.parse(localStorage.getItem(`${SEEN_KEY}:${uid}`) || '{}');
    return v.day === day ? v.seen || {} : {};
  } catch { return {}; }
};

/**
 * The window at class time: a live class with someone booked who hasn't joined — once a class, and again only when
 * someone new is missing from it.
 */
export function LiveNotJoinedPopup({ currentUser }) {
  const q = useLiveNotJoined(currentUser);
  const [open, setOpen] = useState(false);
  const live = (q.data?.classes || []).filter(c => c.live);
  const day = q.data?.day;
  const fresh = live.filter(c => {
    const seen = seenOf(currentUser?.id, day)[c.id] || [];
    return c.notJoined.some(s => !seen.includes(s.bookingId));
  });
  useEffect(() => {
    if (q.enabled && fresh.length) setOpen(true);
  }, [q.enabled, fresh.map(c => c.id + c.notJoined.length).join()]);
  const close = () => {
    try {
      const seen = seenOf(currentUser?.id, day);
      for (const c of live) seen[c.id] = c.notJoined.map(s => s.bookingId);
      localStorage.setItem(`${SEEN_KEY}:${currentUser?.id}`, JSON.stringify({ day, seen }));
    } catch { /* it shows again on the next check */ }
    setOpen(false);
  };
  if (!q.enabled || !live.length) return null;
  const students = live.reduce((n, c) => n + c.notJoined.length, 0);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserX className="h-5 w-5 text-rose-600" />Class is on — {students} student{students === 1 ? '' : 's'} not joined yet</DialogTitle>
          <DialogDescription>They booked {live.length === 1 ? 'this class' : 'these classes'} and haven't joined. Call them to join now.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-auto">
          {live.map(c => <NotJoinedClass key={c.id} c={c} />)}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" asChild><Link to={createPageUrl('LiveNotJoined')} onClick={close}>Open the page</Link></Button>
          <Button onClick={close}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
