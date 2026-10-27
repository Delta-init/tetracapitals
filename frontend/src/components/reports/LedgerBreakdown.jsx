import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle, Download, Loader2, Search } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { downloadExcel } from '@/components/utils/excelExport';
import { AED_PER_USD } from '@/components/common/Usd';

/* ────────────────────────────────────────────────────────────────────────────
   What is behind a quarterly commission ledger's numbers on Commission Reports
   (the user, 2026-10-27): the requests its net deposit is made of, and the sum
   from there — gross, adjustments, buffer in, release and buffer — beside what
   the requests add up to today (backend functions/commissionLedgerBreakdown.ts).
   And, for the cards on top, the ledgers a total is made of.
──────────────────────────────────────────────────────────────────────────── */

const fmt = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n) => `$${fmt(n)}`;
const aedOf = (n) => `AED ${fmt((Number(n) || 0) * AED_PER_USD)}`;
// In UTC, as the quarters are counted (generateQuarterlyLedgers) — so a request near midnight shows in its quarter.
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pct = (r) => (r == null ? '—' : `${Math.round(r * 10000) / 100}%`);
const differs = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) >= 0.01;

export const LEDGER_FIELD_TITLE = {
  net: 'Net deposit', gross: 'Gross commission', release: 'Release', buffer: 'Buffer', buffer_in: 'Buffer in', buffer_out: 'Buffer out',
};

function Line({ label, value, strong, muted, note }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 ${strong ? 'border-t border-slate-200 font-semibold text-slate-900' : 'text-slate-700'} ${muted ? 'text-slate-400' : ''}`}>
      <span>{label}{note && <span className="ml-1 text-xs font-normal text-slate-400">{note}</span>}</span>
      <span className="tabular-nums">{money(value)} <span className="text-xs font-normal text-slate-400">{aedOf(value)}</span></span>
    </div>
  );
}

/** One ledger's numbers opened: { ledgerId, field } or null. */
export default function LedgerBreakdown({ open, onClose }) {
  const [q, setQ] = useState('');
  const res = useQuery({
    queryKey: ['ledger-breakdown', open?.ledgerId],
    queryFn: async () => (await base44.functions.invoke('getLedgerBreakdown', { ledgerId: open.ledgerId })).data,
    enabled: !!open?.ledgerId,
    retry: false,
  });
  const d = res.data;
  const L = d?.ledger;
  const needle = q.trim().toLowerCase();
  const requests = useMemo(() => (d?.requests || []).filter(r => !needle
    || [r.student_name, r.student_code, r.type, r.transaction_id, r.mt5_login].some(v => String(v || '').toLowerCase().includes(needle))), [d, needle]);
  const showRequests = open && ['net', 'gross'].includes(open.field);

  const exportIt = async () => {
    try {
      await downloadExcel({
        fileName: `${L.mentor_name} ${L.quarter} - ${LEDGER_FIELD_TITLE[open.field]}.xlsx`, sheet: 'Requests',
        columns: [{ header: 'Raised' }, { header: 'Approved' }, { header: 'Type' }, { header: 'Student' }, { header: 'Code' }, { header: 'MT5' }, { header: 'Transaction ID' },
          { header: 'Amount (USD)', type: 'number' }, { header: 'Counts as (USD)', type: 'number' }],
        rows: requests.map(r => [day(r.at), day(r.approved_at), r.type === 'DEPOSIT' ? 'Deposit' : 'Withdrawal', r.student_name, r.student_code, r.mt5_login, r.transaction_id,
          r.usd, r.type === 'DEPOSIT' ? r.usd : -r.usd]),
      });
    } catch (err) {
      toast.error(err?.message || "The export didn't work");
    }
  };

  return (
    <Dialog open={!!open} onOpenChange={(v) => { if (!v) { onClose(); setQ(''); } }}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{open && LEDGER_FIELD_TITLE[open.field]}{L ? ` — ${L.mentor_name}, ${L.quarter}` : ''}</DialogTitle>
          <DialogDescription>{L ? `${day(L.start_date)} – ${day(L.end_date)} · closed ${day(L.closed_at)}${L.closed_by_name ? ` by ${L.closed_by_name}` : ''}` : 'What makes this number'}</DialogDescription>
        </DialogHeader>
        {res.isLoading ? (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
        ) : res.isError ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {/unknown function|not found|404/i.test(String(res.error?.message)) ? 'This breakdown needs the server update (the API deploy).' : (res.error?.message || "The breakdown couldn't be loaded.")}
          </p>
        ) : L && (
          <div className="max-h-[70vh] space-y-4 overflow-auto">
            {/* The sum, as the ledger was made */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-2 text-sm">
              <Line label="Approved deposits" value={d.today.deposits_usd} note="today" />
              <Line label="− Approved withdrawals" value={d.today.withdrawals_usd} note="today" />
              <Line label="Net deposit" value={L.net_deposit_usd} strong note="ledger" />
              <Line label={`Gross commission (${pct(L.rate)} of net)`} value={L.gross_commission_usd} />
              <Line label="+ Manual adjustments" value={L.manual_adjustment_usd} />
              <Line label={`+ Buffer carried in${d.previous?.missing ? '' : ` (from ${d.previous.quarter})`}`} value={L.buffer_carried_in_usd} />
              <Line label="Adjusted gross" value={L.adjusted_gross_commission_usd} strong />
              <Line label="Release (75%)" value={L.commission_release_usd} />
              <Line label="Buffer (25%)" value={L.commission_buffer_usd} />
              <Line label={`Buffer carried out${d.next?.missing ? ' (no next quarter yet)' : ` (to ${d.next.quarter})`}`} value={L.buffer_carried_out_usd} muted={!!d.next?.missing} />
            </div>

            {differs(L.net_deposit_usd, d.today.net_deposit_usd) && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                The ledger says a net deposit of {money(L.net_deposit_usd)}; the approved requests in its quarter add up to {money(d.today.net_deposit_usd)} today.
                Something was approved, changed or removed after the quarter closed.
              </p>
            )}
            {differs(L.manual_adjustment_usd, d.today.adjustments_usd) && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                The ledger counts {money(L.manual_adjustment_usd)} of manual adjustments; the adjustments dated in its quarter come to {money(d.today.adjustments_usd)} today.
              </p>
            )}
            {['buffer_in'].includes(open.field) && !d.previous?.missing && differs(d.previous.buffer_usd, L.buffer_carried_in_usd) && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {d.previous.quarter}'s ledger held a buffer of {money(d.previous.buffer_usd)}; this ledger brought in {money(L.buffer_carried_in_usd)}.
              </p>
            )}

            {['release', 'buffer', 'buffer_in', 'buffer_out'].includes(open.field) && d.adjustments.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Manual adjustments in the quarter</p>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {d.adjustments.map(a => (
                      <tr key={a.id}><td className="py-1.5 text-slate-600">{day(a.at)}</td><td className="py-1.5">{a.reason || '—'}{a.by && <span className="text-xs text-slate-400"> · {a.by}</span>}</td><td className="py-1.5 text-right tabular-nums">{money(a.usd)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(showRequests || open.field === 'release' || open.field === 'buffer') && (
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    The requests — {plural(d.requests.filter(r => r.type === 'DEPOSIT').length, 'deposit')}, {plural(d.requests.filter(r => r.type === 'WITHDRAWAL').length, 'withdrawal')}
                  </p>
                  <div className="relative ml-auto">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Student, MT5, transaction…" className="h-8 w-56 pl-8" />
                  </div>
                  <Button variant="outline" size="sm" onClick={exportIt} disabled={!requests.length}><Download className="mr-1.5 h-4 w-4" />Export</Button>
                </div>
                {!requests.length ? <p className="py-6 text-center text-sm text-slate-400">No approved deposits or withdrawals in this quarter.</p> : (
                  <div className="overflow-hidden rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <tr>{['Raised', 'Type', 'Student', 'MT5 · transaction', 'Amount'].map(h => <th key={h} className={`px-3 py-2 ${h === 'Amount' ? 'text-right' : ''}`}>{h}</th>)}</tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {requests.map(r => (
                          <tr key={r.id} className="hover:bg-slate-50/60">
                            <td className="whitespace-nowrap px-3 py-2 text-slate-600">{day(r.at)}<div className="text-xs text-slate-400">approved {day(r.approved_at)}</div></td>
                            <td className="px-3 py-2">{r.type === 'DEPOSIT' ? <span className="text-emerald-700">Deposit</span> : <span className="text-rose-700">Withdrawal</span>}</td>
                            <td className="px-3 py-2">
                              {r.student_id ? <Link to={`${createPageUrl('StudentDetail')}?id=${r.student_id}`} className="font-medium text-brand-navy hover:underline">{r.student_name || 'A student'}</Link> : '—'}
                              {r.student_code && <div className="text-xs text-slate-400">{r.student_code}</div>}
                            </td>
                            <td className="px-3 py-2 text-slate-600">{r.mt5_login || '—'}<div className="text-xs text-slate-400">{r.transaction_id}</div></td>
                            <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${r.type === 'WITHDRAWAL' ? 'text-rose-700' : ''}`}>{r.type === 'WITHDRAWAL' ? '−' : ''}{money(r.usd)}<div className="text-xs text-slate-400">{aedOf(r.usd)}</div></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The ledgers a card's total is made of — from the page's own filtered list. */
export function LedgerList({ open, onClose, onOpenLedger }) {
  const ledgers = open?.ledgers || [];
  const total = ledgers.reduce((s, l) => s + (Number(l[open?.field]) || 0), 0);
  return (
    <Dialog open={!!open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{open?.title}</DialogTitle>
          <DialogDescription>{ledgers.length} ledger{ledgers.length === 1 ? '' : 's'} · {money(total)} · {aedOf(total)}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr><th className="px-3 py-2">Person</th><th className="px-3 py-2">Quarter</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Amount</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ledgers.map(l => (
                <tr key={l.id} className="cursor-pointer hover:bg-cyan-50/50" title="Open this ledger's numbers" onClick={() => onOpenLedger(l)}>
                  <td className="px-3 py-2 font-medium text-slate-800">{l.mentor_name}</td>
                  <td className="px-3 py-2 text-blue-600">{l.quarter}</td>
                  <td className="px-3 py-2 text-slate-600">{String(l.overall_status || '').replace(/_/g, ' ')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(l[open.field])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
