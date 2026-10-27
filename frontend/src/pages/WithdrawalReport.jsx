import ReportShell, { num } from '@/components/reports/ReportShell';

/* Withdrawal report (the user, 2026-10-11): approved withdrawals, when approved — per person (whoever raised the request),
   team and month (backend functions/reports.ts getMoneyReport). */
export default function WithdrawalReport() {
  return (
    <ReportShell
      title="Withdrawal report" fn="getMoneyReport" body={{ kind: 'withdrawal' }}
      description="Approved withdrawals, when they were approved — for whoever raised each request, their team and its location."
      cards={d => [
        { label: 'Withdrawals approved', open: 'count', usd: d.total.usd },
        { label: 'Requests', open: 'count', value: num(d.total.count) },
        { label: 'Average withdrawal', open: 'count', usd: d.total.count ? d.total.usd / d.total.count : 0 },
        { label: 'People withdrawing for', open: 'count', value: num(d.people.length), sub: 'with at least one approved withdrawal' },
      ]}
      columns={[
        { key: 'usd', label: 'Withdrawals (AED)', open: 'count', type: 'money' },
        { key: 'count', label: 'Requests', open: 'count', type: 'number' },
        { key: 'students', label: 'Students', open: 'count', type: 'number' },
        { label: 'Average', open: 'count', type: 'money', get: r => (r.count ? r.usd / r.count : 0) },
      ]}
    />
  );
}
