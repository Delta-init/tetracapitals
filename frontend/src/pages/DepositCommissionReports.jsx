import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DollarSign, Download, Users, Split } from 'lucide-react';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import PeriodApprovalCell from '@/components/commission/PeriodApprovalCell';

const QUARTERS = [
  { value: 1, label: 'Q1 (Jan–Mar)' },
  { value: 2, label: 'Q2 (Apr–Jun)' },
  { value: 3, label: 'Q3 (Jul–Sep)' },
  { value: 4, label: 'Q4 (Oct–Dec)' },
];
const money = (n) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Built-in admin roles that may view every staff member's commissions. Any other
// role (mentors / staff) is scoped to their own credits only.
const ADMIN_ROLES = ['super_admin', 'admin', 'broker_admin', 'finance_admin', 'academic_head', 'admin_supervisor'];

export default function DepositCommissionReports() {
  const now = new Date();
  const queryClient = useQueryClient();
  const [quarter, setQuarter] = useState(Math.ceil((now.getMonth() + 1) / 3));
  const [year, setYear] = useState(now.getFullYear());

  const { data: currentUser } = useQuery({ queryKey: ['me-effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()) });
  const { data: myRole } = useQuery({
    queryKey: ['my-commission-role', currentUser?.app_role],
    queryFn: () => base44.entities.CommissionRole.filter({ role_key: currentUser.app_role }).then(r => r[0] || null),
    enabled: !!currentUser?.app_role,
  });
  // Admins (built-in admin role, or a custom role scoped to "all") see everyone;
  // everyone else sees only their own commission credits.
  const canSeeAll = !!currentUser && (ADMIN_ROLES.includes(currentUser.app_role) || myRole?.data_scope === 'all');

  const { data: credits = [], isLoading } = useQuery({
    queryKey: ['commission-credits'],
    queryFn: () => base44.entities.CommissionCredit.list('-created_date'),
  });

  // Per-staff approval workflow (Broker -> Academic -> Finance -> Released).
  const periodKey = `${year}-Q${quarter}`;
  const periodEnded = new Date() >= new Date(year, quarter * 3, 1);
  const canApprove = !!currentUser && ['super_admin', 'admin', 'broker_admin', 'academic_head', 'finance_admin'].includes(currentUser.app_role);
  const { data: approvals = [], refetch: refetchApprovals } = useQuery({
    queryKey: ['period-approvals', 'deposit', periodKey],
    queryFn: () => base44.entities.CommissionPeriodApproval.filter({ kind: 'deposit', period: periodKey }),
  });
  const approvalByStaff = useMemo(() => {
    const m = {};
    for (const a of approvals) m[a.recipient_id] = a;
    return m;
  }, [approvals]);

  const [selected, setSelected] = useState(null);

  const { rows, total, byStaff } = useMemo(() => {
    const startMonth = (quarter - 1) * 3;
    const start = new Date(year, startMonth, 1);
    const end = new Date(year, startMonth + 3, 1);
    const map = {};
    const byStaff = {};
    for (const c of credits) {
      if (c.method !== 'deposit' || c.is_pool) continue; // pool accruals are shown/distributed separately
      // Scope: non-admin staff only see credits where they are the recipient.
      if (!canSeeAll && c.recipient_id !== currentUser?.id) continue;
      const d = new Date(c.requested_at || c.created_date);
      if (isNaN(d.getTime()) || d < start || d >= end) continue;
      const key = c.recipient_id || c.recipient_name;
      if (!map[key]) map[key] = { key, name: c.recipient_name || '—', net: 0, count: 0 };
      map[key].net += c.commission_usd || 0; // deposits add, withdrawals subtract
      map[key].count += 1;
      (byStaff[key] = byStaff[key] || []).push(c);
    }
    // Floor each staff's deposit commission at $0 (never negative).
    // NOT floored at $0: a withdrawal clawback can push a staff's net negative
    // (deposit earned in an earlier quarter, withdrawn now) — that must show and
    // reduce their release this quarter, otherwise it's a loophole.
    const rows = Object.values(map).map(r => ({ ...r, commission: r.net })).sort((a, b) => b.commission - a.commission);
    const total = rows.reduce((a, r) => ({ commission: a.commission + r.commission, count: a.count + r.count }), { commission: 0, count: 0 });
    return { rows, total, byStaff };
  }, [credits, quarter, year, canSeeAll, currentUser?.id]);

  const detailCredits = selected ? (byStaff[selected.key] || []) : [];

  // Deposit POOL groups (Junior+Senior 2% shared pool, anchored on the Chief).
  // Accrues over the quarter, split equally among members at closing. Only
  // admins who can approve see/act on pools.
  const poolGroups = useMemo(() => {
    if (!canApprove) return [];
    const startMonth = (quarter - 1) * 3;
    const start = new Date(year, startMonth, 1);
    const end = new Date(year, startMonth + 3, 1);
    const g = {};
    for (const c of credits) {
      if (c.method !== 'deposit' || !c.is_pool) continue;
      const d = new Date(c.requested_at || c.created_date);
      if (isNaN(d.getTime()) || d < start || d >= end) continue;
      const key = c.pool_group_id || c.pool_group_name || '—';
      if (!g[key]) g[key] = { id: c.pool_group_id, name: c.pool_group_name || '—', total: 0, distributed: 0, members: new Map(), pending: 0 };
      g[key].total += c.commission_usd || 0;
      if (c.status === 'distributed') g[key].distributed += 1; else g[key].pending += 1;
      if (c.recipient_id) g[key].members.set(c.recipient_id, c.recipient_name || '—');
    }
    return Object.values(g).map(x => {
      const memberList = [...x.members.values()];
      return { ...x, memberList, share: memberList.length ? x.total / memberList.length : 0, done: x.pending === 0 && x.distributed > 0 };
    }).sort((a, b) => b.total - a.total);
  }, [credits, quarter, year, canApprove]);

  const distributeMutation = useMutation({
    mutationFn: (groupId) => base44.functions.invoke('distributeDepositPool', { pool_group_id: groupId, period: periodKey }),
    onSuccess: (res) => {
      const d = res?.data || res;
      if (d?.distributed) toast.success(`Pool distributed: ${money(d.pool_total)} → ${d.members} member(s), ${money(d.share_each)} each`);
      else toast.info(d?.reason || 'Nothing to distribute');
      queryClient.invalidateQueries({ queryKey: ['commission-credits'] });
    },
    onError: (e) => toast.error(e?.message || 'Distribution failed'),
  });

  const periodLabel = `Q${quarter} ${year}`;

  const exportCsv = () => {
    const csv = [['Staff', 'Deposit Commission', 'Credits'].join(','), ...rows.map(r => [`"${r.name}"`, r.commission.toFixed(2), r.count].join(','))];
    const blob = new Blob([csv.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `deposit_commission_${periodLabel}.csv`; a.click();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-100/20 p-6">
      <div className="w-full max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <DollarSign className="h-7 w-7 text-blue-600" /> Deposit Commission
            </h1>
            <p className="text-gray-600 mt-1 text-sm">Deposit commission {canSeeAll ? 'per staff' : '— your earnings'} — released <strong>quarterly</strong>.</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={quarter} onChange={e => setQuarter(Number(e.target.value))} className="h-9 rounded-md border border-input bg-white px-3 text-sm">
              {QUARTERS.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
            </select>
            <select value={year} onChange={e => setYear(Number(e.target.value))} className="h-9 rounded-md border border-input bg-white px-3 text-sm">
              {[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4 mr-1" /> Export</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-xs text-blue-600 font-medium uppercase">Total Deposit Commission</p>
            <p className="text-2xl font-bold text-blue-700 mt-1">{money(total.commission)}</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 font-medium uppercase">Staff / Credits</p>
            <p className="text-2xl font-bold text-gray-700 mt-1">{rows.length} · {total.count}</p>
          </div>
        </div>

        {canApprove && poolGroups.length > 0 && (
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5 text-purple-600" /> Deposit Pool — {periodLabel}
              </CardTitle>
              <p className="text-sm text-gray-500 mt-1">
                Pooled deposit commission (e.g. Junior + Senior 2%) is split <strong>equally</strong> among its members at quarter close.
                {!periodEnded && <span className="text-amber-600"> Quarter still open — distribute after it ends.</span>}
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-purple-50 border-b">
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Pool (Group)</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Members</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Pool Total</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Share / member</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {poolGroups.map(g => (
                      <tr key={g.id || g.name} className="border-b hover:bg-purple-50/40">
                        <td className="px-4 py-3 font-medium text-gray-900">{g.name}</td>
                        <td className="px-4 py-3 text-gray-700">
                          <div className="flex flex-wrap gap-1">
                            {g.memberList.map((m, i) => <Badge key={i} variant="secondary">{m}</Badge>)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-purple-700">{money(g.total)}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{money(g.share)}</td>
                        <td className="px-4 py-3 text-right">
                          {g.done ? (
                            <Badge className="bg-green-100 text-green-700 border-green-200">Distributed</Badge>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => distributeMutation.mutate(g.id)}
                              disabled={!periodEnded || !g.id || distributeMutation.isPending}
                              className="bg-purple-600 hover:bg-purple-700"
                            >
                              <Split className="h-4 w-4 mr-1" /> Distribute
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-lg">Staff — {periodLabel}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Staff</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Deposit Commission</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600">Credits</th>
                    {canApprove && <th className="text-right px-4 py-3 font-semibold text-gray-600">Approval / Release</th>}
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={canApprove ? 4 : 3} className="text-center py-10 text-gray-400">Loading…</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={canApprove ? 4 : 3} className="text-center py-10 text-gray-400">No deposit commission for {periodLabel}.</td></tr>
                  ) : rows.map(r => (
                    <tr key={r.key} onClick={() => setSelected(r)} className="border-b hover:bg-blue-50 cursor-pointer">
                      <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                      <td className="px-4 py-3 text-right font-bold text-blue-700">{money(r.commission)}</td>
                      <td className="px-4 py-3 text-center"><Badge variant="secondary">{r.count}</Badge></td>
                      {canApprove && (
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <PeriodApprovalCell
                            kind="deposit" period={periodKey}
                            recipientId={r.key} recipientName={r.name}
                            approval={approvalByStaff[r.key]}
                            currentUser={currentUser} periodEnded={periodEnded}
                            onDone={refetchApprovals}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="bg-gray-100 border-t-2 border-gray-300 font-bold">
                      <td className="px-4 py-3 text-gray-700">Total ({rows.length})</td>
                      <td className="px-4 py-3 text-right text-blue-700">{money(total.commission)}</td>
                      <td className="px-4 py-3 text-center">{total.count}</td>
                      {canApprove && <td></td>}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Per-staff detail */}
        <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{selected?.name} — deposit credits ({periodLabel})</DialogTitle>
            </DialogHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Student</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Email</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Initiated by</th>
                    <th className="text-center px-3 py-2 font-semibold text-gray-600">Level</th>
                    <th className="text-right px-3 py-2 font-semibold text-gray-600">Amount</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Txn ID</th>
                    <th className="text-right px-3 py-2 font-semibold text-gray-600">Commission</th>
                  </tr>
                </thead>
                <tbody>
                  {detailCredits.map((c, i) => (
                    <tr key={c.id || i} className="border-b hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium">{c.student_name || '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{c.student_email || '—'}</td>
                      <td className="px-3 py-2 text-gray-700">{c.initiator_name || '—'}</td>
                      <td className="px-3 py-2 text-center">L{c.level} <span className="text-xs text-gray-400">({c.percentage}%)</span></td>
                      <td className="px-3 py-2 text-right font-mono">{money(c.base_amount)}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-500">{c.txn_id || '—'}</td>
                      <td className={`px-3 py-2 text-right font-bold ${(c.commission_usd || 0) < 0 ? 'text-red-600' : 'text-blue-700'}`}>{money(c.commission_usd)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-100 border-t-2 font-bold">
                    <td colSpan={6} className="px-3 py-2 text-gray-700">Total ({detailCredits.length} credits)</td>
                    <td className="px-3 py-2 text-right text-blue-700">{money(detailCredits.reduce((s, c) => s + (c.commission_usd || 0), 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
