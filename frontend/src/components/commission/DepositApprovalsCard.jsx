import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import PeriodApprovalCell from '@/components/commission/PeriodApprovalCell';
import { TablePagination, usePagination } from '@/components/common/TablePagination';

const money = (n) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Deposit commission per staff for a quarter (deposits add, withdrawals claw
 * back — never floored at $0), with the Broker → Academic → Finance approval
 * that releases it. Shown on Quarterly Deposit Closing.
 */
export default function DepositApprovalsCard({ credits, start, end, periodKey, periodLabel, periodEnded, currentUser }) {
  const { data: approvals = [], refetch } = useQuery({
    queryKey: ['period-approvals', 'deposit', periodKey],
    queryFn: () => base44.entities.CommissionPeriodApproval.filter({ kind: 'deposit', period: periodKey }),
  });
  const approvalByStaff = useMemo(() => Object.fromEntries(approvals.map(a => [a.recipient_id, a])), [approvals]);

  const { rows, total } = useMemo(() => {
    const map = {};
    for (const c of credits) {
      if (c.method !== 'deposit' || c.is_pool) continue; // pools are distributed separately
      const d = new Date(c.requested_at || c.created_date);
      if (isNaN(d.getTime()) || d < start || d >= end) continue;
      const key = c.recipient_id || c.recipient_name;
      if (!map[key]) map[key] = { key, name: c.recipient_name || '—', commission: 0, count: 0 };
      map[key].commission += c.commission_usd || 0;
      map[key].count += 1;
    }
    const rows = Object.values(map).sort((a, b) => b.commission - a.commission);
    const total = rows.reduce((a, r) => ({ commission: a.commission + r.commission, count: a.count + r.count }), { commission: 0, count: 0 });
    return { rows, total };
  }, [credits, start, end]);
  // 25 staff to a page; the total row still adds up every staff.
  const { pageItems: pageRows, bar } = usePagination(rows, { resetKey: periodKey });

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-lg text-brand-navy">Deposit commission approvals — {periodLabel}</CardTitle>
        <p className="mt-1 text-sm text-slate-500">
          Per staff, deposits minus withdrawals. Approve Broker → Academic → Finance to release.
          {!periodEnded && <span className="text-amber-600"> Quarter still open — approvals start after it ends.</span>}
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50/80">
                <th className="px-4 py-3 text-left font-semibold text-slate-600">Staff</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-600">Deposit commission</th>
                <th className="px-4 py-3 text-center font-semibold text-slate-600">Credits</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-600">Approval / Release</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={4} className="py-10 text-center text-slate-400">No deposit commission for {periodLabel}.</td></tr>
              ) : pageRows.map(r => (
                <tr key={r.key} className="border-b hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-medium text-slate-900">{r.name}</td>
                  <td className={`px-4 py-3 text-right font-bold ${r.commission < 0 ? 'text-rose-600' : 'text-blue-700'}`}>{money(r.commission)}</td>
                  <td className="px-4 py-3 text-center"><Badge variant="secondary">{r.count}</Badge></td>
                  <td className="px-4 py-3 text-right">
                    <PeriodApprovalCell
                      kind="deposit" period={periodKey}
                      recipientId={r.key} recipientName={r.name}
                      approval={approvalByStaff[r.key]}
                      currentUser={currentUser} periodEnded={periodEnded}
                      onDone={refetch}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold">
                  <td className="px-4 py-3 text-slate-700">Total ({rows.length})</td>
                  <td className="px-4 py-3 text-right text-blue-700">{money(total.commission)}</td>
                  <td className="px-4 py-3 text-center">{total.count}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <TablePagination {...bar} />
      </CardContent>
    </Card>
  );
}
