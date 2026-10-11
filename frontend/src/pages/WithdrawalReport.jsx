import ReportShell, { usd, num } from '@/components/reports/ReportShell';

/* Withdrawal report (the user, 2026-10-11): approved withdrawals, when approved — per person (whoever raised the request),
   team and month (backend functions/reports.ts getMoneyReport). */
export default function WithdrawalReport() {
  return (
    <ReportShell
      title="Withdrawal report" fn="getMoneyReport" body={{ kind: 'withdrawal' }}
      description="Approved withdrawals, when they were approved — for whoever raised each request, their team and its location."
      cards={d => [
        { label: 'Withdrawals approved', value: usd(d.total.usd) },
        { label: 'Requests', value: num(d.total.count) },
        { label: 'Average withdrawal', value: usd(d.total.count ? d.total.usd / d.total.count : 0) },
        { label: 'People withdrawing for', value: num(d.people.length), sub: 'with at least one approved withdrawal' },
      ]}
      columns={[
        { key: 'usd', label: 'Withdrawals (USD)', type: 'money' },
        { key: 'count', label: 'Requests', type: 'number' },
        { key: 'students', label: 'Students', type: 'number' },
        { label: 'Average', type: 'money', get: r => (r.count ? r.usd / r.count : 0) },
      ]}
    />
  );
}
