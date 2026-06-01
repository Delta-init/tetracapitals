import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter } from 'date-fns';
import { Calendar, RefreshCw } from 'lucide-react';

import StudentWiseReport from '../components/reports/StudentWiseReport';
import CommissionByMentorReport from '../components/reports/CommissionByMentorReport';
import { getEffectiveUser } from '../components/utils/ImpersonationContext';

const DATE_TABS = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Custom'];

const QUARTERS = [
    { label: 'Q1 (Jan–Mar)', value: 1 },
    { label: 'Q2 (Apr–Jun)', value: 2 },
    { label: 'Q3 (Jul–Sep)', value: 3 },
    { label: 'Q4 (Oct–Dec)', value: 4 },
];

const MENTOR_ROLES = ['junior_mentor', 'senior_mentor'];

const ADMIN_REPORT_TABS = [
    { key: 'student_wise', label: 'Student-Wise Transactions' },
    { key: 'commission_mentor', label: 'Commission by Mentor' },
];

const MENTOR_REPORT_TABS = [
    { key: 'student_wise', label: 'My Students Transactions' },
    { key: 'commission_mentor', label: 'My Commission Summary' },
];

function getDateRange(tab) {
    const now = new Date();
    switch (tab) {
        case 'Daily': return { start: startOfDay(now), end: endOfDay(now) };
        case 'Weekly': return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
        case 'Monthly': return { start: startOfMonth(now), end: endOfMonth(now) };
        default: return { start: startOfDay(now), end: endOfDay(now) };
    }
}

export default function Reports() {
    const [currentUser, setCurrentUser] = useState(null);
    const [activeTab, setActiveTab] = useState('Daily');
    const [activeReport, setActiveReport] = useState(null);
    const [customStart, setCustomStart] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [customEnd, setCustomEnd] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [mentorFilter, setMentorFilter] = useState('');
    const currentYear = new Date().getFullYear();
    const currentQ = Math.ceil((new Date().getMonth() + 1) / 3);
    const [selectedQuarter, setSelectedQuarter] = useState(currentQ);
    const [selectedYear, setSelectedYear] = useState(currentYear);

    useEffect(() => {
        base44.auth.me().then(u => {
            const user = getEffectiveUser(u);
            setCurrentUser(user);
            const isMentor = MENTOR_ROLES.includes(user.app_role);
            setActiveReport('student_wise');
        });
    }, []);

    const dateRange = useMemo(() => {
        if (activeTab === 'Custom') return { start: new Date(customStart), end: new Date(customEnd) };
        if (activeTab === 'Quarterly') {
            const qStartMonth = (selectedQuarter - 1) * 3;
            const start = new Date(selectedYear, qStartMonth, 1);
            const end = endOfMonth(new Date(selectedYear, qStartMonth + 2, 1));
            return { start, end };
        }
        return getDateRange(activeTab);
    }, [activeTab, customStart, customEnd, selectedQuarter, selectedYear]);

    const safeEnd = (dateRange.end instanceof Date && !isNaN(dateRange.end)) ? dateRange.end : new Date();
    const safeStart = (dateRange.start instanceof Date && !isNaN(dateRange.start)) ? dateRange.start : new Date();
    const startDateStr = format(safeStart, 'yyyy-MM-dd');
    const endDateStr = format(safeEnd, 'yyyy-MM-dd');
    const dateLabel = `${format(safeStart, 'dd MMM yyyy')} – ${format(safeEnd, 'dd MMM yyyy')}`;

    const isMentor = currentUser && MENTOR_ROLES.includes(currentUser.app_role);
    const reportTabs = isMentor ? MENTOR_REPORT_TABS : ADMIN_REPORT_TABS;

    const { data: allTransactions = [], isLoading, refetch } = useQuery({
        queryKey: ['funding-transactions-approved'],
        queryFn: () => base44.entities.FundingTransaction.filter({ status: 'APPROVED' }),
    });

    const { data: allUsers = [] } = useQuery({
        queryKey: ['all-users-reports'],
        queryFn: () => base44.entities.User.list(),
    });

    const filteredTransactions = useMemo(() => {
        const start = dateRange.start;
        const end = dateRange.end;
        let filtered = allTransactions.filter(t => {
            const txDate = new Date(t.requested_at || t.created_date);
            return txDate >= start && txDate <= end;
        });
        // Mentors only see their own students' transactions
        if (isMentor && currentUser) {
            filtered = filtered.filter(t =>
                t.initiating_mentor_id === currentUser.id
            );
        } else if (mentorFilter) {
            filtered = filtered.filter(r =>
                r.initiating_mentor_name === mentorFilter ||
                r.primary_mentor_name === mentorFilter ||
                r.senior_mentor_name === mentorFilter
            );
        }
        return filtered;
    }, [allTransactions, dateRange, mentorFilter, isMentor, currentUser]);

    if (!currentUser || activeReport === null) return (
        <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
    );

    return (
        <div className="p-6 max-w-full">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">{isMentor ? 'My Reports' : 'Reports'}</h1>
                    <p className="text-sm text-gray-500 mt-1">{dateLabel}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                    <RefreshCw className="h-4 w-4 mr-1" /> Refresh
                </Button>
            </div>

            {/* Date Tabs + Filters */}
            <div className="flex flex-wrap items-center gap-3 mb-5">
                <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                    {DATE_TABS.map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-4 py-2 text-sm font-medium transition-colors ${
                                activeTab === tab ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                            }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                {activeTab === 'Quarterly' && (
                    <div className="flex items-center gap-2">
                        <select
                            value={selectedQuarter}
                            onChange={e => setSelectedQuarter(Number(e.target.value))}
                            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                            {QUARTERS.map(q => (
                                <option key={q.value} value={q.value}>{q.label}</option>
                            ))}
                        </select>
                        <select
                            value={selectedYear}
                            onChange={e => setSelectedYear(Number(e.target.value))}
                            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                            {[currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map(y => (
                                <option key={y} value={y}>{y}</option>
                            ))}
                        </select>
                    </div>
                )}

                {activeTab === 'Custom' && (
                    <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-gray-400" />
                        <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-40 h-9 text-sm" />
                        <span className="text-gray-400 text-sm">to</span>
                        <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-40 h-9 text-sm" />
                    </div>
                )}

                {!isMentor && (
                <select
                    value={mentorFilter}
                    onChange={e => setMentorFilter(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                    <option value="">All Mentors</option>
                    {Array.from(new Set([
                        ...allTransactions.map(t => t.primary_mentor_name).filter(Boolean),
                        ...allTransactions.map(t => t.senior_mentor_name).filter(Boolean)
                    ])).sort().map(name => (
                        <option key={name} value={name}>{name}</option>
                    ))}
                </select>
                )}
            </div>

            {/* Report Sub-tabs */}
            <div className="flex gap-1 mb-5 border-b border-gray-200 overflow-x-auto">
                {reportTabs.map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveReport(tab.key)}
                        className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                            activeReport === tab.key
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-600 hover:text-gray-900'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Loading */}
            {isLoading && (
                <div className="flex items-center justify-center py-20">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                    <p className="ml-3 text-gray-500">Loading transaction data...</p>
                </div>
            )}

            {/* Report Content */}
            {!isLoading && (
                <>

                    {activeReport === 'student_wise' && <StudentWiseReport transactions={filteredTransactions} dateLabel={dateLabel} startDate={startDateStr} endDate={endDateStr} />}
                    {activeReport === 'commission_mentor' && <CommissionByMentorReport startDate={startDateStr} endDate={endDateStr} dateLabel={dateLabel} isMentor={isMentor} mentorId={isMentor ? currentUser?.id : null} />}
                </>
            )}
        </div>
    );
}