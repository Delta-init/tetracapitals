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
import { AlarmClock, BellRing, CheckCircle2, DoorOpen, Download, FileSpreadsheet, Hourglass, Loader2, Search, Users, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { downloadExcel } from '@/components/utils/excelExport';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import { createPageUrl } from '@/utils';
import { CallButton, ONBOARDING_CONNECTED } from '@/components/followups/CallFlow';
import { OnboardedSwitch, OnboardingDialog } from '@/components/students/onboarding';
import { ClosedByCell, closedByText } from '@/components/students/closedBy';
import { SALES_CRMS } from '@/components/students/salesCrm';
import { VerificationCell, VerificationTable, ResubmitBonusDialog } from '@/components/students/bonusVerification';

const hoursSince = (from, now) => Math.max(0, (Date.parse(now) - Date.parse(from)) / 3_600_000);
const waitText = (h) => (h < 1 ? `${Math.max(1, Math.floor(h * 60))} min` : h < 48 ? `${Math.floor(h)} h` : `${Math.floor(h / 24)} days`);
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
/** The sales CRM they came through: Sales CRM, Draw or Remote CRM. */
const platformOf = (s) => SALES_CRMS[s.sales_crm]?.label || '';
// Where a student came from (backend getNotOnboarded `from`).
const FROM = { finance: 'Finance', lms: 'LMS sign-up', sheet: 'Sheet', added: 'Added' };
// The onboarding call from this page (backend getNotOnboarded `call`): Not connected, with how many tries.
const callText = (c) => (!c ? '' : c.connected ? 'Connected' : `Not connected${c.attempts > 1 ? ` ×${c.attempts}` : ''}`);
const CALLS = { all: 'Any call', not_connected: 'Not connected', none: 'Not called yet' };
const callMatch = (c, f) => f === 'all' || (f === 'not_connected' ? !!c && !c.connected : f === 'none' ? !c : true);

// The Not onboarded list as a download — CSV or Excel, these columns (Excel keeps the times and hours as such).
const WAITING_COLUMNS = [
  { header: 'Student', value: s => s.full_name },
  { header: 'Code', value: s => s.student_code },
  { header: 'Phone', value: s => s.phone },
  { header: 'Email', value: s => s.email },
  { header: 'Course', value: s => s.course },
  { header: 'CS', value: s => s.primary_mentor_name },
  { header: 'Team', value: s => s.team_name },
  { header: 'Closed By', value: s => closedByText(s) },
  { header: 'Platform', value: s => platformOf(s) },
  { header: 'From', value: s => FROM[s.from] || '' },
  { header: 'Call', value: s => callText(s.call) },
  { header: 'Arrived', type: 'datetime', value: s => s.created_date },
  { header: 'Hours Waiting', type: 'number', value: s => Math.floor(s.waited) },
  { header: 'Leaders Told', type: 'datetime', value: s => s.alert?.at || '' },
];
// The verification tabs as Excel: one row per bonus, as VerificationTable lists them (components/students/bonusVerification.jsx).
const BONUS_STATES = { not_requested: 'Bonus not raised yet', pending: 'Verification pending', rejected: 'Rejected', approved: 'Approved' };
const bonusRows = (list, kind) =>
  list.flatMap(s => (s.bonuses || []).filter(b => kind === 'approved' || b.state !== 'approved' || s.bonuses.length === 1).map(b => ({ s, b })));
const verificationColumns = (kind) => [
  { header: 'Student', value: ({ s }) => s.full_name },
  { header: 'Code', value: ({ s }) => s.student_code },
  { header: 'Course', value: ({ b }) => b.course },
  { header: 'Invoice', value: ({ b }) => b.invoice_number },
  { header: 'CS', value: ({ s }) => s.primary_mentor_name },
  { header: 'Team', value: ({ s }) => s.team_name },
  { header: 'Closed By', value: ({ s }) => closedByText(s) },
  { header: 'Platform', value: ({ s }) => platformOf(s) },
  { header: 'Bonus', type: 'number', value: ({ b }) => b.amount },
  { header: 'Currency', value: ({ b }) => b.currency },
  { header: 'Status', value: ({ b }) => BONUS_STATES[b.state] || b.state },
  ...(kind === 'approved' ? [] : [{ header: 'Submitted Again', type: 'number', value: ({ b }) => b.resubmitted || '' }]),
  ...(kind === 'pending'
    ? [{ header: 'Raised', type: 'datetime', value: ({ b }) => b.requested_at }]
    : [{ header: 'Decided', type: 'datetime', value: ({ b }) => b.decided_at }, { header: 'Decided By', value: ({ b }) => b.decided_by }]),
  ...(kind === 'rejected' ? [{ header: 'Reason', width: 40, value: ({ b }) => b.reason }] : []),
  { header: 'Welcome Sent', type: 'datetime', value: ({ s }) => s.onboarded_at },
  { header: 'Welcome Sent By', value: ({ s }) => s.onboarded_by_name },
];
const FILE_NAMES = { waiting: 'not_onboarded', pending: 'verification_pending', rejected: 'bonus_rejected', approved: 'bonus_approved_this_month' };

/**
 * Not onboarded — new students from finance who haven't been onboarded yet, the longest waiting first. Onboarding
 * them (the welcome email / WhatsApp) takes them off. A CS sees their own; a Chief Mentor or CS Manager their
 * people's; admin roles everyone. Still waiting 6 hours after arriving, the CS's leaders and the Super Admins are
 * emailed and notified once (backend/src/students/onboardingAlerts.ts). Each says who closed them and in which
 * sales CRM — Sales CRM, Draw or Remote CRM (components/students/closedBy.jsx).
 *
 * Onboarding verification (the user, 2026-10-04): a student promised an MT5 bonus at the sales close is onboarded
 * only once a broker admin approves it. Welcomed but waiting on it, they're under Verification pending; rejected,
 * under Rejected, where their CS submits it again; approved this month, under Approved
 * (components/students/bonusVerification.jsx).
 */
const TABS = [
  { key: 'waiting', label: 'Not onboarded', icon: DoorOpen, tone: 'amber' },
  { key: 'pending', label: 'Verification pending', icon: Hourglass, tone: 'amber' },
  { key: 'rejected', label: 'Rejected', icon: XCircle, tone: 'rose' },
  { key: 'approved', label: 'Approved this month', icon: CheckCircle2, tone: 'emerald' },
];
const TAB_ON = { amber: 'border-amber-300 bg-amber-50 text-amber-800', rose: 'border-rose-300 bg-rose-50 text-rose-700', emerald: 'border-emerald-300 bg-emerald-50 text-emerald-700' };
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
  const [from, setFrom] = useState('all');
  const [call, setCall] = useState('all');
  const [welcome, setWelcome] = useState(null);   // a connected onboarding call: their welcome, to send
  const [tab, setTab] = useState('waiting');
  const [resubmit, setResubmit] = useState(null); // { student, bonus } — a rejected bonus to submit again
  const [exporting, setExporting] = useState(false);

  const limit = data?.wait_hours ?? 6;
  const waiting = useMemo(
    () => (data?.rows || []).map(s => ({ ...s, waited: hoursSince(s.created_date, data.now) })).sort((a, b) => b.waited - a.waited),
    [data],
  );
  // One fewer here is one fewer in the sidebar.
  useEffect(() => { if (data) queryClient.invalidateQueries({ queryKey: ['nav-counts'] }); }, [waiting.length]);
  // A connected onboarding call was logged (followupUi.jsx): their welcome opens — from here, so it doesn't matter
  // whether their row is still on screen, or the page came back from a phone call.
  useEffect(() => {
    const open = (e) => setWelcome((data?.rows || []).find(r => r.id === e.detail?.id) || e.detail);
    window.addEventListener(ONBOARDING_CONNECTED, open);
    return () => window.removeEventListener(ONBOARDING_CONNECTED, open);
  }, [data]);

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
    (from === 'all' || s.from === from) &&
    callMatch(s.call, call) &&
    (!needle || [s.full_name, s.student_code, s.phone, s.email, s.course, s.primary_mentor_name, closedByText(s), platformOf(s), FROM[s.from]].some(v => String(v || '').toLowerCase().includes(needle)))
  );

  // The verification tabs: the same search and CS filter.
  const vMatch = (s) =>
    (cs === 'all' || (s.primary_mentor_id || 'none') === cs) &&
    (!needle || [s.full_name, s.student_code, s.phone, s.email, s.course, s.primary_mentor_name, closedByText(s), platformOf(s)].some(v => String(v || '').toLowerCase().includes(needle)));
  const lists = {
    pending: (data?.verifying || []).filter(s => s.verification === 'pending'),
    rejected: (data?.verifying || []).filter(s => s.verification === 'rejected'),
    approved: data?.approved || [],
  };
  const counts = { waiting: waiting.length, pending: lists.pending.length, rejected: lists.rejected.length, approved: lists.approved.length };
  const vRows = tab === 'waiting' ? [] : lists[tab].filter(vMatch);

  const exportCsv = () => {
    const lines = [WAITING_COLUMNS.map(c => c.header), ...rows.map(s => WAITING_COLUMNS.map(c => (c.type === 'datetime' ? when(c.value(s)) : c.value(s))))];
    const csv = lines.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `not_onboarded_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };
  // The open tab as Excel, with its filters: the students waiting, or one row per bonus on a verification tab.
  const exportExcel = async () => {
    const columns = tab === 'waiting' ? WAITING_COLUMNS : verificationColumns(tab);
    const items = tab === 'waiting' ? rows : bonusRows(vRows, tab);
    setExporting(true);
    try {
      await downloadExcel({
        fileName: `${FILE_NAMES[tab]}_${new Date().toISOString().slice(0, 10)}.xlsx`,
        sheet: TABS.find(t => t.key === tab).label,
        columns,
        rows: items.map(item => columns.map(c => c.value(item))),
      });
    } catch (e) {
      toast.error(e?.message || 'Could not make the Excel file');
    } finally {
      setExporting(false);
    }
  };
  const exportable = tab === 'waiting' ? rows.length : vRows.length;

  const TH = ({ children }) => <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">{children}</th>;

  const table = (list) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-slate-50/80">
            <th className="sticky left-0 z-10 bg-slate-50 px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 shadow-[1px_0_0_#e2e8f0]">Call · Onboard</th>
            <TH>Student</TH><TH>Phone</TH><TH>CS</TH><TH>Closed By</TH><TH>From</TH><TH>Call</TH><TH>Verification</TH><TH>Arrived</TH><TH>Waiting</TH><TH>Leaders Told</TH>
          </tr>
        </thead>
        <tbody>
          {list.map(s => (
            <tr key={s.id}
              className="group cursor-pointer border-b border-slate-100 align-top hover:bg-amber-50/30"
              onClick={(e) => { if (!e.target.closest('button, a')) navigate(`${createPageUrl('StudentDetail')}?id=${s.id}`); }}>
              <td className="sticky left-0 z-10 bg-white px-3 py-2.5 shadow-[1px_0_0_#e2e8f0] group-hover:bg-amber-50">
                <div className="flex items-center gap-2">
                  {/* The phone icon is the same onboarding call as the switch: the log asks whether it connected */}
                  <CallButton variant="icon" student={{ id: s.id, full_name: s.full_name, phone: s.phone, call_for: 'onboarding', ask_connected: true }} />
                  {/* The call first: the welcome opens only after a connected call is logged */}
                  <OnboardedSwitch student={s} currentUser={currentUser} callFirst />
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
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{FROM[s.from] || '—'}</td>
              <td className="whitespace-nowrap px-3 py-2.5">
                {s.call
                  ? <span title={s.call.at ? `Last call ${when(s.call.at)}` : undefined}
                      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.call.connected ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                      {callText(s.call)}
                    </span>
                  : <span className="text-slate-300">—</span>}
              </td>
              {/* The MT5 bonus promised at the close: they are onboarded only once it's approved */}
              <td className="px-3 py-2.5"><VerificationCell row={s} /></td>
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
            Students who haven't been onboarded yet — from finance, LMS sign-ups, added by hand or from the sheets — the longest waiting first. Onboard starts with the call: log it — connected, their welcome email / WhatsApp follows and takes them off this list; not connected, they're tagged Not connected with a follow-up today.
            {` A new student from finance still waiting ${limit} hours after arriving: their Chief Mentor, CS Manager and the Super Admins get an email and a notification (overnight ones at 09:00 UAE).`}
            {' A student promised an MT5 bonus at the sales close is onboarded only once a broker admin approves it — until then they are under Verification pending; a rejected bonus is submitted again from Rejected.'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          <StatsCard title="Waiting" value={waiting.length} icon={DoorOpen} color="amber" delay={0.02} />
          <StatsCard title={`Over ${limit} hours`} value={late} icon={AlarmClock} color="red" delay={0.05} />
          {byCs && <StatsCard title="CSs with students waiting" value={people.filter(([id]) => id).length} icon={Users} color="blue" delay={0.08} />}
          <StatsCard title="Verification pending" value={counts.pending} icon={Hourglass} color="amber" delay={0.11} />
          <StatsCard title="Bonus rejected" value={counts.rejected} icon={XCircle} color="red" delay={0.14} />
        </div>

        {/* Not onboarded, and the three steps of onboarding verification */}
        <div className="flex flex-wrap gap-2">
          {TABS.map(({ key, label, icon: Icon, tone }) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${tab === key ? TAB_ON[tone] : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              <Icon className="h-4 w-4" />{label}
              <span className="rounded-full bg-white/70 px-1.5 text-xs font-semibold">{counts[key]}</span>
            </button>
          ))}
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
              {tab === 'waiting' && (<>
              <Select value={wait} onValueChange={(v) => v && setWait(v)}>
                <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any wait</SelectItem>
                  <SelectItem value="late">Over {limit} hours</SelectItem>
                  <SelectItem value="fresh">Under {limit} hours</SelectItem>
                </SelectContent>
              </Select>
              <Select value={from} onValueChange={(v) => v && setFrom(v)}>
                <SelectTrigger className="h-9 w-40" aria-label="From"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">From anywhere</SelectItem>
                  {Object.entries(FROM).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={call} onValueChange={(v) => v && setCall(v)}>
                <SelectTrigger className="h-9 w-40" aria-label="Call"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(CALLS).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}</SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" /> CSV</Button>
              </>)}
              {/* Whichever tab is open, as filtered */}
              <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting || !exportable}
                className="border-green-600 text-green-700 hover:bg-green-50">
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Excel
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading || !currentUser ? (
              <p className="py-12 text-center text-sm text-slate-400">Loading students…</p>
            ) : tab !== 'waiting' && !error ? (
              vRows.length === 0 ? (
                <p className="py-12 text-center text-sm text-slate-400">
                  {lists[tab].length ? 'Nobody here matches these filters.'
                    : tab === 'pending' ? 'No bonus waiting for a broker admin.'
                    : tab === 'rejected' ? 'No rejected bonus.'
                    : 'No bonus approved this month yet.'}
                </p>
              ) : (
                <Paged items={vRows} resetKey={`${tab}|${needle}|${cs}`}>
                  {(pageRows, bar) => (<>
                    <VerificationTable list={pageRows} kind={tab} onResubmit={setResubmit} />
                    <TablePagination {...bar} />
                  </>)}
                </Paged>
              )
            ) : error ? (
              <p className="py-12 text-center text-sm text-rose-600">{error.message || 'Could not load the students'}</p>
            ) : rows.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-400">{waiting.length ? 'Nobody waiting matches these filters.' : 'Nobody waiting — every student is onboarded.'}</p>
            ) : (
              <Paged items={rows} resetKey={`${needle}|${cs}|${wait}|${from}|${call}`}>
                {(pageRows, bar) => (<>
                  {table(pageRows)}
                  <TablePagination {...bar} />
                </>)}
              </Paged>
            )}
          </CardContent>
        </Card>
      </div>
      {welcome && <OnboardingDialog student={welcome} open onOpenChange={(o) => { if (!o) setWelcome(null); }} callAfterSend={false} />}
      {resubmit && <ResubmitBonusDialog target={resubmit} onOpenChange={(o) => { if (!o) setResubmit(null); }} />}
    </div>
  );
}
