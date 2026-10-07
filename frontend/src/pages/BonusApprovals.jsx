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
import { CheckCircle2, Gift, Hourglass, Landmark, Search, XCircle } from 'lucide-react';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import { createPageUrl } from '@/utils';
import { logAction } from '@/components/utils/AuditLogger';
import ProcessFundingDialog from '@/components/funding/ProcessFundingDialog';

/*
 * MT5 Bonus Approvals (the user, 2026-10-04): every MT5 bonus waiting for a broker admin or a Super Admin, in one place —
 * the bonus promised at a sales close, which the student's onboarding (and the salesperson's commission) waits on, and
 * every other bonus request once Delta finance approved its payment. Approve or reject with the same box the Funding
 * Requests page uses, and the same steps after it: the audit log, then the commission credit (a sales-close bonus
 * credits nobody). A rejected sales-close bonus goes back to the student's CS, who can submit it again from Not
 * onboarded. Broker admins and Super Admins only (backend/src/functions/bonusApprovals.ts).
 */
const APPROVERS = ['broker_admin', 'super_admin'];
const TABS = [
  { key: 'pending', label: 'Pending', icon: Hourglass, on: 'border-amber-300 bg-amber-50 text-amber-800' },
  { key: 'approved', label: 'Approved this month', icon: CheckCircle2, on: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  { key: 'rejected', label: 'Rejected this month', icon: XCircle, on: 'border-rose-300 bg-rose-50 text-rose-700' },
];
// The decision column stays at the right edge when the table scrolls sideways.
const STICKY_END = 'sticky right-0 shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.15)]';
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const usd = (t) => `$${Number(t.amount_usd || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const original = (t) => (t.amount_currency && t.amount_currency !== 'USD' && t.amount_original
  ? `${t.amount_currency} ${Number(t.amount_original).toLocaleString('en-US')}` : '');

export default function BonusApprovals() {
  const queryClient = useQueryClient();
  const { data: currentUser } = useQuery({ queryKey: ['me-effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()) });
  const allowed = APPROVERS.includes(currentUser?.app_role);
  const { data, isLoading, error } = useQuery({
    queryKey: ['bonus-approvals'],
    queryFn: async () => (await base44.functions.invoke('getBonusApprovals', {})).data,
    enabled: !!currentUser && allowed,
    refetchInterval: 60_000,
  });
  const [tab, setTab] = useState('pending');
  const [q, setQ] = useState('');
  const [deciding, setDeciding] = useState(null);

  // The same as the Funding Requests page: the decision, the audit log, then the commission credit.
  const decide = useMutation({
    mutationFn: async ({ id, data: change }) => {
      const result = await base44.entities.FundingTransaction.update(id, change);
      const action = change.status === 'APPROVED' ? 'approve_funding_transaction' : 'reject_funding_transaction';
      await logAction(action, 'FundingTransaction', id, `${change.status} transaction for ${change.student_name}`, null, change);
      if (change.status === 'APPROVED' && result?.type === 'BONUS') {
        try { await base44.functions.invoke('creditCommission', { transaction_id: id }); }
        catch (e) { console.error('commission credit failed', e); }
      }
      return result;
    },
    onSuccess: (_r, { data: change }) => {
      queryClient.invalidateQueries({ queryKey: ['bonus-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['nav-counts'] });
      queryClient.invalidateQueries({ queryKey: ['funding-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
      setDeciding(null);
      toast.success(change.status === 'APPROVED' ? 'Bonus approved' : 'Bonus rejected — their CS can submit it again');
    },
    onError: (e) => toast.error(e?.message || 'Could not save the decision'),
  });
  const onProcess = (formData) => decide.mutate({
    id: deciding.id,
    data: { ...formData, approved_by_id: currentUser.id, approved_by_name: currentUser.full_name, approved_at: new Date().toISOString() },
  });

  const needle = q.trim().toLowerCase();
  const rows = useMemo(
    () => (data?.[tab] || []).filter(t => !needle || [t.student?.full_name, t.student?.student_code, t.student?.cs, t.mt5_login, t.course, t.student_name]
      .some(v => String(v || '').toLowerCase().includes(needle))),
    [data, tab, needle],
  );

  if (currentUser && !allowed) {
    return (
      <div className="min-h-screen p-6">
        <p className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          MT5 bonuses are approved by broker admins and Super Admins.
        </p>
      </div>
    );
  }

  const TH = ({ children }) => <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">{children}</th>;

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div>
          <PageTitle eyebrow="Funding" icon={Gift}>MT5 Bonus Approvals</PageTitle>
          <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
            Every MT5 bonus waiting for a broker admin: the bonus promised at a sales close — the student is onboarded, and the salesperson's commission counts, only once it's approved — and other bonus requests once finance has approved their payment. Credit the bonus in MT5, then approve it with the transaction ID. A rejected sales-close bonus goes back to the student's CS to submit again.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatsCard title="Waiting for you" value={data?.counts?.pending ?? 0} icon={Hourglass} color="amber" delay={0.02} />
          <StatsCard title="Approved this month" value={data?.counts?.approved ?? 0} icon={CheckCircle2} color="emerald" delay={0.05} />
          <StatsCard title="Rejected this month" value={data?.counts?.rejected ?? 0} icon={XCircle} color="red" delay={0.08} />
          <StatsCard title="Still with finance" value={data?.counts?.with_finance ?? 0} icon={Landmark} color="blue" delay={0.11} />
        </div>

        <div className="flex flex-wrap gap-2">
          {TABS.map(({ key, label, icon: Icon, on }) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${tab === key ? on : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              <Icon className="h-4 w-4" />{label}
              <span className="rounded-full bg-white/70 px-1.5 text-xs font-semibold">{data?.counts?.[key] ?? 0}</span>
            </button>
          ))}
        </div>

        <Card className="overflow-hidden">
          <CardHeader className="border-b">
            <div className="relative w-fit">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Student, code, CS, MT5, course…" className="h-9 w-72 pl-9" />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading || !currentUser ? (
              <p className="py-12 text-center text-sm text-slate-400">Loading bonuses…</p>
            ) : error ? (
              <p className="py-12 text-center text-sm text-rose-600">{error.message || 'Could not load the bonuses'}</p>
            ) : rows.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-400">
                {(data?.[tab] || []).length ? 'Nothing matches the search.'
                  : tab === 'pending' ? 'No MT5 bonus is waiting for approval.' : tab === 'approved' ? 'No bonus approved this month yet.' : 'No bonus rejected this month.'}
              </p>
            ) : (
              <Paged items={rows} resetKey={`${tab}|${needle}`}>
                {(pageRows, bar) => (<>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-slate-50/80">
                          <TH>Student</TH><TH>CS</TH><TH>Bonus · MT5</TH><TH>From</TH><TH>Welcome</TH>
                          <th className={`${STICKY_END} whitespace-nowrap bg-slate-50 px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500`}>
                            {tab === 'pending' ? '' : 'Decided'}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map(t => (
                          <tr key={t.id} className="group border-b border-slate-100 align-top hover:bg-slate-50">
                            <td className="min-w-[180px] px-3 py-2.5">
                              {t.student
                                ? <Link to={`${createPageUrl('StudentDetail')}?id=${t.student.id}`} className="font-medium text-slate-900 hover:text-blue-600">{t.student.full_name || t.student_name || 'Student'}</Link>
                                : <span className="font-medium text-slate-900">{t.student_name || 'Student'}</span>}
                              <div className="font-mono text-xs text-slate-400">{t.student?.student_code || t.student_code}</div>
                              {t.course && <div className="mt-0.5 max-w-[240px] text-xs text-slate-500">{t.course}{t.sales_close?.invoice_number ? ` · ${t.sales_close.invoice_number}` : ''}</div>}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5">
                              <div className="text-slate-700">{t.student?.cs || t.primary_mentor_name || <span className="text-slate-400">No CS</span>}</div>
                              {t.student?.team && <div className="text-xs text-slate-400">{t.student.team}</div>}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5">
                              <div className="font-semibold text-slate-800">{usd(t)}</div>
                              {original(t) && <div className="text-xs text-slate-400">{original(t)}</div>}
                              <div className="mt-0.5 font-mono text-xs text-slate-600">{t.mt5_login ? `MT5 ${t.mt5_login}` : 'No MT5 login'}</div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5">
                              <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.source === 'sales_close' ? 'bg-violet-50 text-violet-700' : t.source === 'course_upgrade' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700'}`}>
                                {t.source === 'sales_close' ? 'Sales close' : t.source === 'course_upgrade' ? 'Course upgrade' : 'Bonus request'}
                              </span>
                              {t.source === 'course_upgrade' && <div className="mt-0.5 text-[11px] text-slate-400">Payment approved by finance</div>}
                              {t.source === 'request' && t.finance_approval?.decision === 'approved' && (
                                <div className="mt-0.5 text-[11px] text-slate-400">Finance approved</div>
                              )}
                              {t.resubmit_count ? <div className="mt-0.5 text-[11px] text-slate-400">Submitted again{t.resubmit_count > 1 ? ` ×${t.resubmit_count}` : ''}</div> : null}
                              <div className="mt-0.5 text-xs text-slate-500">
                                {when(t.resubmitted_at || t.requested_at || t.created_date)}
                                {(t.resubmitted_by_name || t.requested_by_name) && <span className="text-slate-400"> · {t.resubmitted_by_name || t.requested_by_name}</span>}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-xs">
                              {t.student?.onboarded
                                ? <span className="text-emerald-700">Sent {when(t.student.onboarded_at)}</span>
                                : <span className="text-amber-700">Not yet</span>}
                            </td>
                            <td className={`${STICKY_END} whitespace-nowrap bg-white px-3 py-2.5 group-hover:bg-slate-50`}>
                              {tab === 'pending' ? (
                                <Button size="sm" onClick={() => setDeciding(t)}>Approve / Reject</Button>
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

      <ProcessFundingDialog
        transaction={deciding}
        currentUser={currentUser}
        open={!!deciding}
        onClose={() => setDeciding(null)}
        onProcess={onProcess}
      />
    </div>
  );
}
