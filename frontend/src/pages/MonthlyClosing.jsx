import React, { useState, useMemo } from 'react';
import { PageTitle } from '@/components/common/PageHeader';
import { TablePagination, usePagination } from '@/components/common/TablePagination';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Award, CheckCircle2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import PeriodApprovalCell from '@/components/commission/PeriodApprovalCell';
import PoolDistributionCard from '@/components/commission/PoolDistributionCard';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const money = (n) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function MonthlyClosing() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const queryClient = useQueryClient();

  const { data: credits = [], isLoading } = useQuery({
    queryKey: ['commission-credits'],
    queryFn: () => base44.entities.CommissionCredit.list('-created_date'),
  });

  // Per-staff approval (Broker -> Academic -> Finance -> Released) and pool
  // distribution — moved here from the Bonus Commission Reports page.
  const { data: currentUser } = useQuery({ queryKey: ['me-effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()) });
  const canApprove = !!currentUser && ['super_admin', 'admin', 'broker_admin', 'academic_head', 'finance_admin'].includes(currentUser.app_role);
  const periodKey = `${year}-${String(month).padStart(2, '0')}`;
  const periodStart = useMemo(() => new Date(year, month - 1, 1), [year, month]);
  const periodEnd = useMemo(() => new Date(year, month, 1), [year, month]);
  const periodEnded = new Date() >= periodEnd;
  const { data: approvals = [], refetch: refetchApprovals } = useQuery({
    queryKey: ['period-approvals', 'bonus', periodKey],
    queryFn: () => base44.entities.CommissionPeriodApproval.filter({ kind: 'bonus', period: periodKey }),
  });
  const approvalByStaff = useMemo(() => Object.fromEntries(approvals.map(a => [a.recipient_id, a])), [approvals]);

  const { rows, totals, periodCredits, poolRows } = useMemo(() => {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    const map = {};
    const poolMap = {}; // Junior+Senior bonus pool, per Chief group
    const periodCredits = [];
    for (const c of credits) {
      if (c.method !== 'bonus_with' && c.method !== 'bonus_without') continue;
      const d = new Date(c.requested_at || c.created_date);
      if (isNaN(d.getTime()) || d < start || d >= end) continue;
      if (c.is_pool) {
        // Pool accrual — shown as its own "… SEN/JUN POOL" line, not paid per staff.
        if (c.status === 'distributed') continue;
        const pk = c.pool_group_id || c.pool_group_name || '—';
        if (!poolMap[pk]) poolMap[pk] = { key: pk, name: c.pool_group_name || 'SEN/JUN POOL', withB: 0, withoutB: 0 };
        if (c.method === 'bonus_with') poolMap[pk].withB += c.commission_usd || 0;
        else poolMap[pk].withoutB += c.commission_usd || 0;
        continue;
      }
      periodCredits.push(c);
      const key = c.recipient_id || c.recipient_name;
      if (!map[key]) map[key] = { key, name: c.recipient_name || '—', withB: 0, withoutB: 0, count: 0, releasedCount: 0 };
      if (c.method === 'bonus_with') map[key].withB += c.commission_usd || 0;
      else map[key].withoutB += c.commission_usd || 0;
      map[key].count += 1;
      if (c.status === 'released') map[key].releasedCount += 1;
    }
    const rows = Object.values(map).map(r => ({ ...r, total: r.withB + r.withoutB, released: r.count > 0 && r.releasedCount === r.count })).sort((a, b) => b.total - a.total);
    const totals = rows.reduce((a, r) => ({ withB: a.withB + r.withB, withoutB: a.withoutB + r.withoutB, total: a.total + r.total }), { withB: 0, withoutB: 0, total: 0 });
    const poolRows = Object.values(poolMap).map(p => ({ ...p, total: p.withB + p.withoutB })).sort((a, b) => b.total - a.total);
    return { rows, totals, periodCredits, poolRows };
  }, [credits, month, year]);
  // Staff rows show 25 to a page (the pool lines stay on top); totals and Release cover every row.
  const { pageItems: pageRows, bar } = usePagination(rows, { resetKey: periodKey });

  const pendingIds = periodCredits.filter(c => c.status !== 'released').map(c => c.id).filter(Boolean);
  const releasedCount = periodCredits.length - pendingIds.length;
  const allReleased = periodCredits.length > 0 && pendingIds.length === 0;

  const releaseMutation = useMutation({
    mutationFn: () => base44.functions.invoke('releaseCommission', { ids: pendingIds }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['commission-credits'] });
      toast.success(`Released ${r?.data?.released ?? 0} bonus credit(s) for ${MONTHS[month - 1]} ${year}`);
    },
    onError: (e) => toast.error(e?.message || 'Release failed'),
  });

  const periodLabel = `${MONTHS[month - 1]} ${year}`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-100/20 p-6">
      <div className="w-full max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <PageTitle eyebrow="Commission" icon={Award}>Bonus Closing</PageTitle>
            <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">Approve, release and distribute bonus commission for the month.</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={month} onChange={e => setMonth(Number(e.target.value))} className="h-9 rounded-md border border-input bg-white px-3 text-sm">
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <select value={year} onChange={e => setYear(Number(e.target.value))} className="h-9 rounded-md border border-input bg-white px-3 text-sm">
              {[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-green-50 border border-green-200 rounded-xl p-4"><p className="text-xs text-green-600 font-medium uppercase">With Bonus</p><p className="text-2xl font-bold text-green-700 mt-1">{money(totals.withB)}</p></div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4"><p className="text-xs text-amber-600 font-medium uppercase">Without Bonus</p><p className="text-2xl font-bold text-amber-700 mt-1">{money(totals.withoutB)}</p></div>
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-4"><p className="text-xs text-purple-600 font-medium uppercase">Total Bonus</p><p className="text-2xl font-bold text-purple-700 mt-1">{money(totals.total)}</p></div>
          <div className={`border rounded-xl p-4 ${allReleased ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
            <p className={`text-xs font-medium uppercase ${allReleased ? 'text-emerald-600' : 'text-gray-500'}`}>Status</p>
            <p className={`text-2xl font-bold mt-1 ${allReleased ? 'text-emerald-700' : 'text-gray-700'}`}>{releasedCount}/{periodCredits.length}</p>
            <p className="text-xs text-gray-400 mt-1">credits released</p>
          </div>
        </div>

        {canApprove && (
          <PoolDistributionCard
            kind="bonus" credits={credits} start={periodStart} end={periodEnd}
            periodKey={periodKey} periodLabel={periodLabel} periodEnded={periodEnded}
          />
        )}

        <Card>
          <CardHeader className="border-b flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Staff — {periodLabel}</CardTitle>
            {allReleased ? (
              <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200"><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Released</Badge>
            ) : (
              <Button size="sm" className="bg-purple-600 hover:bg-purple-700"
                disabled={pendingIds.length === 0 || releaseMutation.isPending}
                onClick={() => { if (window.confirm(`Release ${pendingIds.length} bonus credit(s) for ${periodLabel} as paid?`)) releaseMutation.mutate(); }}>
                <Lock className="h-4 w-4 mr-1" /> {releaseMutation.isPending ? 'Releasing…' : `Release ${periodLabel}`}
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Staff</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">With Bonus</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Without Bonus</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Total</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
                    {canApprove && <th className="text-right px-4 py-3 font-semibold text-gray-600">Approval</th>}
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={canApprove ? 6 : 5} className="text-center py-10 text-gray-400">Loading…</td></tr>
                  ) : (rows.length === 0 && poolRows.length === 0) ? (
                    <tr><td colSpan={canApprove ? 6 : 5} className="text-center py-10 text-gray-400">No bonus commission for {periodLabel}.</td></tr>
                  ) : (<>
                  {poolRows.map(p => (
                    <tr key={'pool-' + p.key} className="border-b-2 border-purple-200 bg-purple-50/60 hover:bg-purple-50">
                      <td className="px-4 py-3 font-semibold text-purple-800">{p.name}</td>
                      <td className="px-4 py-3 text-right text-green-700">{money(p.withB)}</td>
                      <td className="px-4 py-3 text-right text-amber-700">{money(p.withoutB)}</td>
                      <td className="px-4 py-3 text-right font-bold text-purple-700">{money(p.total)}<span className="text-xs text-gray-400 ml-1">(Jun+Sen pool)</span></td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant="outline" className="bg-purple-100 text-purple-800 border-purple-200">Pool</Badge>
                      </td>
                      {canApprove && <td className="px-4 py-3 text-right text-xs text-slate-400">Distribute above</td>}
                    </tr>
                  ))}
                  {pageRows.map(r => (
                    <tr key={r.key} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                      <td className="px-4 py-3 text-right text-green-700">{money(r.withB)}</td>
                      <td className="px-4 py-3 text-right text-amber-700">{money(r.withoutB)}</td>
                      <td className="px-4 py-3 text-right font-bold text-purple-700">{money(r.total)}</td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant="outline" className={r.released ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-amber-100 text-amber-800 border-amber-200'}>
                          {r.released ? 'Released' : 'Pending'}
                        </Badge>
                      </td>
                      {canApprove && (
                        <td className="px-4 py-3 text-right">
                          <PeriodApprovalCell
                            kind="bonus" period={periodKey}
                            recipientId={r.key} recipientName={r.name}
                            approval={approvalByStaff[r.key]}
                            currentUser={currentUser} periodEnded={periodEnded}
                            onDone={refetchApprovals}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                  </>)}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="bg-gray-100 border-t-2 border-gray-300 font-bold">
                      <td className="px-4 py-3 text-gray-700">Total ({rows.length})</td>
                      <td className="px-4 py-3 text-right text-green-700">{money(totals.withB)}</td>
                      <td className="px-4 py-3 text-right text-amber-700">{money(totals.withoutB)}</td>
                      <td className="px-4 py-3 text-right text-purple-700">{money(totals.total)}</td>
                      <td></td>
                      {canApprove && <td></td>}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <TablePagination {...bar} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
