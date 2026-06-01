import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, CheckCircle, Eye } from "lucide-react";
import { 
  filterLedgersByRole, 
  canTakeAction, 
  getApprovalStatusBadge,
  getNextApprovalStatus 
} from "../components/utils/CommissionApprovalUtils";
import ApprovalDialog from "../components/commission/ApprovalDialog";
import ApprovalHistory from "../components/commission/ApprovalHistory";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import { logAction } from "../components/utils/AuditLogger";

export default function CommissionReports() {
  const [currentUser, setCurrentUser] = useState(null);
  const [filterMentor, setFilterMentor] = useState('all');
  const [filterQuarter, setFilterQuarter] = useState('all');
  const [filterYear, setFilterYear] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLedger, setSelectedLedger] = useState(null);
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);

  const queryClient = useQueryClient();

  useEffect(() => {
    const fetchUser = async () => {
      const user = await base44.auth.me();
      setCurrentUser(user);
    };
    fetchUser();
  }, []);

  const { data: rawLedgers = [], isLoading: ledgersLoading } = useQuery({
    queryKey: ['commission-ledgers'],
    queryFn: () => base44.entities.CommissionLedger.list('-year', 500),
    enabled: !!currentUser,
    refetchOnMount: 'always'
  });

  // Ensure all ledgers have overall_status field (default to pending_broker_approval for old records)
  const ledgers = rawLedgers.map(ledger => ({
    ...ledger,
    overall_status: ledger.overall_status || 'pending_broker_approval',
    broker_admin_approval_status: ledger.broker_admin_approval_status || 'pending',
    academic_head_approval_status: ledger.academic_head_approval_status || 'pending',
    finance_admin_approval_status: ledger.finance_admin_approval_status || 'pending'
  }));

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: async () => { const r = await base44.functions.invoke('getAllUsers', {}); return r.data?.users || []; },
    enabled: !!currentUser
  });

  const approvalMutation = useMutation({
    mutationFn: async ({ ledgerId, action, level, data }) => {
      const updateData = {
        [`${level}_approval_status`]: action === 'approve' ? 'approved' : 'rejected',
        [`${level}_approved_by_id`]: currentUser.id,
        [`${level}_approved_by_name`]: currentUser.full_name,
        [`${level}_approved_at`]: new Date().toISOString(),
      };

      if (action === 'reject' && data.rejectionReason) {
        updateData[`${level}_rejection_reason`] = data.rejectionReason;
        updateData.overall_status = 'rejected';
      } else if (action === 'approve') {
        const ledger = ledgers.find(l => l.id === ledgerId);
        updateData.overall_status = getNextApprovalStatus(ledger.overall_status, 'approve');
        
        // If finance admin is approving, also set release info
        if (level === 'finance_admin') {
          updateData.actual_release_date = new Date().toISOString();
        }
      }

      await base44.entities.CommissionLedger.update(ledgerId, updateData);
      
      // Log the action
      const ledger = ledgers.find(l => l.id === ledgerId);
      const actionType = action === 'approve' ? 'approve_commission_ledger' : 'reject_commission_ledger';
      await logAction(actionType, 'CommissionLedger', ledgerId, `${action} commission for ${ledger.mentor_name} - ${ledger.quarter}`, null, updateData);
      
      // If finance admin approved, create payout transaction
      if (level === 'finance_admin' && action === 'approve' && data) {
        const ledger = ledgers.find(l => l.id === ledgerId);
        await base44.entities.PayoutTransaction.create({
          commission_ledger_id: ledgerId,
          mentor_id: ledger.mentor_id,
          mentor_name: ledger.mentor_name,
          quarter: ledger.quarter,
          payout_amount_usd: ledger.commission_release_usd,
          payout_method: data.payoutMethod,
          payout_reference: data.payoutReference || '',
          payout_date: new Date().toISOString(),
          processed_by_id: currentUser.id,
          processed_by_name: currentUser.full_name,
          notes: data.notes || ''
        });
      }
    },
    onSuccess: async () => {
      await queryClient.refetchQueries(['commission-ledgers']);
      toast.success('Commission approval processed successfully');
      setShowApprovalDialog(false);
      setSelectedLedger(null);
    },
    onError: (error) => {
      toast.error('Failed to process approval: ' + error.message);
    }
  });

  if (!currentUser || ledgersLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Filter ledgers
  let filteredLedgers = filterLedgersByRole(ledgers, currentUser);

  if (filterMentor !== 'all') {
    filteredLedgers = filteredLedgers.filter(l => l.mentor_id === filterMentor);
  }
  if (filterQuarter !== 'all') {
    filteredLedgers = filteredLedgers.filter(l => l.quarter_number === parseInt(filterQuarter));
  }
  if (filterYear !== 'all') {
    filteredLedgers = filteredLedgers.filter(l => l.year === parseInt(filterYear));
  }
  if (filterStatus !== 'all') {
    filteredLedgers = filteredLedgers.filter(l => l.overall_status === filterStatus);
  }
  if (searchTerm) {
    filteredLedgers = filteredLedgers.filter(l =>
      l.mentor_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.quarter?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }

  // Get unique values for filters
  const mentorsWithLedgers = [...new Set(ledgers.map(l => l.mentor_id))]
    .map(id => users.find(u => u.id === id))
    .filter(Boolean);
  
  const years = [...new Set(ledgers.map(l => l.year))].sort((a, b) => b - a);

  // Calculate summary
  const totalGrossCommission = filteredLedgers.reduce((sum, l) => sum + (l.gross_commission_usd || 0), 0);
  const totalReleased = filteredLedgers
    .filter(l => l.overall_status === 'released')
    .reduce((sum, l) => sum + (l.commission_release_usd || 0), 0);
  const totalPending = filteredLedgers
    .filter(l => l.overall_status !== 'released' && l.overall_status !== 'rejected')
    .reduce((sum, l) => sum + (l.commission_release_usd || 0), 0);

  const handleApprove = (ledger) => {
    setSelectedLedger(ledger);
    setShowApprovalDialog(true);
  };

  const handleApprovalSubmit = (data) => {
    const role = currentUser.app_role;
    let level = '';
    
    if (role === 'broker_admin' || (role === 'super_admin' && selectedLedger.overall_status === 'pending_broker_approval')) {
      level = 'broker_admin';
    } else if (role === 'academic_head' || (role === 'super_admin' && selectedLedger.overall_status === 'pending_academic_approval')) {
      level = 'academic_head';
    } else if (role === 'finance_admin' || (role === 'super_admin' && selectedLedger.overall_status === 'pending_finance_approval')) {
      level = 'finance_admin';
    }
    
    approvalMutation.mutate({
      ledgerId: selectedLedger.id,
      action: 'approve',
      level,
      data
    });
  };

  const handleReject = (rejectionReason) => {
    const role = currentUser.app_role;
    let level = '';
    
    if (role === 'broker_admin' || (role === 'super_admin' && selectedLedger.overall_status === 'pending_broker_approval')) {
      level = 'broker_admin';
    } else if (role === 'academic_head' || (role === 'super_admin' && selectedLedger.overall_status === 'pending_academic_approval')) {
      level = 'academic_head';
    } else if (role === 'finance_admin' || (role === 'super_admin' && selectedLedger.overall_status === 'pending_finance_approval')) {
      level = 'finance_admin';
    }
    
    approvalMutation.mutate({
      ledgerId: selectedLedger.id,
      action: 'reject',
      level,
      data: { rejectionReason }
    });
  };

  const getApprovalLevel = (ledger) => {
    if (ledger.overall_status === 'pending_broker_approval') return 'broker';
    if (ledger.overall_status === 'pending_academic_approval') return 'academic';
    if (ledger.overall_status === 'pending_finance_approval') return 'finance';
    return null;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Commission Reports</h1>
          <p className="text-gray-600 mt-2 text-base">View and manage all mentor commission ledgers</p>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-none bg-gradient-to-br from-blue-100 to-indigo-100 shadow-lg">
            <CardContent className="p-5">
              <p className="text-sm font-semibold uppercase tracking-wider text-gray-700">Total Gross Commission</p>
              <p className="text-3xl font-bold text-blue-700 mt-1">${totalGrossCommission.toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card className="border-none bg-gradient-to-br from-emerald-100 to-teal-100 shadow-lg">
            <CardContent className="p-5">
              <p className="text-sm font-semibold uppercase tracking-wider text-gray-700">Total Released</p>
              <p className="text-3xl font-bold text-emerald-700 mt-1">${totalReleased.toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card className="border-none bg-gradient-to-br from-amber-100 to-orange-100 shadow-lg">
            <CardContent className="p-5">
              <p className="text-sm font-semibold uppercase tracking-wider text-gray-700">Pending Release</p>
              <p className="text-3xl font-bold text-amber-700 mt-1">${totalPending.toFixed(2)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="border-gray-200">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search mentor or quarter..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              <Select value={filterMentor} onValueChange={setFilterMentor}>
                <SelectTrigger>
                  <SelectValue placeholder="All Mentors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Mentors</SelectItem>
                  {mentorsWithLedgers.map((mentor) => (
                    <SelectItem key={mentor.id} value={mentor.id}>
                      {mentor.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterYear} onValueChange={setFilterYear}>
                <SelectTrigger>
                  <SelectValue placeholder="All Years" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Years</SelectItem>
                  {years.map(year => (
                    <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterQuarter} onValueChange={setFilterQuarter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Quarters" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Quarters</SelectItem>
                  <SelectItem value="1">Q1</SelectItem>
                  <SelectItem value="2">Q2</SelectItem>
                  <SelectItem value="3">Q3</SelectItem>
                  <SelectItem value="4">Q4</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending_broker_approval">Pending Broker</SelectItem>
                  <SelectItem value="pending_academic_approval">Pending Academic</SelectItem>
                  <SelectItem value="pending_finance_approval">Pending Finance</SelectItem>
                  <SelectItem value="released">Released</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Commission Table */}
        <Card className="border-gray-200">
          <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-blue-50">
            <CardTitle className="text-lg font-semibold tracking-tight">Commission Ledgers</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="font-semibold">Mentor</TableHead>
                    <TableHead className="font-semibold">Quarter</TableHead>
                    <TableHead className="font-semibold">Net Deposit</TableHead>
                    <TableHead className="font-semibold">Gross</TableHead>
                    <TableHead className="font-semibold">Release</TableHead>
                    <TableHead className="font-semibold">Buffer</TableHead>
                    <TableHead className="font-semibold">Buffer In</TableHead>
                    <TableHead className="font-semibold">Buffer Out</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    {!['junior_mentor', 'senior_mentor'].includes(currentUser.app_role) && (
                      <TableHead className="font-semibold text-right">Actions</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLedgers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={['junior_mentor', 'senior_mentor'].includes(currentUser.app_role) ? 9 : 10} className="text-center py-8 text-gray-500">
                        No commission ledgers found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredLedgers.map((ledger) => {
                      const statusBadge = getApprovalStatusBadge(ledger);
                      const canAct = canTakeAction(ledger, currentUser);
                      
                      return (
                        <TableRow key={ledger.id} className="hover:bg-gray-50 transition-colors">
                          <TableCell className="font-medium">{ledger.mentor_name}</TableCell>
                          <TableCell className="font-semibold text-blue-600">{ledger.quarter}</TableCell>
                          <TableCell className="font-semibold">${ledger.net_deposit_usd?.toFixed(2)}</TableCell>
                          <TableCell className="font-semibold">${ledger.gross_commission_usd?.toFixed(2)}</TableCell>
                          <TableCell className="font-semibold text-emerald-600">
                            ${ledger.commission_release_usd?.toFixed(2)}
                          </TableCell>
                          <TableCell className="font-semibold text-amber-600">
                            ${ledger.commission_buffer_usd?.toFixed(2)}
                          </TableCell>
                          <TableCell>${ledger.buffer_carried_in_usd?.toFixed(2)}</TableCell>
                          <TableCell>${ledger.buffer_carried_out_usd?.toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={statusBadge.color}>
                              {statusBadge.label}
                            </Badge>
                            {ledger.actual_release_date && ledger.overall_status === 'released' && (
                              <div className="text-xs text-gray-600 mt-1">
                                {format(new Date(ledger.actual_release_date), 'MMM d, yyyy')}
                              </div>
                            )}
                          </TableCell>
                          {!['junior_mentor', 'senior_mentor'].includes(currentUser.app_role) && (
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setSelectedLedger(ledger);
                                    setShowHistoryDialog(true);
                                  }}
                                >
                                  <Eye className="h-4 w-4 mr-1" />
                                  View
                                </Button>
                                {canAct && (
                                  <Button
                                    size="sm"
                                    onClick={() => handleApprove(ledger)}
                                    disabled={approvalMutation.isPending}
                                    className="bg-emerald-600 hover:bg-emerald-700"
                                  >
                                    <CheckCircle className="h-4 w-4 mr-1" />
                                    Process
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Approval Dialog */}
        {selectedLedger && (
          <ApprovalDialog
            open={showApprovalDialog}
            onOpenChange={setShowApprovalDialog}
            ledger={selectedLedger}
            approvalLevel={getApprovalLevel(selectedLedger)}
            onApprove={handleApprovalSubmit}
            onReject={handleReject}
            isSubmitting={approvalMutation.isPending}
          />
        )}

        {/* History Dialog */}
        <Dialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Commission Ledger Details</DialogTitle>
            </DialogHeader>
            {selectedLedger && <ApprovalHistory ledger={selectedLedger} />}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}