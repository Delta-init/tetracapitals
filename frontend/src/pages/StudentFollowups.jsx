import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { PageTitle } from '@/components/common/PageHeader';
import { TablePagination, usePagination } from '@/components/common/TablePagination';
import StatsCard from '@/components/dashboard/StatsCard';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlarmClock, CalendarCheck, CheckCircle2, DollarSign, Download, ListChecks, PhoneCall, Plus, Search, TrendingUp, XCircle } from 'lucide-react';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import { createPageUrl } from '@/utils';
import {
  OUTCOMES, STAGES, StatusBadge, StageBadge, ReminderBadge, NewFollowupDialog, fmtDate, fmtDue, money,
} from '@/components/followups/followupUi';
import { CallButton, useCallFlow } from '@/components/followups/CallFlow';
import ReminderLog from '@/components/followups/ReminderLog';
import { LastCallLine } from '@/components/calls/callUi';
import { isStudentOf } from '@/components/students/common';
import { TagChip, useStudentTagCatalog } from '@/components/students/tags';

// The follow-ups' business day (backend students/followups.ts BUSINESS_OFFSET_MS).
const businessDate = (iso) => (iso ? new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10) : '');
const TABS = {
  overdue: { label: 'Overdue', test: (f) => f.followup_status === 'OVERDUE' },
  today: { label: 'Due today', test: (f) => f.followup_status === 'DUE TODAY' },
  // A call logged today, or a follow-up opened today with what the student said (the user, 2026-10-04).
  done: { label: 'Done today', test: (f, today) => !!today && (f.last_contact_date === today || (!!f.client_said && businessDate(f.created_date) === today)) },
  upcoming: { label: 'Upcoming', test: (f) => f.followup_status === 'On Track' || f.followup_status === '-' },
  closed: { label: 'Closed', test: (f) => f.followup_status === 'Closed' },
  all: { label: 'All', test: () => true },
};

/**
 * Student follow-ups — the CSE Follow-up Tracker inside the portal. A CS sees
 * and works their own students; CS Managers and Chief Mentors also see the
 * people under them; admin roles see everyone (the server enforces all of it).
 */
export default function StudentFollowups() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: currentUser } = useQuery({ queryKey: ['me-effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()) });
  const { data, isLoading, error } = useQuery({
    queryKey: ['followups'],
    queryFn: async () => (await base44.functions.invoke('getFollowups', {})).data,
    enabled: !!currentUser,
    refetchInterval: 60_000,
  });
  const canEditAny = ['super_admin', 'admin'].includes(currentUser?.app_role);
  const { data: students = [] } = useQuery({
    queryKey: ['followup-students', currentUser?.id],
    queryFn: () => base44.entities.Student.list('-created_date'),
    enabled: !!currentUser,
  });
  const myStudents = useMemo(
    () => students.filter(s => canEditAny || isStudentOf(s, currentUser?.id)).sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || ''))),
    [students, canEditAny, currentUser?.id],
  );

  const followups = data?.followups || [];
  const stats = data?.stats || {};
  // ?tab=upcoming etc. — where a notice or email opens it (tomorrow's follow-ups are under Upcoming).
  const tabInUrl = () => { const t = new URLSearchParams(location.search).get('tab'); return t && TABS[t] ? t : null; };
  const [tab, setTab] = useState(() => tabInUrl() || 'today');
  useEffect(() => { const t = tabInUrl(); if (t) setTab(t); }, [location.search]);
  const [stage, setStage] = useState('all');
  const [outcome, setOutcome] = useState('all');
  const [team, setTeam] = useState('all');
  const [cs, setCs] = useState('all');
  const [tag, setTag] = useState('all');
  const { data: tagCatalog = [] } = useStudentTagCatalog();
  const [q, setQ] = useState('');
  const callFlow = useCallFlow();
  const [creating, setCreating] = useState(false);

  const teams = useMemo(() => [...new Set(followups.map(f => f.team_name).filter(Boolean))].sort(), [followups]);
  // Whose students — more than one for a leader or an admin: the CS filter.
  const people = useMemo(
    () => [...new Map(followups.map(f => [f.mentor_id, f.mentor_name || 'No CS'])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [followups],
  );
  const needle = q.trim().toLowerCase();
  const base = followups.filter(f =>
    (stage === 'all' || f.stage === stage) &&
    (outcome === 'all' || f.target_outcome === outcome) &&
    (team === 'all' || f.team_name === team) &&
    (cs === 'all' || (f.mentor_id || 'none') === cs) &&
    (tag === 'all' || (f.tag_names || []).includes(tag)) &&
    (!needle || [f.student_name, f.student_code, f.phone, f.mentor_name, f.client_said].some(v => String(v || '').toLowerCase().includes(needle)))
  );
  const today = data?.today;
  const counts = Object.fromEntries(Object.entries(TABS).map(([k, t]) => [k, base.filter(f => t.test(f, today)).length]));
  const rows = base.filter(f => TABS[tab].test(f, today));
  const { pageItems, bar } = usePagination(rows, { resetKey: `${tab}|${stage}|${outcome}|${team}|${cs}|${tag}|${needle}` });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['followups'] });
  const showMentor = new Set(followups.map(f => f.mentor_id)).size > 1;

  const exportCsv = () => {
    const head = ['Student', 'Code', 'Phone', 'Mentor', 'Team', 'Target Outcome', 'Stage', 'Last Contact Date', 'Next Follow-up Due', 'Follow-up Status', 'Reminder Email', 'Follow-up Count', 'What Client Said', 'Objection / Lost Reason', 'Converted Date', 'Deal Value', 'Notes'];
    const reminder = (r) => (r ? `${r.status === 'sent' && r.seen_at ? 'seen' : r.status} ${r.date}${r.status === 'skipped' || r.status === 'failed' ? ` (${r.reason})` : ''}` : '');
    const lines = [head, ...rows.map(f => [f.student_name, f.student_code, f.phone, f.mentor_name, f.team_name, f.target_outcome, f.stage, f.last_contact_date, f.next_followup_date, f.followup_status, reminder(f.reminder), f.followup_count, f.client_said, f.objection_reason, f.converted_date, f.deal_value ?? '', f.notes])];
    const csv = lines.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `followups_${TABS[tab].label.toLowerCase().replace(/\s+/g, '_')}_${data?.today || ''}.csv`;
    a.click();
  };

  const TH = ({ children, right }) => <th className={`whitespace-nowrap px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 ${right ? 'text-right' : 'text-left'}`}>{children}</th>;

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <PageTitle eyebrow="Students" icon={PhoneCall}>Follow-ups</PageTitle>
            <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
              Your students’ follow-ups — call, log what they said and set the next date. Converted automatically when a matching approved deposit arrives.
            </p>
          </div>
          <Button onClick={() => setCreating(true)} disabled={!myStudents.length}><Plus className="h-4 w-4" /> New follow-up</Button>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-8">
          <StatsCard title="Total" value={stats.total ?? 0} icon={ListChecks} color="blue" delay={0.02} />
          <StatsCard title="Converted" value={stats.converted ?? 0} icon={CheckCircle2} color="emerald" delay={0.05} />
          <StatsCard title="Lost" value={stats.lost ?? 0} icon={XCircle} color="red" delay={0.08} />
          <StatsCard title="In progress" value={stats.in_progress ?? 0} icon={TrendingUp} color="cyan" delay={0.11} />
          <StatsCard title="Conversion" value={`${Math.round((stats.conversion_rate || 0) * 100)}%`} icon={TrendingUp} color="purple" delay={0.14} />
          <StatsCard title="Overdue" value={stats.overdue ?? 0} icon={AlarmClock} color="red" delay={0.17} />
          <StatsCard title="Due today" value={stats.due_today ?? 0} icon={CalendarCheck} color="amber" delay={0.2} />
          <StatsCard title="Revenue" value={`$${(stats.revenue || 0).toLocaleString('en-US')}`} icon={DollarSign} color="emerald" delay={0.23} />
        </div>

        <Card className="overflow-hidden">
          <CardHeader className="space-y-3 border-b">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="h-auto flex-wrap">
                {Object.entries(TABS).map(([k, t]) => (
                  <TabsTrigger key={k} value={k}>{t.label} <span className="ml-1.5 rounded-full bg-slate-200/70 px-1.5 text-[11px] tabular">{counts[k]}</span></TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={stage} onValueChange={(v) => v && setStage(v)}>
                <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All stages</SelectItem>{STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={outcome} onValueChange={(v) => v && setOutcome(v)}>
                <SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All target outcomes</SelectItem>{OUTCOMES.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={tag} onValueChange={(v) => v && setTag(v)}>
                <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All tags</SelectItem>{tagCatalog.filter(t => t.active !== false).map(t => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
              {teams.length > 1 && (
                <Select value={team} onValueChange={(v) => v && setTeam(v)}>
                  <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All teams</SelectItem>{teams.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              )}
              {people.length > 1 && (
                <Select value={cs} onValueChange={(v) => v && setCs(v)}>
                  <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">Every CS</SelectItem>{people.map(([id, name]) => <SelectItem key={id || 'none'} value={id || 'none'}>{name}</SelectItem>)}</SelectContent>
                </Select>
              )}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Student, phone, what they said…" className="h-9 w-64 pl-9" />
              </div>
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" /> CSV</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50/80">
                    <th className="sticky left-0 z-10 bg-slate-50 px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 shadow-[1px_0_0_#e2e8f0]">Call · Log</th>
                    <TH>Student</TH><TH>Phone</TH>{showMentor && <TH>Mentor</TH>}<TH>Target Outcome</TH><TH>Stage</TH>
                    <TH>Last Contact</TH><TH>Next Follow-up</TH><TH>Status</TH><TH>Reminder</TH><TH right>Count</TH>
                    <TH>What Client Said</TH><TH>Objection / Lost Reason</TH><TH>Converted</TH><TH right>Deal Value</TH><TH>Notes</TH>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={16} className="py-12 text-center text-slate-400">Loading follow-ups…</td></tr>
                  ) : error ? (
                    <tr><td colSpan={16} className="py-12 text-center text-rose-600">{error.message || 'Could not load follow-ups'}</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={16} className="py-12 text-center text-slate-400">
                      {!followups.length ? 'No follow-ups yet — open one with New follow-up.'
                        : tab === 'done' ? 'No follow-up done today yet — log a call and it shows here.'
                        : `Nothing ${TABS[tab].label.toLowerCase()}.`}
                    </td></tr>
                  ) : pageItems.map(f => (
                    <tr key={f.id}
                      className="group cursor-pointer border-b border-slate-100 align-top hover:bg-cyan-50/40"
                      onClick={(e) => { if (!e.target.closest('button, a')) navigate(`${createPageUrl('StudentDetail')}?id=${f.student_id}`); }}>
                      <td className="sticky left-0 z-10 bg-white px-3 py-2.5 shadow-[1px_0_0_#e2e8f0] group-hover:bg-cyan-50">
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
                      {showMentor && <td className="px-3 py-2.5 text-slate-600">{f.mentor_name}<div className="text-xs text-slate-400">{f.team_name}</div></td>}
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">{f.target_outcome}</td>
                      <td className="px-3 py-2.5"><StageBadge stage={f.stage} /></td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{fmtDate(f.last_contact_date)}<LastCallLine call={f.last_call} /></td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{fmtDue(f)}</td>
                      <td className="px-3 py-2.5"><StatusBadge status={f.followup_status} /></td>
                      <td className="px-3 py-2.5"><ReminderBadge reminder={f.reminder} status={f.followup_status} /></td>
                      <td className="tabular px-3 py-2.5 text-right text-slate-700">{f.followup_count}</td>
                      <td className="max-w-[260px] px-3 py-2.5 text-slate-600">{f.client_said || <span className="text-slate-300">—</span>}</td>
                      <td className="max-w-[200px] px-3 py-2.5 text-slate-600">{f.objection_reason || <span className="text-slate-300">—</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{f.converted_date ? <>{fmtDate(f.converted_date)}{f.auto_converted && <div className="text-[11px] text-emerald-600">automatic</div>}</> : <span className="text-slate-300">—</span>}</td>
                      <td className="tabular whitespace-nowrap px-3 py-2.5 text-right font-medium text-slate-800">{money(f.deal_value)}</td>
                      <td className="max-w-[220px] px-3 py-2.5 text-slate-500">{f.notes || <span className="text-slate-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination {...bar} />
          </CardContent>
        </Card>

        <ReminderLog currentUser={currentUser} />
      </div>

      <NewFollowupDialog open={creating} onClose={() => setCreating(false)} onSaved={refresh} students={myStudents} followups={followups}
        onLog={(f) => callFlow?.openLog(f)} />
    </div>
  );
}
