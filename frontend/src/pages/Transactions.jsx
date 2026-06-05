import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TransactionTable from "../components/transactions/TransactionTable";
import { Plus, Upload } from "lucide-react";
import { canApproveTransactions, isMentorRole } from "../components/utils/DataMasking";
import { toast } from "sonner";

export default function Transactions() {
  const [currentUser, setCurrentUser] = useState(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [formData, setFormData] = useState({
    student_id: '',
    type: 'deposit',
    amount: '',
    screenshot_url: ''
  });
  const [approvalData, setApprovalData] = useState({
    payment_method: '',
    transaction_id: '',
    mt5_id: '',
    user_id: ''
  });
  const [rejectionReason, setRejectionReason] = useState('');

  const queryClient = useQueryClient();

  useEffect(() => {
    const fetchUser = async () => {
      const user = await base44.auth.me();
      setCurrentUser(user);
    };
    fetchUser();
  }, []);

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => base44.entities.FundingTransaction.list('-requested_at'),
    enabled: !!currentUser
  });

  const { data: students = [] } = useQuery({
    queryKey: ['students'],
    queryFn: () => base44.entities.Student.list(),
    enabled: !!currentUser
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.FundingTransaction.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      setShowAddDialog(false);
      toast.success('Transaction request created successfully');
      resetForm();
    }
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      await base44.entities.FundingTransaction.update(id, {
        ...data,
        status: 'APPROVED',
        approved_by_id: currentUser.id,
        approved_by_name: currentUser.full_name,
        approved_at: new Date().toISOString()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
      setShowApproveDialog(false);
      toast.success('Transaction approved successfully');
    }
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }) => base44.entities.FundingTransaction.update(id, {
      status: 'REJECTED',
      approved_by_id: currentUser.id,
      approved_by_name: currentUser.full_name,
      approved_at: new Date().toISOString(),
      notes: reason
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      setShowRejectDialog(false);
      toast.success('Transaction rejected');
    }
  });

  const resetForm = () => {
    setFormData({
      student_id: '',
      type: 'deposit',
      amount: '',
      screenshot_url: ''
    });
  };

  const handleSubmit = () => {
    const student = students.find(s => s.id === formData.student_id);
    const dataToSave = {
      type: formData.type.toUpperCase(),
      student_id: formData.student_id,
      student_name: student?.full_name || '',
      student_code: student?.student_code || '',
      primary_mentor_id: student?.primary_mentor_id || currentUser.id,
      primary_mentor_name: student?.primary_mentor_name || currentUser.full_name,
      senior_mentor_id: student?.senior_mentor_id,
      senior_mentor_name: student?.senior_mentor_name,
      amount_usd: formData.amount,
      payment_method: '',
      screenshot_url: formData.screenshot_url,
      status: 'PENDING',
      requested_by_id: currentUser.id,
      requested_by_name: currentUser.full_name,
      requested_at: new Date().toISOString()
    };
    createMutation.mutate(dataToSave);
  };

  const handleApprove = (transaction) => {
    setSelectedTransaction(transaction);
    setApprovalData({
      payment_method: transaction.payment_method || '',
      transaction_id: transaction.transaction_id || '',
      mt5_id: transaction.mt5_id || '',
      user_id: transaction.user_id || ''
    });
    setShowApproveDialog(true);
  };

  const handleReject = (transaction) => {
    setSelectedTransaction(transaction);
    setRejectionReason('');
    setShowRejectDialog(true);
  };

  const confirmApproval = () => {
    approveMutation.mutate({
      id: selectedTransaction.id,
      data: approvalData
    });
  };

  const confirmRejection = () => {
    rejectMutation.mutate({
      id: selectedTransaction.id,
      reason: rejectionReason
    });
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setFormData({ ...formData, screenshot_url: file_url });
      toast.success('Screenshot uploaded');
    }
  };

  if (!currentUser) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  // Filter transactions
  const myStudents = students.filter(s => s.primary_mentor_id === currentUser.id);
  const myStudentIds = myStudents.map(s => s.id);
  
  let filteredTransactions = isMentorRole(currentUser.app_role)
    ? transactions.filter(t => t.primary_mentor_id === currentUser.id)
    : transactions;

  if (filterStatus !== 'all') {
    filteredTransactions = filteredTransactions.filter(t => t.status?.toUpperCase() === filterStatus.toUpperCase());
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Transactions</h1>
          {isMentorRole(currentUser.app_role) && (
            <Button onClick={() => setShowAddDialog(true)} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="h-4 w-4 mr-2" />
              New Request
            </Button>
          )}
        </div>

        {/* Filters */}
        <Tabs value={filterStatus} onValueChange={setFilterStatus}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Table */}
        <TransactionTable
          transactions={filteredTransactions}
          currentUser={currentUser}
          onView={(t) => setSelectedTransaction(t)}
          onApprove={handleApprove}
          onReject={handleReject}
        />

        {/* Add Dialog */}
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Transaction Request</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Student *</Label>
                <Select
                  value={formData.student_id}
                  onValueChange={(value) => setFormData({ ...formData, student_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select student" />
                  </SelectTrigger>
                  <SelectContent>
                    {myStudents.map((student) => (
                      <SelectItem key={student.id} value={student.id}>
                        {student.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Type *</Label>
                <Select
                  value={formData.type}
                  onValueChange={(value) => setFormData({ ...formData, type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deposit">Deposit</SelectItem>
                    <SelectItem value="withdrawal">Withdrawal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Amount *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>Screenshot (Optional)</Label>
                <Input type="file" accept="image/*" onChange={handleFileUpload} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create Request'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Approve Dialog */}
        <Dialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Approve Transaction</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Input
                  value={approvalData.payment_method}
                  onChange={(e) => setApprovalData({ ...approvalData, payment_method: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Transaction ID</Label>
                <Input
                  value={approvalData.transaction_id}
                  onChange={(e) => setApprovalData({ ...approvalData, transaction_id: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>MT5 ID</Label>
                <Input
                  value={approvalData.mt5_id}
                  onChange={(e) => setApprovalData({ ...approvalData, mt5_id: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>User ID</Label>
                <Input
                  value={approvalData.user_id}
                  onChange={(e) => setApprovalData({ ...approvalData, user_id: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowApproveDialog(false)}>Cancel</Button>
              <Button onClick={confirmApproval} disabled={approveMutation.isPending} className="bg-emerald-600 hover:bg-emerald-700">
                {approveMutation.isPending ? 'Approving...' : 'Approve'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Reject Dialog */}
        <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject Transaction</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Rejection Reason</Label>
                <Textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Explain why this transaction is being rejected..."
                  rows={4}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowRejectDialog(false)}>Cancel</Button>
              <Button onClick={confirmRejection} disabled={rejectMutation.isPending} variant="destructive">
                {rejectMutation.isPending ? 'Rejecting...' : 'Reject'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}