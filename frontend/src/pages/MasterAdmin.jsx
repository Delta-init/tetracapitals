import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Search, Edit, Trash2, KeyRound, LogIn, Plus, ShieldAlert, Save, Users } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import PersonnelForm from '../components/personnel/PersonnelForm';
import TagsPicker from '../components/funding/TagsPicker';
import { startImpersonation } from '../components/utils/ImpersonationContext';
import { logAction } from '../components/utils/AuditLogger';

const PAYMENT_METHODS = ['AED TRANSFER','UPI','CARD PAYMENT','USDT','INR TRANSFER','Cash deposit','Cash Withdrawal','Bank Withdrawal','Other'];

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MasterAdmin() {
  const [currentUser, setCurrentUser] = useState(null);
  const [tab, setTab] = useState('transactions');
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => setCurrentUser(null));
  }, []);

  // Transaction editing state
  const [txSearch, setTxSearch] = useState('');
  const [txTypeFilter, setTxTypeFilter] = useState('all');
  const [txStatusFilter, setTxStatusFilter] = useState('all');
  const [txEdit, setTxEdit] = useState(null); // the tx being edited
  const [draft, setDraft] = useState({});     // patch staged for save
  const [selectedIds, setSelectedIds] = useState(() => new Set()); // bulk selection
  const [bulkDate, setBulkDate] = useState('');                     // date to apply in bulk

  // Personnel state — same as the existing Personnel page actions, just lifted here
  const [personnelForm, setPersonnelForm] = useState({ open: false, user: null });
  const [resetPwUser, setResetPwUser] = useState(null);
  const [resetPwValue, setResetPwValue] = useState('');
  const [resetPwShow, setResetPwShow] = useState(false);

  const isSuper = currentUser?.app_role === 'super_admin';

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: transactions = [] } = useQuery({
    queryKey: ['funding-transactions'],
    queryFn: () => base44.entities.FundingTransaction.list('-requested_at'),
    enabled: isSuper,
  });
  const { data: students = [] } = useQuery({
    queryKey: ['students'],
    queryFn: () => base44.entities.Student.list(),
    enabled: isSuper,
  });
  const { data: users = [] } = useQuery({
    queryKey: ['all-users-master-admin'],
    queryFn: async () => {
      const r = await base44.functions.invoke('getAllUsers', {});
      return r.data?.users || [];
    },
    enabled: isSuper,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const editTxMutation = useMutation({
    mutationFn: async ({ id, patch }) => {
      const r = await base44.functions.invoke('masterEditTransaction', { id, patch });
      return r.data;
    },
    onSuccess: (out) => {
      queryClient.invalidateQueries({ queryKey: ['funding-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
      const changed = out?.changed?.length || 0;
      toast.success(`Saved ${changed} change${changed === 1 ? '' : 's'}`);
      setTxEdit(null);
      setDraft({});
    },
    onError: (e) => toast.error(e?.message || 'Save failed'),
  });

  const deleteTxMutation = useMutation({
    mutationFn: async (id) => {
      const r = await base44.functions.invoke('masterDeleteTransaction', { id });
      return r.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['funding-transactions'] });
      toast.success('Transaction deleted');
      setTxEdit(null);
      setDraft({});
    },
    onError: (e) => toast.error(e?.message || 'Delete failed'),
  });

  const bulkEditMutation = useMutation({
    mutationFn: async ({ ids, patch }) => {
      const r = await base44.functions.invoke('masterBulkEditTransactions', { ids, patch });
      return r.data;
    },
    onSuccess: (out) => {
      queryClient.invalidateQueries({ queryKey: ['funding-transactions'] });
      toast.success(`Updated ${out?.modified ?? 0} transaction${(out?.modified ?? 0) === 1 ? '' : 's'}`);
      setSelectedIds(new Set());
      setBulkDate('');
    },
    onError: (e) => toast.error(e?.message || 'Bulk update failed'),
  });

  const createUserMutation = useMutation({
    mutationFn: async (userData) => {
      const response = await base44.functions.invoke('createUser', userData);
      const created = response.data?.user;
      if (created) await logAction('create_user', 'User', created.id, `Created user: ${userData.full_name}`, null, { ...userData, password: '[redacted]' });
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-users-master-admin'] });
      setPersonnelForm({ open: false, user: null });
      toast.success('User created');
    },
    onError: (e) => toast.error(e?.message || 'Failed to create user'),
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ userId, userData }) => {
      const response = await base44.functions.invoke('updateUser', { userId, userData });
      await logAction('update_user', 'User', userId, `Updated user: ${userData.full_name}`, null, userData);
      return response.data?.user;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-users-master-admin'] });
      setPersonnelForm({ open: false, user: null });
      toast.success('User updated');
    },
    onError: (e) => toast.error(e?.message || 'Update failed'),
  });

  const resetPwMutation = useMutation({
    mutationFn: async ({ userId, newPassword, userName }) => {
      const r = await base44.functions.invoke('resetUserPassword', { userId, newPassword });
      await logAction('reset_user_password', 'User', userId, `Reset password for ${userName}`, null, { user_id: userId });
      return r.data;
    },
    onSuccess: (_, vars) => {
      toast.success(`Password reset for ${vars.userName}`);
      setResetPwUser(null);
      setResetPwValue('');
      setResetPwShow(false);
    },
    onError: (e) => toast.error(e?.message || 'Failed to reset password'),
  });

  // ── Computed: filtered transactions ───────────────────────────────────────
  const visibleTxs = useMemo(() => {
    const q = txSearch.trim().toLowerCase();
    return transactions.filter(t => {
      if (txTypeFilter !== 'all' && t.type !== txTypeFilter) return false;
      if (txStatusFilter !== 'all' && t.status !== txStatusFilter) return false;
      if (!q) return true;
      const has = (v) => v != null && String(v).toLowerCase().includes(q);
      return (
        has(t.student_name) ||
        has(t.student_code) ||
        has(t.transaction_id) ||
        has(t.mt5_login) ||
        has(t.primary_mentor_name) ||
        has(t.initiating_mentor_name)
      );
    }).slice(0, 500);
  }, [transactions, txSearch, txTypeFilter, txStatusFilter]);

  // ── Bulk selection ─────────────────────────────────────────────────────────
  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const allVisibleSelected = visibleTxs.length > 0 && visibleTxs.every(t => selectedIds.has(t.id));
  const toggleSelectAllVisible = () => setSelectedIds(prev => {
    const next = new Set(prev);
    if (visibleTxs.every(t => next.has(t.id))) visibleTxs.forEach(t => next.delete(t.id));
    else visibleTxs.forEach(t => next.add(t.id));
    return next;
  });
  const applyBulkDate = () => {
    if (!bulkDate || selectedIds.size === 0) return;
    // Anchor at local noon so the calendar date can't slip across midnight in UTC.
    const iso = new Date(`${bulkDate}T12:00:00`).toISOString();
    if (isNaN(new Date(iso).getTime())) { toast.error('Invalid date'); return; }
    if (!window.confirm(`Set the Requested date to ${bulkDate} for ${selectedIds.size} selected transaction(s)?`)) return;
    bulkEditMutation.mutate({ ids: Array.from(selectedIds), patch: { requested_at: iso } });
  };

  // ── Edit dialog helpers ───────────────────────────────────────────────────
  const openEdit = (tx) => {
    setTxEdit(tx);
    setDraft({
      type: tx.type,
      status: tx.status,
      amount_usd: tx.amount_usd ?? 0,
      requested_at: tx.requested_at || tx.created_date,
      transaction_id: tx.transaction_id || '',
      payment_method: tx.payment_method || '',
      mt5_login: tx.mt5_login || '',
      notes: tx.notes || '',
      tags: Array.isArray(tx.tags) ? tx.tags : [],
      student_id: tx.student_id || '',
      initiating_mentor_id: tx.initiating_mentor_id || '',
      primary_mentor_id: tx.primary_mentor_id || '',
      rejection_reason: tx.rejection_reason || '',
    });
  };

  const setField = (key, value) => setDraft(d => ({ ...d, [key]: value }));

  // When student changes, sync student_name and student_code to the new selection
  const onChangeStudent = (newId) => {
    const s = students.find(x => x.id === newId);
    setDraft(d => ({
      ...d,
      student_id: newId,
      // also bubble the picked student's primary mentor as a courtesy
      primary_mentor_id: s?.primary_mentor_id || d.primary_mentor_id,
    }));
  };

  const saveTx = () => {
    if (!txEdit) return;
    // Build the patch with derived display fields so the DB stays consistent
    const patch = { ...draft };
    if (patch.student_id) {
      const s = students.find(x => x.id === patch.student_id);
      if (s) { patch.student_name = s.full_name; patch.student_code = s.student_code; }
    }
    if (patch.initiating_mentor_id) {
      const u = users.find(x => x.id === patch.initiating_mentor_id);
      if (u) patch.initiating_mentor_name = u.full_name;
    } else {
      patch.initiating_mentor_id = null;
      patch.initiating_mentor_name = null;
    }
    if (patch.primary_mentor_id) {
      const u = users.find(x => x.id === patch.primary_mentor_id);
      if (u) patch.primary_mentor_name = u.full_name;
    }
    // Convert local-input datetime back to ISO
    if (patch.requested_at && !patch.requested_at.includes('Z')) {
      const d = new Date(patch.requested_at);
      patch.requested_at = isNaN(d.getTime()) ? null : d.toISOString();
    }
    // Coerce numeric
    patch.amount_usd = Number(patch.amount_usd);
    // Empty strings -> null for cleanly-clearable fields
    for (const k of ['transaction_id', 'rejection_reason', 'notes', 'mt5_login']) {
      if (patch[k] === '') patch[k] = null;
    }
    editTxMutation.mutate({ id: txEdit.id, patch });
  };

  const deleteTx = () => {
    if (!txEdit) return;
    if (!confirm(`Permanently delete this ${txEdit.type} of $${txEdit.amount_usd?.toFixed(2)} for ${txEdit.student_name}?\n\nThis cannot be undone. The transaction is removed from every page that aggregates over it (Reports, MentorPerformance, Quarter Closing, Daily Payouts, etc.). A full snapshot is preserved in the audit log if recovery is needed.`)) return;
    deleteTxMutation.mutate(txEdit.id);
  };

  // ── Access gate ───────────────────────────────────────────────────────────
  if (!currentUser) return <div className="p-8 text-center text-gray-500">Loading…</div>;
  if (!isSuper) {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <Card className="border-red-200">
          <CardContent className="p-6 text-center space-y-3">
            <ShieldAlert className="h-10 w-10 text-red-600 mx-auto" />
            <h2 className="text-lg font-semibold">Restricted page</h2>
            <p className="text-sm text-gray-600">Master Admin Tools are visible only to super admin accounts.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const mentors = users; // for the editable mentor dropdowns
  const userRoleBadge = (role) => {
    const colors = {
      super_admin: 'bg-purple-100 text-purple-800',
      admin: 'bg-red-100 text-red-800',
      broker_admin: 'bg-orange-100 text-orange-800',
      academic_head: 'bg-blue-100 text-blue-800',
      academic_admin: 'bg-cyan-100 text-cyan-800',
      senior_mentor: 'bg-green-100 text-green-800',
      junior_mentor: 'bg-yellow-100 text-yellow-800',
      finance_admin: 'bg-indigo-100 text-indigo-800',
      assistance: 'bg-pink-100 text-pink-800',
    };
    return colors[role] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-100/20 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShieldAlert className="h-7 w-7 text-red-600" />
            Master Admin
          </h1>
          <p className="text-gray-600 mt-1 text-sm">
            Full edit access to any transaction and any user. Every change is audit-logged with before/after snapshots.
          </p>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="transactions">Transactions ({transactions.length})</TabsTrigger>
            <TabsTrigger value="personnel">Personnel ({users.length})</TabsTrigger>
          </TabsList>

          {/* ── Transactions tab ─────────────────────────────────────────── */}
          <TabsContent value="transactions" className="space-y-3">
            <Card>
              <CardContent className="p-4 flex flex-wrap gap-3">
                <div className="flex-1 min-w-[200px] relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input value={txSearch} onChange={(e) => setTxSearch(e.target.value)} className="pl-9" placeholder="Search student, code, txn id, mt5, mentor…" />
                </div>
                <Select value={txTypeFilter} onValueChange={setTxTypeFilter}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    <SelectItem value="DEPOSIT">Deposit</SelectItem>
                    <SelectItem value="WITHDRAWAL">Withdrawal</SelectItem>
                    <SelectItem value="BONUS">Bonus</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={txStatusFilter} onValueChange={setTxStatusFilter}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="APPROVED">Approved</SelectItem>
                    <SelectItem value="REJECTED">Rejected</SelectItem>
                  </SelectContent>
                </Select>
                <span className="self-center text-sm text-gray-500">{visibleTxs.length} of {transactions.length}</span>
              </CardContent>
            </Card>

            {/* Bulk date editor — appears once rows are selected */}
            {selectedIds.size > 0 && (
              <Card className="border-blue-300 bg-blue-50">
                <CardContent className="p-3 flex flex-wrap items-center gap-3">
                  <span className="text-sm font-semibold text-blue-800">{selectedIds.size} selected</span>
                  <span className="text-sm text-gray-600">Set <strong>Requested date</strong> to:</span>
                  <Input type="date" value={bulkDate} onChange={e => setBulkDate(e.target.value)} className="w-44 h-9" />
                  <Button size="sm" onClick={applyBulkDate} disabled={!bulkDate || bulkEditMutation.isPending} className="bg-blue-600 hover:bg-blue-700">
                    {bulkEditMutation.isPending ? 'Applying…' : `Apply to ${selectedIds.size}`}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear selection</Button>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="w-8">
                        <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} aria-label="Select all" className="h-4 w-4 cursor-pointer align-middle" />
                      </TableHead>
                      <TableHead>Requested</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead>Initiated by</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Txn ID</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleTxs.length === 0 ? (
                      <TableRow><TableCell colSpan={9} className="text-center py-8 text-gray-500">No transactions match.</TableCell></TableRow>
                    ) : visibleTxs.map(t => (
                      <TableRow key={t.id} className={`hover:bg-gray-50 ${selectedIds.has(t.id) ? 'bg-blue-50' : ''}`}>
                        <TableCell className="w-8">
                          <input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => toggleSelect(t.id)} aria-label="Select row" className="h-4 w-4 cursor-pointer align-middle" />
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{t.requested_at ? format(new Date(t.requested_at), 'MMM d, yyyy HH:mm') : '-'}</TableCell>
                        <TableCell><Badge variant="outline">{t.type}</Badge></TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            t.status === 'APPROVED' ? 'bg-green-100 text-green-800 border-green-200' :
                            t.status === 'PENDING' ? 'bg-yellow-100 text-yellow-800 border-yellow-200' :
                            'bg-red-100 text-red-800 border-red-200'
                          }>{t.status}</Badge>
                        </TableCell>
                        <TableCell className="font-medium">
                          {t.student_name} <span className="font-mono text-xs text-gray-400">{t.student_code}</span>
                        </TableCell>
                        <TableCell className="text-sm">{t.initiating_mentor_name || t.primary_mentor_name || '-'}</TableCell>
                        <TableCell className="text-right font-mono">${(t.amount_usd ?? 0).toFixed(2)}</TableCell>
                        <TableCell className="text-sm font-mono">{t.transaction_id || '-'}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(t)} title="Edit">
                            <Edit className="h-4 w-4 text-blue-600" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Personnel tab ────────────────────────────────────────────── */}
          <TabsContent value="personnel" className="space-y-3">
            <div className="flex justify-end">
              <Button onClick={() => setPersonnelForm({ open: true, user: null })} className="bg-blue-600 hover:bg-blue-700">
                <Plus className="h-4 w-4 mr-2" />Add User
              </Button>
            </div>
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Commission</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map(u => (
                      <TableRow key={u.id} className="hover:bg-gray-50">
                        <TableCell className="font-medium">{u.full_name}</TableCell>
                        <TableCell className="text-sm">{u.email}</TableCell>
                        <TableCell><Badge className={userRoleBadge(u.app_role)}>{u.app_role?.replace(/_/g, ' ')}</Badge></TableCell>
                        <TableCell>{['junior_mentor','senior_mentor'].includes(u.app_role) ? `${u.commission_rate ?? 4}%` : '-'}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setPersonnelForm({ open: true, user: u })} title="Edit user">
                              <Edit className="h-4 w-4" />
                            </Button>
                            {u.app_role !== 'super_admin' && u.app_role !== 'broker_admin' && (
                              <Button size="sm" variant="ghost" className="text-amber-600 hover:bg-amber-50" title={`Impersonate ${u.full_name}`}
                                onClick={async () => {
                                  await logAction('other', 'User', u.id, `Super admin started impersonating ${u.full_name} (${u.app_role})`, null, {});
                                  startImpersonation(u, currentUser);
                                }}>
                                <LogIn className="h-4 w-4" />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="text-blue-600 hover:bg-blue-50" title="Reset password"
                              onClick={() => { setResetPwUser(u); setResetPwValue(''); setResetPwShow(false); }}>
                              <KeyRound className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Transaction edit dialog ───────────────────────────────────── */}
      <Dialog open={!!txEdit} onOpenChange={(o) => !o && (setTxEdit(null), setDraft({}))}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="h-5 w-5 text-blue-600" />
              Edit Transaction
              {txEdit && <span className="text-xs font-mono text-gray-400 ml-2">{txEdit.id}</span>}
            </DialogTitle>
          </DialogHeader>
          {txEdit && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Type</Label>
                  <Select value={draft.type} onValueChange={(v) => setField('type', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DEPOSIT">Deposit</SelectItem>
                      <SelectItem value="WITHDRAWAL">Withdrawal</SelectItem>
                      <SelectItem value="BONUS">Bonus</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={draft.status} onValueChange={(v) => setField('status', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PENDING">Pending</SelectItem>
                      <SelectItem value="APPROVED">Approved (reinstate)</SelectItem>
                      <SelectItem value="REJECTED">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Amount (USD)</Label>
                  <Input type="number" step="0.01" value={draft.amount_usd}
                    onChange={(e) => setField('amount_usd', e.target.value)} />
                </div>
                <div>
                  <Label>Requested at</Label>
                  <Input type="datetime-local" value={toLocalInput(draft.requested_at)}
                    onChange={(e) => setField('requested_at', e.target.value)} />
                </div>
                <div>
                  <Label>Transaction ID</Label>
                  <Input value={draft.transaction_id || ''} onChange={(e) => setField('transaction_id', e.target.value)}
                    placeholder="(empty to clear)" />
                </div>
                <div>
                  <Label>Payment Method</Label>
                  <Select value={draft.payment_method || ''} onValueChange={(v) => setField('payment_method', v)}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>MT5 Login</Label>
                  <Input value={draft.mt5_login || ''} onChange={(e) => setField('mt5_login', e.target.value)} />
                </div>
                <div>
                  <Label>Student</Label>
                  <Select value={draft.student_id} onValueChange={onChangeStudent}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {students.slice(0, 500).map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.student_code} — {s.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Initiating Mentor</Label>
                  {/* Radix Select disallows value="" so we use a sentinel that
                      we translate back to null at submit time. */}
                  <Select
                    value={draft.initiating_mentor_id || '__none__'}
                    onValueChange={(v) => setField('initiating_mentor_id', v === '__none__' ? '' : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="(none)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">(none — use primary)</SelectItem>
                      {mentors.map(u => (
                        <SelectItem key={u.id} value={u.id}>{u.full_name} ({u.app_role?.replace(/_/g, ' ')})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Primary Mentor</Label>
                  <Select value={draft.primary_mentor_id} onValueChange={(v) => setField('primary_mentor_id', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {mentors.map(u => (
                        <SelectItem key={u.id} value={u.id}>{u.full_name} ({u.app_role?.replace(/_/g, ' ')})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {draft.type === 'BONUS' && (
                <div>
                  <Label>Tag</Label>
                  <TagsPicker value={draft.tags || []} onChange={(t) => setField('tags', t)} />
                </div>
              )}

              {draft.status === 'REJECTED' && (
                <div>
                  <Label>Rejection Reason</Label>
                  <Input value={draft.rejection_reason || ''} onChange={(e) => setField('rejection_reason', e.target.value)} />
                </div>
              )}

              <div>
                <Label>Notes</Label>
                <Textarea rows={2} value={draft.notes || ''} onChange={(e) => setField('notes', e.target.value)} />
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900">
                <strong>Heads up:</strong> changes are live immediately on every page that aggregates over transactions (Dashboard, Reports, MentorPerformance, Quarter Closing, Daily Payouts, etc.). Already-released daily 1% payouts are NOT auto-reversed — delete them manually from Commission Tools if needed.
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="destructive" onClick={deleteTx} disabled={deleteTxMutation.isPending}>
              <Trash2 className="h-4 w-4 mr-1" />Delete
            </Button>
            <div className="flex-1" />
            <Button variant="outline" onClick={() => { setTxEdit(null); setDraft({}); }}>Cancel</Button>
            <Button onClick={saveTx} disabled={editTxMutation.isPending} className="bg-blue-600 hover:bg-blue-700">
              <Save className="h-4 w-4 mr-1" />{editTxMutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Personnel form (create/edit) ──────────────────────────────── */}
      {personnelForm.open && (
        <PersonnelForm
          user={personnelForm.user}
          allUsers={users}
          onSubmit={(formData) => {
            if (personnelForm.user) {
              const { password, ...rest } = formData;
              updateUserMutation.mutate({ userId: personnelForm.user.id, userData: rest });
            } else {
              createUserMutation.mutate(formData);
            }
          }}
          onClose={() => setPersonnelForm({ open: false, user: null })}
        />
      )}

      {/* ── Reset password dialog ─────────────────────────────────────── */}
      <Dialog open={!!resetPwUser} onOpenChange={(o) => !o && setResetPwUser(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-blue-600" />Reset password</DialogTitle>
          </DialogHeader>
          {resetPwUser && (
            <div className="space-y-3">
              <div className="bg-gray-50 rounded p-3 text-sm space-y-1">
                <p><span className="text-gray-500">User:</span> <strong>{resetPwUser.full_name}</strong></p>
                <p><span className="text-gray-500">Email:</span> {resetPwUser.email}</p>
              </div>
              <div>
                <Label>New Password</Label>
                <div className="flex gap-2 mt-1">
                  <Input type={resetPwShow ? 'text' : 'password'} value={resetPwValue}
                    onChange={(e) => setResetPwValue(e.target.value)} minLength={8} autoComplete="new-password" autoFocus />
                  <Button type="button" variant="outline" onClick={() => setResetPwShow(s => !s)}>{resetPwShow ? 'Hide' : 'Show'}</Button>
                  <Button type="button" variant="outline" onClick={() => {
                    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
                    let out = ''; for (let i=0;i<12;i++) out += chars[Math.floor(Math.random()*chars.length)];
                    setResetPwValue(out); setResetPwShow(true);
                  }}>Generate</Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPwUser(null)} disabled={resetPwMutation.isPending}>Cancel</Button>
            <Button onClick={() => {
              if (!resetPwUser || !resetPwValue || resetPwValue.length < 8) { toast.error('Password must be at least 8 characters'); return; }
              resetPwMutation.mutate({ userId: resetPwUser.id, newPassword: resetPwValue, userName: resetPwUser.full_name });
            }} className="bg-blue-600 hover:bg-blue-700" disabled={resetPwMutation.isPending}>
              {resetPwMutation.isPending ? 'Resetting…' : 'Reset password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
