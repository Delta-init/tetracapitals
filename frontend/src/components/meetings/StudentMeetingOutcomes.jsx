import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { MeetingStageBadge, FOLLOW_UP_LABEL } from './meetingStage';

/* A student's meeting outcomes (backend students/meetingOutcomes.ts): each meeting's mentor said where the client
   stands, newest first — the stage, what goes with it, the remark, who and when, and the reminder it set. */

const tz = 'Asia/Dubai';
const day = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

function details(o) {
  switch (o?.stage) {
    case 'interested': return [['Course', o.courseTitle], ['Payment date', o.paymentDate], ['Payment mode', o.paymentMode]];
    case 'follow_up': return [['Follow-up', FOLLOW_UP_LABEL[o.followUpKind] ?? o.followUpKind], ['Date', o.followUpDate]];
    case 'meeting_with': return [['Mentor', o.withMentorName]];
    case 'revision': return [['Course', o.courseTitle], ['Module', o.moduleTitle], ['Preferred mentor', o.withMentorName]];
    case 'not_interested': return [['Why', o.reason]];
    default: return [];
  }
}

export default function StudentMeetingOutcomes({ student }) {
  const { data, isLoading } = useQuery({
    queryKey: ['student-meeting-outcomes', student?.id],
    queryFn: async () => (await base44.functions.invoke('getStudentMeetingOutcomes', { studentId: student.id })).data,
    enabled: !!student?.id,
    retry: false,
  });
  const rows = data?.outcomes ?? [];
  if (isLoading || !rows.length) return null;
  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
          <ClipboardCheck className="h-4 w-4 text-indigo-600" /> Meeting outcomes
        </h3>
        <ul className="space-y-3">
          {rows.map(r => (
            <li key={r.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <MeetingStageBadge stage={r.stage} />
                <span className="font-medium text-slate-800">{r.meeting?.title}</span>
                <span className="text-slate-500">· {r.mentor?.name || r.outcome?.filledByName} · {day(r.filled_at)}</span>
              </div>
              <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                {details(r.outcome).filter(([, v]) => v).map(([k, v]) => (
                  <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="text-slate-800">{v}</dd></div>
                ))}
              </dl>
              {r.outcome?.remark && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{r.outcome.remark}</p>}
              {r.reminder && <p className="mt-1 text-xs text-slate-500">Follow-up {r.reminder.created ? 'opened' : 'moved'} to {r.reminder.date} for their CS</p>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
