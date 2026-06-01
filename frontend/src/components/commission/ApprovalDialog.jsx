import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { AlertCircle, CheckCircle, Loader2 } from "lucide-react";

export default function ApprovalDialog({ 
  open, 
  onOpenChange, 
  ledger, 
  approvalLevel,
  onApprove, 
  onReject,
  isSubmitting 
}) {
  const [rejectionReason, setRejectionReason] = useState('');
  const [payoutMethod, setPayoutMethod] = useState('');
  const [payoutReference, setPayoutReference] = useState('');
  const [notes, setNotes] = useState('');

  const isFinanceLevel = approvalLevel === 'finance';

  const handleApprove = () => {
    if (isFinanceLevel) {
      onApprove({ payoutMethod, payoutReference, notes });
    } else {
      onApprove();
    }
  };

  const handleReject = () => {
    onReject(rejectionReason);
    setRejectionReason('');
  };

  const levelLabels = {
    broker: 'Broker Admin',
    academic: 'Academic Head',
    finance: 'Finance Admin'
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Commission Approval - {levelLabels[approvalLevel]}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Ledger Summary */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-600">Mentor</p>
                <p className="font-semibold">{ledger?.mentor_name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-600">Quarter</p>
                <p className="font-semibold">{ledger?.quarter}</p>
              </div>
              <div>
                <p className="text-xs text-gray-600">Net Deposit</p>
                <p className="font-semibold text-blue-600">
                  ${ledger?.net_deposit_usd?.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-600">Gross Commission</p>
                <p className="font-semibold">${ledger?.gross_commission_usd?.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-600">Release Amount</p>
                <p className="font-semibold text-emerald-600">
                  ${ledger?.commission_release_usd?.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-600">Buffer Amount</p>
                <p className="font-semibold text-amber-600">
                  ${ledger?.commission_buffer_usd?.toFixed(2)}
                </p>
              </div>
            </div>
          </div>

          {/* Approval History */}
          <div className="space-y-2">
            <h4 className="font-semibold text-sm">Approval History</h4>
            <div className="space-y-1 text-sm">
              {ledger?.broker_admin_approval_status === 'approved' && (
                <div className="flex items-center gap-2 text-emerald-600">
                  <CheckCircle className="h-4 w-4" />
                  <span>Broker Admin: Approved by {ledger?.broker_admin_approved_by_name}</span>
                </div>
              )}
              {ledger?.academic_head_approval_status === 'approved' && (
                <div className="flex items-center gap-2 text-emerald-600">
                  <CheckCircle className="h-4 w-4" />
                  <span>Academic Head: Approved by {ledger?.academic_head_approved_by_name}</span>
                </div>
              )}
            </div>
          </div>

          {/* Finance Admin Fields */}
          {isFinanceLevel && (
            <div className="space-y-4 border-t pt-4">
              <h4 className="font-semibold text-sm">Payout Details</h4>
              
              <div className="space-y-2">
                <Label htmlFor="payoutMethod">Payout Method *</Label>
                <Input
                  id="payoutMethod"
                  value={payoutMethod}
                  onChange={(e) => setPayoutMethod(e.target.value)}
                  placeholder="e.g., Bank Transfer, PayPal, Wire Transfer"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="payoutReference">Payout Reference/Transaction ID</Label>
                <Input
                  id="payoutReference"
                  value={payoutReference}
                  onChange={(e) => setPayoutReference(e.target.value)}
                  placeholder="External payment reference or transaction ID"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional notes about the payout..."
                  rows={3}
                />
              </div>
            </div>
          )}

          {/* Rejection Reason */}
          <div className="space-y-2 border-t pt-4">
            <Label htmlFor="rejectionReason">Rejection Reason (if rejecting)</Label>
            <Textarea
              id="rejectionReason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Provide a reason if rejecting this commission..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleReject}
            disabled={isSubmitting || !rejectionReason.trim()}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Rejecting...
              </>
            ) : (
              <>
                <AlertCircle className="mr-2 h-4 w-4" />
                Reject
              </>
            )}
          </Button>
          <Button
            type="button"
            onClick={handleApprove}
            disabled={isSubmitting || (isFinanceLevel && !payoutMethod.trim())}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <CheckCircle className="mr-2 h-4 w-4" />
                {isFinanceLevel ? 'Approve & Release' : 'Approve'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}