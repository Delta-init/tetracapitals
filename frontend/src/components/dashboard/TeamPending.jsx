import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  BadgeCheck, BookOpenCheck, CalendarClock, ClipboardCheck, Coins, GraduationCap, Gift, Inbox, LifeBuoy, Loader2, MessageSquare, PhoneCall,
  PiggyBank, Search, UserX, Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { createPageUrl } from '@/utils';

/* ────────────────────────────────────────────────────────────────────────────
   On the Dashboard (the user, 2026-10-28): the Root portal's CS pending and CS
   report — for a Super Admin every CS, a CS Manager their location's, a Chief
   Mentor their own team's — and what waits on the mentors (Super Admins and
   Chief Mentors). Every number opens what is behind it (backend
   functions/dashboardPending.ts).
──────────────────────────────────────────────────────────────────────────── */

const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;
const num = (n) => (Number(n) || 0).toLocaleString('en-US');
const aed = (n) => `AED ${(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const usd = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const day = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '—');
const dateOnly = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—');
const studentLink = (id) => `${createPageUrl('StudentDetail')}?id=${id}`;
const needsUpdate = (e) => /unknown function|not found|404/i.test(String(e?.message));

const ACCENT = {
  slate: 'border-slate-200 bg-white', amber: 'border-amber-200 bg-amber-50/60', rose: 'border-rose-200 bg-rose-50/60', sky: 'border-sky-200 bg-sky-50/60',
  violet: 'border-violet-200 bg-violet-50/60', emerald: 'border-emerald-200 bg-emerald-50/60', cyan: 'border-cyan-200 bg-cyan-50/60',
};
/** A stat card that opens its list. */
function Stat({ icon: Icon, title, value, hint, accent = 'slate', onClick }) {
  const inner = (
    <div className={cn('h-full rounded-2xl border p-4 text-left shadow-soft transition-colors', ACCENT[accent], onClick && 'hover:border-brand-navy/40')}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500"><Icon className="h-3.5 w-3.5" />{title}</p>
      <p className="mt-1.5 text-2xl font-bold text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
  return onClick ? <button type="button" onClick={onClick} className="block h-full w-full">{inner}</button> : inner;
}
/** A count in a table that opens its list; plain when 0. */
const Opens = ({ n, onOpen, className, children }) =>
  n > 0 ? <button type="button" onClick={onOpen} className={cn('font-medium underline-offset-2 hover:underline', className)}>{children ?? num(n)}</button> : <span className="text-slate-300">{children ?? 0}</span>;

/** A list behind a number: `columns` [[header, cell(row), text(row)?]], with a search. */
function ListDialog({ open, onClose, title, rows, columns }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = (rows || []).filter(r => !needle || columns.some(([, , text]) => text && String(text(r) ?? '').toLowerCase().includes(needle)));
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setQ(''); } }}>
      <DialogContent className="max-w-5xl">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{shown.length}{needle ? ` of ${rows?.length ?? 0}` : ''}</DialogDescription></DialogHeader>
        <div className="relative max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find…" className="h-9 pl-8" />
        </div>
        <div className="max-h-[65vh] overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
              <tr>{columns.map(([h]) => <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!shown.length && <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-slate-400">Nothing here.</td></tr>}
              {shown.map((r, i) => <tr key={r.id || r.ticketId || `${r.studentId || r.student_id}-${i}`} className="align-top hover:bg-slate-50">{columns.map(([h, cell]) => <td key={h} className="px-3 py-2">{cell(r)}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const Muted = ({ children }) => <span className="block text-xs text-slate-400">{children}</span>;
const StudentCell = (r) => (
  (r.studentId || r.student_id)
    ? <Link to={studentLink(r.studentId || r.student_id)} className="font-medium text-brand-navy hover:underline">{r.student || 'A student'}<Muted>{r.code}</Muted></Link>
    : <>{r.student || '—'}<Muted>{r.code}</Muted></>
);
const csNames = (r) => (r.cs || []).map(c => c.name).filter(Boolean).join(', ') || 'No CS yet';
const BONUS_STAGE = { sent_back: 'Sent back', after_payment: 'After full payment', needs_call: 'Needs call + MT5', with_finance: 'With finance', waiting_broker: 'Broker admin' };

/* ── CS pending ────────────────────────────────────────────────────────── */

const PENDING_KINDS = {
  onboarding: { title: 'Onboarding pending', cols: [['Student', StudentCell, r => `${r.student} ${r.code}`], ['CS', r => csNames(r), csNames], ['Since', r => <>{day(r.since)}{r.late && <Muted><span className="text-rose-600">over 6 hours — from finance</span></Muted>}</>]] },
  bonus: { title: 'Bonus pending', cols: [['Student', StudentCell, r => `${r.student} ${r.code}`], ['CS', r => csNames(r), csNames], ['Bonus', r => <>{r.count} · {usd(r.usd)}</>],
    ['Where it is', r => Object.entries(r.stages || {}).map(([k, v]) => `${BONUS_STAGE[k] || k} ${v.count}`).join(' · '), r => Object.keys(r.stages || {}).map(k => BONUS_STAGE[k]).join(' ')], ['Since', r => day(r.since)]] },
  tickets: { title: 'LMS tickets pending', cols: [['Student', StudentCell, r => `${r.student} ${r.code}`], ['CS', r => csNames(r), csNames], ['Ticket', r => <>{r.subject}<Muted>{r.category}</Muted></>, r => r.subject],
    ['Waiting', r => (r.status === 'waiting_on_student' ? 'On the student' : <span className="text-amber-700">For an answer</span>)], ['Last message', r => day(r.lastMessageAt)]] },
  followups: { title: 'Follow-ups due', cols: [['Student', StudentCell, r => `${r.student} ${r.code}`], ['CS', r => csNames(r), csNames], ['Due', r => <span className={r.overdue ? 'font-medium text-rose-600' : ''}>{dateOnly(r.due)}{r.overdue ? ' · overdue' : ''}</span>], ['Follow-up', r => r.title || r.outcome || r.stage, r => `${r.title} ${r.outcome}`]] },
  completions: { title: 'Class completions to call', cols: [['Student', StudentCell, r => `${r.student} ${r.code}`], ['CS', r => csNames(r), csNames], ['Class', r => <>{r.className}<Muted>{[r.course, r.mentor].filter(Boolean).join(' · ')}</Muted></>, r => r.className], ['Ended', r => day(r.endedAt)]] },
};

export function CsPendingPanel() {
  const [loc, setLoc] = useState('all');
  const [pick, setPick] = useState(null); // { kind, cs? }
  const q = useQuery({ queryKey: ['dashboard', 'cs-pending'], queryFn: () => fn('getDashboardCsPending', {}), refetchInterval: 120_000, retry: false });
  const d = q.data;
  const locOk = (r) => loc === 'all' || r.location === loc;
  const people = (d?.people || []).filter(locOk);
  const t = loc === 'all' || !d?.totalsByLocation ? d?.totals : d.totalsByLocation[loc];
  const rowsOf = (kind, cs) => (d?.items?.[kind] || []).filter(locOk).filter(r => !cs || (r.csIds || []).includes(cs.id));
  if (q.error) return <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">CS pending: {needsUpdate(q.error) ? 'needs the server update (the API deploy).' : q.error.message}</p>;
  const scopeLabel = d?.scope === 'all' ? 'Every CS' : d?.scope === 'location' ? `Your location's CSs (${d.location === 'bangalore' ? 'Bangalore' : 'Dubai'})` : "Your team's CSs";
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b py-4">
        <CardTitle className="flex items-center gap-2 text-base text-brand-navy"><Inbox className="h-4 w-4" />CS pending <span className="text-sm font-normal text-slate-500">· {scopeLabel}</span></CardTitle>
        {d?.scope === 'all' && (
          <div className="flex rounded-full border bg-white p-0.5 text-xs">
            {[['all', 'Everyone'], ['dubai', 'Dubai'], ['bangalore', 'Bangalore']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setLoc(k)} className={cn('rounded-full px-3 py-1 font-medium', loc === k ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-50')}>{l}</button>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {q.isLoading || !t ? <p className="flex items-center gap-2 py-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p> : <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat icon={Inbox} title="Total pending" value={num(t.total)} hint={`across ${people.length} CS${people.length === 1 ? '' : 's'}`} />
            <Stat icon={UserX} accent="amber" title="Onboarding" value={num(t.onboarding)} hint={t.onboarding_late ? `${t.onboarding_late} over 6 hours` : 'not onboarded yet'} onClick={() => setPick({ kind: 'onboarding' })} />
            <Stat icon={Gift} accent="rose" title="Bonus pending" value={num(t.bonus)} hint={`${usd(t.bonus_usd)} · ${t.bonus_sent_back || 0} sent back`} onClick={() => setPick({ kind: 'bonus' })} />
            <Stat icon={LifeBuoy} accent="cyan" title="LMS tickets" value={num((t.tickets_open || 0) + (t.tickets_waiting || 0))} hint={`${t.tickets_open || 0} need an answer`} onClick={() => setPick({ kind: 'tickets' })} />
            <Stat icon={PhoneCall} accent="violet" title="Follow-ups due" value={num((t.followups_today || 0) + (t.followups_overdue || 0))} hint={`${t.followups_overdue || 0} overdue`} onClick={() => setPick({ kind: 'followups' })} />
            <Stat icon={GraduationCap} accent="emerald" title="Class completions" value={num(t.completions)} hint="waiting for a call" onClick={() => setPick({ kind: 'completions' })} />
          </div>
          {d?.tickets && !d.tickets.available && <p className="text-xs text-amber-700">LMS tickets aren't counted: {d.tickets.message}</p>}
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
                <tr>{['CS', 'Onboarding', 'Bonus', 'Tickets', 'Follow-ups', 'Completions', 'Total'].map(h => <th key={h} className={cn('whitespace-nowrap px-3 py-2.5 font-semibold', h !== 'CS' && 'text-right')}>{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!people.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No CSs here.</td></tr>}
                {people.map(p => {
                  const c = p.counts, open = (kind) => setPick({ kind, cs: p });
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2"><p className="font-medium text-slate-900">{p.name}</p><Muted>{[p.team, p.location === 'bangalore' ? 'Bangalore' : null, p.active ? null : 'switched off'].filter(Boolean).join(' · ')}</Muted></td>
                      <td className="px-3 py-2 text-right"><Opens n={c.onboarding} onOpen={() => open('onboarding')} className="text-amber-700" />{c.onboarding_late ? <Muted><span className="text-rose-600">{c.onboarding_late} late</span></Muted> : null}</td>
                      <td className="px-3 py-2 text-right"><Opens n={c.bonus} onOpen={() => open('bonus')} className="text-rose-700" />{c.bonus_sent_back ? <Muted>{c.bonus_sent_back} sent back</Muted> : null}</td>
                      <td className="px-3 py-2 text-right"><Opens n={c.tickets_open + c.tickets_waiting} onOpen={() => open('tickets')} className="text-cyan-700" /></td>
                      <td className="px-3 py-2 text-right"><Opens n={c.followups_today + c.followups_overdue} onOpen={() => open('followups')} className="text-violet-700" />{c.followups_overdue ? <Muted><span className="text-rose-600">{c.followups_overdue} overdue</span></Muted> : null}</td>
                      <td className="px-3 py-2 text-right"><Opens n={c.completions} onOpen={() => open('completions')} className="text-emerald-700" /></td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">{num(p.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>}
      </CardContent>
      {pick && <ListDialog open onClose={() => setPick(null)} title={`${PENDING_KINDS[pick.kind].title}${pick.cs ? ` — ${pick.cs.name}` : ''}`} rows={rowsOf(pick.kind, pick.cs)} columns={PENDING_KINDS[pick.kind].cols} />}
    </Card>
  );
}

/* ── CS report ─────────────────────────────────────────────────────────── */

const todayDubai = () => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() + 4 * 3_600_000 - n * 86_400_000).toISOString().slice(0, 10);
const PERIODS = [['today', 'Today'], ['week', 'Last 7 days'], ['month', 'This month'], ['quarter', 'This quarter'], ['year', 'This year']];
const askOf = (p) => (p === 'today' ? { period: 'custom', from: todayDubai(), to: todayDubai() } : p === 'week' ? { period: 'custom', from: daysAgo(6), to: todayDubai() } : { period: p });
const REPORT_COLS = {
  revenue: [['When', r => day(r.at)], ['What', r => ({ deposit: 'Deposit', withdrawal: 'Withdrawal', course_payment: 'Course payment' }[r.kind] || r.kind) + (r.course ? ` · ${r.course}` : ''), r => r.kind], ['Student', StudentCell, r => `${r.student} ${r.code}`], ['CS', r => r.cs, r => r.cs], ['AED', r => <span className={r.kind === 'withdrawal' ? 'text-rose-600' : 'text-emerald-700'}>{aed(r.aed)}</span>]],
  followups: [['When', r => day(r.at)], ['Student', StudentCell, r => `${r.student} ${r.code}`], ['CS', r => r.cs, r => r.cs], ['What', r => <>{r.kind}{r.stage_to ? ` → ${r.stage_to}` : ''}<Muted>{r.client_said || r.text}</Muted></>, r => `${r.kind} ${r.client_said} ${r.text}`]],
  calls: [['When', r => day(r.at)], ['Student', StudentCell, r => `${r.student} ${r.code}`], ['CS', r => r.cs, r => r.cs], ['Call', r => `${r.direction === 'in' ? 'In' : 'Out'} · ${r.status}`, r => r.status], ['Talk', r => (r.talk_seconds ? `${Math.floor(r.talk_seconds / 60)}m ${r.talk_seconds % 60}s` : '—')]],
  onboarded: [['When', r => day(r.at)], ['Student', StudentCell, r => `${r.student} ${r.code}`], ['CS', r => r.cs, r => r.cs]],
  bonus: [['Raised', r => day(r.at)], ['Student', StudentCell, r => `${r.student} ${r.code}`], ['CS', r => r.cs, r => r.cs], ['Stage', r => r.stage, r => r.stage], ['MT5 bonus', r => usd(r.usd)], ['Paid', r => (r.aed ? aed(r.aed) : '—')]],
  commission: [['When', r => day(r.at)], ['Student', StudentCell, r => `${r.student} ${r.code}`], ['CS', r => r.cs, r => r.cs], ['Type', r => r.type, r => r.type], ['Commission', r => aed(r.aed)]],
};

export function CsReportPanel() {
  const [period, setPeriod] = useState('month');
  const [pick, setPick] = useState(null); // { section, title, rows }
  const ask = askOf(period);
  const q = useQuery({ queryKey: ['dashboard', 'cs-report', ask], queryFn: () => fn('getDashboardCsReport', ask), retry: false });
  const d = q.data;
  // One row per CS, from every section.
  const people = useMemo(() => {
    const m = new Map();
    const take = (section, keys) => {
      for (const r of d?.[section]?.people || []) {
        const row = m.get(r.id) ?? { id: r.id, name: r.name, team: r.team };
        for (const k of keys) row[`${section}.${k}`] = r[k];
        m.set(r.id, row);
      }
    };
    take('revenue', ['deposits', 'deposit_aed', 'withdrawals', 'withdrawal_aed', 'course_payments', 'course_payment_aed', 'net_aed']);
    take('followups', ['logged', 'contacted', 'converted']);
    take('calls', ['calls', 'connected', 'talk_seconds']);
    take('onboarded', ['onboarded']);
    take('bonus', ['count', 'usd', 'approved']);
    take('commission', ['credits', 'aed']);
    return [...m.values()].sort((a, b) => (b['revenue.net_aed'] || 0) - (a['revenue.net_aed'] || 0) || a.name.localeCompare(b.name));
  }, [d]);
  const t = (section, k) => d?.[section]?.total?.[k] || 0;
  const open = (section, title, filter = () => true) => setPick({ section, title, rows: (d?.[section]?.rows || []).filter(filter) });
  if (q.error) return <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">CS report: {needsUpdate(q.error) ? 'needs the server update (the API deploy).' : q.error.message}</p>;
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b py-4">
        <CardTitle className="flex items-center gap-2 text-base text-brand-navy"><ClipboardCheck className="h-4 w-4" />CS report</CardTitle>
        <div className="flex flex-wrap rounded-full border bg-white p-0.5 text-xs">
          {PERIODS.map(([k, l]) => <button key={k} type="button" onClick={() => setPeriod(k)} className={cn('rounded-full px-3 py-1 font-medium', period === k ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-50')}>{l}</button>)}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {q.isLoading || !d ? <p className="flex items-center gap-2 py-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p> : <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Stat icon={PiggyBank} accent="emerald" title="Deposits" value={aed(t('revenue', 'deposit_aed'))} hint={`${num(t('revenue', 'deposits'))} approved`} onClick={() => open('revenue', 'Deposits', r => r.kind === 'deposit')} />
            <Stat icon={Wallet} accent="rose" title="Withdrawals" value={aed(t('revenue', 'withdrawal_aed'))} hint={`${num(t('revenue', 'withdrawals'))} approved`} onClick={() => open('revenue', 'Withdrawals', r => r.kind === 'withdrawal')} />
            <Stat icon={BookOpenCheck} accent="sky" title="Course payments" value={aed(t('revenue', 'course_payment_aed'))} hint={`${num(t('revenue', 'course_payments'))} approved`} onClick={() => open('revenue', 'Course payments', r => r.kind === 'course_payment')} />
            <Stat icon={CalendarClock} accent="violet" title="Follow-ups logged" value={num(t('followups', 'logged'))} hint={`${num(t('followups', 'contacted'))} contacted · ${num(t('followups', 'converted'))} converted`} onClick={() => open('followups', 'Follow-ups logged')} />
            <Stat icon={PhoneCall} accent="cyan" title="Calls" value={num(t('calls', 'calls'))} hint={`${num(t('calls', 'connected'))} connected`} onClick={() => open('calls', 'Calls')} />
            <Stat icon={BadgeCheck} accent="amber" title="Onboarded" value={num(t('onboarded', 'onboarded'))} onClick={() => open('onboarded', 'Onboarded')} />
            <Stat icon={Coins} title="Commission" value={aed(t('commission', 'aed'))} hint={`bonuses ${num(t('bonus', 'count'))} · ${usd(t('bonus', 'usd'))}`} onClick={() => open('commission', 'Commission')} />
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
                <tr>{['CS', 'Deposits', 'Withdrawals', 'Course payments', 'Follow-ups', 'Calls', 'Onboarded', 'Bonuses', 'Commission'].map(h => <th key={h} className={cn('whitespace-nowrap px-3 py-2.5 font-semibold', h !== 'CS' && 'text-right')}>{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!people.length && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">Nothing in this period.</td></tr>}
                {people.map(p => {
                  const mine = (r) => r.cs_id === p.id;
                  const o = (section, n, label, filter, text) => <Opens n={n} onOpen={() => open(section, `${label} — ${p.name}`, r => mine(r) && (!filter || filter(r)))}>{text}</Opens>;
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2"><p className="font-medium text-slate-900">{p.name}</p><Muted>{p.team}</Muted></td>
                      <td className="px-3 py-2 text-right">{o('revenue', p['revenue.deposits'], 'Deposits', r => r.kind === 'deposit', aed(p['revenue.deposit_aed']))}<Muted>{num(p['revenue.deposits'])}</Muted></td>
                      <td className="px-3 py-2 text-right">{o('revenue', p['revenue.withdrawals'], 'Withdrawals', r => r.kind === 'withdrawal', aed(p['revenue.withdrawal_aed']))}<Muted>{num(p['revenue.withdrawals'])}</Muted></td>
                      <td className="px-3 py-2 text-right">{o('revenue', p['revenue.course_payments'], 'Course payments', r => r.kind === 'course_payment', aed(p['revenue.course_payment_aed']))}<Muted>{num(p['revenue.course_payments'])}</Muted></td>
                      <td className="px-3 py-2 text-right">{o('followups', p['followups.logged'], 'Follow-ups logged')}<Muted>{num(p['followups.converted'])} converted</Muted></td>
                      <td className="px-3 py-2 text-right">{o('calls', p['calls.calls'], 'Calls')}<Muted>{num(p['calls.connected'])} connected</Muted></td>
                      <td className="px-3 py-2 text-right">{o('onboarded', p['onboarded.onboarded'], 'Onboarded')}</td>
                      <td className="px-3 py-2 text-right">{o('bonus', p['bonus.count'], 'Bonuses')}<Muted>{usd(p['bonus.usd'])}</Muted></td>
                      <td className="px-3 py-2 text-right">{o('commission', p['commission.credits'], 'Commission', null, aed(p['commission.aed']))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>}
      </CardContent>
      {pick && <ListDialog open onClose={() => setPick(null)} title={pick.title} rows={pick.rows} columns={REPORT_COLS[pick.section]} />}
    </Card>
  );
}

/* ── Mentors pending ───────────────────────────────────────────────────── */

const MENTOR_KINDS = {
  outcomes: { title: 'Meeting outcome forms waiting', cols: [['Meeting', r => <>{r.title}<Muted>{r.category}</Muted></>, r => r.title], ['With', r => (r.attendees || []).join(', ') || '—', r => (r.attendees || []).join(' ')], ['Ended', r => day(r.endsAt)]] },
  unverified: { title: 'Classes to verify', cols: [['Class', r => r.title, r => r.title], ['Held', r => day(r.startsAt)], ['Status', r => (r.overdue ? <span className="font-medium text-rose-600">Overdue</span> : 'Waiting')]] },
  messages: { title: 'Unread student messages', cols: [['Student', r => <>{r.student || '—'}<Muted>{r.studentEmail}</Muted></>, r => `${r.student} ${r.studentEmail}`], ['Unread', r => r.unread], ['Last', r => <>{day(r.lastMessageAt)}<Muted>{r.preview}</Muted></>, r => r.preview]] },
};

export function MentorPendingPanel() {
  const [pick, setPick] = useState(null); // { kind, mentor? }
  const q = useQuery({ queryKey: ['dashboard', 'mentor-pending'], queryFn: () => fn('getDashboardMentorPending', {}), refetchInterval: 120_000, retry: false });
  const d = q.data;
  const mentors = d?.mentors || [];
  const sum = (k) => mentors.reduce((n, m) => n + (m.counts?.[k] || 0), 0);
  const rowsOf = (kind, m) => (m ? m.rows?.[kind] || [] : mentors.flatMap(x => (x.rows?.[kind] || []).map(r => ({ ...r, mentor: x.name }))));
  const colsOf = (kind, m) => (m ? MENTOR_KINDS[kind].cols : [['Mentor', r => r.mentor, r => r.mentor], ...MENTOR_KINDS[kind].cols]);
  if (q.error) return <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Mentors pending: {needsUpdate(q.error) ? 'needs the server update (the API deploy).' : q.error.message}</p>;
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b py-4"><CardTitle className="flex items-center gap-2 text-base text-brand-navy"><GraduationCap className="h-4 w-4" />Mentors pending <span className="text-sm font-normal text-slate-500">· every mentor, from the LMS</span></CardTitle></CardHeader>
      <CardContent className="space-y-4 p-4">
        {q.isLoading ? <p className="flex items-center gap-2 py-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>
          : d && !d.available ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{d.message}</p> : <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat icon={Inbox} title="Total pending" value={num(mentors.reduce((n, m) => n + (m.total || 0), 0))} hint={(() => { const n = mentors.filter(m => m.total > 0).length; return `${n} mentor${n === 1 ? '' : 's'} with something`; })()} />
              <Stat icon={ClipboardCheck} accent="amber" title="Outcome forms" value={num(sum('outcomes'))} hint="meetings over, form not filled" onClick={() => setPick({ kind: 'outcomes' })} />
              <Stat icon={BookOpenCheck} accent="rose" title="Classes to verify" value={num(sum('unverified'))} hint={`${sum('unverifiedOverdue')} overdue`} onClick={() => setPick({ kind: 'unverified' })} />
              <Stat icon={MessageSquare} accent="sky" title="Unread messages" value={num(sum('messages'))} hint={`in ${sum('chats')} chat${sum('chats') === 1 ? '' : 's'}`} onClick={() => setPick({ kind: 'messages' })} />
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <tr>{['Mentor', 'Outcome forms', 'Classes to verify', 'Unread messages', 'Total'].map(h => <th key={h} className={cn('whitespace-nowrap px-3 py-2.5 font-semibold', h !== 'Mentor' && 'text-right')}>{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {!mentors.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">No mentors.</td></tr>}
                  {mentors.map(m => (
                    <tr key={m.instructorId} className="hover:bg-slate-50">
                      <td className="px-3 py-2"><p className="font-medium text-slate-900">{m.name || m.email}</p><Muted>{m.email}{m.active ? '' : ' · switched off'}</Muted></td>
                      <td className="px-3 py-2 text-right"><Opens n={m.counts.outcomes} onOpen={() => setPick({ kind: 'outcomes', mentor: m })} className="text-amber-700" /></td>
                      <td className="px-3 py-2 text-right"><Opens n={m.counts.unverified} onOpen={() => setPick({ kind: 'unverified', mentor: m })} className="text-rose-700" />{m.counts.unverifiedOverdue ? <Muted><span className="text-rose-600">{m.counts.unverifiedOverdue} overdue</span></Muted> : null}</td>
                      <td className="px-3 py-2 text-right"><Opens n={m.counts.messages} onOpen={() => setPick({ kind: 'messages', mentor: m })} className="text-sky-700" /></td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">{num(m.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>}
      </CardContent>
      {pick && <ListDialog open onClose={() => setPick(null)} title={`${MENTOR_KINDS[pick.kind].title}${pick.mentor ? ` — ${pick.mentor.name}` : ''}`} rows={rowsOf(pick.kind, pick.mentor)} columns={colsOf(pick.kind, pick.mentor)} />}
    </Card>
  );
}
