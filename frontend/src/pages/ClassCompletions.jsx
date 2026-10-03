import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { PageTitle } from '@/components/common/PageHeader';
import { Paged, TablePagination } from '@/components/common/TablePagination';
import StatsCard from '@/components/dashboard/StatsCard';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BookCheck, CheckCircle2, PhoneCall, Search } from 'lucide-react';
import { CallButton, useCallFlow } from '@/components/followups/CallFlow';

const TABS = [
  { key: 'open', label: 'Call needed' },
  { key: 'called', label: 'Called' },
  { key: 'all', label: 'All' },
];
/* Who said the class was over (backend students/classCompletions.ts). */
const ENDED = {
  google_meet: { label: 'Google Meet', hint: 'Google Meet recorded the meeting ending', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  lms_room: { label: 'LMS room', hint: 'The LMS room closed', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  timetable: { label: 'Timetable', hint: 'No word from the meeting — its timetable end', cls: 'border-slate-200 bg-slate-50 text-slate-600' },
};
const HELD = { lms_room: 'LMS room', google_meet: 'Google Meet', classroom: 'Classroom', link: 'Online link' };
const ATTENDED = { joined_room: 'Joined the LMS room', joined_link: 'Joined by the class link', marked: 'Marked attended by the mentor' };
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Class Completions — students who attended a live class in the Delta LMS that
 * is now over (backend/src/students/classCompletions.ts). Their CS is told ten
 * minutes after the class ended; each waits under "Call needed" until a call is
 * logged after the class — a follow-up Log, or a 3CX call. Whose: as the
 * follow-ups (a CS their own, leaders their people's, admin roles everyone's).
 */
export default function ClassCompletions() {
  const callFlow = useCallFlow();
  const { data, isLoading, error } = useQuery({
    // Under 'followups': a call logged through the call flow (which refreshes 'followups') shows here at once.
    queryKey: ['followups', 'class-completions'],
    queryFn: async () => (await base44.functions.invoke('getClassCompletions', {})).data,
    refetchInterval: 60_000,
  });
  const [tab, setTab] = useState('open');
  const [q, setQ] = useState('');

  const all = data?.completions || [];
  const count = { open: all.filter(c => !c.called_at).length, called: all.filter(c => c.called_at).length, all: all.length };
  const byCs = new Set(all.map(c => c.student.cs_id)).size > 1;
  const needle = q.trim().toLowerCase();
  const rows = all.filter(c => (tab === 'all' || (tab === 'open' ? !c.called_at : !!c.called_at)) &&
    (!needle || [c.student.name, c.student.code, c.student.cs, c.class.course, c.class.title, c.class.mentor].some(v => String(v || '').toLowerCase().includes(needle))));

  const TH = ({ children }) => <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">{children}</th>;
  const table = (list) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-slate-50/80">
            <TH>Student</TH><TH>Class</TH><TH>Ended</TH><TH>Attended</TH><TH>Told</TH><TH>Call</TH>
          </tr>
        </thead>
        <tbody>
          {list.map(c => {
            const ended = ENDED[c.class.endSource] || ENDED.timetable;
            const student = { id: c.student.id, full_name: c.student.name, phone: c.student.phone };
            return (
              <tr key={c.id} className="border-b border-slate-100 align-top hover:bg-slate-50/60">
                <td className="px-3 py-2.5">
                  <Link to={`${createPageUrl('StudentDetail')}?id=${c.student.id}`} className="font-medium text-slate-900 hover:text-blue-600">{c.student.name}</Link>
                  <div className="font-mono text-xs text-slate-400">{c.student.code}</div>
                  {byCs && <div className="text-xs text-slate-500">{[c.student.cs, c.student.team].filter(Boolean).join(' · ')}</div>}
                </td>
                <td className="max-w-[300px] px-3 py-2.5">
                  <div className="font-medium text-slate-800">{[c.class.course, c.class.title].filter(Boolean).join(' · ') || 'A class'}</div>
                  <div className="text-xs text-slate-500">{[c.class.mentor, HELD[c.class.heldIn], c.class.academy].filter(Boolean).join(' · ')}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <div className="text-slate-700">{when(c.ended_at)}</div>
                  <Badge variant="outline" className={`mt-1 text-[11px] ${ended.cls}`} title={ended.hint}>{ended.label}</Badge>
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-600">
                  {ATTENDED[c.class.attendance] || 'Attended'}
                  {c.class.attendedAt && <div className="text-slate-400">{when(c.class.attendedAt)}</div>}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500">
                  {when(c.notified_at)}
                  {c.told.length > 0 && <div className="text-slate-400">{c.told_to === 'super_admins' ? 'Super Admins (no CS)' : c.told.join(', ')}</div>}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  {c.called_at ? (
                    <div className="text-xs">
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Called {when(c.called_at)}</span>
                      <div className="text-slate-400">{[c.called_via, c.called_by].filter(Boolean).join(' · ')}</div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <CallButton student={student} />
                      <Button size="sm" variant="outline" className="h-8" onClick={() => callFlow?.startCall(student)}>Log call</Button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div>
          <PageTitle eyebrow="Students" icon={BookCheck}>Class Completions</PageTitle>
          <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
            Students who attended a live class in the LMS that is now over — told to their CS ten minutes after the class ended.
            Call them and log the call (a follow-up Log, or a 3CX call): it moves to Called.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <StatsCard title="Call needed" value={count.open} icon={PhoneCall} color="amber" delay={0.02} />
          <StatsCard title="Called" value={count.called} icon={CheckCircle2} color="emerald" delay={0.05} />
        </div>

        <Card className="overflow-hidden">
          <CardHeader className="border-b">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
                {TABS.map(t => (
                  <button key={t.key} type="button" onClick={() => setTab(t.key)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                    {t.label}{t.key !== 'all' && count[t.key] > 0 ? ` (${count[t.key]})` : ''}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Student, course, class, mentor…" className="h-9 w-64 pl-9" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <p className="py-12 text-center text-sm text-slate-400">Loading class completions…</p>
            ) : error ? (
              <p className="py-12 text-center text-sm text-rose-600">{error.message || 'Could not load class completions'}</p>
            ) : rows.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-400">
                {needle ? 'Nothing matches that search.'
                  : tab === 'open' ? 'Nobody waiting for a call — every class completion has been called.'
                  : 'No class completions yet — they come from the LMS once a student attends a class.'}
              </p>
            ) : (
              <Paged items={rows} resetKey={`${tab}|${needle}`}>
                {(pageRows, bar) => (<>
                  {table(pageRows)}
                  <TablePagination {...bar} />
                </>)}
              </Paged>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
