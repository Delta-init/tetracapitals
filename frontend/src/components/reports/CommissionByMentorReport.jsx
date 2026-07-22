import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';

export default function CommissionByMentorReport({ startDate, endDate, dateLabel, isMentor, mentorId }) {
    const navigate = useNavigate();
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchData = async () => {
        if (!startDate || !endDate) return;
        setLoading(true);
        setError(null);
        try {
            const res = await base44.functions.invoke('getMentorCommissions', { startDate, endDate });
            let data = res.data?.rows || [];
            // In impersonation mode, filter to only show this mentor's data
            if (isMentor && mentorId) {
                data = data.filter(r => r.mentor_id === mentorId);
            }
            setRows(data);
        } catch (e) {
            setError(e.message || 'Failed to load commission data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, [startDate, endDate]);

    const totals = rows.reduce((acc, r) => {
        acc.total_deposit += r.total_deposit || 0;
        acc.total_bonus += r.total_bonus || 0;
        acc.total_withdrawal += r.total_withdrawal || 0;
        acc.net_deposit += r.net_deposit || 0;
        acc.commissionable_net += r.commissionable_net || 0;
        acc.gross_commission += r.gross_commission || 0;
        acc.manual_adjustment += r.manual_adjustment || 0;
        acc.adjusted_gross += r.adjusted_gross || 0;
        acc.release_75 += r.release_75 || 0;
        acc.buffer_25 += r.buffer_25 || 0;
        return acc;
    }, { total_deposit: 0, total_bonus: 0, total_withdrawal: 0, net_deposit: 0, commissionable_net: 0, gross_commission: 0, manual_adjustment: 0, adjusted_gross: 0, release_75: 0, buffer_25: 0 });

    const handleExport = () => {
        const headers = ['Mentor', 'Total Deposit', 'Total Bonus', 'Total Withdrawal', 'Net Deposit', 'Commissionable Net (capped)', 'Gross Commission (4%)', 'Manual Adjustments', 'Adjusted Gross', 'Release (75%)', 'Buffer (25%)', 'Txns'];
        const csvRows = [headers.join(','), ...rows.map(r => [
            `"${r.mentor_name}"`,
            r.total_deposit.toFixed(2), (r.total_bonus || 0).toFixed(2), r.total_withdrawal.toFixed(2), r.net_deposit.toFixed(2),
            r.commissionable_net.toFixed(2), r.gross_commission.toFixed(2), r.manual_adjustment.toFixed(2),
            r.adjusted_gross.toFixed(2), r.release_75.toFixed(2), r.buffer_25.toFixed(2), r.transaction_count
        ].join(','))];
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = `commission_mentor_report_${format(new Date(), 'yyyy-MM-dd')}.csv`; a.click();
    };

    if (loading) return (
        <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            <p className="ml-3 text-gray-500">Calculating commissions...</p>
        </div>
    );

    if (error) return (
        <div className="text-center py-20 text-red-500">
            <p>{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={fetchData}><RefreshCw className="h-4 w-4 mr-1" /> Retry</Button>
        </div>
    );

    return (
        <div>
            <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-gray-500">{rows.length} mentors · {dateLabel} · $25K cap per student applies</p>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="h-4 w-4 mr-1" /> Refresh</Button>
                    <Button variant="outline" size="sm" onClick={handleExport} disabled={!rows.length}><Download className="h-4 w-4 mr-1" /> Export CSV</Button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                    <p className="text-xs text-green-600 font-medium uppercase">Commissionable Net</p>
                    <p className="text-xl font-bold text-green-700 mt-1">${totals.commissionable_net.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                    <p className="text-xs text-gray-400 mt-1">After $25K cap per student</p>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                    <p className="text-xs text-blue-600 font-medium uppercase">Gross Commission (4%)</p>
                    <p className="text-xl font-bold text-blue-700 mt-1">${totals.gross_commission.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                    <p className="text-xs text-emerald-600 font-medium uppercase">Total Release (75%)</p>
                    <p className="text-xl font-bold text-emerald-700 mt-1">${totals.release_75.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                    <p className="text-xs text-amber-600 font-medium uppercase">Total Buffer (25%)</p>
                    <p className="text-xl font-bold text-amber-700 mt-1">${totals.buffer_25.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-gray-50 border-b border-gray-200">
                                <th className="text-left px-4 py-3 font-semibold text-gray-600">Mentor</th>
                                <th className="text-center px-4 py-3 font-semibold text-gray-600">Txns</th>
                                <th className="text-right px-4 py-3 font-semibold text-gray-600">Total Deposit</th>
                                <th className="text-right px-4 py-3 font-semibold text-gray-600">Total Bonus</th>
                                <th className="text-right px-4 py-3 font-semibold text-gray-600">Total Withdrawal</th>
                                <th className="text-right px-4 py-3 font-semibold text-gray-600">Net Deposit</th>
                                <th className="text-right px-4 py-3 font-semibold text-gray-600">Commissionable Net<br/><span className="text-xs font-normal text-gray-400">($25K cap/student)</span></th>
                                <th className="text-right px-4 py-3 font-semibold text-gray-600">Gross Commission<br/><span className="text-xs font-normal text-gray-400">(by rate)</span></th>
                                <th className="text-right px-4 py-3 font-semibold text-gray-600">Manual Adj.</th>
                                <th className="text-right px-4 py-3 font-semibold text-gray-600">Adjusted Gross</th>
                                <th className="text-right px-4 py-3 font-semibold text-gray-600">Release (75%)</th>
                                <th className="text-right px-4 py-3 font-semibold text-gray-600">Buffer (25%)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 ? (
                                <tr><td colSpan={12} className="text-center py-12 text-gray-400">No commission data found for this period.</td></tr>
                            ) : rows.map((row, idx) => (
                                <tr key={row.mentor_id} onClick={() => navigate(`/ReportTransactionDetails?filterType=mentor&filterId=${row.mentor_id}&filterName=${encodeURIComponent(row.mentor_name)}&startDate=${startDate}&endDate=${endDate}&dateLabel=${encodeURIComponent(dateLabel)}`)} className={`border-b border-gray-100 hover:bg-blue-50 cursor-pointer ${idx % 2 !== 0 ? 'bg-gray-50/40' : ''}`}>
                                    <td className="px-4 py-3 font-medium text-gray-900">{row.mentor_name}</td>
                                    <td className="px-4 py-3 text-center"><Badge variant="outline">{row.transaction_count}</Badge></td>
                                    <td className="px-4 py-3 text-right font-medium text-green-700">${row.total_deposit?.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                    <td className="px-4 py-3 text-right font-medium text-purple-700">${(row.total_bonus || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                    <td className="px-4 py-3 text-right font-medium text-red-600">${row.total_withdrawal?.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                    <td className={`px-4 py-3 text-right font-medium ${row.net_deposit >= 0 ? 'text-gray-700' : 'text-orange-600'}`}>${row.net_deposit?.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                    <td className="px-4 py-3 text-right font-medium text-green-700">${row.commissionable_net?.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                    <td className="px-4 py-3 text-right font-medium text-blue-700">${row.gross_commission?.toLocaleString('en-US', { minimumFractionDigits: 2 })}<br/><span className="text-xs text-gray-400">{row.commission_rate}%</span></td>
                                    <td className={`px-4 py-3 text-right font-medium ${(row.manual_adjustment || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {row.adjustment_count > 0 ? `${row.manual_adjustment >= 0 ? '+' : ''}$${row.manual_adjustment?.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}
                                    </td>
                                    <td className="px-4 py-3 text-right font-bold text-indigo-700">${row.adjusted_gross?.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                    <td className="px-4 py-3 text-right font-bold text-emerald-700">${row.release_75?.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                    <td className="px-4 py-3 text-right font-bold text-amber-600">${row.buffer_25?.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="bg-gray-100 border-t-2 border-gray-300 font-bold">
                                <td colSpan={2} className="px-4 py-3 text-gray-700">Total ({rows.length} mentors)</td>
                                <td className="px-4 py-3 text-right text-green-700">${totals.total_deposit.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                <td className="px-4 py-3 text-right text-purple-700">${totals.total_bonus.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                <td className="px-4 py-3 text-right text-red-600">${totals.total_withdrawal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                <td className="px-4 py-3 text-right text-gray-700">${totals.net_deposit.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                <td className="px-4 py-3 text-right text-green-700">${totals.commissionable_net.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                <td className="px-4 py-3 text-right text-blue-700">${totals.gross_commission.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                <td className="px-4 py-3 text-right">${totals.manual_adjustment.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                <td className="px-4 py-3 text-right text-indigo-700">${totals.adjusted_gross.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                <td className="px-4 py-3 text-right text-emerald-700">${totals.release_75.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                <td className="px-4 py-3 text-right text-amber-600">${totals.buffer_25.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </div>
    );
}