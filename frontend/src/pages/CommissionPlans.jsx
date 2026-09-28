import React, { useState } from 'react';
import { PageTitle } from '@/components/common/PageHeader';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, Layers, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';

// Each method has its OWN list of positions (level 1 = the staff who submits;
// each next level is the person up the Up Head chain). Deposit positions can be
// flagged as a POOL — those don't pay per transaction; they accrue to a shared
// pool that's split among the pool members at closing.
const METHODS = [
  { key: 'bonus_with', label: 'With Bonus', pool: true, color: 'text-green-700', bar: 'bg-green-50 border-green-200' },
  { key: 'bonus_without', label: 'Without Bonus', pool: true, color: 'text-amber-700', bar: 'bg-amber-50 border-amber-200' },
  { key: 'deposit', label: 'Deposit', pool: true, color: 'text-blue-700', bar: 'bg-blue-50 border-blue-200' },
];

// Sensible defaults for a new plan. Every method is seeded to the standard
// role chain so a new plan comes up ready to edit (you can still add/remove
// positions and rename labels):
//   CS 2% · CS Manager 1% · Junior 1% (pool) · Senior 1% (pool) · Chief 4%.
const emptyLevel = () => ({ label: '', percentage: '', pool: false });
const standardRows = () => [
  { label: 'CS', percentage: '2', pool: false },
  { label: 'CS Manager', percentage: '1', pool: false },
  { label: 'Junior', percentage: '1', pool: true },
  { label: 'Senior', percentage: '1', pool: true },
  { label: 'Chief', percentage: '4', pool: false },
];
const emptyForm = () => ({
  name: '',
  active: true,
  bonus_with: standardRows(),
  bonus_without: standardRows(),
  deposit: standardRows(),
});

const sumPct = (levels) => (levels || []).reduce((s, l) => s + (parseFloat(l.percentage) || 0), 0);

export default function CommissionPlans() {
  const [currentUser, setCurrentUser] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const queryClient = useQueryClient();

  React.useEffect(() => {
    base44.auth.me().then(u => setCurrentUser(getEffectiveUser(u))).catch(() => setCurrentUser(null));
  }, []);

  const { data: plans = [] } = useQuery({
    queryKey: ['commission-plans'],
    queryFn: () => base44.entities.CommissionPlan.list('name'),
    enabled: !!currentUser,
  });

  // Read a method's positions from a plan. New shape is [{level,label,percentage,pool}];
  // fall back to the older [{level,percentage}] and the oldest single `levels` array.
  const planLevels = (plan, m) => {
    const arr = plan[`${m.key}_levels`];
    if (Array.isArray(arr)) return arr.map((l, i) => ({ level: l.level ?? i + 1, label: l.label || '', percentage: l.percentage ?? 0, pool: !!l.pool }));
    if (Array.isArray(plan.levels)) return plan.levels.map((l, i) => ({ level: i + 1, label: '', percentage: l[`${m.key}_pct`] ?? 0, pool: false }));
    return [];
  };
  const planTotal = (plan, m) => planLevels(plan, m).reduce((s, l) => s + (parseFloat(l.percentage) || 0), 0);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { name: form.name.trim(), active: !!form.active };
      for (const m of METHODS) {
        payload[`${m.key}_levels`] = form[m.key].map((l, i) => ({
          level: i + 1,
          label: (l.label || '').trim(),
          percentage: parseFloat(l.percentage) || 0,
          pool: m.pool ? !!l.pool : false,
        }));
        payload[`total_${m.key}`] = sumPct(form[m.key]);
      }
      if (editing?.id) return base44.entities.CommissionPlan.update(editing.id, payload);
      return base44.entities.CommissionPlan.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-plans'] });
      toast.success(editing?.id ? 'Plan updated' : 'Plan created');
      setEditing(null);
    },
    onError: (e) => toast.error(e?.message || 'Save failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.CommissionPlan.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['commission-plans'] }); toast.success('Plan deleted'); },
    onError: (e) => toast.error(e?.message || 'Delete failed'),
  });

  const openNew = () => { setForm(emptyForm()); setEditing({}); };
  const openEdit = (plan) => {
    const next = { name: plan.name || '', active: plan.active !== false };
    for (const m of METHODS) {
      const lv = planLevels(plan, m).map(l => ({ label: l.label, percentage: String(l.percentage ?? ''), pool: !!l.pool }));
      next[m.key] = lv.length ? lv : [emptyLevel()];
    }
    setForm(next);
    setEditing(plan);
  };
  const setLevel = (key, idx, patch) => setForm(f => ({ ...f, [key]: f[key].map((l, i) => i === idx ? { ...l, ...patch } : l) }));
  const addLevel = (key) => setForm(f => ({ ...f, [key]: [...f[key], emptyLevel()] }));
  const removeLevel = (key, idx) => setForm(f => ({ ...f, [key]: f[key].length > 1 ? f[key].filter((_, i) => i !== idx) : f[key] }));

  const isSuper = ['super_admin', 'admin'].includes(currentUser?.app_role);
  if (!currentUser) return <div className="p-8 text-center text-gray-500">Loading…</div>;
  if (!isSuper) {
    return (
      <div className="p-8 max-w-xl mx-auto"><Card className="border-red-200"><CardContent className="p-6 text-center space-y-3">
        <ShieldAlert className="h-10 w-10 text-red-600 mx-auto" />
        <h2 className="text-lg font-semibold">Restricted page</h2>
        <p className="text-sm text-gray-600">Commission plans are managed by admins.</p>
      </CardContent></Card></div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-100/20 p-6">
      <div className="w-full max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <PageTitle eyebrow="Commission" icon={Layers}>Commission Plans</PageTitle>
            <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
              Define each position from the initiator up the chain, with an editable %. Positions can be marked <strong>Pool</strong> — those accrue to a shared pool paid at closing (bonus monthly, deposit quarterly). Assign a plan to the base staff (the CS) in Personnel.
            </p>
          </div>
          <Button onClick={openNew} className="bg-indigo-600 hover:bg-indigo-700"><Plus className="h-4 w-4 mr-1" /> New Plan</Button>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead>Plan</TableHead>
                    <TableHead className="text-right">With Bonus</TableHead>
                    <TableHead className="text-right">Without Bonus</TableHead>
                    <TableHead className="text-right">Deposit</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plans.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-10 text-gray-400">No plans yet. Create your first commission plan.</TableCell></TableRow>
                  ) : plans.map(p => (
                    <TableRow key={p.id} className="hover:bg-gray-50">
                      <TableCell className="font-medium">{p.name}</TableCell>
                      {METHODS.map(m => (
                        <TableCell key={m.key} className={`text-right ${m.color}`}>
                          {planLevels(p, m).length} pos · {planTotal(p, m).toFixed(2)}%
                        </TableCell>
                      ))}
                      <TableCell>
                        <Badge variant="outline" className={p.active !== false ? 'bg-green-100 text-green-800 border-green-200' : 'bg-gray-100 text-gray-600'}>
                          {p.active !== false ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600" onClick={() => openEdit(p)} title="Edit"><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" title="Delete" disabled={deleteMutation.isPending}
                          onClick={() => { if (window.confirm(`Delete plan "${p.name}"?`)) deleteMutation.mutate(p.id); }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Create / edit dialog */}
        <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editing?.id ? 'Edit Plan' : 'New Commission Plan'}</DialogTitle></DialogHeader>
            <div className="space-y-5 py-2">
              <div className="space-y-2 max-w-md">
                <Label>Plan name *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Standard Plan" />
              </div>

              {METHODS.map(m => (
                <div key={m.key} className={`rounded-lg border p-4 space-y-2 ${m.bar}`}>
                  <div className="flex items-center justify-between">
                    <Label className={`text-base ${m.color}`}>{m.label}</Label>
                    <span className={`text-sm font-semibold ${m.color}`}>Total {sumPct(form[m.key]).toFixed(2)}%</span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-gray-500 px-1">
                      <span className="w-8">Lvl</span>
                      <span className="flex-1">Position (label)</span>
                      <span className="w-20 text-right">%</span>
                      {m.pool && <span className="w-14 text-center">Pool</span>}
                      <span className="w-7" />
                    </div>
                    {form[m.key].map((lvl, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="w-8 text-xs text-gray-600">{i + 1}</span>
                        <Input value={lvl.label} onChange={e => setLevel(m.key, i, { label: e.target.value })} placeholder={m.pool ? 'e.g. CS / Chief' : 'e.g. Level ' + (i + 1)} className="flex-1 h-8" />
                        <Input type="number" step="0.01" min="0" value={lvl.percentage} onChange={e => setLevel(m.key, i, { percentage: e.target.value })} placeholder="0" className="w-20 h-8 text-right" />
                        {m.pool && (
                          <span className="w-14 flex justify-center">
                            <input type="checkbox" checked={!!lvl.pool} onChange={e => setLevel(m.key, i, { pool: e.target.checked })} className="h-4 w-4" title="Accrues to the shared pool, paid at closing" />
                          </span>
                        )}
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => removeLevel(m.key, i)} disabled={form[m.key].length <= 1} title="Remove position">
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => addLevel(m.key)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add position
                  </Button>
                </div>
              ))}
              <p className="text-xs text-gray-400">
                Level 1 = the staff who submits (the CS); each next level is the next person up the Up Head chain. Positions ticked <strong>Pool</strong> don't pay per-transaction — their % accrues to one shared pool, split equally among the pool members at closing (bonus at month-end, deposit at quarter-end).
              </p>

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} className="h-4 w-4" />
                Active
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button className="bg-indigo-600 hover:bg-indigo-700" disabled={saveMutation.isPending || !form.name.trim()} onClick={() => saveMutation.mutate()}>
                {saveMutation.isPending ? 'Saving…' : (editing?.id ? 'Save changes' : 'Create plan')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
