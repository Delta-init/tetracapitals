import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { PageTitle } from '@/components/common/PageHeader';
import StatsCard from '@/components/dashboard/StatsCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Eye, Hourglass, Loader2, Play, ShieldAlert, UserCheck } from 'lucide-react';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import { isAdminRole } from '@/components/utils/roles';
import { createPageUrl } from '@/utils';

const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

/**
 * The inactivity rule: students held by a CS with no approved deposit for
 * N days (90) move to the next team's CS. Admin roles can see who is due;
 * only a Super Admin can switch it on, change the days or run it now.
 */
export default function InactivityTransfers() {
  const queryClient = useQueryClient();
  const { data: currentUser } = useQuery({ queryKey: ['me-effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()) });
  const canView = !!currentUser && isAdminRole(currentUser.app_role);
  const isSuper = currentUser?.app_role === 'super_admin';

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['inactivity-transfer'],
    queryFn: async () => (await base44.functions.invoke('getInactivityTransfer', {})).data,
    enabled: canView,
  });
  const settings = data?.settings;
  const due = data?.due || [];

  const [days, setDays] = useState('');
  useEffect(() => { if (settings) setDays(String(settings.days)); }, [settings?.days]);

  const saveMutation = useMutation({
    mutationFn: (patch) => base44.functions.invoke('setInactivityTransfer', patch),
    onSuccess: (_r, patch) => {
      toast.success('enabled' in patch ? (patch.enabled ? 'Rule switched on — it runs once a day' : 'Rule switched off') : 'Days saved');
      queryClient.invalidateQueries({ queryKey: ['inactivity-transfer'] });
    },
    onError: (e) => toast.error(e?.message || 'Save failed'),
  });
  const runMutation = useMutation({
    mutationFn: () => base44.functions.invoke('runInactivityTransfer', {}),
    onSuccess: (r) => {
      const d = r?.data || {};
      toast.success(`Moved ${d.moved ?? 0} student(s)${d.left?.length ? ` · ${d.left.length} left (no other team with CS)` : ''}`);
      refetch();
      queryClient.invalidateQueries({ queryKey: ['students'] });
    },
    onError: (e) => toast.error(e?.message || 'Run failed'),
  });

  if (!currentUser) return <div className="p-8 text-center text-slate-400">Loading…</div>;
  if (!canView) {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <Card className="border-red-200"><CardContent className="p-6 text-center space-y-3">
          <ShieldAlert className="h-10 w-10 text-red-600 mx-auto" />
          <h2 className="text-lg font-semibold">Restricted page</h2>
          <p className="text-sm text-slate-600">Only admins can see the inactivity rule.</p>
        </CardContent></Card>
      </div>
    );
  }

  const daysValid = /^\d+$/.test(days) && Number(days) >= 30 && Number(days) <= 365;

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <PageTitle eyebrow="Students" icon={Hourglass}>Inactivity Transfers</PageTitle>
          <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
            A student held by a CS with no approved deposit for {settings?.days ?? 90} days moves to the next team’s CS, in turn.
            Only students given out since this rule was added are watched; both mentors are notified.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatsCard title="Students watched" value={data?.watched ?? 0} icon={Eye} color="blue" delay={0.05} />
          <StatsCard title="Due to move now" value={due.length} icon={Hourglass} color="amber" delay={0.12} />
          <StatsCard title="Moved last run" value={settings?.last_run_moved ?? 0} icon={UserCheck} color="cyan" trend={settings?.last_run_at ? `on ${fmt(settings.last_run_at)}` : 'never run'} delay={0.19} />
        </div>

        <Card>
          <CardHeader className="border-b"><CardTitle className="text-base text-brand-navy">Rule</CardTitle></CardHeader>
          <CardContent className="space-y-5 pt-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-slate-900">Move inactive students automatically</p>
                <p className="text-sm text-slate-500">
                  {settings?.enabled ? 'On — checked once a day.' : 'Off — nobody is moved.'}
                  {settings?.updated_by_name && ` Last changed by ${settings.updated_by_name} on ${fmt(settings.updated_date)}.`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                <Switch
                  checked={!!settings?.enabled}
                  disabled={!isSuper || !settings || saveMutation.isPending}
                  onCheckedChange={(on) => {
                    if (on && !window.confirm(`Switch on? From now on, every day, CS-held students with no approved deposit for ${settings.days} days move to the next team. ${due.length} would move on the first run.`)) return;
                    saveMutation.mutate({ enabled: on });
                  }}
                />
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div>
                <p className="mb-1.5 text-sm font-medium text-slate-700">Days without an approved deposit</p>
                <Input value={days} onChange={e => setDays(e.target.value)} disabled={!isSuper} className="w-32" inputMode="numeric" />
              </div>
              {isSuper && (
                <Button variant="outline" disabled={!daysValid || String(settings?.days) === days || saveMutation.isPending} onClick={() => saveMutation.mutate({ days: Number(days) })}>
                  Save days
                </Button>
              )}
              {!daysValid && days !== '' && <p className="text-xs text-rose-600">30 to 365 days.</p>}
            </div>
            {!isSuper && <p className="text-xs text-slate-400">Only a Super Admin can change the rule.</p>}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="border-b">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base text-brand-navy">Due to move now <span className="font-normal text-slate-400">· {due.length}</span></CardTitle>
              {isSuper && (
                <Button
                  size="sm"
                  disabled={!due.length || runMutation.isPending}
                  onClick={() => { if (window.confirm(`Move ${due.length} student(s) to the next team's CS now?`)) runMutation.mutate(); }}
                >
                  {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run now
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50/80">
                    {['Student', 'CS', 'Team', 'Given on / last deposit', 'Idle'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={5} className="py-10 text-center text-slate-400">Loading…</td></tr>
                  ) : due.length === 0 ? (
                    <tr><td colSpan={5} className="py-10 text-center text-slate-400">Nobody is due to move.</td></tr>
                  ) : due.map(d => (
                    <tr key={d.id} className="border-b border-slate-100 hover:bg-brand-cyan/[0.04]">
                      <td className="px-4 py-2.5">
                        <Link to={`${createPageUrl('StudentDetail')}?id=${d.id}`} className="font-medium text-slate-900 hover:text-blue-600">{d.name}</Link>
                        <div className="font-mono text-xs text-slate-400">{d.code}</div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">{d.mentorName}</td>
                      <td className="px-4 py-2.5 text-slate-600">{d.teamName || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-600">{d.lastDeposit ? `last deposit ${fmt(d.lastDeposit)}` : `given ${fmt(d.since)}`}</td>
                      <td className="px-4 py-2.5"><Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">{d.idleDays} days</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
