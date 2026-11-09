import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { PageTitle } from '@/components/common/PageHeader';
import { CalendarClock } from 'lucide-react';
import { ASKS_FOR_MEETINGS, MeetingRequestInbox, RequestMeetingDialog } from '@/components/meetings/meetingRequests';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';

/* ────────────────────────────────────────────────────────────────────────────
   Meeting Requests (the user, 2026-11-09): the request inbox — search, a tab
   for where each stands (Needs review, Scheduled, Held, Follow-up, Converted,
   Blocked by the 7-day rule, Rejected, Taken back) and a card per request that
   opens its review. A mentor who asks sees their own; a CS their students',
   a CS Manager their location's, a Super Admin all — and decides them there.
──────────────────────────────────────────────────────────────────────────── */

export default function MeetingRequests() {
  const { data: me } = useQuery({ queryKey: ['me', 'effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()), staleTime: 5 * 60_000 });
  const [asking, setAsking] = useState(false);
  const asks = me && ASKS_FOR_MEETINGS.includes(me.app_role);
  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <PageTitle eyebrow="Students" icon={CalendarClock}>Meeting Requests</PageTitle>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            {asks
              ? "Every meeting you asked for and where it stands. The student's CS picks the date and time and approves it. Another mentor's meeting with the student in the last 7 days blocks a new request."
              : "Mentors ask to meet your students. Open one to see the 7-day check, then pick the date, time and online or in person — it's booked in the LMS when you approve."}
          </p>
        </div>
        {me && <MeetingRequestInbox box={asks ? 'mine' : 'to_decide'} onNew={asks ? () => setAsking(true) : null} />}
      </div>
      <RequestMeetingDialog open={asking} onClose={() => setAsking(false)} />
    </div>
  );
}
