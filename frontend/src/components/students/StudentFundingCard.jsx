import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Paged, TablePagination } from '@/components/common/TablePagination';
import { Eye, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import TagChips from '@/components/funding/TagChips';
import { PaymentDetails } from '@/components/funding/FundingRequestForm';
import { useFinanceLink, WithAccountsBadge, FinanceApprovalNote } from '@/components/funding/FinanceApproval';
import { isWithAccounts } from '@/components/utils/FundingAccessControl';

/* ────────────────────────────────────────────────────────────────────────────
   A student's funding requests, every one (the user, 2026-10-05): deposits,
   withdrawals and bonuses — the sales-close bonus credits too — pending,
   approved and rejected, with what each came with: the product, the MT5 login,
   the receipt, who raised it, and why one was turned down. The totals are the
   approved deposits and withdrawals, as before.
──────────────────────────────────────────────────────────────────────────── */

const STATUSES = { all: 'All', PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected' };
const TYPES = { all: 'Every type', DEPOSIT: 'Deposits', WITHDRAWAL: 'Withdrawals', BONUS: 'Bonuses' };
const TYPE_STYLE = {
  DEPOSIT: 'bg-blue-50 text-blue-700 border-blue-200',
  WITHDRAWAL: 'bg-purple-50 text-purple-700 border-purple-200',
  BONUS: 'bg-amber-50 text-amber-800 border-amber-200',
};
const STATUS_STYLE = {
  PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
  APPROVED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  REJECTED: 'bg-red-100 text-red-800 border-red-200',
};
const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const typeLabel = (t) => (t.bonus_credit ? 'Bonus credit' : t.type === 'DEPOSIT' ? 'Deposit' : t.type === 'WITHDRAWAL' ? 'Withdrawal' : t.type === 'BONUS' ? 'Bonus' : t.type);

/** Who raised it — their CS, the senior mentor or a co-mentor, said so. */
function AddedBy({ txn, student }) {
  if (!txn.initiating_mentor_name) return <span className="text-gray-400">-</span>;
  let co = [];
  try { co = typeof student.co_mentors_details === 'string' ? JSON.parse(student.co_mentors_details) : student.co_mentors_details || []; } catch { co = []; }
  const role = txn.initiating_mentor_id === student.primary_mentor_id ? 'Primary'
    : txn.initiating_mentor_id === student.senior_mentor_id ? 'Senior'
      : Array.isArray(co) && co.some(cm => cm.mentor_id === txn.initiating_mentor_id) ? 'Co-Mentor' : '';
  return <>{txn.initiating_mentor_name}{role && <span className="block text-xs text-gray-500">({role})</span>}</>;
}

export default function StudentFundingCard({ student, transactions = [], loading = false }) {
  const financeOn = useFinanceLink();
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');
  const [receipt, setReceipt] = useState(null);   // { url, name, failed? } — the receipt being looked at

  const approved = (t) => t.status === 'APPROVED';
  const totalDeposits = transactions.filter(t => t.type === 'DEPOSIT' && approved(t)).reduce((s, t) => s + (t.amount_usd || 0), 0);
  const totalWithdrawals = transactions.filter(t => t.type === 'WITHDRAWAL' && approved(t)).reduce((s, t) => s + (t.amount_usd || 0), 0);
  const ofType = useMemo(() => transactions.filter(t => type === 'all' || t.type === type), [transactions, type]);
  const count = (s) => (s === 'all' ? ofType.length : ofType.filter(t => t.status === s).length);
  const rows = ofType.filter(t => status === 'all' || t.status === status);

  const TH = ({ children }) => <th className="whitespace-nowrap p-3 text-left text-sm font-semibold text-gray-700">{children}</th>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: 'Total Deposits', value: totalDeposits, icon: TrendingUp, tone: 'from-blue-100 to-blue-200 text-blue-900' },
          { label: 'Total Withdrawals', value: totalWithdrawals, icon: TrendingDown, tone: 'from-purple-100 to-purple-200 text-purple-900' },
          { label: 'Net Deposit', value: totalDeposits - totalWithdrawals, icon: Wallet, tone: 'from-emerald-100 to-emerald-200 text-emerald-900' },
        ].map(({ label, value, icon: Icon, tone }) => (
          <Card key={label} className={`border-none bg-gradient-to-br shadow-sm ${tone}`}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="mt-1 text-2xl font-bold">{loading ? '…' : money(value)}</p>
              </div>
              <Icon className="h-7 w-7 opacity-70" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-gray-200">
        <CardHeader className="border-b border-gray-100 bg-slate-50/70">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-lg font-semibold">Funding requests ({transactions.length})</CardTitle>
            <Select value={type} onValueChange={(v) => v && setType(v)}>
              <SelectTrigger className="h-9 w-full sm:w-44" aria-label="Type"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(TYPES).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {/* Pending / Approved / Rejected, with how many — scrolls sideways on a phone */}
          <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {Object.entries(STATUSES).map(([k, l]) => (
              <button
                key={k}
                type="button"
                onClick={() => setStatus(k)}
                aria-pressed={status === k}
                className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${status === k ? 'border-brand-navy bg-brand-navy text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {l} <span className={status === k ? 'text-white/80' : 'text-slate-400'}>{count(k)}</span>
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500">
              {loading ? 'Loading funding requests…' : transactions.length ? 'No requests match these filters.' : 'No funding requests for this student yet.'}
            </p>
          ) : (
            <Paged items={rows} resetKey={`${student?.id}|${status}|${type}`}>
              {(pageRows, bar) => (<>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <TH>Date</TH><TH>Type</TH><TH>Amount</TH><TH>Payment</TH><TH>MT5 Login</TH><TH>Txn ID</TH>
                        <TH>Product</TH><TH>Added By</TH><TH>Status</TH><TH>Rejection Reason</TH><TH>Receipt</TH>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((txn) => (
                        <tr key={txn.id} className="border-b align-top hover:bg-gray-50">
                          <td className="whitespace-nowrap p-3 text-sm">{txn.requested_at ? format(new Date(txn.requested_at), 'MMM d, yyyy HH:mm') : '-'}</td>
                          <td className="p-3 text-sm">
                            <Badge variant="outline" className={`whitespace-nowrap ${TYPE_STYLE[txn.type] || ''}`}>{typeLabel(txn)}</Badge>
                          </td>
                          <td className="whitespace-nowrap p-3 text-sm font-semibold text-gray-900">{money(txn.amount_usd)}<PaymentDetails tx={txn} /></td>
                          <td className="p-3 text-sm">{txn.payment_method || '-'}</td>
                          <td className="p-3 font-mono text-sm">{txn.mt5_login || '-'}</td>
                          <td className="p-3 font-mono text-sm">{txn.transaction_id || '-'}</td>
                          <td className="p-3 text-sm">{txn.tags?.length ? <TagChips tags={txn.tags} /> : <span className="text-gray-400">-</span>}</td>
                          <td className="p-3 text-sm"><AddedBy txn={txn} student={student} /></td>
                          <td className="p-3">
                            {isWithAccounts(txn, financeOn)
                              ? <WithAccountsBadge transaction={txn} />
                              : <Badge variant="outline" className={STATUS_STYLE[txn.status] || 'bg-gray-100 text-gray-800 border-gray-200'}>{txn.status}</Badge>}
                            <FinanceApprovalNote transaction={txn} />
                          </td>
                          <td className="max-w-[220px] p-3 text-sm">
                            {txn.status === 'REJECTED' && txn.rejection_reason ? <span className="font-medium text-red-600">{txn.rejection_reason}</span> : <span className="text-gray-400">-</span>}
                          </td>
                          <td className="p-3 text-sm">
                            {txn.screenshot_url ? (
                              <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs"
                                onClick={() => setReceipt({ url: txn.screenshot_url, name: `${typeLabel(txn)} · ${money(txn.amount_usd)}` })}>
                                <Eye className="h-3.5 w-3.5" /> View
                              </Button>
                            ) : <span className="text-gray-400">-</span>}
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

      {/* A request's receipt: a photo shows here, a PDF in its viewer, anything else opens in a new tab */}
      <Dialog open={!!receipt} onOpenChange={(o) => { if (!o) setReceipt(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Receipt{receipt?.name ? ` · ${receipt.name}` : ''}</DialogTitle>
          </DialogHeader>
          {receipt && (/\.pdf($|\?)/i.test(receipt.url)
            ? <iframe src={receipt.url} title="Receipt" className="h-[70vh] w-full rounded-md border" />
            : receipt.failed
              ? <p className="text-sm text-gray-500">This receipt cannot be shown here — open it in a new tab.</p>
              : <img src={receipt.url} alt="Receipt" className="max-h-[70vh] w-full rounded-md border object-contain"
                  onError={() => setReceipt(r => (r ? { ...r, failed: true } : r))} />)}
          {receipt && <a href={receipt.url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline">Open in a new tab</a>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
