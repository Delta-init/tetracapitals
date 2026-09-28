import React, { useState } from 'react';
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

const SCOPE_LABEL = { all: 'All students', downline: 'Downline', own: 'Own only' };

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
      return base44.entities.CommissionRole.create({ ...payload, role_key });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-roles'] });
      toast.success(editing?.id ? 'Role updated' : 'Role created');
      setEditing(null);
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Layers className="h-7 w-7 text-indigo-600" /> Roles
            </h1>
            <p className="text-gray-600 mt-1 text-sm">
              Create roles and tick the pages each role can access. Assign a role to each staff in Personnel; the hierarchy (who reports to whom) is set per-staff there.
            </p>
          </div>
          <Button onClick={openNew} className="bg-indigo-600 hover:bg-indigo-700"><Plus className="h-4 w-4 mr-1" /> New Role</Button>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead>Role</TableHead>
                    <TableHead>Pages allowed</TableHead>
                    <TableHead>Data scope</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roles.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-10 text-gray-400">No roles yet. Create your first role.</TableCell></TableRow>
                  ) : roles.map(r => (
                    <TableRow key={r.id} className="hover:bg-gray-50">
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-sm text-gray-600">{Array.isArray(r.page_permissions) ? r.page_permissions.length : 0} page(s)</TableCell>
                      <TableCell className="text-sm text-gray-600">{SCOPE_LABEL[r.data_scope] || 'Own only'}</TableCell>
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
                <Label>Data scope</Label>
                <select
                  value={form.data_scope}
                  onChange={e => setForm(f => ({ ...f, data_scope: e.target.value }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="all">All students (see everything)</option>
                  <option value="downline">Downline (students of staff under them, via Up Head)</option>
                  <option value="own">Own only (students they created / are primary for)</option>
                </select>
                <p className="text-xs text-gray-400">Which records this role sees inside pages. (Takes effect once permission enforcement is wired.)</p>
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
