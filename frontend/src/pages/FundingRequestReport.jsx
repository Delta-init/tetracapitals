import ReportShell, { usd, num } from '@/components/reports/ReportShell';

const aedOnly = (n) => `AED ${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// As Funding Requests shows it (2026-10-13): a bonus counts its MT5 bonus in USD; the AED is what was paid.
const usdPaid = (u, a) => `${usd(u)}${Number(a) > 0 ? ` · ${aedOnly(a)}` : ''}`;

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
        { label: 'Pending', tone: 'pending', value: num(d.total.pending), sub: `${usdPaid(['DEPOSIT', 'WITHDRAWAL', 'BONUS'].reduce((s, t) => s + (d.grid?.[t]?.PENDING?.usd || 0), 0), ['DEPOSIT', 'WITHDRAWAL', 'BONUS'].reduce((s, t) => s + (d.grid?.[t]?.PENDING?.aed || 0), 0))} waiting` },
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
        { label: 'Amount (USD · AED paid)', get: r => r.usd, fmt: (v, r) => usdPaid(r.usd, r.aed) },
        { key: 'avg_decide_hours', label: 'Avg. to decide', fmt: hours },
      ]}
    />
  );
}
