import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { MeetingStageBadge, FOLLOW_UP_LABEL, EXPERIENCE_LABEL, LOSS_WAY_LABEL } from './meetingStage';

/* A student's meeting outcomes (backend students/meetingOutcomes.ts): each meeting's mentor said where the client
   stands, newest first — the stage, what goes with it, the concern and the remark, who and when, and the reminder it
   set — under who the client is, as the latest meeting's second step said (students.client_profile). */

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

const money = (n, cur) => `${cur || ''} ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`.trim();

/** Who the client is, as rows: experience, losses, country, family, occupation. */
export function profileRows(p) {
  if (!p) return [];
  const exp = EXPERIENCE_LABEL[p.experience] ?? p.experience;
  return [
    ['Trading experience', p.experience === 'fresher' || p.years == null ? exp : `${exp} · ${p.years} ${Number(p.years) === 1 ? 'year' : 'years'}`],
    ['Losses', p.hadLosses ? `${money(p.lossAmount, p.lossCurrency)} — ${(p.lossHow ?? []).map(w => LOSS_WAY_LABEL[w] ?? w).join(', ')}` : 'None'],
    ['Country of residence', p.country],
    ['Family in Dubai', p.familyInDubai ? 'Yes' : 'No'],
    ['Occupation / business', p.occupation],
  ];
}

function Rows({ rows }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
      {rows.filter(([, v]) => v).map(([k, v]) => (
        <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="text-slate-800">{v}</dd></div>
      ))}
    </dl>
  );
}

export default function StudentMeetingOutcomes({ student }) {
  const { data, isLoading } = useQuery({
    queryKey: ['student-meeting-outcomes', student?.id],
    queryFn: async () => (await base44.functions.invoke('getStudentMeetingOutcomes', { studentId: student.id })).data,
    enabled: !!student?.id,
    retry: false,
  });
  const rows = data?.outcomes ?? [];
  const profile = student?.client_profile;
  if (isLoading || (!rows.length && !profile)) return null;
  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
          <ClipboardCheck className="h-4 w-4 text-indigo-600" /> Meeting outcomes
        </h3>
        {profile && (
          <div className="mb-3 rounded-lg bg-slate-50 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Client profile{profile.by ? ` · from ${profile.by}` : ''}{profile.at ? `, ${day(profile.at)}` : ''}
            </p>
            <Rows rows={profileRows(profile)} />
          </div>
        )}
        <ul className="space-y-3">
          {rows.map(r => (
            <li key={r.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <MeetingStageBadge stage={r.stage} />
                <span className="font-medium text-slate-800">{r.meeting?.title}</span>
                <span className="text-slate-500">· {r.mentor?.name || r.outcome?.filledByName} · {day(r.filled_at)}</span>
              </div>
              <div className="mt-2"><Rows rows={details(r.outcome)} /></div>
              {r.outcome?.concern && <p className="mt-2 text-sm text-slate-700"><span className="text-xs font-semibold text-slate-500">Concern: </span>{r.outcome.concern}</p>}
              {r.outcome?.remark && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{r.outcome.remark}</p>}
              {r.reminder && <p className="mt-1 text-xs text-slate-500">Follow-up {r.reminder.created ? 'opened' : 'moved'} to {r.reminder.date} for their CS</p>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
