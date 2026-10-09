import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CalendarCheck, CalendarX, LogIn, MessageSquareText, Play, Square, Star, UserCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
   A class's Info (the user, 2026-10-09): who booked it and when, who cancelled,
   when it started, when the mentor and each student joined, when it ended, and
   each student's review from the after-class form — from the LMS's class card
   (getMentorClass → LMS /service/classes/:id). Names only. Shown in the Mentor
   Calendar's class card and from a student's Classes list, to everyone who can
   open those.
──────────────────────────────────────────────────────────────────────────── */

const STATUS = {
  booked: { label: 'Booked', cls: 'border-sky-200 bg-sky-50 text-sky-700' },
  attended: { label: 'Attended', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  missed: { label: 'Missed', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  cancelled: { label: 'Cancelled', cls: 'border-slate-200 bg-slate-100 text-slate-500' },
};
const EVENT = {
  booked: { icon: CalendarCheck, cls: 'text-sky-600', text: (e) => `${e.who} booked` },
  cancelled: { icon: CalendarX, cls: 'text-slate-500', text: (e) => `${e.who} cancelled` },
  started: { icon: Play, cls: 'text-blue-600', text: () => 'Class started' },
  mentor_joined: { icon: UserCheck, cls: 'text-indigo-600', text: (e) => `${e.who || 'The mentor'} (mentor) joined` },
  joined: { icon: LogIn, cls: 'text-emerald-600', text: (e) => `${e.who} joined` },
  ended: { icon: Square, cls: 'text-slate-600', text: () => 'Class ended' },
  review: { icon: MessageSquareText, cls: 'text-amber-600', text: (e) => `${e.who} sent a review` },
};

const Stars = ({ n }) => (
  <span className="inline-flex items-center gap-0.5" title={`${n} out of 5`}>
    {[1, 2, 3, 4, 5].map(i => <Star key={i} className={cn('h-3 w-3', i <= n ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} />)}
  </span>
);

/** The Info section: the students and the timeline. `c` is the LMS class card; `tz` the zone times are shown in. */
export function ClassInfoSection({ c, tz }) {
  const at = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz || undefined }) : '');
  const students = Array.isArray(c?.students) ? c.students : null;
  const timeline = Array.isArray(c?.timeline) ? c.timeline : null;
  if (!students && !timeline) {
    return <p className="text-xs text-slate-400">The LMS doesn't share a class's bookings and reviews yet — it needs its update.</p>;
  }
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Students ({students?.length ?? 0})</p>
        {!students?.length ? <p className="text-sm text-slate-400">Nobody has booked this class.</p> : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {students.map((s, i) => {
              const st = STATUS[s.status] || STATUS.booked;
              return (
                <li key={i} className="px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-slate-900">{s.name}</span>
                    <Badge variant="outline" className={st.cls}>{st.label}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">
                    {[s.bookedAt && `Booked ${at(s.bookedAt)}`, s.cancelledAt && `cancelled ${at(s.cancelledAt)}`, s.joinedAt && `joined ${at(s.joinedAt)}`].filter(Boolean).join(' · ')}
                  </p>
                  {s.review && (
                    <div className="mt-1 rounded-md bg-amber-50/60 px-2 py-1 text-xs text-slate-700">
                      <Stars n={s.review.rating} />{s.review.comment ? <span className="ml-1.5">“{s.review.comment}”</span> : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Timeline</p>
        {!timeline?.length ? <p className="text-sm text-slate-400">Nothing has happened yet.</p> : (
          <ol className="space-y-1.5">
            {timeline.map((e, i) => {
              const ev = EVENT[e.kind] || { icon: CalendarCheck, cls: 'text-slate-500', text: () => e.kind };
              const Icon = ev.icon;
              return (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', ev.cls)} />
                  <span className="w-28 shrink-0 tabular-nums text-xs leading-5 text-slate-500">{at(e.at)}</span>
                  <span className="min-w-0 text-slate-800">
                    {ev.text(e)}
                    {e.kind === 'review' && (
                      <span className="ml-1.5"><Stars n={e.rating} />{e.comment ? <span className="ml-1 text-slate-600">“{e.comment}”</span> : null}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

/** A class's card on its own — for a list that knows only the class id (a student's Classes). */
export function ClassInfoDialog({ classId, title, onClose }) {
  const q = useQuery({
    queryKey: ['mentors', 'class', classId],
    enabled: !!classId,
    retry: false,
    queryFn: async () => (await base44.functions.invoke('getMentorClass', { classId })).data,
  });
  const c = q.data;
  const tz = c?.timezone || 'Asia/Dubai';
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{c?.title || title || 'Class'}</DialogTitle>
          <DialogDescription>
            {c ? [c.courseTitle, c.instructorName && `with ${c.instructorName}`,
              c.startsAt && new Date(c.startsAt).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz })]
              .filter(Boolean).join(' · ') : ' '}
          </DialogDescription>
        </DialogHeader>
        {q.isLoading ? <Skeleton className="h-40 w-full" />
          : q.isError ? <p className="text-sm text-slate-500">{/no such class/i.test(String(q.error?.message)) ? "This class belongs to the other academy — its details aren't shared here." : (q.error?.message || "The class couldn't be loaded")}</p>
            : <ClassInfoSection c={c} tz={tz} />}
      </DialogContent>
    </Dialog>
  );
}
