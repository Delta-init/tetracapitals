import React, { useState } from 'react';
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Users, Send, Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { toast } from "sonner";

const PAYMENT_METHODS = ['AED TRANSFER','UPI','CARD PAYMENT','USDT','INR TRANSFER','Cash deposit','Other'];

export default function ReferralRequestPopup({ student, currentUser, onClose }) {
  const [depositAmount, setDepositAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [mt5Login, setMt5Login] = useState('');
  const [screenshotUrl, setScreenshotUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
    if (!depositAmount || parseFloat(depositAmount) <= 0) {
      toast.error('Please enter a valid deposit amount');
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
        requested_deposit_amount: parseFloat(depositAmount),
        payment_method: paymentMethod,
        mt5_login: mt5Login,
        screenshot_url: screenshotUrl,
        notes
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
              You can send a referral request to co-manage this client. If approved, your deposits for this client will be tracked separately and commissions attributed to you.
            </AlertDescription>
          </Alert>

          <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
            <p><span className="text-gray-500">Student:</span> <span className="font-medium">{student.full_name}</span></p>
            <p><span className="text-gray-500">Code:</span> <span className="font-mono">{student.student_code || '-'}</span></p>
            <p><span className="text-gray-500">Primary Mentor:</span> <span className="font-medium text-blue-700">{student.primary_mentor_name}</span></p>
          </div>

          <div className="space-y-2">
            <Label>Amount (USD) *</Label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>

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