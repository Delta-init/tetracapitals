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
import { Plus, Pencil, Trash2, Layers, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import { DEFAULT_SCOPES, SCOPE_LABELS, BUILTIN_ROLES } from '@/components/utils/roles';

// The set of pages a role's access can be toggled for. Keep in sync with the
// sidebar in Layout.jsx (plus the new commission pages).
const PAGES = [
  'Dashboard', 'TeamDashboard', 'Teams', 'ActivityTracker', 'AIInsights', 'MentorTraining', 'Leaderboard', 'MentorPerformance',
  'MasterAdmin', 'RolesManagement', 'Hierarchy', 'Personnel', 'AcademicCounselors', 'Students',
  'StudentLogs', 'StudentLogHistoryPage', 'MyStudentRequests', 'StudentRequestApprovals',
  'RetentionManagement', 'DrawAdminStudents', 'MT5Accounts', 'FundingActivities',
  'FundingRequests', 'MyTargets', 'TargetsManagement', 'MyCommissionHistory',
  'QuarterClosing', 'MonthlyClosing', 'DailyPayouts', 'CommissionTools', 'CommissionPlans', 'CommissionReports',
  'BonusCommissionReports', 'DepositCommissionReports', 'GamificationSettings',
  'Transactions', 'TransactionTags', 'Commissions', 'Tickets', 'Reports', 'AuditLogs',
];

const emptyForm = { name: '', page_permissions: [], data_scope: 'own', active: true };

const SCOPE_LABEL = SCOPE_LABELS;

// Built-in roles whose visibility can be set here. Their setting is stored as a
// commission_roles doc with the built-in role_key and NO page_permissions, so
// it changes visibility only — the sidebar keeps its built-in pages.
const BUILTIN_VISIBILITY = [
  { key: 'chief_mentor', name: 'Chief Mentor' },
  { key: 'senior_mentor', name: 'Senior Mentor' },
  { key: 'junior_mentor', name: 'Junior Mentor' },
];
const SCOPE_OPTIONS = [
  { value: 'own', label: 'Own students', hint: 'Only students they are the primary mentor for (or created)' },
  { value: 'downline', label: 'Team students', hint: 'Their students plus everyone on their team (via Up Head)' },
  { value: 'all', label: 'Full system', hint: 'Every student in the system' },
];

export default function RolesManagement() {
  const [currentUser, setCurrentUser] = useState(null);
  const [editing, setEditing] = useState(null); // role being edited, or {} for new
  const [form, setForm] = useState(emptyForm);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    base44.auth.me().then(u => setCurrentUser(getEffectiveUser(u))).catch(() => setCurrentUser(null));
  }, []);

  const { data: roles = [] } = useQuery({
    queryKey: ['commission-roles'],
    queryFn: () => base44.entities.CommissionRole.list('name'),
    enabled: !!currentUser,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        page_permissions: form.page_permissions,
        data_scope: form.data_scope || 'own',
        active: !!form.active,
      };
      if (editing?.id) return base44.entities.CommissionRole.update(editing.id, payload);
      // Generate a stable key from the name on create — this becomes the user's
      // app_role value, so it must not change when the name is later edited.
      const role_key = form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (BUILTIN_ROLES.includes(role_key)) {
        throw new Error(`"${form.name.trim()}" is a built-in role — set its visibility in Built-in roles above.`);
      }
      return base44.entities.CommissionRole.create({ ...payload, role_key });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-roles'] });
      toast.success(editing?.id ? 'Role updated' : 'Role created');
      setEditing(null);
    },
    onError: (e) => toast.error(e?.message || 'Save failed'),
  });

  // Save a built-in role's visibility (creates its settings doc the first time).
  const [savedKey, setSavedKey] = useState(null);
  const visibilityMutation = useMutation({
    mutationFn: async ({ key, name, scope }) => {
      const doc = roles.find(r => r.role_key === key);
      if (doc) return base44.entities.CommissionRole.update(doc.id, { data_scope: scope });
      return base44.entities.CommissionRole.create({ name, role_key: key, data_scope: scope, builtin: true, active: true });
    },
    onSuccess: (_d, { key }) => {
      queryClient.invalidateQueries({ queryKey: ['commission-roles'] });
      setSavedKey(key);
      setTimeout(() => setSavedKey(k => (k === key ? null : k)), 2000);
    },
    onError: (e) => toast.error(e?.message || 'Save failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.CommissionRole.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-roles'] });
      toast.success('Role deleted');
    },
    onError: (e) => toast.error(e?.message || 'Delete failed'),
  });

  const openNew = () => { setForm(emptyForm); setEditing({}); };
  const openEdit = (role) => {
    setForm({
      name: role.name || '',
      page_permissions: Array.isArray(role.page_permissions) ? role.page_permissions : [],
      data_scope: role.data_scope || 'own',
      active: role.active !== false,
    });
    setEditing(role);
  };
  const togglePage = (page) => setForm(f => ({
    ...f,
    page_permissions: f.page_permissions.includes(page)
      ? f.page_permissions.filter(p => p !== page)
      : [...f.page_permissions, page],
  }));

  const isSuper = ['super_admin', 'admin'].includes(currentUser?.app_role);
  const customRoles = roles.filter(r => !r.builtin && !BUILTIN_ROLES.includes(r.role_key));
  if (!currentUser) return <div className="p-8 text-center text-gray-500">Loading…</div>;
  if (!isSuper) {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <Card className="border-red-200"><CardContent className="p-6 text-center space-y-3">
          <ShieldAlert className="h-10 w-10 text-red-600 mx-auto" />
          <h2 className="text-lg font-semibold">Restricted page</h2>
          <p className="text-sm text-gray-600">Role management is limited to admins.</p>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-100/20 p-6">
      <div className="w-full space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <PageTitle eyebrow="People & Access" icon={Layers}>Roles</PageTitle>
            <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
              Create roles and tick the pages each role can access. Assign a role to each staff in Personnel; the hierarchy (who reports to whom) is set per-staff there.
            </p>
          </div>
          <Button onClick={openNew} className="bg-indigo-600 hover:bg-indigo-700"><Plus className="h-4 w-4 mr-1" /> New Role</Button>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-brand-navy">Built-in roles · visibility</h2>
              <p className="mt-1 text-sm text-slate-500">
                Which students, funding requests and commission each role can see.
              </p>
            </div>
            <div className="divide-y divide-slate-100">
              {BUILTIN_VISIBILITY.map(({ key, name }) => {
                const current = roles.find(r => r.role_key === key)?.data_scope || DEFAULT_SCOPES[key];
                const busy = visibilityMutation.isPending && visibilityMutation.variables?.key === key;
                return (
                  <div key={key} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium text-slate-900">{name}</p>
                      <p className="text-xs text-slate-400">{SCOPE_OPTIONS.find(o => o.value === current)?.hint}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {savedKey === key && <span className="text-xs font-medium text-emerald-600">Saved</span>}
                      <div className="inline-flex rounded-xl bg-slate-100/80 p-1">
                        {SCOPE_OPTIONS.map(o => (
                          <button
                            key={o.value}
                            type="button"
                            disabled={busy}
                            onClick={() => o.value !== current && visibilityMutation.mutate({ key, name, scope: o.value })}
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                              current === o.value ? 'bg-white text-brand-navy shadow-soft' : 'text-slate-500 hover:text-brand-navy'
                            }`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-brand-navy">Custom roles</h2>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead>Role</TableHead>
                    <TableHead>Pages allowed</TableHead>
                    <TableHead>Visibility</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customRoles.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-10 text-gray-400">No roles yet. Create your first role.</TableCell></TableRow>
                  ) : customRoles.map(r => (
                    <TableRow key={r.id} className="hover:bg-gray-50">
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-sm text-gray-600">{Array.isArray(r.page_permissions) ? r.page_permissions.length : 0} page(s)</TableCell>
                      <TableCell className="text-sm text-gray-600">{SCOPE_LABEL[r.data_scope] || SCOPE_LABEL.own}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={r.active !== false ? 'bg-green-100 text-green-800 border-green-200' : 'bg-gray-100 text-gray-600'}>
                          {r.active !== false ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600" onClick={() => openEdit(r)} title="Edit"><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" title="Delete" disabled={deleteMutation.isPending}
                          onClick={() => { if (window.confirm(`Delete role "${r.name}"?`)) deleteMutation.mutate(r.id); }}>
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
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editing?.id ? 'Edit Role' : 'New Role'}</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Role name *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Junior Mentor, Senior Mentor, Sales" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Page permissions ({form.page_permissions.length} selected)</Label>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setForm(f => ({ ...f, page_permissions: [...PAGES] }))}>All</Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setForm(f => ({ ...f, page_permissions: [] }))}>None</Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 border rounded-md p-3 max-h-64 overflow-y-auto">
                  {PAGES.map(page => (
                    <label key={page} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                      <input type="checkbox" checked={form.page_permissions.includes(page)} onChange={() => togglePage(page)} className="h-4 w-4" />
                      <span className="truncate">{page}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Visibility</Label>
                <select
                  value={form.data_scope}
                  onChange={e => setForm(f => ({ ...f, data_scope: e.target.value }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {SCOPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label} — {o.hint}</option>)}
                </select>
                <p className="text-xs text-gray-400">Which students, funding requests and commission this role can see.</p>
              </div>

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} className="h-4 w-4" />
                Active
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button className="bg-indigo-600 hover:bg-indigo-700" disabled={saveMutation.isPending || !form.name.trim()} onClick={() => saveMutation.mutate()}>
                {saveMutation.isPending ? 'Saving…' : (editing?.id ? 'Save changes' : 'Create role')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
