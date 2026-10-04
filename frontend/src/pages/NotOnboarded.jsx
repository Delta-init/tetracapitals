import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { PageTitle } from '@/components/common/PageHeader';
import { Paged, TablePagination } from '@/components/common/TablePagination';
import StatsCard from '@/components/dashboard/StatsCard';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlarmClock, BellRing, DoorOpen, Download, Search, Users } from 'lucide-react';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import { createPageUrl } from '@/utils';
import { CallButton } from '@/components/followups/CallFlow';
import { OnboardedSwitch } from '@/components/students/onboarding';
import { ClosedByCell, closedByText } from '@/components/students/closedBy';
import { SALES_CRMS } from '@/components/students/salesCrm';

const hoursSince = (from, now) => Math.max(0, (Date.parse(now) - Date.parse(from)) / 3_600_000);
const waitText = (h) => (h < 1 ? `${Math.max(1, Math.floor(h * 60))} min` : h < 48 ? `${Math.floor(h)} h` : `${Math.floor(h / 24)} days`);
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
/** The sales CRM they came through: Sales CRM, Draw or Remote CRM. */
const platformOf = (s) => SALES_CRMS[s.sales_crm]?.label || '';

/**
 * Not onboarded — new students from finance who haven't been onboarded yet, the longest waiting first. Onboarding
 * them (the welcome email / WhatsApp) takes them off. A CS sees their own; a Chief Mentor or CS Manager their
 * people's; admin roles everyone. Still waiting 6 hours after arriving, the CS's leaders and the Super Admins are
 * emailed and notified once (backend/src/students/onboardingAlerts.ts). Each says who closed them and in which
 * sales CRM — Sales CRM, Draw or Remote CRM (components/students/closedBy.jsx).
 */
export default function NotOnboarded() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: currentUser } = useQuery({ queryKey: ['me-effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()) });
  // Under 'students': onboarding someone (components/students/onboarding.jsx) fetches it again.
  const { data, isLoading, error } = useQuery({
    queryKey: ['students', 'not-onboarded'],
    queryFn: async () => (await base44.functions.invoke('getNotOnboarded', {})).data,
    enabled: !!currentUser,
    refetchInterval: 60_000,
  });
  const [q, setQ] = useState('');
  const [cs, setCs] = useState('all');
  const [wait, setWait] = useState('all');

  const limit = data?.wait_hours ?? 6;
  const waiting = useMemo(
    () => (data?.rows || []).map(s => ({ ...s, waited: hoursSince(s.created_date, data.now) })).sort((a, b) => b.waited - a.waited),
    [data],
  );
  // One fewer here is one fewer in the sidebar.
  useEffect(() => { if (data) queryClient.invalidateQueries({ queryKey: ['nav-counts'] }); }, [waiting.length]);

  const people = useMemo(
    () => [...new Map(waiting.map(s => [s.primary_mentor_id, s.primary_mentor_name || 'No CS'])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [waiting],
  );
  const byCs = people.length > 1;
  const late = waiting.filter(s => s.waited >= limit).length;
  const needle = q.trim().toLowerCase();
  const rows = waiting.filter(s =>
    (cs === 'all' || (s.primary_mentor_id || 'none') === cs) &&
    (wait === 'all' || (wait === 'late' ? s.waited >= limit : s.waited < limit)) &&
    (!needle || [s.full_name, s.student_code, s.phone, s.email, s.course, s.primary_mentor_name, closedByText(s), platformOf(s)].some(v => String(v || '').toLowerCase().includes(needle)))
  );

  const exportCsv = () => {
    const head = ['Student', 'Code', 'Phone', 'Email', 'Course', 'CS', 'Team', 'Closed By', 'Platform', 'Arrived', 'Hours Waiting', 'Leaders Told'];
    const lines = [head, ...rows.map(s => [s.full_name, s.student_code, s.phone, s.email, s.course, s.primary_mentor_name, s.team_name, closedByText(s), platformOf(s), when(s.created_date), Math.floor(s.waited), s.alert?.at ? when(s.alert.at) : ''])];
    const csv = lines.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `not_onboarded_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const TH = ({ children }) => <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">{children}</th>;

  const table = (list) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-slate-50/80">
            <th className="sticky left-0 z-10 bg-slate-50 px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 shadow-[1px_0_0_#e2e8f0]">Call · Onboard</th>
            <TH>Student</TH><TH>Phone</TH><TH>CS</TH><TH>Closed By</TH><TH>Arrived</TH><TH>Waiting</TH><TH>Leaders Told</TH>
          </tr>
        </thead>
        <tbody>
          {list.map(s => (
            <tr key={s.id}
              className="group cursor-pointer border-b border-slate-100 align-top hover:bg-amber-50/30"
              onClick={(e) => { if (!e.target.closest('button, a')) navigate(`${createPageUrl('StudentDetail')}?id=${s.id}`); }}>
              <td className="sticky left-0 z-10 bg-white px-3 py-2.5 shadow-[1px_0_0_#e2e8f0] group-hover:bg-amber-50">
                <div className="flex items-center gap-2">
                  <CallButton variant="icon" student={{ id: s.id, full_name: s.full_name, phone: s.phone }} />
                  <OnboardedSwitch student={s} currentUser={currentUser} />
                </div>
              </td>
              <td className="px-3 py-2.5">
                <Link to={`${createPageUrl('StudentDetail')}?id=${s.id}`} className="font-medium text-slate-900 hover:text-blue-600">{s.full_name || 'Student'}</Link>
                <div className="font-mono text-xs text-slate-400">{s.student_code}</div>
                {s.course && <div className="mt-0.5 max-w-[260px] text-xs text-slate-500">{s.course}</div>}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{s.phone || '—'}</td>
              <td className="whitespace-nowrap px-3 py-2.5">
                <div className="text-slate-700">{s.primary_mentor_name || <span className="text-slate-400">No CS</span>}</div>
                {s.team_name && <div className="text-xs text-slate-400">{s.team_name}</div>}
              </td>
              {/* Who closed them, and in which sales CRM */}
              <td className="px-3 py-2.5"><ClosedByCell student={s} /></td>
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{when(s.created_date)}</td>
              <td className="whitespace-nowrap px-3 py-2.5">
                <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.waited >= limit ? 'bg-rose-600 text-white' : 'bg-amber-50 text-amber-700'}`}>
                  {waitText(s.waited)}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500">
                {s.alert?.told?.length
                  ? <span title={`Emailed and notified: ${s.alert.told.map(t => t.name).join(', ')}`} className="inline-flex items-center gap-1"><BellRing className="h-3 w-3 text-rose-500" />{when(s.alert.at)}</span>
                  : s.alert?.reason
                    ? <span title={s.alert.reason}>Nobody told</span>
                    : <span className="text-slate-300">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div>
          <PageTitle eyebrow="Students" icon={DoorOpen}>Not onboarded</PageTitle>
          <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
            New students from finance who haven't been onboarded yet — the longest waiting first. Onboard sends their welcome email / WhatsApp and takes them off this list.
            {` Still waiting ${limit} hours after arriving, their Chief Mentor, CS Manager and the Super Admins get an email and a notification (overnight ones at 09:00 UAE).`}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <StatsCard title="Waiting" value={waiting.length} icon={DoorOpen} color="amber" delay={0.02} />
          <StatsCard title={`Over ${limit} hours`} value={late} icon={AlarmClock} color="red" delay={0.05} />
          {byCs && <StatsCard title="CSs with students waiting" value={people.filter(([id]) => id).length} icon={Users} color="blue" delay={0.08} />}
        </div>

        <Card className="overflow-hidden">
          <CardHeader className="border-b">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Student, phone, course, closed by…" className="h-9 w-64 pl-9" />
              </div>
              {byCs && (
                <Select value={cs} onValueChange={(v) => v && setCs(v)}>
                  <SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Every CS</SelectItem>
                    {people.map(([id, name]) => <SelectItem key={id || 'none'} value={id || 'none'}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Select value={wait} onValueChange={(v) => v && setWait(v)}>
                <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any wait</SelectItem>
                  <SelectItem value="late">Over {limit} hours</SelectItem>
                  <SelectItem value="fresh">Under {limit} hours</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" /> CSV</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading || !currentUser ? (
              <p className="py-12 text-center text-sm text-slate-400">Loading students…</p>
            ) : error ? (
              <p className="py-12 text-center text-sm text-rose-600">{error.message || 'Could not load the students'}</p>
            ) : rows.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-400">{waiting.length ? 'Nobody waiting matches these filters.' : 'Nobody waiting — every new student from finance is onboarded.'}</p>
            ) : (
              <Paged items={rows} resetKey={`${needle}|${cs}|${wait}`}>
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
