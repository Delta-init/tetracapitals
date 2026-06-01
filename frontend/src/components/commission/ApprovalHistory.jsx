import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, XCircle, Clock } from "lucide-react";
import { format } from "date-fns";

export default function ApprovalHistory({ ledger }) {
  const approvalSteps = [
    {
      level: 'Broker Admin',
      status: ledger.broker_admin_approval_status,
      approvedBy: ledger.broker_admin_approved_by_name,
      approvedAt: ledger.broker_admin_approved_at,
      rejectionReason: ledger.broker_admin_rejection_reason
    },
    {
      level: 'Academic Head',
      status: ledger.academic_head_approval_status,
      approvedBy: ledger.academic_head_approved_by_name,
      approvedAt: ledger.academic_head_approved_at,
      rejectionReason: ledger.academic_head_rejection_reason
    },
    {
      level: 'Finance Admin',
      status: ledger.finance_admin_approval_status,
      approvedBy: ledger.finance_admin_approved_by_name,
      approvedAt: ledger.finance_admin_approved_at,
      rejectionReason: ledger.finance_admin_rejection_reason
    }
  ];

  const getStatusIcon = (status) => {
    switch (status) {
      case 'approved':
        return <CheckCircle className="h-5 w-5 text-emerald-600" />;
      case 'rejected':
        return <XCircle className="h-5 w-5 text-red-600" />;
      default:
        return <Clock className="h-5 w-5 text-gray-400" />;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Approval History</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {approvalSteps.map((step, index) => (
            <div key={index} className="flex items-start gap-4">
              <div className="mt-0.5">{getStatusIcon(step.status)}</div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{step.level}</p>
                  {step.status === 'approved' && step.approvedAt && (
                    <p className="text-xs text-gray-600">
                      {format(new Date(step.approvedAt), 'MMM d, yyyy HH:mm')}
                    </p>
                  )}
                </div>
                {step.status === 'approved' && step.approvedBy && (
                  <p className="text-sm text-gray-600">Approved by {step.approvedBy}</p>
                )}
                {step.status === 'rejected' && step.rejectionReason && (
                  <p className="text-sm text-red-600 mt-1">Rejected: {step.rejectionReason}</p>
                )}
                {step.status === 'pending' && (
                  <p className="text-sm text-gray-500">Awaiting approval</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}