import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Calendar, DollarSign, CheckCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { getEffectiveUser } from "../components/utils/ImpersonationContext";

const RELEASE_ROLES = ['super_admin', 'admin', 'broker_admin', 'finance_admin'];
const MENTOR_ROLES = ['senior_mentor', 'junior_mentor', 'subjunior_mentor'];

function yesterdayString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

export default function DailyPayouts() {
  const [currentUser, setCurrentUser] = useState(null);
  const [selectedDate, setSelectedDate] = useState(yesterdayString());
  const [releaseModal, setReleaseModal] = useState(null);   // { mentor_id, mentor_name, net, payout }
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then((u) => setCurrentUser(getEffectiveUser(u))).catch(() => {});
  }, []);

  const canRelease = currentUser && RELEASE_ROLES.includes(currentUser.app_role);
  const isMentor = currentUser && MENTOR_ROLES.includes(currentUser.app_role);

  const { data: transactions = [] } = useQuery({
    queryKey: ['funding-transactions'],
    queryFn: () => base44.entities.FundingTransaction.list('-requested_at'),
    enabled: !!currentUser,
  });

  const { data: adjustments = [] } = useQuery({
    queryKey: ['manual-commission-adjustments'],
    queryFn: () => base44.entities.ManualCommissionAdjustment.list('-created_date'),
    enabled: !!currentUser,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['all-users-daily-payouts'],
    queryFn: async () => {
      const r = await base44.functions.invoke('getAllUsers', {});
      return r.data?.users || [];
    },
    enabled: !!currentUser && canRelease,
  });

  const releaseMutation = useMutation({
    mutationFn: async ({ mentor_id, date, invoice_number }) => {
      const r = await base44.functions.invoke('releaseDailyPayout', { mentor_id, date, invoice_number });
      return r.data;
    },
    onSuccess: (out) => {
      queryClient.invalidateQueries({ queryKey: ['manual-commission-adjustments'] });
      toast.success(`Released $${Math.abs(out.amount_usd).toFixed(2)} to ${out.mentor_name}`);
      setReleaseModal(null);
      setInvoiceNumber('');
    },
    onError: (e) => toast.error(e?.message || 'Failed to release payout'),
  });

  // Compute per-mentor rows for the selected date.
  const rows = useMemo(() => {
    if (!currentUser) return [];
    const dayStart = new Date(`${selectedDate}T00:00:00.000Z`);
    const dayEnd   = new Date(`${selectedDate}T23:59:59.999Z`);
    const byMentor = new Map();
    for (const t of transactions) {
      if (t.status !== 'APPROVED') continue;
      const ts = new Date(t.requested_at || t.created_date);
      if (ts < dayStart || ts > dayEnd) continue;
      const mid = t.initiating_mentor_id || t.primary_mentor_id;
      if (!mid) continue;
      if (isMentor && mid !== currentUser.id) continue;     // mentors see only their own
      let row = byMentor.get(mid);
      if (!row) {
        const u = users.find(x => x.id === mid);
        row = {
          id: mid,
          name: t.initiating_mentor_name || t.primary_mentor_name || u?.full_name || 'Unknown',
          rate: u?.commission_rate ?? 4,
          net: 0,
        };
        byMentor.set(mid, row);
      }
      if (t.type === 'DEPOSIT' || t.type === 'BONUS') row.net += t.amount_usd || 0;
      else if (t.type === 'WITHDRAWAL') row.net -= t.amount_usd || 0;
    }
    // Map of existing daily-1% releases for this date.
    const releasedByMentor = new Map();
    for (const a of adjustments) {
      if (a.payout_kind !== 'daily_1pct') continue;
      if (a.payout_date !== selectedDate) continue;
      releasedByMentor.set(a.mentor_id, a);
    }
    const out = [];
    for (const row of byMentor.values()) {
      if (row.net <= 0) continue;                         // hide zero / negative days
      out.push({
        ...row,
        payout: Math.round(row.net * 0.01 * 100) / 100,
        released: releasedByMentor.get(row.id) || null,
      });
    }
    return out.sort((a, b) => b.net - a.net);
  }, [transactions, adjustments, users, selectedDate, currentUser, isMentor]);

  const totals = useMemo(() => ({
    net: rows.reduce((s, r) => s + r.net, 0),
    payout: rows.reduce((s, r) => s + r.payout, 0),
    released: rows.filter(r => r.released).length,
    total: rows.length,
  }), [rows]);

  const openRelease = (row) => {
    setReleaseModal({ mentor_id: row.id, mentor_name: row.name, net: row.net, payout: row.payout });
    setInvoiceNumber('');
  };

  const confirmRelease = () => {
    if (!releaseModal) return;
    releaseMutation.mutate({
      mentor_id: releaseModal.mentor_id,
      date: selectedDate,
      invoice_number: invoiceNumber.trim(),
    });
  };

  if (!currentUser) {
    return <div className="p-8 text-center text-gray-500">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
              <DollarSign className="h-7 w-7 text-blue-600" />
              Daily 1% Payouts
            </h1>
            <p className="text-gray-600 mt-1 text-sm">
              {isMentor
                ? 'Your daily 1% deposit-commission advance — released by admins each day.'
                : 'Release 1% of yesterday\'s net deposits as an advance against each mentor\'s quarterly commission.'}
            </p>
          </div>
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-gray-600">Date</Label>
              <Input
                type="date"
                value={selectedDate}
                max={todayString()}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-44"
              />
            </div>
          </div>
        </div>

        <Card>
          <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-500">Mentors</p>
              <p className="text-2xl font-bold text-gray-900">{totals.total}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-500">Net Deposits</p>
              <p className="text-2xl font-bold text-blue-700">${totals.net.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-500">1% Payout Total</p>
              <p className="text-2xl font-bold text-green-700">${totals.payout.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-500">Released</p>
              <p className="text-2xl font-bold text-purple-700">{totals.released} / {totals.total}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="h-5 w-5 text-gray-500" />
              Payouts for {format(new Date(selectedDate + 'T00:00:00'), 'EEEE, MMM d, yyyy')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead>Mentor</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead className="text-right">Net Deposit</TableHead>
                  <TableHead className="text-right">1% Payout</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Invoice</TableHead>
                  {canRelease && <TableHead className="text-right">Action</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canRelease ? 7 : 6} className="text-center py-8 text-gray-500">
                      No deposits {isMentor ? '' : 'from any mentor '}on this date.
                    </TableCell>
                  </TableRow>
                ) : rows.map((r) => (
                  <TableRow key={r.id} className={r.released ? 'bg-green-50/40' : ''}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell><Badge variant="outline">{r.rate}%</Badge></TableCell>
                    <TableCell className="text-right font-mono">${r.net.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono font-semibold text-green-700">${r.payout.toFixed(2)}</TableCell>
                    <TableCell>
                      {r.released ? (
                        <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200 gap-1">
                          <CheckCircle className="h-3 w-3" />
                          Released {r.released.created_date ? format(new Date(r.released.created_date), 'MMM d') : ''}
                          {r.released.created_by_name ? ` by ${r.released.created_by_name}` : ''}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200">
                          Pending
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {r.released?.invoice_number || r.released?.notes || (r.released ? '—' : '')}
                    </TableCell>
                    {canRelease && (
                      <TableCell className="text-right">
                        {!r.released && (
                          <Button
                            size="sm"
                            className="bg-blue-600 hover:bg-blue-700"
                            onClick={() => openRelease(r)}
                            disabled={releaseMutation.isPending}
                          >
                            <Send className="h-3.5 w-3.5 mr-1" />
                            Release
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!releaseModal} onOpenChange={(o) => !o && setReleaseModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Release daily payout</DialogTitle>
          </DialogHeader>
          {releaseModal && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded p-3 text-sm space-y-1">
                <p><span className="text-gray-500">Mentor:</span> <strong>{releaseModal.mentor_name}</strong></p>
                <p><span className="text-gray-500">Date:</span> {selectedDate}</p>
                <p><span className="text-gray-500">Net deposit:</span> <span className="font-mono">${releaseModal.net.toFixed(2)}</span></p>
                <p><span className="text-gray-500">1% payout:</span> <span className="font-mono font-semibold text-green-700">${releaseModal.payout.toFixed(2)}</span></p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoice">Invoice Number (Optional)</Label>
                <Input
                  id="invoice"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="e.g. NO;4470"
                  autoFocus
                />
                <p className="text-xs text-gray-500">
                  Stored on the ManualCommissionAdjustment so it shows up in commission reports and exports.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReleaseModal(null)} disabled={releaseMutation.isPending}>
              Cancel
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              onClick={confirmRelease}
              disabled={releaseMutation.isPending}
            >
              {releaseMutation.isPending ? 'Releasing…' : 'Confirm Release'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
