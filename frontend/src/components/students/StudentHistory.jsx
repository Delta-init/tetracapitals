import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History } from "lucide-react";
import { format } from "date-fns";

// Everything that happened to a student, from the server's getStudentHistory:
// { team, firstReceivedBy, cameFrom, events: [{ at, type, text, by, kind }] }.
// Shared by the history card and the student's page, which reads the team,
// the first receiver and where they came from off the same answer.
export function useStudentHistory(studentId, enabled = true) {
  return useQuery({
    queryKey: ['student-history', studentId],
    queryFn: async () => {
      const res = await base44.functions.invoke('getStudentHistory', { studentId });
      return res.data;
    },
    enabled: !!studentId && enabled,
  });
}

const when = (at) => {
  if (!at) return '';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : format(d, 'd MMM yyyy, HH:mm');
};

const DOT = {
  arrived: 'bg-blue-500',
  created: 'bg-blue-500',
  assigned: 'bg-emerald-500',
  mentor_changed: 'bg-purple-500',
  senior_mentor_changed: 'bg-purple-400',
  level_changed: 'bg-amber-500',
  status_changed: 'bg-gray-500',
  enrolment_changed: 'bg-emerald-500',
  made_common: 'bg-amber-400',
  tag_changed: 'bg-sky-500',
  details_changed: 'bg-indigo-400',
  onboarding_changed: 'bg-teal-500',
  payment_link: 'bg-emerald-600',
  lms_ticket: 'bg-amber-600',
  lms_enrolment: 'bg-violet-500',
  lms_access: 'bg-indigo-500',
  course_upgrade: 'bg-emerald-500',
  pool_changed: 'bg-cyan-500',
  request: 'bg-slate-400',
};

export default function StudentHistory({ studentId, enabled = true }) {
  const { data, isLoading, error } = useStudentHistory(studentId, enabled);
  const events = data?.events ?? [];

  return (
    <Card className="border-gray-200">
      <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-slate-50 to-blue-50">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <History className="h-5 w-5 text-slate-600" />
          History
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        {isLoading ? (
          <p className="text-sm text-gray-500">Loading history…</p>
        ) : error ? (
          <p className="text-sm text-red-600">The history could not be loaded.</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing recorded for this student yet.</p>
        ) : (
          <ol className="relative ml-2 border-l border-gray-200">
            {events.map((e, i) => (
              <li key={`${e.at}-${i}`} className="mb-5 ml-5 last:mb-0">
                <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white ${DOT[e.type] ?? 'bg-gray-400'}`} />
                <p className="text-sm text-gray-900">{e.text}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span>{when(e.at) || 'Date not recorded'}</span>
                  {e.by && <span>· by {e.by}</span>}
                  {e.kind === 'record' && (
                    <Badge variant="outline" className="border-gray-200 bg-gray-50 text-[10px] font-normal text-gray-500">from earlier records</Badge>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
