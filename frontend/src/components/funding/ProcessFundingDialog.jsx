import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle } from "lucide-react";

const DEPOSIT_PAYMENT_METHODS = [
  'AED TRANSFER',
  'UPI',
  'CARD PAYMENT',
  'USDT',
  'INR TRANSFER',
  'Cash deposit',
  'Other'
];

const WITHDRAWAL_PAYMENT_METHODS = [
  'AED TRANSFER',
  'UPI',
  'CARD PAYMENT',
  'USDT',
  'INR TRANSFER',
  'Cash Withdrawal',
  'Bank Withdrawal',
  'Other'
];

export default function ProcessFundingDialog({ transaction, open, onClose, onProcess }) {
  const [formData, setFormData] = useState({
    amount_usd: 0,
    payment_method: '',
    mt5_account_id: '',
    mt5_login: '',
    transaction_id: '',
    rejection_reason: '',
    notes: ''
  });
  const [transactionIdError, setTransactionIdError] = useState('');
  const [withdrawalMentorId, setWithdrawalMentorId] = useState('');

  const { data: mt5Accounts = [] } = useQuery({
    queryKey: ['mt5accounts', transaction?.student_id],
    queryFn: async () => {
      if (!transaction?.student_id) return [];
      const accounts = await base44.entities.MT5Account.list();
      return accounts.filter(acc => acc.student_id === transaction.student_id);
    },
    enabled: !!transaction?.student_id && open
  });

  const { data: student, isLoading: isLoadingStudent } = useQuery({
    queryKey: ['student', transaction?.student_id],
    queryFn: async () => {
      if (!transaction?.student_id) return null;
      const students = await base44.entities.Student.list();
      return students.find(s => s.id === transaction.student_id);
    },
    enabled: !!transaction?.student_id,
    staleTime: 0
  });

  const { data: allTransactions = [] } = useQuery({
    queryKey: ['all-funding-transactions'],
    queryFn: () => base44.entities.FundingTransaction.list(),
    enabled: open
  });

  // Build co-managed mentor options for withdrawal attribution
  const coManagedMentorOptions = useMemo(() => {
    if (!student || !transaction || transaction.type !== 'WITHDRAWAL') return [];
    let coMentors = [];
    if (student.co_mentors_details) {
      try {
        coMentors = typeof student.co_mentors_details === 'string'
          ? JSON.parse(student.co_mentors_details)
          : student.co_mentors_details;
      } catch (_) {}
    }
    if (!Array.isArray(coMentors) || coMentors.length === 0) return [];
    const options = [{ id: student.primary_mentor_id, name: student.primary_mentor_name }];
    coMentors.forEach(cm => {
      if (!options.find(o => o.id === cm.mentor_id)) {
        options.push({ id: cm.mentor_id, name: cm.mentor_name });
      }
    });
    return options;
  }, [student, transaction]);

  const isCoManagedWithdrawal = coManagedMentorOptions.length > 0;

  useEffect(() => {
    if (transaction) {
      setFormData({
        amount_usd: transaction.amount_usd || 0,
        payment_method: transaction.payment_method || '',
        mt5_account_id: transaction.mt5_account_id || '',
        mt5_login: transaction.mt5_login || '',
        transaction_id: transaction.transaction_id || '',
        rejection_reason: transaction.rejection_reason || '',
        notes: transaction.notes || ''
      });
      setTransactionIdError('');
      setWithdrawalMentorId('');
    }
  }, [transaction]);

  const handleApprove = async () => {
    if (!formData.transaction_id || formData.transaction_id.trim() === '') {
      setTransactionIdError('Transaction ID is required');
      return;
    }

    const duplicate = allTransactions.find(
      t => t.transaction_id === formData.transaction_id && t.id !== transaction.id
    );
    
    if (duplicate) {
      setTransactionIdError('This Transaction ID already exists');
      return;
    }

    setTransactionIdError('');
    
    const selectedMT5Account = mt5Accounts.find(acc => acc.id === formData.mt5_account_id);
    
    const selectedWithdrawalMentor = isCoManagedWithdrawal && withdrawalMentorId
      ? coManagedMentorOptions.find(m => m.id === withdrawalMentorId)
      : null;

    const updatedData = {
      ...formData,
      mt5_login: formData.mt5_account_id ? (selectedMT5Account?.mt5_login || formData.mt5_login) : formData.mt5_login,
      initiating_mentor_id: transaction.type === 'WITHDRAWAL'
        ? (isCoManagedWithdrawal ? selectedWithdrawalMentor?.id : transaction.primary_mentor_id)
        : (transaction.initiating_mentor_id || undefined),
      initiating_mentor_name: transaction.type === 'WITHDRAWAL'
        ? (isCoManagedWithdrawal ? selectedWithdrawalMentor?.name : transaction.primary_mentor_name)
        : (transaction.initiating_mentor_name || undefined),
      status: 'APPROVED'
    };

    // Auto-upgrade student from Level 1 to Level 2 on first approved deposit
    if (transaction.type === 'DEPOSIT' && student?.student_level === 'LEVEL_1') {
      const previousApprovedDeposits = allTransactions.filter(
        t => t.student_id === transaction.student_id && t.type === 'DEPOSIT' && t.status === 'APPROVED' && t.id !== transaction.id
      );
      if (previousApprovedDeposits.length === 0) {
        await base44.entities.Student.update(transaction.student_id, { student_level: 'LEVEL_2' });
      }
    }
    // Update co_mentors_details via backend function
    console.log('initiating_mentor_id:', transaction.initiating_mentor_id, '| type:', transaction.type);
    if (transaction.type === 'DEPOSIT') {
      // Update co-mentor contribution if initiating mentor exists
      if (transaction.initiating_mentor_id) {
        try {
          await base44.functions.invoke('updateCoMentorContribution', {
            student_id: transaction.student_id,
            mentor_id: transaction.initiating_mentor_id
          });
        } catch (err) { console.error('Failed to update co-mentor contribution:', err); }
      }
      // Also update primary mentor's entry in co_mentors_details if they have one
      if (transaction.primary_mentor_id) {
        try {
          await base44.functions.invoke('updateCoMentorContribution', {
            student_id: transaction.student_id,
            mentor_id: transaction.primary_mentor_id
          });
        } catch (err) { console.error('Failed to update primary mentor contribution:', err); }
      }
    }

    // Withdrawal deductions for co-managed clients are handled via CoManageCalculator tool
    // No additional processing needed here

    onProcess(updatedData);
  };

  const handleReject = () => {
    const updatedData = {
      ...formData,
      status: 'REJECTED'
    };
    
    onProcess(updatedData);
  };

  if (!transaction) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Process Funding Request</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-gray-50 rounded-lg p-4 space-y-2">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-gray-600">Type:</span>
                <span className="ml-2 font-semibold">{transaction.type}</span>
              </div>
              <div>
                <span className="text-gray-600">Student:</span>
                <span className="ml-2 font-semibold">{transaction.student_name}</span>
              </div>
              <div>
                <span className="text-gray-600">Code:</span>
                <span className="ml-2 font-mono font-semibold">{transaction.student_code}</span>
              </div>
              <div>
                <span className="text-gray-600">Student Level:</span>
                <span className={`ml-2 font-semibold ${student?.student_level === 'LEVEL_1' ? 'text-yellow-700' : 'text-green-700'}`}>
                  {student?.student_level || 'Unknown'}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2 bg-blue-50 p-4 rounded-lg border-2 border-blue-200">
            <Label htmlFor="amount_usd" className="text-base font-semibold">Amount (USD) - Editable</Label>
            <Input
              id="amount_usd"
              type="number"
              step="0.01"
              value={formData.amount_usd}
              onChange={(e) => setFormData({ ...formData, amount_usd: parseFloat(e.target.value) || 0 })}
              placeholder="Enter amount in USD"
              className="text-lg font-semibold"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="payment_method">Payment Method</Label>
              <Select
                value={formData.payment_method}
                onValueChange={(value) => setFormData({ ...formData, payment_method: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select payment method" />
                </SelectTrigger>
                <SelectContent>
                  {(transaction?.type === 'WITHDRAWAL' ? WITHDRAWAL_PAYMENT_METHODS : DEPOSIT_PAYMENT_METHODS).map((method) => (
                    <SelectItem key={method} value={method}>
                      {method}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mt5_account">MT5 Account</Label>
              <Select
                value={formData.mt5_account_id}
                onValueChange={(value) => setFormData({ ...formData, mt5_account_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select MT5 account" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>None</SelectItem>
                  {mt5Accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.mt5_login} ({account.platform})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="mt5_login">MT5 Login (Manual)</Label>
              <Input
                id="mt5_login"
                value={formData.mt5_login}
                onChange={(e) => setFormData({ ...formData, mt5_login: e.target.value })}
                placeholder="Or enter manually"
                disabled={!!formData.mt5_account_id}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="transaction_id">
                Transaction ID <span className="text-red-500">*</span>
              </Label>
              <Input
                id="transaction_id"
                value={formData.transaction_id}
                onChange={(e) => {
                  setFormData({ ...formData, transaction_id: e.target.value });
                  setTransactionIdError('');
                }}
                placeholder="Enter unique transaction ID"
                className={transactionIdError ? 'border-red-500' : ''}
              />
              {transactionIdError && (
                <p className="text-sm text-red-600">{transactionIdError}</p>
              )}
            </div>

            {isCoManagedWithdrawal && (
              <div className="space-y-2 md:col-span-2">
                <Label className="text-base font-semibold text-orange-700">Attribute Withdrawal To *</Label>
                <Select value={withdrawalMentorId} onValueChange={setWithdrawalMentorId}>
                  <SelectTrigger className="border-orange-300 focus:ring-orange-400">
                    <SelectValue placeholder="Select mentor to attribute withdrawal to" />
                  </SelectTrigger>
                  <SelectContent>
                    {coManagedMentorOptions.map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-orange-600">This is a co-managed client. Select which mentor's net deposit this withdrawal reduces.</p>
              </div>
            )}

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="rejection_reason">Rejection Reason</Label>
              <Input
                id="rejection_reason"
                value={formData.rejection_reason}
                onChange={(e) => setFormData({ ...formData, rejection_reason: e.target.value })}
                placeholder="Enter reason if rejecting..."
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Add any notes..."
                rows={3}
              />
            </div>
          </div>

          {transaction.screenshot_url && (
            <div className="space-y-2">
              <Label>Screenshot</Label>
              <a
                href={transaction.screenshot_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 text-sm underline"
              >
                View Screenshot
              </a>
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleReject}
            className="flex items-center gap-2"
          >
            <XCircle className="h-4 w-4" />
            Reject
          </Button>
          <Button
            onClick={handleApprove}
            disabled={isLoadingStudent || (isCoManagedWithdrawal && !withdrawalMentorId)}
            className="bg-emerald-600 hover:bg-emerald-700 flex items-center gap-2 disabled:opacity-50"
          >
            <CheckCircle className="h-4 w-4" />
            {isLoadingStudent ? 'Loading...' : 'Approve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}