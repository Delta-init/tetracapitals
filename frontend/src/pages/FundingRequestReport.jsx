import { localFromAed } from '@/components/utils/displayCurrency';
import ReportShell, { num } from '@/components/reports/ReportShell';

const aedOnly = (n) => localFromAed(n, { decimals: true }); // INR on a Bangalore team (2026-10-14)
// Fully in AED, as Funding Requests (the user, 2026-10-13): a deposit or withdrawal in AED, a course payment what the
// student paid (a sales-close bonus has none — its money comes through finance).

/* Funding request report (the user, 2026-10-11): every deposit, withdrawal and bonus request raised in the period,
   where it stands, and how long a decision took (backend functions/reports.ts getFundingRequestReport). */
const hours = (h) => (h == null ? '—' : h < 48 ? `${Math.round(h * 10) / 10} h` : `${Math.round((h / 24) * 10) / 10} days`);

export default function FundingRequestReport() {
  return (
    <ReportShell
      title="Funding request report" fn="getFundingRequestReport"
      description="Every deposit, withdrawal and bonus request raised in the period — where it stands now, and how long a decision took."
      cards={d => [
        { label: 'Requests raised', open: 'count', value: num(d.total.count), sub: `${num(d.total.deposit)} deposits · ${num(d.total.withdrawal)} withdrawals · ${num(d.total.bonus)} bonuses` },
        { label: 'Pending', open: 'pending', tone: 'pending', value: num(d.total.pending), sub: `${aedOnly(['DEPOSIT', 'WITHDRAWAL', 'BONUS'].reduce((s, t) => s + (d.grid?.[t]?.PENDING?.aed || 0), 0))} waiting` },
        { label: 'Approved', open: 'approved', tone: 'approved', value: num(d.total.approved) },
        { label: 'Rejected', open: 'rejected', tone: 'rejected', value: num(d.total.rejected) },
        { label: 'Average time to decide', open: 'decided', value: hours(d.total.avg_decide_hours), sub: `over ${num(d.total.decided)} decided` },
      ]}
      columns={[
        { key: 'count', label: 'Requests', type: 'number', open: 'count' },
        { key: 'deposit', label: 'Deposits', type: 'number', open: 'deposit' },
        { key: 'withdrawal', label: 'Withdrawals', type: 'number', open: 'withdrawal' },
        { key: 'bonus', label: 'Bonuses', type: 'number', open: 'bonus' },
        { key: 'pending', label: 'Pending', type: 'number', tone: 'pending', open: 'pending' },
        { key: 'approved', label: 'Approved', type: 'number', tone: 'approved', open: 'approved' },
        { key: 'rejected', label: 'Rejected', type: 'number', tone: 'rejected', open: 'rejected' },
        { label: 'Amount (AED)', open: 'count', get: r => r.aed, fmt: (v) => aedOnly(v) },
        { key: 'avg_decide_hours', label: 'Avg. to decide', fmt: hours, open: 'decided' },
      ]}
    />
  );
}
