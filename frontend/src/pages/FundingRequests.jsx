import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, TrendingUp, TrendingDown, Eye, Edit, Plus, Upload, Download, CheckSquare, XSquare, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import ProcessFundingDialog from "../components/funding/ProcessFundingDialog.jsx";
import AddTransactionDialog from "../components/funding/AddTransactionDialog";
import BulkImportDialog from "../components/funding/BulkImportDialog";
import TagChips from "../components/funding/TagChips";
import { 
  canProcessFundingTransaction,
  canCreateFundingTransaction,
  filterFundingTransactionsByRole 
} from "../components/utils/FundingAccessControl";
import { toast } from "sonner";
import { format } from "date-fns";
import { logAction } from "../components/utils/AuditLogger";

export default function FundingRequests() {
  const [currentUser, setCurrentUser] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterMentor, setFilterMentor] = useState('all');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('all');
  const [filterTag, setFilterTag] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showBulkUpdateDialog, setShowBulkUpdateDialog] = useState(false);
  const [bulkUpdatePaymentMethod, setBulkUpdatePaymentMethod] = useState('');
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [showProcessDialog, setShowProcessDialog] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showBulkImportDialog, setShowBulkImportDialog] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  const queryClient = useQueryClient();

  useEffect(() => {
    const fetchUser = async () => {
      const user = await base44.auth.me();
      setCurrentUser(user);
    };
    fetchUser();
  }, []);

  const { data: transactions = [] } = useQuery({
    queryKey: ['funding-transactions'],
    queryFn: () => base44.entities.FundingTransaction.list('-requested_at'),
    enabled: !!currentUser
  });

  const { data: students = [] } = useQuery({
    queryKey: ['students'],
    queryFn: () => base44.entities.Student.list(),
    enabled: !!currentUser
  });

  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['all-users-funding'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAllUsers', {});
      return res.data?.users || [];
    },
    enabled: !!currentUser
  });

  const { data: tagCatalog = [] } = useQuery({
    queryKey: ['transaction-tags-catalog'],
    queryFn: () => base44.entities.TransactionTag.list('name'),
    enabled: !!currentUser,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const result = await base44.entities.FundingTransaction.update(id, data);
      const action = data.status === 'APPROVED' ? 'approve_funding_transaction' : 'reject_funding_transaction';
      await logAction(action, 'FundingTransaction', id, `${data.status} transaction for ${data.student_name}`, null, data);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['funding-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
      setShowProcessDialog(false);
      setSelectedTransaction(null);
      toast.success('Transaction processed successfully');
    }
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const user = await base44.auth.me();
      const result = await base44.entities.FundingTransaction.create({
        ...data,
        initiating_mentor_id: data.type === 'WITHDRAWAL'
          ? data.primary_mentor_id
          : (data.initiating_mentor_id || user.id),
        initiating_mentor_name: data.type === 'WITHDRAWAL'
          ? data.primary_mentor_name
          : (data.initiating_mentor_name || user.full_name),
        requested_by_id: user.id,
        requested_by_name: user.full_name,
        requested_at: new Date().toISOString()
      });
      await logAction('create_funding_transaction', 'FundingTransaction', result.id, `Created ${data.type} for ${data.student_name}`, null, data);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['funding-transactions'] });
      setShowAddDialog(false);
      toast.success('Transaction created successfully');
    }
  });

  const bulkCreateMutation = useMutation({
    mutationFn: async (transactions) => {
      const user = await base44.auth.me();
      const transactionsWithMeta = transactions.map(t => ({
        ...t,
        initiating_mentor_id: t.initiating_mentor_id || user.id,
        initiating_mentor_name: t.initiating_mentor_name || user.full_name,
        requested_by_id: user.id,
        requested_by_name: user.full_name,
        requested_at: new Date().toISOString()
      }));
      const result = await base44.entities.FundingTransaction.bulkCreate(transactionsWithMeta);
      await logAction('bulk_import_transactions', 'FundingTransaction', null, `Imported ${transactions.length} transactions`, null, { count: transactions.length });
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['funding-transactions'] });
      setShowBulkImportDialog(false);
    }
  });

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Filter transactions
  let filteredTransactions = filterFundingTransactionsByRole(currentUser, transactions, students, users);

  // Apply filters
  if (filterStatus !== 'all') {
    filteredTransactions = filteredTransactions.filter(t => t.status === filterStatus);
  }
  if (filterType !== 'all') {
    filteredTransactions = filteredTransactions.filter(t => t.type === filterType);
  }
  if (filterMentor !== 'all') {
    filteredTransactions = filteredTransactions.filter(t => {
      const initiatingName = t.initiating_mentor_name;
      const primaryName = t.primary_mentor_name;
      return initiatingName ? initiatingName === filterMentor : primaryName === filterMentor;
    });
  }
  if (filterPaymentMethod !== 'all') {
    filteredTransactions = filteredTransactions.filter(t => t.payment_method === filterPaymentMethod);
  }
  if (filterTag !== 'all') {
    filteredTransactions = filteredTransactions.filter(t => Array.isArray(t.tags) && t.tags.includes(filterTag));
  }
  if (filterDateFrom) {
    const from = new Date(filterDateFrom);
    filteredTransactions = filteredTransactions.filter(t => {
      const d = new Date(t.requested_at || t.created_date);
      return d >= from;
    });
  }
  if (filterDateTo) {
    const to = new Date(filterDateTo + 'T23:59:59');
    filteredTransactions = filteredTransactions.filter(t => {
      const d = new Date(t.requested_at || t.created_date);
      return d <= to;
    });
  }
  if (searchTerm) {
    const lowerSearch = searchTerm.toLowerCase();
    // Coerce each field to a string before lowercasing — imported docs may
    // have numeric mt5_login / transaction_id values that would otherwise
    // throw .toLowerCase is not a function and blank the page.
    const has = (v) => v != null && String(v).toLowerCase().includes(lowerSearch);
    filteredTransactions = filteredTransactions.filter(t => {
      const student = students.find(s => s.id === t.student_id);
      return has(t.student_name) ||
        has(t.student_code) ||
        has(t.mt5_login) ||
        has(t.transaction_id) ||
        has(t.user_id) ||
        has(student?.email);
    });
  }

  // Get unique mentors for filter
  const uniqueMentors = [...new Set(transactions.map(t => t.primary_mentor_name))].filter(Boolean);
  
  // Get unique payment methods for filter
  const uniquePaymentMethods = [...new Set(transactions.map(t => t.payment_method))].filter(Boolean).sort();

  const canProcess = canProcessFundingTransaction(currentUser.app_role);
  const canCreate = canCreateFundingTransaction(currentUser.app_role);
  const isBackendAdmin = ['broker_admin', 'super_admin', 'admin'].includes(currentUser.app_role);

  const handleProcess = (transaction) => {
    setSelectedTransaction(transaction);
    setShowProcessDialog(true);
  };

  const handleProcessSubmit = (formData) => {
    const updatedData = {
      ...formData,
      approved_by_id: currentUser.id,
      approved_by_name: currentUser.full_name,
      approved_at: new Date().toISOString()
    };
    
    updateMutation.mutate({
      id: selectedTransaction.id,
      data: updatedData
    });
  };

  // Bulk approval handlers
  const pendingTransactions = filteredTransactions.filter(t => t.status === 'PENDING');
  const selectedPendingIds = selectedIds.filter(id => 
    pendingTransactions.some(t => t.id === id)
  );

  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedIds(pendingTransactions.map(t => t.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id, checked) => {
    if (checked) {
      setSelectedIds(prev => [...prev, id]);
    } else {
      setSelectedIds(prev => prev.filter(i => i !== id));
    }
  };

  const handleBulkApprove = async () => {
    if (selectedPendingIds.length === 0) {
      toast.error('No pending transactions selected');
      return;
    }

    setIsBulkProcessing(true);
    try {
      const updatePromises = selectedPendingIds.map(async (id) => {
        const transaction = transactions.find(t => t.id === id);
        await base44.entities.FundingTransaction.update(id, {
          status: 'APPROVED',
          approved_by_id: currentUser.id,
          approved_by_name: currentUser.full_name,
          approved_at: new Date().toISOString()
        });
        await logAction('approve_funding_transaction', 'FundingTransaction', id, 
          `Bulk approved transaction for ${transaction?.student_name}`, null, { status: 'APPROVED' });
        
        // Auto-upgrade Level 1 student to Level 2 on first approved deposit
        if (transaction?.type === 'DEPOSIT') {
          const student = students.find(s => s.id === transaction.student_id);
          if (student?.student_level === 'LEVEL_1') {
            const prevApproved = transactions.filter(
              t => t.student_id === transaction.student_id && t.type === 'DEPOSIT' && t.status === 'APPROVED' && t.id !== id
            );
            if (prevApproved.length === 0) {
              await base44.entities.Student.update(transaction.student_id, { student_level: 'LEVEL_2' });
            }
          }
        }
      });

      await Promise.all(updatePromises);
      queryClient.invalidateQueries({ queryKey: ['funding-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
      setSelectedIds([]);
      toast.success(`Successfully approved ${selectedPendingIds.length} transactions`);
    } catch (error) {
      toast.error('Failed to bulk approve transactions');
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const handleBulkReject = async () => {
    if (selectedPendingIds.length === 0) {
      toast.error('No pending transactions selected');
      return;
    }

    setIsBulkProcessing(true);
    try {
      const updatePromises = selectedPendingIds.map(id => {
        const transaction = transactions.find(t => t.id === id);
        return base44.entities.FundingTransaction.update(id, {
          status: 'REJECTED',
          approved_by_id: currentUser.id,
          approved_by_name: currentUser.full_name,
          approved_at: new Date().toISOString(),
          notes: 'Bulk rejected'
        }).then(() => 
          logAction('reject_funding_transaction', 'FundingTransaction', id, 
            `Bulk rejected transaction for ${transaction?.student_name}`, null, { status: 'REJECTED' })
        );
      });

      await Promise.all(updatePromises);
      queryClient.invalidateQueries({ queryKey: ['funding-transactions'] });
      setSelectedIds([]);
      toast.success(`Successfully rejected ${selectedPendingIds.length} transactions`);
    } catch (error) {
      toast.error('Failed to bulk reject transactions');
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // Bulk update payment method (super_admin only)
  const handleBulkUpdatePaymentMethod = async () => {
    if (selectedIds.length === 0) {
      toast.error('No transactions selected');
      return;
    }
    if (!bulkUpdatePaymentMethod) {
      toast.error('Please select a payment method');
      return;
    }

    setIsBulkProcessing(true);
    try {
      const updatePromises = selectedIds.map(id => {
        const transaction = transactions.find(t => t.id === id);
        return base44.entities.FundingTransaction.update(id, {
          payment_method: bulkUpdatePaymentMethod
        }).then(() => 
          logAction('update_funding_transaction', 'FundingTransaction', id, 
            `Bulk updated payment method to ${bulkUpdatePaymentMethod} for ${transaction?.student_name}`, 
            { payment_method: transaction?.payment_method }, 
            { payment_method: bulkUpdatePaymentMethod })
        );
      });

      await Promise.all(updatePromises);
      queryClient.invalidateQueries({ queryKey: ['funding-transactions'] });
      setSelectedIds([]);
      setShowBulkUpdateDialog(false);
      setBulkUpdatePaymentMethod('');
      toast.success(`Successfully updated payment method for ${selectedIds.length} transactions`);
    } catch (error) {
      toast.error('Failed to bulk update payment method');
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // Bulk delete (super_admin only)
  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) {
      toast.error('No transactions selected');
      return;
    }

    setIsBulkProcessing(true);
    try {
      const deletePromises = selectedIds.map(id => {
        const transaction = transactions.find(t => t.id === id);
        return base44.entities.FundingTransaction.delete(id).then(() => 
          logAction('delete_funding_transaction', 'FundingTransaction', id, 
            `Deleted transaction for ${transaction?.student_name}`, transaction, null)
        );
      });

      await Promise.all(deletePromises);
      queryClient.invalidateQueries({ queryKey: ['funding-transactions'] });
      setSelectedIds([]);
      setShowBulkDeleteDialog(false);
      toast.success(`Successfully deleted ${selectedIds.length} transactions`);
    } catch (error) {
      toast.error('Failed to bulk delete transactions');
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'PENDING': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'APPROVED': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'REJECTED': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getTypeColor = (type) => {
    return type === 'DEPOSIT'
      ? 'bg-blue-100 text-blue-800 border-blue-200'
      : 'bg-purple-100 text-purple-800 border-purple-200';
  };

  const handleExportFundingRequests = () => {
    if (filteredTransactions.length === 0) {
      toast.error('No transactions to export');
      return;
    }

    const escapeCSV = (value) => {
      if (value === null || value === undefined) return '';
      const stringValue = String(value);
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    };

    const csvContent = [
      ['Requested Date', 'Type', 'Status', 'Student Name', 'Student Email', 'Student Code', 'Primary Mentor', 'Added By', 'MT5 Login', 'Amount USD', 'Payment Method', 'Tags', 'User ID', 'Transaction ID', 'Approved By', 'Approved Date', 'Notes'].join(','),
      ...filteredTransactions.map(t => {
        const student = students.find(s => s.id === t.student_id);
        // Tags are stored as a string array; join with "; " so they fit in one CSV cell.
        const tagsStr = Array.isArray(t.tags) ? t.tags.join('; ') : '';
        return [
          escapeCSV(t.requested_at ? format(new Date(t.requested_at), 'yyyy-MM-dd HH:mm') : ''),
          escapeCSV(t.type || ''),
          escapeCSV(t.status || ''),
          escapeCSV(t.student_name || ''),
          escapeCSV(student?.email || ''),
          escapeCSV(t.student_code || ''),
          escapeCSV(t.primary_mentor_name || ''),
          escapeCSV(t.initiating_mentor_name || t.requested_by_name || ''),
          escapeCSV(t.mt5_login || ''),
          escapeCSV(t.amount_usd?.toFixed(2) || '0.00'),
          escapeCSV(t.payment_method || ''),
          escapeCSV(tagsStr),
          escapeCSV(t.user_id || ''),
          escapeCSV(t.transaction_id || ''),
          escapeCSV(t.approved_by_name || ''),
          escapeCSV(t.approved_at ? format(new Date(t.approved_at), 'yyyy-MM-dd HH:mm') : ''),
          escapeCSV(t.notes || '')
        ].join(',');
      })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `funding_requests_export_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filteredTransactions.length} funding requests successfully`);
  };

  // Calculate summary stats
  const pendingCount = filteredTransactions.filter(t => t.status === 'PENDING').length;
  const approvedCount = filteredTransactions.filter(t => t.status === 'APPROVED').length;
  const rejectedCount = filteredTransactions.filter(t => t.status === 'REJECTED').length;
  const totalPendingAmount = filteredTransactions
    .filter(t => t.status === 'PENDING')
    .reduce((sum, t) => sum + (t.amount_usd || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Funding Requests</h1>
            <p className="text-gray-600 mt-2 text-base">Review and process deposit and withdrawal requests</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleExportFundingRequests} variant="outline" className="border-green-600 text-green-600 hover:bg-green-50">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            {isBackendAdmin && (
              <>
                <Button onClick={() => setShowAddDialog(true)} className="bg-blue-600 hover:bg-blue-700">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Transaction
                </Button>
                <Button onClick={() => setShowBulkImportDialog(true)} variant="outline">
                  <Upload className="h-4 w-4 mr-2" />
                  Bulk Import
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="border-none bg-gradient-to-br from-amber-100 to-orange-100 shadow-lg">
            <CardContent className="p-4">
              <p className="text-sm font-medium text-gray-700 uppercase tracking-wide">Pending Requests</p>
              <p className="text-3xl font-bold text-amber-700 mt-1">{pendingCount}</p>
            </CardContent>
          </Card>
          <Card className="border-none bg-gradient-to-br from-emerald-100 to-teal-100 shadow-lg">
            <CardContent className="p-4">
              <p className="text-sm font-medium text-gray-700 uppercase tracking-wide">Approved</p>
              <p className="text-3xl font-bold text-emerald-700 mt-1">{approvedCount}</p>
            </CardContent>
          </Card>
          <Card className="border-none bg-gradient-to-br from-red-100 to-pink-100 shadow-lg">
            <CardContent className="p-4">
              <p className="text-sm font-medium text-gray-700 uppercase tracking-wide">Rejected</p>
              <p className="text-3xl font-bold text-red-700 mt-1">{rejectedCount}</p>
            </CardContent>
          </Card>
          <Card className="border-none bg-gradient-to-br from-blue-100 to-indigo-100 shadow-lg">
            <CardContent className="p-4">
              <p className="text-sm font-medium text-gray-700 uppercase tracking-wide">Pending Amount</p>
              <p className="text-3xl font-bold text-blue-700 mt-1">${totalPendingAmount.toFixed(2)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="border-gray-200">
          <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-blue-50">
            <CardTitle className="text-lg font-semibold tracking-tight">Filters</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="flex flex-col gap-3">
              {/* Top row: filters left, search right */}
              <div className="flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex flex-wrap items-center gap-3 flex-1">

              {/* Status Filter */}
              <Tabs value={filterStatus} onValueChange={setFilterStatus}>
                <TabsList>
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="PENDING">Pending</TabsTrigger>
                  <TabsTrigger value="APPROVED">Approved</TabsTrigger>
                  <TabsTrigger value="REJECTED">Rejected</TabsTrigger>
                </TabsList>
              </Tabs>

              {/* Type Filter */}
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="DEPOSIT">Deposit</SelectItem>
                  <SelectItem value="WITHDRAWAL">Withdrawal</SelectItem>
                </SelectContent>
              </Select>

              {/* Mentor Filter */}
              <Select value={filterMentor} onValueChange={setFilterMentor}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Mentor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Mentors</SelectItem>
                  {uniqueMentors.map((mentor) => (
                    <SelectItem key={mentor} value={mentor}>
                      {mentor}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Date Range Filter */}
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={filterDateFrom}
                  onChange={e => setFilterDateFrom(e.target.value)}
                  className="w-38 h-9 text-sm"
                  placeholder="From"
                />
                <span className="text-gray-400 text-sm">–</span>
                <Input
                  type="date"
                  value={filterDateTo}
                  onChange={e => setFilterDateTo(e.target.value)}
                  className="w-38 h-9 text-sm"
                  placeholder="To"
                />
                {(filterDateFrom || filterDateTo) && (
                  <Button variant="ghost" size="sm" onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); }} className="text-gray-400 hover:text-gray-600 px-2">✕</Button>
                )}
              </div>

              {/* Payment Method Filter */}
              {['super_admin', 'broker_admin'].includes(currentUser.app_role) && (
                <Select value={filterPaymentMethod} onValueChange={setFilterPaymentMethod}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Payment Method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Payment Methods</SelectItem>
                    {uniquePaymentMethods.map((method) => (
                      <SelectItem key={method} value={method}>
                        {method}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Tag Filter (admin-managed list from TransactionTag) */}
              {tagCatalog.length > 0 && (
                <Select value={filterTag} onValueChange={setFilterTag}>
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="Tag" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Tags</SelectItem>
                    {tagCatalog.filter(t => t.active !== false).map((t) => (
                      <SelectItem key={t.id} value={t.name}>
                        <span className="inline-flex items-center gap-2">
                          {t.color && <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color }} />}
                          {t.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
                </div>

                {/* Search - top right */}
                <div className="md:w-72 w-full">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Search student, code, MT5, txn ID..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Transactions Table */}
        <Card className="border-gray-200">
          <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-blue-50">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-semibold tracking-tight">Funding Requests</CardTitle>
              {/* Bulk Action Buttons */}
              {['super_admin', 'broker_admin'].includes(currentUser.app_role) && selectedPendingIds.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">{selectedPendingIds.length} selected</span>
                  <Button
                    size="sm"
                    onClick={handleBulkApprove}
                    disabled={isBulkProcessing}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    <CheckSquare className="h-4 w-4 mr-1" />
                    Bulk Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleBulkReject}
                    disabled={isBulkProcessing}
                  >
                    <XSquare className="h-4 w-4 mr-1" />
                    Bulk Reject
                  </Button>
                </div>
              )}
              {/* Bulk Update Payment Method & Delete - Super Admin Only */}
              {currentUser.app_role === 'super_admin' && selectedIds.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">{selectedIds.length} selected</span>
                  <Button
                    size="sm"
                    onClick={() => setShowBulkUpdateDialog(true)}
                    disabled={isBulkProcessing}
                    variant="outline"
                    className="border-purple-600 text-purple-600 hover:bg-purple-50"
                  >
                    <Edit className="h-4 w-4 mr-1" />
                    Bulk Update Payment
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setShowBulkDeleteDialog(true)}
                    disabled={isBulkProcessing}
                    variant="destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Bulk Delete
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    {['super_admin', 'broker_admin'].includes(currentUser.app_role) && (
                      <TableHead className="w-12">
                        <Checkbox
                          checked={
                            currentUser.app_role === 'super_admin' 
                              ? filteredTransactions.length > 0 && selectedIds.length === filteredTransactions.length
                              : pendingTransactions.length > 0 && selectedPendingIds.length === pendingTransactions.length
                          }
                          onCheckedChange={(checked) => {
                            if (currentUser.app_role === 'super_admin') {
                              setSelectedIds(checked ? filteredTransactions.map(t => t.id) : []);
                            } else {
                              handleSelectAll(checked);
                            }
                          }}
                          disabled={currentUser.app_role === 'super_admin' ? filteredTransactions.length === 0 : pendingTransactions.length === 0}
                        />
                      </TableHead>
                    )}
                    <TableHead className="font-semibold">Requested</TableHead>
                    <TableHead className="font-semibold">Type</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="font-semibold">Student</TableHead>
                    <TableHead className="font-semibold">Email</TableHead>
                    <TableHead className="font-semibold">Code</TableHead>
                    <TableHead className="font-semibold">Level</TableHead>
                    <TableHead className="font-semibold">Primary Mentor</TableHead>
                    <TableHead className="font-semibold">Added By</TableHead>
                    <TableHead className="font-semibold">MT5 Login</TableHead>
                    <TableHead className="font-semibold">Amount</TableHead>
                    <TableHead className="font-semibold">Payment</TableHead>
                    <TableHead className="font-semibold">Tags</TableHead>
                    <TableHead className="font-semibold">User ID</TableHead>
                    <TableHead className="font-semibold">Txn ID</TableHead>
                    <TableHead className="font-semibold">Approved By</TableHead>
                    <TableHead className="font-semibold">Rejection Reason</TableHead>
                    <TableHead className="font-semibold text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransactions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={['super_admin', 'broker_admin'].includes(currentUser.app_role) ? 18 : 17} className="text-center py-8 text-gray-500">
                        No funding requests found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredTransactions.map((transaction) => {
                      const student = students.find(s => s.id === transaction.student_id);
                      
                      return (
                      <TableRow key={transaction.id} className="hover:bg-gray-50 transition-colors">
                        {['super_admin', 'broker_admin'].includes(currentUser.app_role) && (
                          <TableCell>
                            {currentUser.app_role === 'super_admin' ? (
                              <Checkbox
                                checked={selectedIds.includes(transaction.id)}
                                onCheckedChange={(checked) => handleSelectOne(transaction.id, checked)}
                              />
                            ) : (
                              transaction.status === 'PENDING' && (
                                <Checkbox
                                  checked={selectedIds.includes(transaction.id)}
                                  onCheckedChange={(checked) => handleSelectOne(transaction.id, checked)}
                                />
                              )
                            )}
                          </TableCell>
                        )}
                        <TableCell className="text-sm">
                          {transaction.requested_at
                            ? format(new Date(transaction.requested_at), 'MMM d, HH:mm')
                            : '-'}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {transaction.type === 'DEPOSIT' ? (
                              <TrendingUp className="h-4 w-4 text-blue-600" />
                            ) : (
                              <TrendingDown className="h-4 w-4 text-purple-600" />
                            )}
                            <Badge variant="outline" className={getTypeColor(transaction.type)}>
                              {transaction.type}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={getStatusColor(transaction.status)}>
                            {transaction.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{transaction.student_name}</TableCell>
                        <TableCell className="text-sm">
                          {student?.email || '-'}
                        </TableCell>
                        <TableCell className="font-mono text-sm text-blue-600">
                          {transaction.student_code}
                        </TableCell>
                        <TableCell>
                         {student?.student_level === 'LEVEL_1' ? (
                           <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200">
                             Level 1
                           </Badge>
                         ) : (
                           <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">
                             Level 2
                           </Badge>
                         )}
                        </TableCell>
                        <TableCell className="text-sm">{transaction.primary_mentor_name}</TableCell>
                        <TableCell className="text-sm">
                          {transaction.initiating_mentor_name ? (
                            <>
                              {transaction.initiating_mentor_name}
                              {transaction.initiating_mentor_id === transaction.primary_mentor_id && <span className="text-xs text-gray-500 block">(Primary)</span>}
                              {transaction.initiating_mentor_id === transaction.senior_mentor_id && <span className="text-xs text-gray-500 block">(Senior)</span>}
                            </>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {transaction.mt5_login || '-'}
                        </TableCell>
                        <TableCell className="font-semibold text-gray-900">
                          ${transaction.amount_usd?.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-sm">{transaction.payment_method}</TableCell>
                        <TableCell>
                          {transaction.tags && transaction.tags.length > 0
                            ? <TagChips tags={transaction.tags} />
                            : <span className="text-gray-400">-</span>}
                        </TableCell>
                        <TableCell className="text-sm">{transaction.user_id || '-'}</TableCell>
                        <TableCell className="text-sm font-mono">
                          {transaction.transaction_id || '-'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {transaction.approved_by_name ? (
                            <div>
                              <p className="font-medium">{transaction.approved_by_name}</p>
                              {transaction.approved_at && (
                                <p className="text-xs text-gray-500">
                                  {format(new Date(transaction.approved_at), 'MMM d, HH:mm')}
                                </p>
                              )}
                            </div>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {transaction.status === 'REJECTED' && transaction.rejection_reason ? (
                            <span className="text-red-600 font-medium">{transaction.rejection_reason}</span>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {transaction.screenshot_url && (
                              <a
                                href={transaction.screenshot_url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </a>
                            )}
                            {canProcess && transaction.status === 'PENDING' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleProcess(transaction)}
                                className="h-8 w-8 p-0"
                                >
                                <Edit className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Process Dialog */}
        <ProcessFundingDialog
          transaction={selectedTransaction}
          currentUser={currentUser}
          open={showProcessDialog}
          onClose={() => {
            setShowProcessDialog(false);
            setSelectedTransaction(null);
          }}
          onProcess={handleProcessSubmit}
        />

        {/* Add Transaction Dialog */}
        <AddTransactionDialog
          open={showAddDialog}
          onClose={() => setShowAddDialog(false)}
          onSubmit={(data) => createMutation.mutate(data)}
          students={students}
          isSubmitting={createMutation.isPending}
        />

        {/* Bulk Import Dialog */}
        <BulkImportDialog
          open={showBulkImportDialog}
          onClose={() => setShowBulkImportDialog(false)}
          onImport={(transactions) => bulkCreateMutation.mutate(transactions)}
          students={students}
          users={users}
        />

        {/* Bulk Update Payment Method Dialog - Super Admin Only */}
        <Dialog open={showBulkUpdateDialog} onOpenChange={setShowBulkUpdateDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Bulk Update Payment Method</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Update payment method for {selectedIds.length} selected transaction(s)
              </p>
              <div className="space-y-2">
                <Label>New Payment Method</Label>
                <Select value={bulkUpdatePaymentMethod} onValueChange={setBulkUpdatePaymentMethod}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select payment method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AED TRANSFER">AED TRANSFER</SelectItem>
                    <SelectItem value="UPI">UPI</SelectItem>
                    <SelectItem value="CARD PAYMENT">CARD PAYMENT</SelectItem>
                    <SelectItem value="USDT">USDT</SelectItem>
                    <SelectItem value="INR TRANSFER">INR TRANSFER</SelectItem>
                    <SelectItem value="Cash deposit">Cash deposit</SelectItem>
                    <SelectItem value="Cash Withdrawal">Cash Withdrawal</SelectItem>
                    <SelectItem value="Bank Withdrawal">Bank Withdrawal</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setShowBulkUpdateDialog(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleBulkUpdatePaymentMethod}
                  disabled={isBulkProcessing || !bulkUpdatePaymentMethod}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  {isBulkProcessing ? 'Updating...' : 'Update'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Bulk Delete Dialog - Super Admin Only */}
        <Dialog open={showBulkDeleteDialog} onOpenChange={setShowBulkDeleteDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Confirm Bulk Delete</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Are you sure you want to delete {selectedIds.length} selected transaction(s)? This action cannot be undone.
              </p>
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setShowBulkDeleteDialog(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleBulkDelete}
                  disabled={isBulkProcessing}
                  variant="destructive"
                >
                  {isBulkProcessing ? 'Deleting...' : 'Delete'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}