import React, { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Split, Users } from 'lucide-react';

const money = (n) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Pool groups (plan positions flagged Pool, e.g. the Junior + Senior pool under
 * a Chief) for one period, with a Distribute action that splits each pool
 * equally among its members. Used by Bonus Closing (monthly, With / Without
 * pooled separately) and Quarterly Deposit Closing (quarterly).
 *
 *   kind         'bonus' | 'deposit'
 *   credits      CommissionCredit rows
 *   start, end   Date range of the period (end exclusive)
 *   periodKey    'YYYY-MM' (bonus) or 'YYYY-Qn' (deposit)
 */
export default function PoolDistributionCard({ kind, credits, start, end, periodKey, periodLabel, periodEnded }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState(null); // { ok, text }
  const isBonus = kind === 'bonus';

  const groups = useMemo(() => {
    const g = {};
    for (const c of credits) {
      const inKind = isBonus ? (c.method === 'bonus_with' || c.method === 'bonus_without') : c.method === 'deposit';
      if (!inKind || !c.is_pool) continue;
      const d = new Date(c.requested_at || c.created_date);
      if (isNaN(d.getTime()) || d < start || d >= end) continue;
      const group = c.pool_group_id || c.pool_group_name || '—';
      const key = isBonus ? `${c.method}::${group}` : group;
      if (!g[key]) g[key] = { key, method: isBonus ? c.method : null, id: c.pool_group_id, name: c.pool_group_name || '—', total: 0, distributed: 0, pending: 0, members: new Map() };
      g[key].total += c.commission_usd || 0;
      if (c.status === 'distributed') g[key].distributed += 1; else g[key].pending += 1;
      if (c.recipient_id) g[key].members.set(c.recipient_id, c.recipient_name || '—');
    }
    return Object.values(g).map(x => {
      const memberList = [...x.members.values()];
      return { ...x, memberList, share: memberList.length ? x.total / memberList.length : 0, done: x.pending === 0 && x.distributed > 0 };
    }).sort((a, b) => b.total - a.total);
  }, [credits, start, end, isBonus]);

  const distribute = useMutation({
    mutationFn: ({ groupId, method }) => base44.functions.invoke('distributeDepositPool', {
      pool_group_id: groupId, period: periodKey, ...(method ? { method } : {}),
    }),
    onSuccess: (res) => {
      const d = res?.data || res;
      setMessage(d?.distributed
        ? { ok: true, text: `Pool distributed: ${money(d.pool_total)} → ${d.members} member(s), ${money(d.share_each)} each` }
        : { ok: false, text: d?.reason || 'Nothing to distribute' });
      queryClient.invalidateQueries({ queryKey: ['commission-credits'] });
    },
    onError: (e) => setMessage({ ok: false, text: e?.message || 'Distribution failed' }),
  });

  if (groups.length === 0) return null;

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-lg text-brand-navy">
          <Users className="h-5 w-5 text-purple-600" /> {isBonus ? 'Bonus' : 'Deposit'} pool — {periodLabel}
        </CardTitle>
        <p className="mt-1 text-sm text-slate-500">
          Pooled commission (plan positions flagged Pool) is split <strong>equally</strong> among its members at {isBonus ? 'month' : 'quarter'} close.
          {!periodEnded && <span className="text-amber-600"> {isBonus ? 'Month' : 'Quarter'} still open — distribute after it ends.</span>}
        </p>
        {message && <p className={`mt-2 text-sm font-medium ${message.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{message.text}</p>}
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50/80">
                <th className="px-4 py-3 text-left font-semibold text-slate-600">Pool (group)</th>
                {isBonus && <th className="px-4 py-3 text-center font-semibold text-slate-600">Type</th>}
                <th className="px-4 py-3 text-left font-semibold text-slate-600">Members</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-600">Pool total</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-600">Share / member</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-600">Action</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <tr key={g.key} className="border-b hover:bg-purple-50/40">
                  <td className="px-4 py-3 font-medium text-slate-900">{g.name}</td>
                  {isBonus && (
                    <td className="px-4 py-3 text-center">
                      <Badge variant="outline" className={g.method === 'bonus_with' ? 'border-green-200 bg-green-100 text-green-800' : 'border-amber-200 bg-amber-100 text-amber-800'}>
                        {g.method === 'bonus_with' ? 'With' : 'Without'}
                      </Badge>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">{g.memberList.map((m, i) => <Badge key={i} variant="secondary">{m}</Badge>)}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-purple-700">{money(g.total)}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{money(g.share)}</td>
                  <td className="px-4 py-3 text-right">
                    {g.done ? (
                      <Badge className="border-green-200 bg-green-100 text-green-700">Distributed</Badge>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => { setMessage(null); distribute.mutate({ groupId: g.id, method: g.method }); }}
                        disabled={!periodEnded || !g.id || distribute.isPending}
                      >
                        <Split className="h-4 w-4" /> Distribute
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
  );
}
