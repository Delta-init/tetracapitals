import React, { useState } from 'react';
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, CheckCircle, Pencil, Trash2 } from "lucide-react";
import { canCreateMT5Account } from "../utils/StudentAccessControl";
import { useStudentMt5, MT5_LOGIN, mt5LoginOf } from "./mt5Accounts";
import { toast } from "sonner";

export default function MT5AccountSection({ student, currentUser }) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  // Edit or remove one (the user, 2026-10-14): whoever may add — a login typed wrong.
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState({
    mt5_login: '',
    platform: 'MT5',
    account_type: 'LIVE',
    base_currency: 'USD',
    is_primary: false
  });

  const queryClient = useQueryClient();
  // The tracker's "Bonus Credited" (course fees from the CS enrolment tracker): already credited.
  const credited = (Array.isArray(student?.course_fees) ? student.course_fees : []).filter(f => f?.source === 'cs_tracker' && f.bonus_given === true && Number(f.bonus_minor) > 0);

  // Only this student's, the primary one first (mt5Accounts.jsx).
  const { data: mt5Accounts = [] } = useStudentMt5(student.id);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.MT5Account.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mt5accounts'] });
      setShowAddDialog(false);
      toast.success('MT5 Account added successfully');
      resetForm();
    },
    // A login is one student's: the database keeps each once.
    onError: (e) => toast.error(/E11000|duplicate key/i.test(String(e?.message))
      ? 'That MT5 login is already saved — for this student or another'
      : e?.message || 'Could not add the MT5 account'),
  });

  const saveEdit = useMutation({
    mutationFn: async (data) => {
      await base44.entities.MT5Account.update(editing.id, data);
      // One primary: the others lose it.
      if (data.is_primary) {
        for (const a of mt5Accounts) if (a.id !== editing.id && a.is_primary) await base44.entities.MT5Account.update(a.id, { is_primary: false });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mt5accounts'] });
      setShowAddDialog(false); setEditing(null); resetForm();
      toast.success('MT5 account updated');
    },
    onError: (e) => toast.error(/E11000|duplicate key/i.test(String(e?.message))
      ? 'That MT5 login is already saved — for this student or another'
      : e?.message || 'Could not update the MT5 account'),
  });
  // Which one is primary, in one click (the user, 2026-10-14) — the old one loses it; kept in their history.
  const makePrimary = useMutation({
    mutationFn: async (account) => (await base44.functions.invoke('setPrimaryMt5', { id: account.id })).data,
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['mt5accounts'] });
      queryClient.invalidateQueries({ queryKey: ['student-mt5'] });
      toast.success(`${r?.primary} is now the primary MT5${r?.was ? ` (was ${r.was})` : ''}`);
    },
    onError: (e) => toast.error(/unknown function|not found|404/i.test(String(e?.message))
      ? 'This needs the server update (the API deploy)'
      : e?.message || 'Could not change the primary MT5'),
  });
  const remove = useMutation({
    mutationFn: async (account) => (await base44.functions.invoke('removeStudentMt5', { id: account.id })).data,
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['mt5accounts'] });
      toast.success(r?.primary ? `MT5 account removed — ${r.primary} is now the primary one` : 'MT5 account removed');
    },
    onError: (e) => toast.error(/unknown function|not found|404/i.test(String(e?.message))
      ? 'Removing needs the server update (the API deploy)'
      : e?.message || 'Could not remove the MT5 account'),
  });
  const startEdit = (a) => {
    setEditing(a);
    setFormData({ mt5_login: String(a.mt5_login ?? ''), platform: a.platform || 'MT5', account_type: a.account_type || 'LIVE', base_currency: a.base_currency || 'USD', is_primary: a.is_primary === true });
    setShowAddDialog(true);
  };
  const askRemove = (a) => {
    if (window.confirm(`Remove MT5 ${a.mt5_login} from ${student.full_name}?${a.is_primary ? ' It is the primary one — their oldest other account becomes primary.' : ''}`)) remove.mutate(a);
  };

  const resetForm = () => {
    setFormData({
      mt5_login: '',
      platform: 'MT5',
      account_type: 'LIVE',
      base_currency: 'USD',
      is_primary: false
    });
  };

  // A login is its number, 4–15 digits, and one student's (2026-10-14) — their first is the primary one.
  const login = mt5LoginOf(formData.mt5_login);
  const loginError = !login ? '' : !MT5_LOGIN.test(login) ? 'The MT5 login is its number — 4 to 15 digits'
    : mt5Accounts.some(a => String(a.mt5_login) === login && a.id !== editing?.id) ? 'Already saved for this student' : '';
  const handleSubmit = () => {
    if (!login || loginError) return;
    if (editing) {
      saveEdit.mutate({ mt5_login: login, platform: formData.platform, account_type: formData.account_type, base_currency: formData.base_currency, is_primary: formData.is_primary });
      return;
    }
    const dataToSave = {
      ...formData,
      mt5_login: login,
      is_primary: formData.is_primary || mt5Accounts.length === 0,
      student_id: student.id,
      student_name: student.full_name,
      student_code: student.student_code
    };
    createMutation.mutate(dataToSave);
  };

  const canCreate = canCreateMT5Account(currentUser);

  return (
    <Card className="border-gray-200">
      <CardHeader className="border-b border-gray-100 flex flex-row items-center justify-between">
        <CardTitle className="text-lg font-semibold">MT5 Accounts</CardTitle>
        {canCreate && (
          <Button
            size="sm"
            onClick={() => setShowAddDialog(true)}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add MT5 Account
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-6">
        {/* Bonuses the CS enrolment tracker has as "Bonus Credited" — already in their MT5, never credited again (2026-10-12) */}
        {credited.length > 0 && (
          <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <p className="font-medium">Bonus already credited — not to be credited again</p>
            {credited.map((f, i) => (
              <p key={i} className="text-xs">{f.course || 'Course'} · {(f.bonus_currency || 'USD')} {((Number(f.bonus_minor) || 0) / 100).toLocaleString('en-US')} · from the CS enrolment tracker{f.invoice_id ? ` (${String(f.invoice_id).replace(/^tracker:/, '').replace(':', ', row ')})` : ''}</p>
            ))}
          </div>
        )}
        {mt5Accounts.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No MT5 accounts added yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {mt5Accounts.map((account) => (
              <div
                key={account.id}
                className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-semibold text-lg text-gray-900">
                        {account.mt5_login}
                      </span>
                      {account.is_primary && (
                        <Badge className="bg-blue-100 text-blue-800 border-blue-200">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Primary
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div>
                        <span className="text-gray-500">Platform:</span>
                        <span className="ml-2 font-medium text-gray-900">
                          {account.platform}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Type:</span>
                        <span className="ml-2 font-medium text-gray-900">
                          {account.account_type || 'N/A'}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Currency:</span>
                        <span className="ml-2 font-medium text-gray-900">
                          {account.base_currency}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Created:</span>
                        <span className="ml-2 font-medium text-gray-900">
                          {new Date(account.created_date).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                  {canCreate && (
                    <div className="flex shrink-0 items-start gap-1">
                      {!account.is_primary && (
                        <Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-xs" disabled={makePrimary.isPending}
                          onClick={() => makePrimary.mutate(account)} title={`Make ${account.mt5_login} the primary MT5`}>
                          <CheckCircle className="h-3.5 w-3.5" />Make primary
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => startEdit(account)} aria-label={`Edit MT5 ${account.mt5_login}`}><Pencil className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" className="h-8 px-2 text-red-600 hover:bg-red-50 hover:text-red-700" disabled={remove.isPending} onClick={() => askRemove(account)} aria-label={`Remove MT5 ${account.mt5_login}`}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Add MT5 Account Dialog */}
      <Dialog open={showAddDialog} onOpenChange={(o) => { setShowAddDialog(o); if (!o) { setEditing(null); resetForm(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit MT5 ${editing.mt5_login}` : 'Add MT5 Account'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mt5_login">MT5 Login *</Label>
              <Input
                id="mt5_login"
                value={formData.mt5_login}
                onChange={(e) => setFormData({ ...formData, mt5_login: e.target.value })}
                placeholder="Enter MT5 login ID"
                inputMode="numeric"
              />
              {loginError && <p className="text-xs text-red-600">{loginError}</p>}
              {!loginError && !editing && mt5Accounts.length === 0 && <p className="text-xs text-gray-500">Their first MT5 account — saved as the primary one.</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="platform">Platform</Label>
              <Select
                value={formData.platform}
                onValueChange={(value) => setFormData({ ...formData, platform: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MT5">MT5</SelectItem>
                  <SelectItem value="MT4">MT4</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="account_type">Account Type</Label>
              <Input
                id="account_type"
                value={formData.account_type}
                onChange={(e) => setFormData({ ...formData, account_type: e.target.value })}
                placeholder="e.g., LIVE, DEMO"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="base_currency">Base Currency</Label>
              <Input
                id="base_currency"
                value={formData.base_currency}
                onChange={(e) => setFormData({ ...formData, base_currency: e.target.value })}
                disabled
              />
              <p className="text-xs text-gray-500">All calculations are in USD</p>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="is_primary"
                checked={formData.is_primary}
                onChange={(e) => setFormData({ ...formData, is_primary: e.target.checked })}
                className="rounded border-gray-300"
              />
              <Label htmlFor="is_primary" className="font-normal cursor-pointer">
                Set as primary account
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAddDialog(false); setEditing(null); resetForm(); }}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || saveEdit.isPending || !login || !!loginError}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {editing ? (saveEdit.isPending ? 'Saving...' : 'Save') : createMutation.isPending ? 'Adding...' : 'Add Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}