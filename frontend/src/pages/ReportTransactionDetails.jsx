import React, { useMemo, useState, useEffect } from 'react';
import { getEffectiveUser } from '../components/utils/ImpersonationContext';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Download } from 'lucide-react';
import { format } from 'date-fns';

const MENTOR_ROLES = ['junior_mentor', 'senior_mentor'];

export default function ReportTransactionDetails() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then((u) => setCurrentUser(getEffectiveUser(u)));
  }, []);

  const isMentor = currentUser && MENTOR_ROLES.includes(currentUser.app_role);
  const params = new URLSearchParams(window.location.search);
  const filterType = params.get('filterType'); // 'mentor', 'student', 'added_by'
  const filterId = params.get('filterId');
  const filterName = params.get('filterName');
  const startDate = params.get('startDate');
  const endDate = params.get('endDate');
  const dateLabel = params.get('dateLabel');
  const reportType = params.get('reportType'); // 'primary' | null

  const { data: allTransactions = [], isLoading } = useQuery({
    queryKey: ['funding-transactions-approved-detail'],
    queryFn: () => base44.entities.FundingTransaction.filter({ status: 'APPROVED' })
  });

  const { data: allAdjustments = [] } = useQuery({
    queryKey: ['manual-commission-adjustments-detail'],
    queryFn: () => base44.entities.ManualCommissionAdjustment.list()
  });

  const transactions = useMemo(() => {
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate + 'T23:59:59') : null;

    return allTransactions.filter((t) => {
      const txDate = new Date(t.requested_at || t.created_date);
      if (start && txDate < start) return false;
      if (end && txDate > end) return false;

      if (filterType === 'student') return t.student_id === filterId;
      if (filterType === 'mentor') {
        if (reportType === 'primary') {
          const effectiveId = t.initiating_mentor_id || t.primary_mentor_id;
          return effectiveId === filterId;
        }
        return (t.initiating_mentor_id || t.primary_mentor_id) === filterId;
      }
      if (filterType === 'added_by') return (t.initiating_mentor_id || t.requested_by_id) === filterId;
      return true;
    });
  }, [allTransactions, filterType, filterId, startDate, endDate]);

  const adjustments = useMemo(() => {
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate + 'T23:59:59') : null;
    return allAdjustments.filter((a) => {
      if (filterType === 'mentor' && a.mentor_id !== filterId) return false;
      const aDate = new Date(a.created_date);
      if (start && aDate < start) return false;
      if (end && aDate > end) return false;
      return true;
    });
  }, [allAdjustments, filterType, filterId, startDate, endDate]);

  const totals = useMemo(() => {
    // Group by student, apply $25K cap per student on net deposit
    const studentMap = {};
    for (const t of transactions) {
      if (!studentMap[t.student_id]) {
        studentMap[t.student_id] = { deposits: 0, withdrawals: 0 };
      }
      // BONUS counts toward deposits for commission (same business rule as
      // every other commission calculator in the app).
      if (t.type === 'DEPOSIT' || t.type === 'BONUS') studentMap[t.student_id].deposits += t.amount_usd || 0;
      else if (t.type === 'WITHDRAWAL') studentMap[t.student_id].withdrawals += t.amount_usd || 0;
    }

    let commissionFromDepositsOnly = 0;
    let grossCommission = 0;
    const CAP = 25000;

    for (const s of Object.values(studentMap)) {
      const depositsCapped = Math.min(s.deposits, CAP);
      commissionFromDepositsOnly += depositsCapped * 0.04;
      const commissionableNet = Math.min(Math.max(s.deposits - s.withdrawals, 0), CAP);
      grossCommission += commissionableNet * 0.04;
    }

    // Commission deducted = reduction in commission due to withdrawals (within per-student cap)
    const commissionDeducted = commissionFromDepositsOnly - grossCommission;
    const manualAdjTotal = adjustments.reduce((sum, a) => {
      return sum + (a.adjustment_type === 'addition' ? a.amount_usd || 0 : -(Math.abs(a.amount_usd) || 0));
    }, 0);

    const totalDeposit = transactions.filter((t) => t.type === 'DEPOSIT' || t.type === 'BONUS').reduce((s, t) => s + (t.amount_usd || 0), 0);
    const totalWithdrawal = transactions.filter((t) => t.type === 'WITHDRAWAL').reduce((s, t) => s + (t.amount_usd || 0), 0);
    const netDeposit = totalDeposit - totalWithdrawal;

    return {
      commissionEarned: commissionFromDepositsOnly,
      commissionDeducted,
      grossCommission,
      manualAdjTotal,
      netCommission: grossCommission + manualAdjTotal,
      totalDeposit,
      totalWithdrawal,
      netDeposit
    };
  }, [transactions, adjustments]);

  const handleExport = () => {
    const headers = ['Date', 'Student Code', 'Student', 'Primary Mentor', 'Senior Mentor', 'Added By', 'Type', 'Amount (USD)', 'Payment Method', 'Transaction ID'];
    const rows = transactions.map((t) => [
    t.requested_at ? format(new Date(t.requested_at), 'dd MMM yyyy HH:mm') : '',
    t.student_code || '',
    `"${t.student_name || ''}"`,
    `"${t.primary_mentor_name || ''}"`,
    `"${t.senior_mentor_name || ''}"`,
    `"${t.initiating_mentor_name || t.requested_by_name || ''}"`,
    t.type,
    (t.amount_usd || 0).toFixed(2),
    `"${t.payment_method || ''}"`,
    t.transaction_id || ''].
    join(','));
    const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `transactions_${filterName}_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
  };

  return (
    <div className="p-6 max-w-full">
            <div className="flex items-center gap-3 mb-6">
                <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
                    <ArrowLeft className="h-4 w-4 mr-1" /> Back
                </Button>
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Transaction Details</h1>
                    <p className="text-sm text-gray-500 mt-0.5">
                        {filterName} · {dateLabel}
                    </p>
                </div>
            </div>

            {isLoading ?
      <div className="flex items-center justify-center py-20">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                    <p className="ml-3 text-gray-500">Loading transactions...</p>
                </div> :

      <>
                    {/* Summary */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-5">
                        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                            <p className="text-xs text-green-600 font-medium uppercase tracking-wide">Total Deposit</p>
                            <p className="text-2xl font-bold text-green-700 mt-1">${totals.totalDeposit.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                        </div>
                        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                            <p className="text-xs text-red-600 font-medium uppercase tracking-wide">Total Withdrawal</p>
                            <p className="text-2xl font-bold text-red-700 mt-1">${totals.totalWithdrawal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                        </div>
                        <div className={`border rounded-xl p-4 ${totals.netDeposit >= 0 ? 'bg-blue-50 border-blue-200' : 'bg-orange-50 border-orange-200'}`}>
                            <p className={`text-xs font-medium uppercase tracking-wide ${totals.netDeposit >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>Net Deposit</p>
                            <p className={`text-2xl font-bold mt-1 ${totals.netDeposit >= 0 ? 'text-blue-700' : 'text-orange-700'}`}>${totals.netDeposit.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                        </div>
                    </div>
                    {reportType !== 'primary' && filterType !== 'student' && <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
                        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                            <p className="text-xs text-green-600 font-medium uppercase tracking-wide">Commission Earned</p>
                            <p className="text-2xl font-bold text-green-700 mt-1">${totals.commissionEarned.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                            <p className="text-xs text-gray-400 mt-1">4% of deposits</p>
                        </div>
                        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                            <p className="text-xs text-red-600 font-medium uppercase tracking-wide">Commission Deducted</p>
                            <p className="text-2xl font-bold text-red-700 mt-1">${totals.commissionDeducted.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                            <p className="text-xs text-gray-400 mt-1">4% of withdrawals</p>
                        </div>
                        <div className={`border rounded-xl p-4 ${totals.manualAdjTotal >= 0 ? 'bg-amber-50 border-amber-200' : 'bg-orange-50 border-orange-200'}`}>
                            <p className={`text-xs font-medium uppercase tracking-wide ${totals.manualAdjTotal >= 0 ? 'text-amber-600' : 'text-orange-600'}`}>Manual Adjustments</p>
                            <p className={`text-2xl font-bold mt-1 ${totals.manualAdjTotal >= 0 ? 'text-amber-700' : 'text-orange-700'}`}>
                                {totals.manualAdjTotal >= 0 ? '+' : ''}${totals.manualAdjTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </p>
                            <p className="text-xs text-gray-400 mt-1">{adjustments.length} adjustment{adjustments.length !== 1 ? 's' : ''}</p>
                        </div>
                        <div className={`border rounded-xl p-4 ${totals.netCommission >= 0 ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'}`}>
                            <p className={`text-xs font-medium uppercase tracking-wide ${totals.netCommission >= 0 ? 'text-blue-600' : 'text-red-600'}`}>Net Commission</p>
                            <p className={`text-2xl font-bold mt-1 ${totals.netCommission >= 0 ? 'text-blue-700' : 'text-red-700'}`}>${totals.netCommission.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                            <p className="text-xs text-gray-400 mt-1">Earned − Deducted + Adj.</p>
                        </div>
                    </div>}

                    {/* Table */}
                    <div className="flex items-center justify-between mb-3">
                        <p className="text-sm text-gray-500">{transactions.length} transactions</p>
                        <Button variant="outline" size="sm" onClick={handleExport} disabled={!transactions.length}>
                            <Download className="h-4 w-4 mr-1" /> Export CSV
                        </Button>
                    </div>

                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-50 border-b border-gray-200">
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Date</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Code</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Student</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Primary Mentor</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Senior Mentor</th>
                                        {!isMentor && <th className="text-left px-4 py-3 font-semibold text-gray-600">Added By</th>}
                                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Type</th>
                                        <th className="text-right px-4 py-3 font-semibold text-gray-600">Amount (USD)</th>
                                        <th className="text-right px-4 py-3 font-semibold text-gray-600">Commission (4%)</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Payment Method</th>
                                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Txn ID</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {transactions.length === 0 ?
                <tr><td colSpan={10} className="text-center py-12 text-gray-400">No transactions found.</td></tr> :
                transactions.map((t, idx) =>
                <tr key={t.id} className={`border-b border-gray-100 hover:bg-gray-50 ${idx % 2 !== 0 ? 'bg-gray-50/40' : ''}`}>
                                            <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                                                {t.requested_at ? format(new Date(t.requested_at), 'dd MMM yyyy') : '—'}
                                            </td>
                                            <td className="px-4 py-3 text-gray-500 font-mono text-xs">{t.student_code || '—'}</td>
                                            <td className="px-4 py-3 font-medium text-gray-900">{t.student_name}</td>
                                            <td className="px-4 py-3 text-gray-600">{t.primary_mentor_name || '—'}</td>
                                            <td className="px-4 py-3 text-gray-600">{t.senior_mentor_name || '—'}</td>
                                            {!isMentor && <td className="px-4 py-3 text-gray-600">{t.initiating_mentor_name || t.requested_by_name || '—'}</td>}
                                            <td className="px-4 py-3 text-center">
                                                <Badge variant={t.type === 'WITHDRAWAL' ? 'destructive' : 'default'} className="text-xs">
                                                    {t.type}
                                                </Badge>
                                            </td>
                                            <td className={`px-4 py-3 text-right font-bold ${t.type === 'WITHDRAWAL' ? 'text-red-600' : 'text-green-700'}`}>
                                                ${(t.amount_usd || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                            </td>
                                            <td className="px-4 py-3 text-right font-medium">
                                               {/* DEPOSIT and BONUS both earn commission (positive); only WITHDRAWAL deducts it. */}
                                               {t.type === 'WITHDRAWAL' ?
                    <span className="text-red-500">-${((t.amount_usd || 0) * 0.04).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span> :
                    <span className="text-purple-700">+${((t.amount_usd || 0) * 0.04).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                    }
                                            </td>
                                            <td className="px-4 py-3 text-gray-600 text-xs">{t.payment_method || '—'}</td>
                                            <td className="px-4 py-3 text-gray-500 font-mono text-xs">{t.transaction_id || '—'}</td>
                                        </tr>
                )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Manual Adjustments Section */}
                    {filterType !== 'student' && adjustments.length > 0 && <div className="mt-6">
                            <h2 className="text-lg font-semibold text-gray-800 mb-3">Manual Commission Adjustments</h2>
                            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-gray-50 border-b border-gray-200">
                                                <th className="text-left px-4 py-3 font-semibold text-gray-600">Date</th>
                                                <th className="text-left px-4 py-3 font-semibold text-gray-600">Mentor</th>
                                                <th className="text-left px-4 py-3 font-semibold text-gray-600">Type</th>
                                                <th className="text-right px-4 py-3 font-semibold text-gray-600">Amount (USD)</th>
                                                <th className="text-left px-4 py-3 font-semibold text-gray-600">Reason</th>
                                                <th className="text-left px-4 py-3 font-semibold text-gray-600">Added By</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {adjustments.map((a, idx) =>
                  <tr key={a.id} className={`border-b border-gray-100 hover:bg-gray-50 ${idx % 2 !== 0 ? 'bg-gray-50/40' : ''}`}>
                                                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                                                        {a.created_date ? format(new Date(a.created_date), 'dd MMM yyyy') : '—'}
                                                    </td>
                                                    <td className="px-4 py-3 font-medium text-gray-900">{a.mentor_name || '—'}</td>
                                                    <td className="px-4 py-3">
                                                        <Badge variant={a.adjustment_type === 'addition' ? 'default' : 'destructive'} className="text-xs">
                                                            {a.adjustment_type === 'addition' ? 'Addition' : 'Deduction'}
                                                        </Badge>
                                                    </td>
                                                    <td className={`px-4 py-3 text-right font-bold ${a.adjustment_type === 'addition' ? 'text-green-700' : 'text-red-600'}`}>
                                                        {a.adjustment_type === 'addition' ? '+' : '-'}${(Math.abs(a.amount_usd) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                    </td>
                                                    <td className="px-4 py-3 text-gray-600 text-xs">{a.reason || '—'}</td>
                                                    <td className="px-4 py-3 text-gray-500 text-xs">Finance Admin</td>
                                                </tr>
                  )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
        }
                </>
      }
        </div>);

}