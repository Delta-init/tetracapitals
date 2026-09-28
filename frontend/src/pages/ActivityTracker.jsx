import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ClipboardList, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import { FIELDS_BY_CATEGORY, activityCategory, connectionRate, isNumeric, computeDailyScore } from '@/components/activity/activityFields';

const today = () => new Date().toISOString().slice(0, 10);
const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const fmt = (v, type) => (type === 'money' ? money(v) : type === 'yn' ? (v || '—') : (v ?? (isNumeric(type) ? 0 : '—')));

export default function ActivityTracker() {
  const queryClient = useQueryClient();
  const { data: currentUser } = useQuery({ queryKey: ['me-effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()) });

  const category = activityCategory(currentUser?.app_role);
  const fields = FIELDS_BY_CATEGORY[category];

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['activity-logs', currentUser?.id],
    queryFn: () => base44.entities.ActivityLog.filter({ staff_id: currentUser.id }),
    enabled: !!currentUser?.id,
  });

  const myLogs = useMemo(() => [...logs].sort((a, b) => String(b.date).localeCompare(String(a.date))), [logs]);

  const [editing, setEditing] = useState(null); // the log being added/edited (or null)

  const saveMutation = useMutation({
    mutationFn: async (raw) => {
      const row = { ...raw };
      // Store the auto-calculated score when the category has a formula.
      const auto = computeDailyScore(category, row);
      if (auto !== null) row.daily_score = auto;
      const existing = logs.find(l => l.date === row.date && l.id !== row.id);
      if (existing && !row.id) row.id = existing.id; // one entry per day — update it
      if (row.id) return base44.entities.ActivityLog.update(row.id, row);
      return base44.entities.ActivityLog.create(row);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activity-logs', currentUser?.id] });
      queryClient.invalidateQueries({ queryKey: ['activity-logs-all'] });
      toast.success('Saved');
      setEditing(null);
    },
    onError: (e) => toast.error(e?.message || 'Save failed'),
  });

  const openNew = () => setEditing({ staff_id: currentUser.id, staff_name: currentUser.full_name, category, date: today() });
  const openEdit = (log) => setEditing({ ...log });

  if (!currentUser) return <div className="p-8 text-center text-gray-500">Loading…</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-100/20 p-6">
      <div className="w-full max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <ClipboardList className="h-7 w-7 text-indigo-600" /> My Activity Tracker
            </h1>
            <p className="text-gray-600 mt-1 text-sm">
              Log your daily activity — {category === 'pa' ? 'PA / CSE' : 'Mentor'} tracker. One entry per day.
            </p>
          </div>
          <Button onClick={openNew} className="bg-indigo-600 hover:bg-indigo-700">
            <Plus className="h-4 w-4 mr-1" /> Add / Edit Today
          </Button>
        </div>

        <Card>
          <CardHeader className="border-b"><CardTitle className="text-lg">Daily Log ({myLogs.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Date</th>
                    {fields.filter(f => isNumeric(f.type)).slice(0, 7).map(f => (
                      <th key={f.key} className="text-right px-3 py-3 font-semibold text-gray-600 whitespace-nowrap">{f.label}</th>
                    ))}
                    {category === 'pa' && <th className="text-right px-3 py-3 font-semibold text-gray-600">Conn %</th>}
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={10} className="text-center py-10 text-gray-400">Loading…</td></tr>
                  ) : myLogs.length === 0 ? (
                    <tr><td colSpan={10} className="text-center py-10 text-gray-400">No entries yet. Click “Add / Edit Today”.</td></tr>
                  ) : myLogs.map(log => (
                    <tr key={log.id} onClick={() => openEdit(log)} className="border-b hover:bg-indigo-50 cursor-pointer">
                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{log.date}</td>
                      {fields.filter(f => isNumeric(f.type)).slice(0, 7).map(f => (
                        <td key={f.key} className="px-3 py-3 text-right">{fmt(log[f.key], f.type)}</td>
                      ))}
                      {category === 'pa' && <td className="px-3 py-3 text-right">{connectionRate(log).toFixed(1)}%</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? 'Edit' : 'New'} Daily Entry</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="max-w-xs">
                <Label>Date</Label>
                <Input type="date" value={editing.date || ''} onChange={(e) => setEditing({ ...editing, date: e.target.value })} />
              </div>
              {category === 'pa' && (
                <p className="text-xs text-gray-500">Connection Rate is calculated automatically from Calls Done / Connected.</p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {fields.filter(f => isNumeric(f.type)).map(f => {
                  // Daily Performance Score is auto-calculated (read-only) when the
                  // category has a formula.
                  const auto = f.key === 'daily_score' ? computeDailyScore(category, editing) : null;
                  if (f.key === 'daily_score' && auto !== null) {
                    return (
                      <div key={f.key}>
                        <Label className="text-xs">{f.label} <span className="text-gray-400">(auto)</span></Label>
                        <Input type="number" value={auto} disabled className="bg-gray-50 font-semibold" />
                      </div>
                    );
                  }
                  return (
                    <div key={f.key}>
                      <Label className="text-xs">{f.label}</Label>
                      <Input
                        type="number" step="0.01"
                        value={editing[f.key] ?? ''}
                        onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value === '' ? '' : Number(e.target.value) })}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {fields.filter(f => f.type === 'yn').map(f => (
                  <div key={f.key}>
                    <Label className="text-xs">{f.label}</Label>
                    <select value={editing[f.key] || 'N'} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })}
                      className="w-full h-10 rounded-md border border-input bg-white px-3 text-sm">
                      <option value="N">No</option>
                      <option value="Y">Yes</option>
                    </select>
                  </div>
                ))}
              </div>
              <div className="space-y-3">
                {fields.filter(f => f.type === 'text').map(f => (
                  <div key={f.key}>
                    <Label className="text-xs">{f.label}</Label>
                    <Input value={editing[f.key] || ''} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })} />
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button className="bg-indigo-600 hover:bg-indigo-700" disabled={saveMutation.isPending || !editing?.date}
              onClick={() => saveMutation.mutate(editing)}>
              {saveMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Saving…</> : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
