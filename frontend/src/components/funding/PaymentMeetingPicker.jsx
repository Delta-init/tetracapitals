import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
   Which meeting the payment is from (the user, 2026-11-09): on a course
   payment, once the student and "Meeting conducted by" are picked — the
   student's meetings with that mentor that have begun, newest first (the
   latest picked for you), or "Not from a meeting listed here". Warns when the
   student's latest meeting was another mentor's. Required (backend
   finance/funding.ts meetingMentorMissing); Meetings done shows the payment
   against the meeting picked.
──────────────────────────────────────────────────────────────────────────── */

export const NOT_LISTED = { none: true };
const TZ = 'Asia/Dubai';
const when = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const CATEGORY = { course_pitch: 'Course pitch', overview: 'Overview', other: 'Other', course_upgrade: 'Course Upgradation' };

export default function PaymentMeetingPicker({ studentId, mentorId, mentorName, value, onChange }) {
  const q = useQuery({
    queryKey: ['payment-meetings', studentId, mentorId],
    queryFn: async () => (await base44.functions.invoke('getPaymentMeetings', { studentId, mentorId })).data,
    enabled: !!studentId && !!mentorId,
    retry: false,
  });
  const list = q.data?.meetings || [];
  const latest = q.data?.latest;
  // The latest picked for you; a pick that isn't in the list (another student or mentor) starts over.
  useEffect(() => {
    if (!q.data) return;
    if (value?.none) return;
    if (value?.meeting_id && list.some(m => m.id === value.meeting_id)) return;
    onChange(list[0] ? { meeting_id: list[0].id, starts_at: list[0].starts_at } : NOT_LISTED);
  }, [q.data, studentId, mentorId]);
  if (!studentId || !mentorId) return null;
  const otherMentorLatest = latest && list[0]?.id !== latest.id;
  const row = (checked, onPick, children, key) => (
    <label key={key} className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm', checked ? 'border-blue-400 bg-blue-50/60' : 'border-slate-200 hover:bg-slate-50')}>
      <input type="radio" className="mt-1" checked={checked} onChange={onPick} />
      <span className="min-w-0">{children}</span>
    </label>
  );
  return (
    <div className="space-y-1.5 md:col-span-2">
      <p className="text-sm font-medium">Which meeting is this payment from? *</p>
      {q.isLoading ? <p className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading their meetings…</p>
        : q.isError ? <p className="text-xs text-amber-700">Couldn't read the meetings — pick "Not from a meeting listed here" to go on.</p> : null}
      <div className="space-y-1.5">
        {list.map((m, i) => row(value?.meeting_id === m.id, () => onChange({ meeting_id: m.id, starts_at: m.starts_at }), (
          <>
            {when(m.starts_at)} · {m.mentor || mentorName} · {CATEGORY[m.category] || m.title}{i === 0 && <span className="ml-1 text-xs text-slate-500">— latest</span>}
            {m.summary && <span className="block text-xs text-slate-500">{m.summary}</span>}
          </>
        ), m.id))}
        {row(!!value?.none, () => onChange(NOT_LISTED), <>Not from a meeting listed here{!list.length && !q.isLoading && <span className="block text-xs text-slate-500">No meetings with {mentorName || 'this mentor'} found for this student.</span>}</>, 'none')}
      </div>
      {otherMentorLatest && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />The student's latest meeting was with {latest.mentor || 'another mentor'} ({when(latest.starts_at)}) — sure it's {mentorName || 'this mentor'}?</p>
      )}
    </div>
  );
}
