import React, { useState } from 'react';
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Users, Send, Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import TagsPicker from "./TagsPicker";
// The amount box and the course payment, as on the main form (FundingRequestForm, which opens this one — the two import
// each other, so these are only used inside functions).
import { CurrencyAmount, CoursePaymentPanel, convert, courseFeeAed, coursePayment, paidBefore, paymentNote } from "./FundingRequestForm";

import { toast } from "sonner";

const PAYMENT_METHODS = ['AED TRANSFER','UPI','CARD PAYMENT','USDT','INR TRANSFER','Cash deposit','Other'];

export default function ReferralRequestPopup({ student, currentUser, onClose, transactionType = 'DEPOSIT', initialTags = [] }) {
  const isBonus = transactionType === 'BONUS';
  const [depositAmount, setDepositAmount] = useState('');   // as typed, in `currency`
  const [currency, setCurrency] = useState(isBonus ? 'AED' : 'USD');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [mt5Login, setMt5Login] = useState('');
  const [screenshotUrl, setScreenshotUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [tags, setTags] = useState(initialTags || []);

  // Product catalog (with each course's fee + bundled "includes") — a BONUS is a course payment, worked out as on
  // the main funding form.
  const { data: bonusTags = [] } = useQuery({
    queryKey: ['transaction-tags-catalog'],
    queryFn: async () => (await base44.entities.TransactionTag.list('name')).filter(t => t.active !== false),
    staleTime: 5 * 60_000,
  });
  const product = isBonus ? bonusTags.find(t => t.name === tags[0]) || null : null;
  const { data: earlier = [], isFetching: loadingEarlier } = useQuery({
    queryKey: ['course-payments', student.id, product?.name],
    queryFn: () => base44.entities.FundingTransaction.filter({ student_id: student.id, type: 'BONUS' }),
    enabled: !!product,
  });
  const money = convert(depositAmount, currency);
  const feeAed = courseFeeAed(product);
  const payment = product
    ? coursePayment({ feeAed, beforeAed: paidBefore(earlier, product.name), todayAed: money.aed, withBonus: product.bonus_type !== 'without' })
    : null;

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setScreenshotUrl(file_url);
    } catch (_) {
      toast.error('Failed to upload screenshot');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (isBonus && (!tags || tags.length === 0)) {
      toast.error('Please pick a product for the bonus');
      return;
    }
    if (!(money.usd > 0)) {
      toast.error(isBonus ? 'Enter what the student paid today' : 'Please enter a valid deposit amount');
      return;
    }
    if (product && loadingEarlier) {
      toast.error("Still loading the course's earlier payments — try again in a moment");
      return;
    }
    if (!paymentMethod) {
      toast.error('Please select a payment method');
      return;
    }
    setSubmitting(true);
    try {
      await base44.functions.invoke('createReferralRequest', {
        student_id: student.id,
        student_name: student.full_name,
        student_code: student.student_code,
        receiving_mentor_id: student.primary_mentor_id,
        receiving_mentor_name: student.primary_mentor_name,
        // In USD, as everything adds up; what was typed — and, for a course payment, the bonus — go in the notes.
        requested_deposit_amount: money.usd,
        payment_method: paymentMethod,
        mt5_login: mt5Login,
        screenshot_url: screenshotUrl,
        notes: [notes.trim(), paymentNote({ amount: depositAmount, currency, product, feeAed, payment })].filter(Boolean).join('\n'),
        transaction_type: transactionType,
        tags: isBonus ? tags : [],
      });

      toast.success(`Referral request sent to ${student.primary_mentor_name}. They will be notified to approve or reject.`);
      onClose();
    } catch (error) {
      toast.error(error?.response?.data?.error || error.message || 'Failed to send referral request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-600" />
            Send Co-Management Referral
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Alert className="bg-amber-50 border-amber-200">
            <AlertDescription className="text-sm text-amber-800">
              <strong>{student.full_name}</strong> is managed by <strong>{student.primary_mentor_name}</strong>.
              You can send a referral request to co-manage this client. If approved, your
              {isBonus ? ' bonuses ' : ' deposits '}
              for this client will be tracked separately and commissions attributed to you.
            </AlertDescription>
          </Alert>

          <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
            <p><span className="text-gray-500">Student:</span> <span className="font-medium">{student.full_name}</span></p>
            <p><span className="text-gray-500">Code:</span> <span className="font-mono">{student.student_code || '-'}</span></p>
            <p><span className="text-gray-500">CS:</span> <span className="font-medium text-blue-700">{student.primary_mentor_name}</span></p>
          </div>

          {isBonus && (
            <div className="space-y-2">
              <Label>Product *</Label>
              <TagsPicker
                value={tags}
                onChange={(picked) => {
                  // Pull in any bundled products — included, not added on top. The
                  // amount is what the student paid today, not the product's price.
                  const primary = picked[0];
                  const picked0 = bonusTags.find(t => t.name === primary);
                  const included = Array.isArray(picked0?.includes)
                    ? picked0.includes.filter(n => n && n !== primary)
                    : [];
                  setTags(primary ? [primary, ...included] : []);
                }}
              />
              {tags.length > 1 && (
                <p className="text-xs text-green-700 font-medium">
                  ✓ Automatically included (no extra charge): {tags.slice(1).join(', ')}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Pick the course, then type what the student paid today — the MT5 bonus, what waits on hold and the balance work themselves out.
              </p>
            </div>
          )}

          <CurrencyAmount
            id="referral-amount"
            label={isBonus ? 'Payment received today *' : 'Amount *'}
            amount={depositAmount}
            currency={currency}
            onAmount={setDepositAmount}
            onCurrency={setCurrency}
          />
          <CoursePaymentPanel product={product} feeAed={feeAed} payment={payment} />

          <div className="space-y-2">
            <Label>Payment Method *</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger>
                <SelectValue placeholder="Select payment method" />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>MT5 Login (Optional)</Label>
            <Input
              value={mt5Login}
              onChange={(e) => setMt5Login(e.target.value)}
              placeholder="Enter MT5 login"
            />
          </div>

          <div className="space-y-2">
            <Label>Screenshot (Optional)</Label>
            <div className="flex items-center gap-2">
              <Input type="file" accept="image/*" onChange={handleFileUpload} disabled={uploading} />
              {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
            </div>
            {screenshotUrl && <p className="text-xs text-green-600">✓ Screenshot uploaded</p>}
          </div>

          <div className="space-y-2">
            <Label>Notes (Optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any context for this referral request..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Send className="h-4 w-4 mr-2" />
            {submitting ? 'Sending...' : 'Send Referral Request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}