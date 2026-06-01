import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom'; // fixed
import { Badge } from '@/components/ui/badge';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';

export default function PrimaryMentorReport({ transactions, dateLabel, startDate, endDate }) {
    const navigate = useNavigate();
    const { rows, totals } = useMemo(() => {
        const mentorMap = {};
        for (const tx of transactions) {
            // Attribute transaction to the mentor who initiated it (co-mentor or primary)
            const key = tx.initiating_mentor_id || tx.primary_mentor_id || 'unassigned';
            const mentorName = tx.initiating_mentor_id && tx.initiating_mentor_id !== tx.primary_mentor_id
                ? tx.initiating_mentor_name
                : (tx.primary_mentor_name || 'Unassigned');
            if (!mentorMap[key]) {
                mentorMap[key] = {
                    mentor_id: key,
                    mentor_name: mentorName || 'Unassigned',
                    senior_mentor_name: tx.senior_mentor_name || '—',
                    total_deposit: 0,
                    total_withdrawal: 0,
                    net: 0,
                    student_count: new Set(),
                    transaction_count: 0,
                };
            }
            if (tx.type === 'DEPOSIT') mentorMap[key].total_deposit += tx.amount_usd || 0;
            else if (tx.type === 'WITHDRAWAL') mentorMap[key].total_withdrawal += tx.amount_usd || 0;
            mentorMap[key].student_count.add(tx.student_id);
            mentorMap[key].transaction_count += 1;
        }

        const rows = Object.values(mentorMap).map(r => ({
            ...r,
            net: r.total_deposit - r.total_withdrawal,
            student_count: r.student_count.size,
        })).sort((a, b) => b.total_deposit - a.total_deposit);

        const totals = rows.reduce((acc, r) => {
            acc.total_deposit += r.total_deposit;
            acc.total_withdrawal += r.total_withdrawal;
            acc.net += r.net;
            return acc;
        }, { total_deposit: 0, total_withdrawal: 0, net: 0 });

        return { rows, totals };
    }, [transactions]);

    const handleExport = () => {
        const headers = ['Primary Mentor', 'Senior Mentor', 'Students', 'Txns', 'Deposits (USD)', 'Withdrawals (USD)', 'Net (USD)'];
        const csvRows = [headers.join(','), ...rows.map(r => [
            `"${r.mentor_name}"`, `"${r.senior_mentor_name}"`, r.student_count, r.transaction_count,
            r.total_deposit.toFixed(2), r.total_withdrawal.toFixed(2), r.net.toFixed(2)
        ].join(','))];
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = `primary_mentor_report_${format(new Date(), 'yyyy-MM-dd')}.csv`; a.click();
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-gray-500">{rows.length} mentors · {dateLabel}</p>
                <Button variant="outline" size="sm" onClick={handleExport} disabled={!rows.length}>
                    <Download className="h-4 w-4 mr-1" /> Export CSV
                </Button>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                    <p className="text-xs text-green-600 font-medium uppercase">Total Deposits</p>
                    <p className="text-2xl font-bold text-green-700 mt-1">${totals.total_deposit.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                    <p className="text-xs text-red-600 font-medium uppercase">Total Withdrawals</p>
                    <p className="text-2xl font-bold text-red-700 mt-1">${totals.total_withdrawal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                </div>
                <div className={`border rounded-xl p-4 ${totals.net >= 0 ? 'bg-blue-50 border-blue-200' : 'bg-orange-50 border-orange-200'}`}>
                    <p className={`text-xs font-medium uppercase ${totals.net >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>Net</p>
                    <p className={`text-2xl font-bold mt-1 ${totals.net >= 0 ? 'text-blue-700' : 'text-orange-700'}`}>${totals.net.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-gray-50 border-b border-gray-200">
                                <th className="text-left px-4 py-3 font-semibold text-gray-600">Primary Mentor</th>
                                <th className="text-left px-4 py-3 font-semibold text-gray-600">Senior Mentor</th>
                                <th className="text-center px-4 py-3 font-semibold text-gray-600">Students</th>
                                <th className="text-center px-4 py-3 font-semibold text-gray-600">Txns</th>
                                <th className="text-right px-4 py-3 font-semibold text-gray-600">Deposit (USD)</th>
                                <th className="text-right px-4 py-3 font-semibold text-gray-600">Withdrawal (USD)</th>
                                <th className="text-right px-4 py-3 font-semibold text-gray-600">Net (USD)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 ? (
                                <tr><td colSpan={7} className="text-center py-12 text-gray-400">No data found for this period.</td></tr>
                            ) : rows.map((row, idx) => (
                                <tr key={row.mentor_id} onClick={() => navigate(`/ReportTransactionDetails?filterType=mentor&filterId=${row.mentor_id}&filterName=${encodeURIComponent(row.mentor_name)}&startDate=${startDate}&endDate=${endDate}&dateLabel=${encodeURIComponent(dateLabel)}&reportType=primary`)} className={`border-b border-gray-100 hover:bg-blue-50 cursor-pointer ${idx % 2 !== 0 ? 'bg-gray-50/40' : ''}`}>
                                    <td className="px-4 py-3 font-medium text-gray-900">{row.mentor_name}</td>
                                    <td className="px-4 py-3 text-gray-600">{row.senior_mentor_name}</td>
                                    <td className="px-4 py-3 text-center"><Badge variant="secondary">{row.student_count}</Badge></td>
                                    <td className="px-4 py-3 text-center"><Badge variant="outline">{row.transaction_count}</Badge></td>
                                    <td className="px-4 py-3 text-right font-medium text-green-700">${row.total_deposit.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                    <td className="px-4 py-3 text-right font-medium text-red-600">{row.total_withdrawal > 0 ? `$${row.total_withdrawal.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}</td>
                                    <td className={`px-4 py-3 text-right font-bold ${row.net >= 0 ? 'text-blue-700' : 'text-orange-600'}`}>${row.net.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="bg-gray-100 border-t-2 border-gray-300 font-bold">
                                <td colSpan={4} className="px-4 py-3 text-gray-700">Total ({rows.length} mentors)</td>
                                <td className="px-4 py-3 text-right text-green-700">${totals.total_deposit.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                <td className="px-4 py-3 text-right text-red-600">${totals.total_withdrawal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                <td className={`px-4 py-3 text-right ${totals.net >= 0 ? 'text-blue-700' : 'text-orange-600'}`}>${totals.net.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </div>
    );
}