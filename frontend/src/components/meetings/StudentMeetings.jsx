import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { MeetingStageBadge } from './meetingStage';
import { profileRows } from './StudentMeetingOutcomes';
import { CATEGORY, MeetingStatusBadge, fn, outcomeDetails, when } from './meetingsUi';

/* The student page's Meetings tab (2026-10-28): every meeting booked from here with them, newest first — when, with
   which mentor, who booked it, where it stands (upcoming, waiting for the mentor's outcome, done, cancelled) and, once
   done, what the mentor said and the follow-up it set — under who the client is (the latest meeting's second step). */

function Rows({ rows }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
      {rows.filter(([, v]) => v).map(([k, v]) => (
        <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="text-slate-800">{v}</dd></div>
      ))}
    </dl>
  );
}

export default function StudentMeetings({ student }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['student-meetings', student?.id],
    queryFn: () => fn('getStudentMeetings', { studentId: student.id }),
    enabled: !!student?.id,
    retry: false,
  });
  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  if (error) return <p className="py-8 text-center text-sm text-rose-600">{error.message || 'Could not load the meetings'}</p>;
  const meetings = data?.meetings ?? [];
  const profile = data?.client_profile ?? student?.client_profile;
  return (
    <div className="space-y-4">
      {profile && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Client profile{profile.by ? ` · from ${profile.by}` : ''}{profile.at ? `, ${when(profile.at)}` : ''}
            </p>
            <Rows rows={profileRows(profile)} />
          </CardContent>
        </Card>
      )}
      {!meetings.length ? (
        <p className="py-10 text-center text-sm text-slate-400">No meetings booked with this student from the Mentor Calendar yet.</p>
      ) : (
        <ul className="space-y-3">
          {meetings.map(m => (
            <li key={m.id}>
              <Card>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <CalendarCheck className="h-4 w-4 text-indigo-600" />
                    <span className="font-medium text-slate-800">{when(m.startsAt)}</span>
                    <span className="text-slate-500">· {m.durationMins} min · {CATEGORY[m.category] ?? m.title}</span>
                    <MeetingStatusBadge status={m.status} />
                    {m.outcome?.stage && <MeetingStageBadge stage={m.outcome.stage} />}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    With {m.mentor?.name || 'the mentor'}{m.bookedByEmail ? ` · booked by ${m.bookedByEmail}` : ''}{m.inPerson && m.location ? ` · ${m.location}` : ''}
                  </p>
                  {m.outcome && (
                    <div className="mt-3 rounded-lg bg-slate-50 p-3">
                      <Rows rows={outcomeDetails(m.outcome)} />
                      {m.outcome.concern && <p className="mt-2 text-sm text-slate-700"><span className="text-xs font-semibold text-slate-500">Concern: </span>{m.outcome.concern}</p>}
                      {m.outcome.remark && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{m.outcome.remark}</p>}
                      <p className="mt-1 text-xs text-slate-500">
                        {m.outcome.filledByName ? `By ${m.outcome.filledByName}, ${when(m.outcome.filledAt)}` : ''}
                        {m.reminder ? ` · follow-up ${m.reminder.created ? 'opened' : 'moved'} to ${m.reminder.date} for their CS` : ''}
                      </p>
                    </div>
                  )}
                  {m.status === 'waiting' && <p className="mt-2 text-xs text-amber-700">Over — waiting for the mentor to fill in how it went.</p>}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
