import ReportShell, { usd, usdAed, num } from '@/components/reports/ReportShell';

/* Funding request report (the user, 2026-10-11): every deposit, withdrawal and bonus request raised in the period,
   where it stands, and how long a decision took (backend functions/reports.ts getFundingRequestReport). */
const hours = (h) => (h == null ? '—' : h < 48 ? `${Math.round(h * 10) / 10} h` : `${Math.round((h / 24) * 10) / 10} days`);

export default function FundingRequestReport() {
  return (
    <ReportShell
      title="Funding request report" fn="getFundingRequestReport"
      description="Every deposit, withdrawal and bonus request raised in the period — where it stands now, and how long a decision took."
      cards={d => [
        { label: 'Requests raised', value: num(d.total.count), sub: `${num(d.total.deposit)} deposits · ${num(d.total.withdrawal)} withdrawals · ${num(d.total.bonus)} bonuses` },
        { label: 'Pending', tone: 'pending', value: num(d.total.pending), sub: `${usdAed(['DEPOSIT', 'WITHDRAWAL', 'BONUS'].reduce((s, t) => s + (d.grid?.[t]?.PENDING?.usd || 0), 0))} waiting` },
        { label: 'Approved', tone: 'approved', value: num(d.total.approved) },
        { label: 'Rejected', tone: 'rejected', value: num(d.total.rejected) },
        { label: 'Average time to decide', value: hours(d.total.avg_decide_hours), sub: `over ${num(d.total.decided)} decided` },
      ]}
      columns={[
        { key: 'count', label: 'Requests', type: 'number' },
        { key: 'deposit', label: 'Deposits', type: 'number' },
        { key: 'withdrawal', label: 'Withdrawals', type: 'number' },
        { key: 'bonus', label: 'Bonuses', type: 'number' },
        { key: 'pending', label: 'Pending', type: 'number', tone: 'pending' },
        { key: 'approved', label: 'Approved', type: 'number', tone: 'approved' },
        { key: 'rejected', label: 'Rejected', type: 'number', tone: 'rejected' },
        { key: 'usd', label: 'Amount (USD)', type: 'money' },
        { key: 'avg_decide_hours', label: 'Avg. to decide', fmt: hours },
      ]}
    />
  );
}
