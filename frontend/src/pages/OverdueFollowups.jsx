import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { PageTitle } from '@/components/common/PageHeader';
import { Paged, TablePagination } from '@/components/common/TablePagination';
import StatsCard from '@/components/dashboard/StatsCard';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlarmClock, BellRing, CalendarX2, Download, Search, Users } from 'lucide-react';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import { createPageUrl } from '@/utils';
import { StageBadge, ReminderBadge, fmtDate, fmtDue, hhmm } from '@/components/followups/followupUi';
import { CallButton, useCallFlow } from '@/components/followups/CallFlow';
import { LastCallLine } from '@/components/calls/callUi';
import { TagChip, useStudentTagCatalog } from '@/components/students/tags';

const LATE = {
  all: { label: 'Any days late', test: () => true },
  recent: { label: '1–2 days late', test: (n) => n <= 2 },
  week: { label: '3–7 days late', test: (n) => n >= 3 && n <= 7 },
  older: { label: 'Over a week late', test: (n) => n > 7 },
};
const daysLate = (due, today) =>
  Math.max(1, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${String(due).slice(0, 10)}T00:00:00Z`)) / 86_400_000));
const toldOn = (iso) => (iso ? `${new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${hhmm(iso)}` : '');

/**
 * Overdue follow-ups — their date passed and no call was logged. A CS sees
 * their own; a Chief Mentor or CS Manager their people's, by CS (they also get
 * an email and a notice when one goes overdue); admin roles everyone. Call,
 * then Log with a new date to take it off. The same data as the Follow-ups
 * page (getFollowups), so the two always agree.
 */
export default function OverdueFollowups() {
  const navigate = useNavigate();
  const callFlow = useCallFlow();
  const { data: currentUser } = useQuery({ queryKey: ['me-effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()) });
  const { data, isLoading, error } = useQuery({
    queryKey: ['followups'],
    queryFn: async () => (await base44.functions.invoke('getFollowups', {})).data,
    enabled: !!currentUser,
    refetchInterval: 60_000,
  });
  const { data: tagCatalog = [] } = useStudentTagCatalog();
  const [q, setQ] = useState('');
  const [cs, setCs] = useState('all');
  const [late, setLate] = useState('all');

  const today = data?.today;
  const overdue = useMemo(() => (data?.followups || [])
    .filter(f => f.followup_status === 'OVERDUE')
    .map(f => ({ ...f, late: daysLate(f.next_followup_date, today) }))
    .sort((a, b) => b.late - a.late || String(a.student_name).localeCompare(String(b.student_name))), [data, today]);
  // Whose students they are — more than one: a leader's view, by CS.
  const people = useMemo(
    () => [...new Map(overdue.map(f => [f.mentor_id, f.mentor_name || 'No CS'])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [overdue],
  );
  const byCs = people.length > 1;
  const needle = q.trim().toLowerCase();
  const rows = overdue.filter(f =>
    (cs === 'all' || f.mentor_id === cs) &&
    LATE[late].test(f.late) &&
    (!needle || [f.student_name, f.student_code, f.phone, f.mentor_name, f.client_said].some(v => String(v || '').toLowerCase().includes(needle)))
  );
  const groups = byCs
    ? people.map(([id, name]) => ({ id, name, rows: rows.filter(f => f.mentor_id === id) })).filter(g => g.rows.length)
    : [{ id: 'all', name: '', rows }];
  const overAWeek = overdue.filter(f => f.late > 7).length;

  const exportCsv = () => {
    const head = ['Student', 'Code', 'Phone', 'CS', 'Team', 'Target Outcome', 'Stage', 'Was Due', 'Days Late', 'Last Contact Date', 'What Client Said', 'Leaders Told'];
    const lines = [head, ...rows.map(f => [f.student_name, f.student_code, f.phone, f.mentor_name, f.team_name, f.target_outcome, f.stage, f.next_followup_date, f.late, f.last_contact_date, f.client_said, f.leaders_told_at ? toldOn(f.leaders_told_at) : ''])];
    const csv = lines.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `overdue_followups_${today || ''}.csv`;
    a.click();
  };

  const TH = ({ children, right }) => <th className={`whitespace-nowrap px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 ${right ? 'text-right' : 'text-left'}`}>{children}</th>;

  const table = (list) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-slate-50/80">
            <th className="sticky left-0 z-10 bg-slate-50 px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 shadow-[1px_0_0_#e2e8f0]">Call · Log</th>
            <TH>Student</TH><TH>Phone</TH><TH>Target Outcome</TH><TH>Stage</TH><TH>Was Due</TH>
            <TH>Last Contact</TH><TH>What Client Said</TH><TH>Reminder</TH><TH>Leaders Told</TH>
          </tr>
        </thead>
        <tbody>
          {list.map(f => (
            <tr key={f.id}
              className="group cursor-pointer border-b border-slate-100 align-top hover:bg-rose-50/30"
              onClick={(e) => { if (!e.target.closest('button, a')) navigate(`${createPageUrl('StudentDetail')}?id=${f.student_id}`); }}>
              <td className="sticky left-0 z-10 bg-white px-3 py-2.5 shadow-[1px_0_0_#e2e8f0] group-hover:bg-rose-50">
                <div className="flex items-center gap-1.5">
                  <CallButton student={{ id: f.student_id, full_name: f.student_name, phone: f.phone }} followup={f} />
                  {f.can_edit && <Button size="sm" variant="outline" className="h-8" onClick={() => callFlow?.openLog(f)}>Log</Button>}
                </div>
              </td>
              <td className="px-3 py-2.5">
                <Link to={`${createPageUrl('StudentDetail')}?id=${f.student_id}`} className="font-medium text-slate-900 hover:text-blue-600">{f.student_name}</Link>
                <div className="font-mono text-xs text-slate-400">{f.student_code}</div>
                {(f.tag_names || []).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {f.tag_names.map(n => <TagChip key={n} name={n} color={tagCatalog.find(t => t.name === n)?.color || '#64748b'} />)}
                  </div>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{String(f.phone || '').replace(/^[\s'`"]+/, '') || '—'}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">{f.target_outcome}</td>
              <td className="px-3 py-2.5"><StageBadge stage={f.stage} /></td>
              <td className="whitespace-nowrap px-3 py-2.5">
                <div className="text-slate-600">{fmtDue(f)}</div>
                <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${f.late > 7 ? 'bg-rose-600 text-white' : 'bg-rose-50 text-rose-700'}`}>
                  {f.late} day{f.late === 1 ? '' : 's'} late
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{fmtDate(f.last_contact_date)}<LastCallLine call={f.last_call} /></td>
              <td className="max-w-[280px] px-3 py-2.5 text-slate-600">{f.client_said || <span className="text-slate-300">—</span>}</td>
              <td className="px-3 py-2.5"><ReminderBadge reminder={f.reminder} status={f.followup_status} /></td>
              <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500">
                {f.leaders_told_at
                  ? <span title="The CS's Chief Mentor and CS Manager were emailed and notified when it went overdue" className="inline-flex items-center gap-1"><BellRing className="h-3 w-3 text-rose-500" />{toldOn(f.leaders_told_at)}</span>
                  : <span className="text-slate-300">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // 25 a page — a bar under each CS's table when grouped by CS.
  const pagedTable = (list) => (
    <Paged items={list} resetKey={`${needle}|${cs}|${late}`}>
      {(pageRows, bar) => (<>
        {table(pageRows)}
        <TablePagination {...bar} />
      </>)}
    </Paged>
  );

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div>
          <PageTitle eyebrow="Students" icon={AlarmClock}>Overdue follow-ups</PageTitle>
          <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
            Follow-ups whose date passed without a call logged — the longest waiting first. Call, then log what they said with a new date to take it off this list.
            {byCs ? ' Their Chief Mentor and CS Manager are emailed and notified once when one goes overdue.' : ''}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <StatsCard title="Overdue" value={overdue.length} icon={AlarmClock} color="red" delay={0.02} />
          <StatsCard title="Over a week late" value={overAWeek} icon={CalendarX2} color="amber" delay={0.05} />
          {byCs && <StatsCard title="CSs with overdue" value={people.length} icon={Users} color="blue" delay={0.08} />}
        </div>

        <Card className="overflow-hidden">
          <CardHeader className="border-b">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Student, phone, what they said…" className="h-9 w-64 pl-9" />
              </div>
              {byCs && (
                <Select value={cs} onValueChange={(v) => v && setCs(v)}>
                  <SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Every CS</SelectItem>
                    {people.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Select value={late} onValueChange={(v) => v && setLate(v)}>
                <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(LATE).map(([k, l]) => <SelectItem key={k} value={k}>{l.label}</SelectItem>)}</SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" /> CSV</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <p className="py-12 text-center text-sm text-slate-400">Loading follow-ups…</p>
            ) : error ? (
              <p className="py-12 text-center text-sm text-rose-600">{error.message || 'Could not load follow-ups'}</p>
            ) : rows.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-400">{overdue.length ? 'Nothing overdue matches these filters.' : 'Nothing overdue — every follow-up is on time.'}</p>
            ) : byCs ? (
              <div className="divide-y divide-slate-200">
                {groups.map(g => (
                  <section key={g.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-2.5">
                      <span className="font-semibold text-slate-800">{g.name}</span>
                      <span className="text-xs text-slate-500">{g.rows.length} overdue · the oldest {g.rows[0].late} day{g.rows[0].late === 1 ? '' : 's'} late</span>
                    </div>
                    {pagedTable(g.rows)}
                  </section>
                ))}
              </div>
            ) : pagedTable(rows)}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
