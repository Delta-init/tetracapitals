import React, { useMemo, useState } from 'react';
import { PageTitle } from '@/components/common/PageHeader';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, Layers, ShieldAlert, Lock, RotateCcw, AlertTriangle } from 'lucide-react';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import {
  DEFAULT_SCOPES, SCOPE_LABELS, BUILTIN_ROLES, BUILTIN_ROLE_NAMES, isAdminRole,
} from '@/components/utils/roles';
import { NAV_ITEMS, NAV_GROUPS, GROUP_OF, navLabel, defaultPagesFor } from '@/components/utils/navigation';

// Every page a role's access can be toggled for — the sidebar's pages (a
// `sameAccessAs` page comes with its partner: Calls with Follow-ups; an
// `everyone` page, like the Mentor Calendar, is for every role).
const PAGES = NAV_ITEMS.filter(i => !i.hidden && !i.sameAccessAs && !i.everyone).map(i => i.name);
// Hidden pages aren't offered here, but a role that already lists one keeps it
// on save, so un-hiding a page later restores it for those roles.
const keptHidden = (doc) => (Array.isArray(doc?.page_permissions) ? doc.page_permissions : []).filter(p => !PAGES.includes(p));
const LABEL_OF = Object.fromEntries(NAV_ITEMS.map(i => [i.name, navLabel(i)]));
const PAGE_GROUPS = NAV_GROUPS
  .map(group => ({ group, pages: PAGES.filter(p => (GROUP_OF[p] || 'More') === group) }))
  .filter(g => g.pages.length);

const SCOPE_OPTIONS = [
  { value: 'own', label: 'Own students', hint: 'Only students they are the primary mentor for (or created)' },
  { value: 'downline', label: 'Team students', hint: 'Their students plus everyone on their team (via Up Head)' },
  { value: 'all', label: 'Full system', hint: 'Every student in the system' },
];
const DEFAULT_RULES = '';

const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));

const emptyForm = { name: '', page_permissions: [], data_scope: 'own', active: true };

/**
 * Role Management: every role — built-in and custom — with its people, pages
 * and visibility. Built-in roles' pages default to the sidebar's per-page role
 * lists (navigation.js); an override is stored as page_permissions on a
 * commission_roles doc with the built-in role_key (the sidebar already honours
 * it). Super Admin is fixed to its default pages so nobody can lock themselves out.
 */
export default function RolesManagement() {
  const [currentUser, setCurrentUser] = useState(null);
  // What the dialog is editing: { kind: 'builtin', key } | { kind: 'custom', doc } | { kind: 'new' }
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState(null);
  const [savedKey, setSavedKey] = useState(null);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    base44.auth.me().then(u => setCurrentUser(getEffectiveUser(u))).catch(() => setCurrentUser(null));
  }, []);

  const { data: roles = [] } = useQuery({
    queryKey: ['commission-roles'],
    queryFn: () => base44.entities.CommissionRole.list('name'),
    enabled: !!currentUser,
  });
  const { data: users = [] } = useQuery({
    queryKey: ['users-role-counts'],
    queryFn: () => base44.entities.User.list(),
    enabled: !!currentUser,
  });

  const peopleOf = useMemo(() => {
    const m = {};
    for (const u of users) if (u.app_role) m[u.app_role] = (m[u.app_role] || 0) + 1;
    return m;
  }, [users]);

  const docOf = (key) => roles.find(r => r.role_key === key);

  // One row per role, built-ins first (in BUILTIN_ROLE_NAMES order).
  const rows = useMemo(() => {
    const builtin = Object.keys(BUILTIN_ROLE_NAMES).map(key => {
      const doc = roles.find(r => r.role_key === key);
      const override = key !== 'super_admin' && Array.isArray(doc?.page_permissions);
      return {
        rowKey: key,
        kind: 'builtin',
        key,
        name: BUILTIN_ROLE_NAMES[key],
        pages: override ? doc.page_permissions.filter(p => PAGES.includes(p)) : defaultPagesFor(key),
        customised: override,
        scope: isAdminRole(key) ? 'all' : (doc?.data_scope || DEFAULT_SCOPES[key] || null),
        locked: key === 'super_admin',
        active: true,
      };
    });
    const custom = roles
      .filter(r => r.role_key && !BUILTIN_ROLES.includes(r.role_key) && !r.builtin)
      .map(r => ({
        rowKey: r.id,
        kind: 'custom',
        key: r.role_key,
        doc: r,
        name: r.name,
        pages: Array.isArray(r.page_permissions) ? r.page_permissions.filter(p => PAGES.includes(p)) : [],
        customised: false,
        scope: r.data_scope || 'own',
        locked: false,
        active: r.active !== false,
      }));
    return [...builtin, ...custom];
  }, [roles]);

  const openRow = (row) => {
    setFormError(null);
    if (row.kind === 'builtin') {
      setForm({
        name: row.name,
        page_permissions: [...row.pages],
        data_scope: isAdminRole(row.key) ? 'all' : (docOf(row.key)?.data_scope || DEFAULT_SCOPES[row.key] || DEFAULT_RULES),
        active: true,
      });
      setEditing({ kind: 'builtin', key: row.key });
    } else {
      setForm({
        name: row.doc.name || '',
        page_permissions: [...row.pages],
        data_scope: row.doc.data_scope || 'own',
        active: row.doc.active !== false,
      });
      setEditing({ kind: 'custom', doc: row.doc });
    }
  };
  const openNew = () => { setFormError(null); setForm(emptyForm); setEditing({ kind: 'new' }); };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing.kind === 'builtin') {
        const key = editing.key;
        const doc = docOf(key);
        // Store only what differs from the built-in defaults (null = default).
        const hidden = keptHidden(doc);
        const pages = sameSet(form.page_permissions, defaultPagesFor(key)) && !hidden.length ? null : [...form.page_permissions, ...hidden];
        const scope = isAdminRole(key) || !form.data_scope || form.data_scope === DEFAULT_SCOPES[key] ? null : form.data_scope;
        if (doc) return base44.entities.CommissionRole.update(doc.id, { page_permissions: pages, data_scope: scope });
        if (pages === null && scope === null) return null; // nothing to store
        return base44.entities.CommissionRole.create({
          name: BUILTIN_ROLE_NAMES[key], role_key: key, builtin: true, active: true,
          page_permissions: pages, data_scope: scope,
        });
      }
      const payload = {
        name: form.name.trim(),
        page_permissions: [...form.page_permissions, ...(editing.kind === 'custom' ? keptHidden(editing.doc) : [])],
        data_scope: form.data_scope || 'own',
        active: !!form.active,
      };
      if (editing.kind === 'custom') return base44.entities.CommissionRole.update(editing.doc.id, payload);
      // Generate a stable key from the name on create — this becomes the user's
      // app_role value, so it must not change when the name is later edited.
      const role_key = form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (BUILTIN_ROLES.includes(role_key)) {
        throw new Error(`"${form.name.trim()}" is a built-in role — edit it in the list instead.`);
      }
      if (roles.some(r => r.role_key === role_key)) throw new Error(`A role named "${form.name.trim()}" already exists.`);
      return base44.entities.CommissionRole.create({ ...payload, role_key });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-roles'] });
      const key = editing.kind === 'builtin' ? editing.key : editing.doc?.id;
      if (key) { setSavedKey(key); setTimeout(() => setSavedKey(k => (k === key ? null : k)), 2500); }
      setEditing(null);
    },
    onError: (e) => setFormError(e?.message || 'Save failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.CommissionRole.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['commission-roles'] }),
  });

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

  const builtinKey = editing?.kind === 'builtin' ? editing.key : null;
  const pagesLocked = builtinKey === 'super_admin';
  const scopeLocked = builtinKey && isAdminRole(builtinKey);
  const scopeOptions = builtinKey && !DEFAULT_SCOPES[builtinKey] && !isAdminRole(builtinKey)
    ? [{ value: DEFAULT_RULES, label: 'Default rules', hint: 'Keep this role’s built-in rules' }, ...SCOPE_OPTIONS]
    : SCOPE_OPTIONS;
  const pagesDiffer = builtinKey && !sameSet(form.page_permissions, defaultPagesFor(builtinKey));
  const scopeText = (s) => (s ? SCOPE_LABELS[s] : 'Default rules');

  const renderRow = (row) => (
    <TableRow key={row.rowKey} className="hover:bg-slate-50/60">
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-900">{row.name}</span>
          {row.locked && <Lock className="h-3.5 w-3.5 text-slate-400" />}
          {row.customised && (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Customised</Badge>
          )}
          {row.kind === 'custom' && !row.active && (
            <Badge variant="outline" className="bg-slate-100 text-slate-500">Inactive</Badge>
          )}
          {savedKey === (row.kind === 'builtin' ? row.key : row.rowKey) && (
            <span className="text-xs font-medium text-emerald-600">Saved</span>
          )}
        </div>
      </TableCell>
      <TableCell className="tabular text-sm text-slate-700">{peopleOf[row.key] || 0}</TableCell>
      <TableCell className="max-w-[340px] text-sm text-slate-600">
        <span className="font-semibold text-slate-800">{row.pages.length}</span>
        <span className="text-slate-400"> / {PAGES.length}</span>
        <span className="ml-2 hidden truncate text-xs text-slate-400 lg:inline">
          {row.pages.slice(0, 3).map(p => LABEL_OF[p] || p).join(', ')}{row.pages.length > 3 ? '…' : ''}
        </span>
      </TableCell>
      <TableCell className="text-sm text-slate-600">{scopeText(row.scope)}</TableCell>
      <TableCell className="whitespace-nowrap text-right">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-brand-navy" onClick={() => openRow(row)} title={row.locked ? 'View' : 'Edit'}>
          <Pencil className="h-4 w-4" />
        </Button>
        {row.kind === 'custom' && (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:bg-rose-50 hover:text-rose-600" title="Delete" disabled={deleteMutation.isPending}
            onClick={() => { if (window.confirm(`Delete role "${row.name}"?`)) deleteMutation.mutate(row.doc.id); }}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </TableCell>
    </TableRow>
  );

  const builtinRows = rows.filter(r => r.kind === 'builtin');
  const customRows = rows.filter(r => r.kind === 'custom');
  const sectionRow = (label, count) => (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={5} className="bg-slate-50/70 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label} · {count}
      </TableCell>
    </TableRow>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-100/20 p-6">
      <div className="w-full space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <PageTitle eyebrow="People & Access" icon={Layers}>Roles</PageTitle>
            <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
              Every role, how many people have it, the pages it can open and what it can see. Assign a role to each staff in Personnel.
            </p>
          </div>
          <Button onClick={openNew}><Plus className="h-4 w-4" /> New role</Button>
        </div>

        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Role</TableHead>
                    <TableHead>People</TableHead>
                    <TableHead>Pages</TableHead>
                    <TableHead>Visibility</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sectionRow('Built-in roles', builtinRows.length)}
                  {builtinRows.map(renderRow)}
                  {sectionRow('Custom roles', customRows.length)}
                  {customRows.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-slate-400">No custom roles yet. Use New role to create one.</TableCell></TableRow>
                  ) : customRows.map(renderRow)}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
        <p className="text-xs text-slate-400">
          Pages control what appears in each person’s sidebar. What someone can do on a page still follows their role’s built-in rules.
        </p>

        {/* Edit / create dialog */}
        <Dialog open={!!editing} onOpenChange={(o) => { if (!o && !saveMutation.isPending) setEditing(null); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-brand-navy">
                {editing?.kind === 'new' ? 'New role' : form.name}
              </DialogTitle>
              <DialogDescription>
                {builtinKey
                  ? `Built-in role · ${peopleOf[builtinKey] || 0} people`
                  : editing?.kind === 'custom' ? `Custom role · ${peopleOf[editing.doc.role_key] || 0} people` : 'A custom role you can assign in Personnel.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              {!builtinKey && (
                <div className="space-y-2">
                  <Label>Role name *</Label>
                  <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. CS Manager, Sales" />
                </div>
              )}

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>Pages <span className="font-normal text-slate-400">· {form.page_permissions.length} of {PAGES.length}</span></Label>
                  {!pagesLocked && (
                    <div className="flex gap-2">
                      {builtinKey && pagesDiffer && (
                        <Button type="button" size="sm" variant="outline" onClick={() => setForm(f => ({ ...f, page_permissions: defaultPagesFor(builtinKey) }))}>
                          <RotateCcw className="h-3.5 w-3.5" /> Reset to default
                        </Button>
                      )}
                      <Button type="button" size="sm" variant="outline" onClick={() => setForm(f => ({ ...f, page_permissions: [...PAGES] }))}>All</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setForm(f => ({ ...f, page_permissions: [] }))}>None</Button>
                    </div>
                  )}
                </div>
                {pagesLocked && (
                  <p className="flex items-center gap-1.5 text-xs text-slate-500"><Lock className="h-3.5 w-3.5" /> Super Admin always keeps its default pages, so nobody can be locked out.</p>
                )}
                <div className="max-h-72 space-y-3 overflow-y-auto rounded-xl border border-slate-200 p-3">
                  {PAGE_GROUPS.map(({ group, pages }) => (
                    <div key={group}>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">{group}</p>
                      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 md:grid-cols-3">
                        {pages.map(page => {
                          const isDefault = builtinKey && defaultPagesFor(builtinKey).includes(page);
                          return (
                            <label key={page} className={`flex items-center gap-2 rounded-md px-1.5 py-1 text-sm ${pagesLocked ? 'opacity-70' : 'cursor-pointer hover:bg-slate-50'}`}>
                              <input
                                type="checkbox"
                                disabled={pagesLocked}
                                checked={form.page_permissions.includes(page)}
                                onChange={() => togglePage(page)}
                                className="h-4 w-4 accent-[#002950]"
                              />
                              <span className="truncate">{LABEL_OF[page]}</span>
                              {builtinKey && !pagesLocked && isDefault && <span className="text-[10px] text-slate-400">default</span>}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                {builtinKey && pagesDiffer && !pagesLocked && (
                  <p className="text-xs text-amber-700">Differs from this role’s default pages — it will show as Customised.</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Visibility</Label>
                {scopeLocked ? (
                  <p className="flex items-center gap-1.5 text-sm text-slate-500"><Lock className="h-3.5 w-3.5" /> Admin roles always see the full system.</p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100/80 p-1">
                      {scopeOptions.map(o => (
                        <button
                          key={o.value || 'default'}
                          type="button"
                          onClick={() => setForm(f => ({ ...f, data_scope: o.value }))}
                          className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                            form.data_scope === o.value ? 'bg-white text-brand-navy shadow-soft' : 'text-slate-500 hover:text-brand-navy'
                          }`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-slate-400">
                      {scopeOptions.find(o => o.value === form.data_scope)?.hint} · applies to students, funding requests and commission.
                    </p>
                  </>
                )}
              </div>

              {!builtinKey && (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} className="h-4 w-4 accent-[#002950]" />
                  Active
                </label>
              )}

              {formError && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /> {formError}
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setEditing(null)} disabled={saveMutation.isPending}>
                {pagesLocked && scopeLocked ? 'Close' : 'Cancel'}
              </Button>
              {!(pagesLocked && scopeLocked) && (
                <Button
                  disabled={saveMutation.isPending || (!builtinKey && !form.name.trim())}
                  onClick={() => saveMutation.mutate()}
                >
                  {saveMutation.isPending ? 'Saving…' : editing?.kind === 'new' ? 'Create role' : 'Save changes'}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
