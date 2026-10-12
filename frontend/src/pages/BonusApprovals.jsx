import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { PageTitle } from '@/components/common/PageHeader';
import { Paged, TablePagination } from '@/components/common/TablePagination';
import StatsCard from '@/components/dashboard/StatsCard';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle2, Download, Gift, Hourglass, Landmark, Loader2, Search, Undo2, XCircle } from 'lucide-react';
import { downloadExcel } from '@/components/utils/excelExport';
import { CopyText, SendBackDialog, FIELDS } from '@/components/funding/corrections';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import { createPageUrl } from '@/utils';
import { logAction } from '@/components/utils/AuditLogger';
import ProcessFundingDialog from '@/components/funding/ProcessFundingDialog';
import TagChips from '@/components/funding/TagChips';
import { PaymentDetails } from '@/components/funding/FundingRequestForm';
import { ReceiptsButton, methodsText, paymentsOf } from '@/components/funding/payments';
import { useUrlState } from '@/components/utils/urlState';

/*
 * MT5 Bonus Approvals (the user, 2026-10-04): every MT5 bonus waiting for a broker admin or a Super Admin, in one place —
 * the bonus promised at a sales close, which the student's onboarding (and the salesperson's commission) waits on, and
 * every other bonus request once Delta finance approved its payment. Approve or reject with the same box the Funding
 * Requests page uses, and the same steps after it: the audit log, then the commission credit (a sales-close bonus
 * credits nobody). A rejected sales-close bonus goes back to the student's CS, who can submit it again from Not
 * onboarded. Broker admins and Super Admins only (backend/src/functions/bonusApprovals.ts).
 *
 * MT5 Approvals (the user, 2026-10-12): pending deposits and withdrawals are here too, each row with its Type
 * (Deposit / Withdrawal / Bonus) and a Type filter, so everything going into MT5 is approved in one place — with the
 * same box and steps as Funding Requests (the commission credit for each type).
 */
const APPROVERS = ['broker_admin', 'super_admin'];
const TABS = [
  { key: 'pending', label: 'Pending', icon: Hourglass, on: 'border-amber-300 bg-amber-50 text-amber-800' },
  { key: 'approved', label: 'Approved',  icon: CheckCircle2, on: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  { key: 'rejected', label: 'Rejected',  icon: XCircle, on: 'border-rose-300 bg-rose-50 text-rose-700' },
  { key: 'returned', label: 'Sent back to CS', icon: Undo2, on: 'border-orange-300 bg-orange-50 text-orange-700' },
];
// The decision column stays at the right edge when the table scrolls sideways.
const STICKY_END = 'sticky right-0 shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.15)]';
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const usd = (t) => `$${Number(t.amount_usd || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const TYPES = {
  DEPOSIT: { label: 'Deposit', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  WITHDRAWAL: { label: 'Withdrawal', cls: 'bg-rose-50 text-rose-700 ring-rose-200' },
  BONUS: { label: 'Bonus', cls: 'bg-violet-50 text-violet-700 ring-violet-200' },
};
const typeOf = (t) => TYPES[t.type] || TYPES.BONUS;
/**
 * What the Receipt column and the approval box open (2026-10-12): the request's own receipts — or, when it has none (a
 * sales-close bonus), finance's receipt for its invoice (the student's other invoices' if it names none).
 */
/** The invoices a request is about: a sales-close bonus its own, anything else all of the student's. */
const invoicesOf = (t) => {
  const all = t.student?.invoices || [];
  const mine = t.sales_close?.invoice_number ? all.filter(f => f.invoice_number === t.sales_close.invoice_number) : [];
  return mine.length ? mine : all;
};
const financeReceiptsOf = (t) => {
  // Each payment the salesperson declared, with its own receipt (2026-10-12); else the invoice's one receipt.
  const list = invoicesOf(t).flatMap(f => (f.payments?.some(p => p.receipt_url)
    ? f.payments.filter(p => p.receipt_url).map(p => ({ method: `${f.invoice_number} · ${p.method || 'payment'}`, amount: p.amount, currency: f.currency, collected_on: p.paid_on, receipt_url: p.receipt_url, receipt_name: p.receipt_name }))
    : f.receipt_url ? [{ method: `Finance receipt · ${f.invoice_number}`, receipt_url: f.receipt_url, receipt_name: f.receipt_name }] : []));
  return list.length ? { payments: list } : null;
};
const money = (n, cur) => `${cur || 'AED'} ${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
/** "Collected AED 2,250 · tabby · recorded AED 2,250" for each invoice the request is about. */
const paidLines = (t) => invoicesOf(t).map(f => ({
  key: f.invoice_number,
  collected: f.collected != null ? money(f.collected, f.currency) + (f.collected_method ? ` · ${f.collected_method}` : '') : null,
  recorded: f.recorded != null ? money(f.recorded, f.currency) : null,
  paid: money(f.paid, f.currency), fee: money(f.fee, f.currency), balance: f.balance > 0 ? money(f.balance, f.currency) : null,
}));
const receiptTxOf = (t) => (paymentsOf(t).some(p => p.receipt_url) ? t : financeReceiptsOf(t) || t);
/** A small select for the filter bar. */
function FilterSelect({ value, onChange, options }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
/**
 * The export (2026-10-12): the rows shown — tab, filters, search and order — with the Funding Requests export's
 * columns (but Added by) and what this page adds. Excel keeps dates as dates and amounts as numbers.
 */
const EXPORT_COLUMNS = [
  { header: 'Requested', type: 'datetime', value: t => t.resubmitted_at || t.requested_at || t.created_date },
  { header: 'Type', value: t => typeOf(t).label },
  { header: 'Status', value: t => (t.returned?.at ? 'SENT BACK' : t.status) },
  { header: 'Student', value: t => t.student?.full_name || t.student_name },
  { header: 'Email', value: t => t.student?.email },
  { header: 'Code', value: t => t.student?.student_code || t.student_code },
  { header: 'Level', value: t => (t.student?.level === 'LEVEL_2' ? 'Level 2' : t.student?.level ? 'Level 1' : '') },
  { header: 'CS', value: t => t.student?.cs || t.primary_mentor_name },
  { header: 'Team', value: t => t.student?.team },
  { header: 'Meeting by', value: t => t.meeting_mentor_name },
  { header: 'MT5 login', value: t => t.mt5_login },
  { header: 'Amount to credit USD', type: 'number', value: t => Number(t.amount_usd) || 0 },
  { header: 'Original amount', value: t => original(t) },
  { header: 'Collected by counsellor', value: t => paidLines(t).map(l => l.collected || `Paid ${l.paid}`).join('; ') },
  { header: 'Recorded against invoice', value: t => paidLines(t).map(l => l.recorded || '').filter(Boolean).join('; ') },
  { header: 'Payment', value: t => methodsText(t) },
  { header: 'Product', value: t => [...(t.tags || []), ...(t.course && !(t.tags || []).includes(t.course) ? [t.course] : [])].join('; ') },
  { header: 'LMS courses now', width: 40, value: t => (t.student?.lms_courses || []).map(c => `${c.title} (${c.status === 'active' ? `${Math.round(c.progress)}%` : c.status})`).join('; ') },
  { header: 'Finance invoices', width: 40, value: t => [t.sales_close?.invoice_number, ...(t.student?.invoices || []).filter(f => f.invoice_number !== t.sales_close?.invoice_number).map(f => `${f.invoice_number} ${f.currency} ${f.fee}${f.balance > 0 ? ` owes ${f.balance}` : ''}`)].filter(Boolean).join('; ') },
  { header: 'Source', value: t => (t.source === 'sales_close' ? 'Sales close' : t.source === 'course_upgrade' ? 'Course upgrade' : 'Request') },
  { header: 'Sold by', value: t => (t.source === 'sales_close' ? (t.student?.closed_by || []).map(c => c.name).join('; ') : '') },
  { header: 'User ID', value: t => t.user_id },
  { header: 'Txn ID', value: t => t.transaction_id },
  { header: 'Welcome', value: t => (t.student?.onboarded ? 'Sent' : 'Not yet') },
  { header: 'Decided by', value: t => t.approved_by_name },
  { header: 'Decided at', type: 'datetime', value: t => t.approved_at },
  { header: 'Rejection reason', width: 30, value: t => t.rejection_reason },
  { header: 'Sent back / corrected', width: 40, value: t => (t.returned?.at ? `Sent back by ${t.returned.by_name}: ${(t.returned.fields || []).join(', ')}${t.returned.note ? ` — ${t.returned.note}` : ''}` : t.corrected?.at ? `Corrected by ${t.corrected.by_name}${t.corrected.changed?.length ? `: ${t.corrected.changed.join(', ')}` : ''}` : '') },
];
const csvCell = (v) => { const x = v == null ? '' : String(v); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };

const STATUS_CLS = {
  PENDING: 'border-amber-200 bg-amber-50 text-amber-700', APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  REJECTED: 'border-rose-200 bg-rose-50 text-rose-700', RETURNED: 'border-orange-200 bg-orange-50 text-orange-700',
};
const original = (t) => (t.amount_currency && t.amount_currency !== 'USD' && t.amount_original
  ? `${t.amount_currency} ${Number(t.amount_original).toLocaleString('en-US')}` : '');

export default function BonusApprovals() {
  const queryClient = useQueryClient();
  const { data: currentUser } = useQuery({ queryKey: ['me-effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()) });
  const allowed = APPROVERS.includes(currentUser?.app_role);
  // The date range is asked of the server (decided ones before this month), so it is read before the list.
  const [from, setFrom] = useUrlState('from', '');
  const [to, setTo] = useUrlState('to', '');
  const { data, isLoading, error } = useQuery({
    queryKey: ['bonus-approvals', from, to],
    queryFn: async () => (await base44.functions.invoke('getBonusApprovals', { ...(from ? { from } : {}), ...(to ? { to } : {}) })).data,
    enabled: !!currentUser && allowed,
    refetchInterval: 60_000,
  });
  const [tab, setTab] = useState('pending');
  const [q, setQ] = useState('');
  const [type, setType] = useUrlState('type', 'all');
  // Filters and sorting, kept in the address (2026-10-12): the date range (requested — and, for Approved / Rejected,
  // decided — UAE days), the CS, where it came from, MT5 and email there or missing, the welcome, and the order.
  const [csF, setCsF] = useUrlState('cs', 'all');
  const [source, setSource] = useUrlState('source', 'all');
  const [mt5F, setMt5F] = useUrlState('mt5', 'all');
  const [emailF, setEmailF] = useUrlState('email', 'all');
  const [welcomeF, setWelcomeF] = useUrlState('welcome', 'all');
  const [sort, setSort] = useUrlState('sort', 'oldest');
  const anyFilter = from || to || csF !== 'all' || source !== 'all' || mt5F !== 'all' || emailF !== 'all' || welcomeF !== 'all';
  const clearFilters = () => { setFrom(''); setTo(''); setCsF('all'); setSource('all'); setMt5F('all'); setEmailF('all'); setWelcomeF('all'); };
  const [deciding, setDeciding] = useState(null);
  const [sendingBack, setSendingBack] = useState(null);
  const [exporting, setExporting] = useState(false);

  // The same as the Funding Requests page: the decision, the audit log, then the commission credit.
  const decide = useMutation({
    mutationFn: async ({ id, data: change }) => {
      const result = await base44.entities.FundingTransaction.update(id, change);
      const action = change.status === 'APPROVED' ? 'approve_funding_transaction' : 'reject_funding_transaction';
      await logAction(action, 'FundingTransaction', id, `${change.status} transaction for ${change.student_name}`, null, change);
      if (change.status === 'APPROVED' && ['BONUS', 'DEPOSIT', 'WITHDRAWAL'].includes(result?.type)) {
        try { await base44.functions.invoke('creditCommission', { transaction_id: id }); }
        catch (e) { console.error('commission credit failed', e); }
      }
      return result;
    },
    onSuccess: (result, { data: change }) => {
      queryClient.invalidateQueries({ queryKey: ['bonus-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['nav-counts'] });
      queryClient.invalidateQueries({ queryKey: ['funding-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
      setDeciding(null);
      const what = (TYPES[result?.type] || TYPES.BONUS).label;
      toast.success(change.status === 'APPROVED' ? `${what} approved` : result?.type === 'BONUS' ? 'Bonus rejected — their CS can submit it again' : `${what} rejected`);
    },
    onError: (e) => toast.error(e?.message || 'Could not save the decision'),
  });
  const onProcess = (formData) => decide.mutate({
    id: deciding.id,
    data: { ...formData, approved_by_id: currentUser.id, approved_by_name: currentUser.full_name, approved_at: new Date().toISOString() },
  });

  const needle = q.trim().toLowerCase();
  const csOptions = useMemo(() => [...new Set(['pending', 'approved', 'rejected', 'returned'].flatMap(k => (data?.[k] || []).map(t => t.student?.cs || t.primary_mentor_name)).filter(Boolean))].sort(), [data]);
  const dayOf = (iso) => (iso ? new Date(new Date(iso).getTime() + 4 * 3_600_000).toISOString().slice(0, 10) : '');   // UAE day
  const rows = useMemo(() => {
    const out = (data?.[tab] || []).filter(t => {
      if (type !== 'all' && t.type !== type) return false;
      if (needle && ![t.student?.full_name, t.student?.student_code, t.student?.email, t.student?.cs, t.mt5_login, t.course, t.student_name, t.transaction_id, t.user_id, t.sales_close?.invoice_number, ...(t.student?.invoices || []).map(f => f.invoice_number), ...(t.student?.closed_by || []).map(c => c.name)]
        .some(v => String(v || '').toLowerCase().includes(needle))) return false;
      // The date range: when it was requested (Approved / Rejected are already that range's decisions, from the server).
      if (tab === 'pending' || tab === 'returned') {
        const d = dayOf(t.resubmitted_at || t.requested_at || t.created_date);
        if ((from && d < from) || (to && d > to)) return false;
      }
      if (csF !== 'all' && (t.student?.cs || t.primary_mentor_name) !== csF) return false;
      if (source !== 'all' && t.source !== source) return false;
      if (mt5F !== 'all' && (mt5F === 'has') !== !!t.mt5_login) return false;
      if (emailF !== 'all' && (emailF === 'has') !== !!t.student?.email) return false;
      if (welcomeF !== 'all' && (welcomeF === 'sent') !== !!t.student?.onboarded) return false;
      return true;
    });
    const at = (t) => String(tab === 'pending' || tab === 'returned' ? (t.resubmitted_at || t.requested_at || t.created_date || '') : (t.approved_at || ''));
    const by = {
      oldest: (a, b) => at(a).localeCompare(at(b)),
      newest: (a, b) => at(b).localeCompare(at(a)),
      amount_high: (a, b) => (Number(b.amount_usd) || 0) - (Number(a.amount_usd) || 0),
      amount_low: (a, b) => (Number(a.amount_usd) || 0) - (Number(b.amount_usd) || 0),
      student: (a, b) => String(a.student?.full_name || a.student_name || '').localeCompare(String(b.student?.full_name || b.student_name || '')),
      cs: (a, b) => String(a.student?.cs || a.primary_mentor_name || '').localeCompare(String(b.student?.cs || b.primary_mentor_name || '')),
    }[sort];
    // Pending keeps corrected ones first whatever the order — they were waiting already.
    return by ? [...out].sort((a, b) => (tab === 'pending' ? (b.corrected?.at ? 1 : 0) - (a.corrected?.at ? 1 : 0) : 0) || by(a, b)) : out;
  }, [data, tab, needle, type, from, to, csF, source, mt5F, emailF, welcomeF, sort]);

  const fileName = (ext) => `mt5_approvals_${tab}_${new Date().toISOString().slice(0, 10)}.${ext}`;
  const exportCsv = () => {
    if (!rows.length) { toast.error('Nothing to export'); return; }
    const text = [EXPORT_COLUMNS.map(c => csvCell(c.header)).join(','),
      ...rows.map(t => EXPORT_COLUMNS.map(c => { const v = c.value(t); return csvCell(c.type === 'datetime' && v ? new Date(v).toLocaleString('en-GB') : v); }).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: fileName('csv') });
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'}`);
  };
  const exportExcel = async () => {
    if (!rows.length) { toast.error('Nothing to export'); return; }
    setExporting(true);
    try {
      await downloadExcel({ fileName: fileName('xlsx'), sheet: 'MT5 Approvals', columns: EXPORT_COLUMNS, rows: rows.map(t => EXPORT_COLUMNS.map(c => c.value(t))) });
      toast.success(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error(e?.message || "The export didn't work");
    } finally {
      setExporting(false);
    }
  };

  if (currentUser && !allowed) {
    return (
      <div className="min-h-screen p-6">
        <p className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          MT5 deposits, withdrawals and bonuses are approved by broker admins and Super Admins.
        </p>
      </div>
    );
  }

  const TH = ({ children }) => <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">{children}</th>;

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PageTitle eyebrow="Funding" icon={Gift}>MT5 Approvals</PageTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length} className="border-green-600 text-green-700 hover:bg-green-50"><Download className="mr-1.5 h-4 w-4" />CSV</Button>
              <Button variant="outline" size="sm" onClick={exportExcel} disabled={!rows.length || exporting} className="border-green-600 text-green-700 hover:bg-green-50">
                {exporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}Excel
              </Button>
            </div>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
            Every deposit, withdrawal and bonus waiting for a broker admin, in one place — the Type column says which. Bonuses: the bonus promised at a sales close — the student is onboarded, and the salesperson's commission counts, only once it's approved — and other bonus requests once finance has approved their payment. Credit the bonus in MT5, then approve it with the transaction ID. A rejected sales-close bonus goes back to the student's CS to submit again.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatsCard title="Waiting for you" value={data?.counts?.pending ?? 0} icon={Hourglass} color="amber" delay={0.02} />
          <StatsCard title={from || to ? 'Approved in those dates' : 'Approved this month'} value={data?.counts?.approved ?? 0} icon={CheckCircle2} color="emerald" delay={0.05} />
          <StatsCard title={from || to ? 'Rejected in those dates' : 'Rejected this month'} value={data?.counts?.rejected ?? 0} icon={XCircle} color="red" delay={0.08} />
          <StatsCard title="Still with finance" value={data?.counts?.with_finance ?? 0} icon={Landmark} color="blue" delay={0.11} />
        </div>

        <div className="flex flex-wrap gap-2">
          {TABS.map(({ key, label, icon: Icon, on }) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${tab === key ? on : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              <Icon className="h-4 w-4" />{label}
              <span className="rounded-full bg-white/70 px-1.5 text-xs font-semibold">{type === 'all' ? (data?.counts?.[key] ?? 0) : (data?.counts?.by_type?.[type]?.[key] ?? 0)}</span>
            </button>
          ))}
        </div>

        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row flex-wrap items-center gap-3 space-y-0 border-b">
            <div className="flex rounded-md border bg-white p-0.5 text-xs" role="group" aria-label="Type">
              {[['all', 'All types'], ...Object.entries(TYPES).map(([k, v]) => [k, v.label])].map(([k, l]) => (
                <button key={k} type="button" onClick={() => setType(k)}
                  className={`rounded px-2.5 py-1.5 font-medium ${type === k ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                  {l}{k !== 'all' && data?.counts?.by_type?.[k]?.[tab] ? <span className="ml-1 opacity-70">{data.counts.by_type[k][tab]}</span> : null}
                </button>
              ))}
            </div>
            <div className="relative w-fit">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Student, email, CS, MT5, invoice, seller…" className="h-9 w-72 pl-9" />
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500">{tab === 'approved' || tab === 'rejected' ? 'Decided' : 'Requested'}</span>
              <Input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} className="h-8 w-36 text-xs" aria-label="From" />
              <span className="text-slate-400">to</span>
              <Input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} className="h-8 w-36 text-xs" aria-label="To" />
              <FilterSelect value={csF} onChange={setCsF} options={[['all', 'All CSs'], ...csOptions.map(c => [c, c])]} />
              <FilterSelect value={source} onChange={setSource} options={[['all', 'Any source'], ['sales_close', 'Sales close'], ['course_upgrade', 'Course upgrade'], ['request', 'Request']]} />
              <FilterSelect value={mt5F} onChange={setMt5F} options={[['all', 'MT5: any'], ['has', 'MT5 given'], ['none', 'No MT5 login']]} />
              <FilterSelect value={emailF} onChange={setEmailF} options={[['all', 'Email: any'], ['has', 'Has an email'], ['none', 'No email']]} />
              <FilterSelect value={welcomeF} onChange={setWelcomeF} options={[['all', 'Welcome: any'], ['sent', 'Welcome sent'], ['not', 'Welcome not sent']]} />
              <FilterSelect value={sort} onChange={setSort} options={[['oldest', 'Oldest first'], ['newest', 'Newest first'], ['amount_high', 'Amount: high → low'], ['amount_low', 'Amount: low → high'], ['student', 'Student A → Z'], ['cs', 'CS A → Z']]} />
              {anyFilter && <button type="button" onClick={clearFilters} className="text-brand-navy underline">Clear filters</button>}
              <span className="ml-auto text-slate-400">{rows.length} shown{!from && !to && (tab === 'approved' || tab === 'rejected') ? ' · this month — pick dates for earlier' : ''}</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading || !currentUser ? (
              <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
            ) : error ? (
              <p className="py-12 text-center text-sm text-rose-600">{error.message || 'Could not load the approvals'}</p>
            ) : rows.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-400">
                {(data?.[tab] || []).length ? 'Nothing matches the search.'
                  : tab === 'pending' ? 'Nothing is waiting for approval.' : tab === 'approved' ? 'Nothing approved this month yet.' : tab === 'returned' ? 'Nothing is with a CS for correction.' : 'Nothing rejected this month.'}
              </p>
            ) : (
              <Paged items={rows} resetKey={`${tab}|${needle}|${type}|${from}|${to}|${csF}|${source}|${mt5F}|${emailF}|${welcomeF}|${sort}`}>
                {(pageRows, bar) => (<>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-slate-50/80">
                          {/* The Funding Requests page's columns (but Added by), and what matters for an MT5 credit (2026-10-12) */}
                          <TH>Requested</TH><TH>Type</TH><TH>Status</TH><TH>Student</TH><TH>CS</TH><TH>Meeting by</TH><TH>MT5 login</TH>
                          <TH>Amount to credit</TH><TH>Paid by the student</TH><TH>Payment</TH><TH>Product</TH><TH>LMS courses now</TH><TH>Finance invoice</TH><TH>From · sold by</TH>
                          <TH>User ID</TH><TH>Txn ID</TH><TH>Receipt</TH><TH>Welcome</TH>
                          <th className={`${STICKY_END} whitespace-nowrap bg-slate-50 px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500`}>
                            {tab === 'pending' ? '' : tab === 'returned' ? 'Sent back' : 'Decided'}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map(t => (
                          <tr key={t.id} className="group border-b border-slate-100 align-top hover:bg-slate-50">
                            <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-600">
                              {when(t.resubmitted_at || t.requested_at || t.created_date)}
                              {t.resubmit_count ? <div className="text-[11px] text-slate-400">Submitted again{t.resubmit_count > 1 ? ` ×${t.resubmit_count}` : ''}</div> : null}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5">
                              <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${typeOf(t).cls}`}>{typeOf(t).label}</span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5">
                              <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLS[t.returned?.at ? 'RETURNED' : t.status] || STATUS_CLS.PENDING}`}>
                                {t.returned?.at ? 'SENT BACK' : t.status}
                              </span>
                              {t.finance_approval?.decision === 'approved' && <div className="mt-0.5 text-[11px] text-slate-400">Finance approved</div>}
                            </td>
                            <td className="min-w-[200px] px-3 py-2.5">
                              {t.student
                                ? <Link to={`${createPageUrl('StudentDetail')}?id=${t.student.id}`} className="font-medium text-slate-900 hover:text-blue-600">{t.student.full_name || t.student_name || 'Student'}</Link>
                                : <span className="font-medium text-slate-900">{t.student_name || 'Student'}</span>}
                              <div className="font-mono text-xs text-slate-400">
                                {t.student?.student_code || t.student_code}
                                {t.student?.level && <span className="ml-1.5 font-sans">· {t.student.level === 'LEVEL_2' ? 'Level 2' : 'Level 1'}</span>}
                              </div>
                              {/* Their email — to check the MT5 account is theirs before crediting (2026-10-12) */}
                              <CopyText text={t.student?.email} className="mt-0.5" />
                              {t.corrected?.at && <div className="mt-1 text-[11px] font-medium text-emerald-700">Corrected by {t.corrected.by_name}{t.corrected.changed?.length ? ` — ${t.corrected.changed.join(', ')}` : ''}{t.corrected.note ? ` (“${t.corrected.note}”)` : ''}</div>}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5">
                              <div className="text-slate-700">{t.student?.cs || t.primary_mentor_name || <span className="text-slate-400">No CS</span>}</div>
                              {t.student?.team && <div className="text-xs text-slate-400">{t.student.team}</div>}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">{t.meeting_mentor_name || '—'}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 font-mono text-sm text-slate-700">{t.mt5_login || <span className="font-sans text-xs text-rose-600">No MT5 login</span>}</td>
                            <td className="whitespace-nowrap px-3 py-2.5">
                              <div className="font-semibold text-slate-800">{usd(t)}</div>
                              {original(t) && <div className="text-xs text-slate-400">{original(t)}</div>}
                              <PaymentDetails tx={t} />
                            </td>
                            {/* What the student paid — the counsellor's collection and what accounts recorded — beside the bonus, never mixed */}
                            <td className="min-w-[180px] px-3 py-2.5 text-xs">
                              {paidLines(t).length ? paidLines(t).map(l => (
                                <div key={l.key} className="mb-1 last:mb-0">
                                  {paidLines(t).length > 1 && <div className="font-mono text-[11px] text-slate-400">{l.key}</div>}
                                  {l.collected ? <div className="text-slate-800">Collected by counsellor <b>{l.collected}</b></div> : <div className="text-slate-800">Paid <b>{l.paid}</b></div>}
                                  {l.recorded && <div className="text-slate-500">Recorded {l.recorded}</div>}
                                  <div className="text-slate-400">of {l.fee}{l.balance ? <span className="text-amber-700"> · owes {l.balance}</span> : ''}</div>
                                </div>
                              )) : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">{methodsText(t) || '—'}</td>
                            <td className="min-w-[140px] px-3 py-2.5">
                              {t.tags?.length ? <TagChips tags={t.tags} /> : null}
                              {t.course && (!t.tags?.length || !t.tags.includes(t.course)) && <div className="mt-0.5 max-w-[220px] text-xs text-slate-500">{t.course}</div>}
                              {!t.tags?.length && !t.course && <span className="text-slate-300">—</span>}
                            </td>
                            <td className="min-w-[180px] px-3 py-2.5 text-xs">
                              {t.student?.lms_courses?.length ? t.student.lms_courses.map((c) => (
                                <div key={c.title} className="text-slate-700">{c.title}<span className="text-slate-400"> · {c.status === 'active' ? `${Math.round(c.progress)}%` : c.status}</span></div>
                              )) : <span className="text-slate-400">Not on an LMS course</span>}
                            </td>
                            <td className="min-w-[160px] px-3 py-2.5 text-xs">
                              {t.sales_close?.invoice_number && <div className="font-mono font-medium text-slate-800">{t.sales_close.invoice_number}</div>}
                              {(t.student?.invoices || []).filter(f => f.invoice_number !== t.sales_close?.invoice_number).map((f) => (
                                <div key={f.invoice_number} className="text-slate-600"><span className="font-mono">{f.invoice_number}</span> · {f.currency} {Number(f.fee).toLocaleString('en-US')}{f.balance > 0 ? <span className="text-amber-700"> · owes {Number(f.balance).toLocaleString('en-US')}</span> : ''}</div>
                              ))}
                              {!t.sales_close?.invoice_number && !t.student?.invoices?.length && <span className="text-slate-300">—</span>}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5">
                              <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.source === 'sales_close' ? 'bg-violet-50 text-violet-700' : t.source === 'course_upgrade' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700'}`}>
                                {t.source === 'sales_close' ? 'Sales close' : t.source === 'course_upgrade' ? 'Course upgrade' : `${typeOf(t).label} request`}
                              </span>
                              {/* Who sold it — for a sales-close bonus (the student's closer in the sales CRM) */}
                              {t.source === 'sales_close' && t.student?.closed_by?.length > 0 && (
                                <div className="mt-0.5 text-xs text-slate-700">Sold by {t.student.closed_by.map(c => c.name).join(', ')}</div>
                              )}
                              {t.source === 'course_upgrade' && <div className="mt-0.5 text-[11px] text-slate-400">Payment approved by finance</div>}
                              {(t.resubmitted_by_name || t.requested_by_name) && <div className="mt-0.5 text-[11px] text-slate-400">{t.resubmitted_by_name || t.requested_by_name}</div>}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">{t.user_id || '—'}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 font-mono text-sm text-slate-600">{t.transaction_id || '—'}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-sm">
                              <ReceiptsButton tx={receiptTxOf(t)} title={t.student?.full_name || t.student_name} />
                              {receiptTxOf(t) !== t && <div className="mt-0.5 text-[11px] text-slate-400">from finance</div>}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-xs">
                              {t.student?.onboarded
                                ? <span className="text-emerald-700">Sent {when(t.student.onboarded_at)}</span>
                                : <span className="text-amber-700">Not yet</span>}
                            </td>
                            <td className={`${STICKY_END} whitespace-nowrap bg-white px-3 py-2.5 group-hover:bg-slate-50`}>
                              {tab === 'pending' ? (
                                <div className="flex flex-col items-stretch gap-1.5">
                                  <Button size="sm" onClick={() => setDeciding(t)}>Approve / Reject</Button>
                                  <Button size="sm" variant="outline" onClick={() => setSendingBack(t)}><Undo2 className="mr-1.5 h-3.5 w-3.5" />Send back to CS</Button>
                                </div>
                              ) : tab === 'returned' ? (
                                <div className="max-w-[240px] whitespace-normal text-xs">
                                  <div className="text-orange-700">Sent back {when(t.returned?.at)} by {t.returned?.by_name}</div>
                                  <div className="text-slate-500">{(t.returned?.fields || []).map(f => FIELDS[f] || f).join(', ')}{t.returned?.note ? ` — “${t.returned.note}”` : ''}</div>
                                  <div className="text-slate-400">Waiting for the CS to correct it</div>
                                </div>
                              ) : (
                                <div className="text-xs">
                                  <div className="text-slate-600">{when(t.approved_at)}</div>
                                  <div className="text-slate-400">{t.approved_by_name || ''}</div>
                                  {tab === 'rejected' && t.rejection_reason && <div className="mt-0.5 max-w-[220px] whitespace-normal text-rose-700">{t.rejection_reason}</div>}
                                  {tab === 'approved' && t.transaction_id && <div className="font-mono text-slate-400">{t.transaction_id}</div>}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <TablePagination {...bar} />
                </>)}
              </Paged>
            )}
          </CardContent>
        </Card>
      </div>

      {sendingBack && <SendBackDialog tx={sendingBack} onClose={() => setSendingBack(null)} />}
      <ProcessFundingDialog
        extraReceipts={deciding ? financeReceiptsOf(deciding) : null}
        transaction={deciding}
        currentUser={currentUser}
        open={!!deciding}
        onClose={() => setDeciding(null)}
        onProcess={onProcess}
      />
    </div>
  );
}
