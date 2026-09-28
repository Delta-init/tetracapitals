import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

// The approval chain, per staff per period. Broker -> Academic -> Finance -> Released.
const STAGE = {
  pending_broker_approval: { role: 'broker_admin', label: 'Pending Broker' },
  pending_academic_approval: { role: 'academic_head', label: 'Pending Academic' },
  pending_finance_approval: { role: 'finance_admin', label: 'Pending Finance' },
};
const SUPER = ['super_admin', 'admin'];

/**
 * One staff row's approval status + action buttons for a commission period.
 *
 * Props:
 *   kind         'bonus' | 'deposit'
 *   period       'YYYY-MM' (bonus) or 'YYYY-Qn' (deposit)
 *   recipientId  staff id
 *   recipientName
 *   approval     the CommissionPeriodApproval record for this staff/period (or undefined)
 *   currentUser  effective user
 *   periodEnded  boolean — approvals only run after the period ends
 *   onDone       () => void   refetch callback
 */
export default function PeriodApprovalCell({ kind, period, recipientId, recipientName, approval, currentUser, periodEnded, onDone }) {
  const [busy, setBusy] = useState(false);
  const status = approval?.overall_status || 'pending_broker_approval';

  const act = async (action) => {
    setBusy(true);
    try {
      const res = await base44.functions.invoke('approveCommissionPeriod', {
        kind, period, recipient_id: recipientId, recipient_name: recipientName, action,
      });
      const st = res?.data?.overall_status;
      toast.success(action === 'reject' ? 'Rejected' : st === 'released' ? 'Released ✓' : 'Approved — moved to next stage');
      onDone?.();
    } catch (e) {
      toast.error(e?.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  if (status === 'released') {
    return <Badge className="bg-green-100 text-green-800 border-green-200">Released</Badge>;
  }
  if (status === 'rejected') {
    return <Badge className="bg-red-100 text-red-700 border-red-200">Rejected</Badge>;
  }

  const stage = STAGE[status];
  const canAct = periodEnded && currentUser && (currentUser.app_role === stage.role || SUPER.includes(currentUser.app_role));

  return (
    <div className="flex items-center justify-end gap-2">
      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">{stage.label}</Badge>
      {!periodEnded ? (
        <span className="text-xs text-gray-400">period open</span>
      ) : canAct ? (
        busy ? (
          <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
        ) : (
          <>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600 hover:bg-green-50" title="Approve" onClick={() => act('approve')}>
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600 hover:bg-red-50" title="Reject" onClick={() => act('reject')}>
              <X className="h-4 w-4" />
            </Button>
          </>
        )
      ) : null}
    </div>
  );
}
