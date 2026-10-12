import ReportShell, { usd, usdAed, num } from '@/components/reports/ReportShell';

const aedOnly = (n) => `AED ${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* Bonus report (the user, 2026-10-11): bonuses by where they stand — needs a connected call + MT5 (promised at a sales
   close, not sent yet), with finance, waiting for a broker admin, approved, rejected (backend functions/reports.ts
   getBonusReport). */
const both = (n, u) => `${num(n)} · ${usdAed(u)}`;

export default function BonusReport() {
  return (
    <ReportShell
      title="Bonus report" fn="getBonusReport"
      description="Bonuses raised in the period, by where they stand — and those promised at a sales close still waiting for a connected call + MT5."
      cards={d => [
        // What the students paid for the approved bonuses — AED only, the first card (the user, 2026-10-12).
        { label: 'Collected (approved)', tone: 'approved', value: aedOnly(d.total.approved_collected_aed), sub: `paid for ${num(d.total.approved)} approved bonuses` },
        { label: 'Bonuses', usd: d.total.usd, sub: `${num(d.total.count)} in all` },
        { label: 'Approved', tone: 'approved', usd: d.total.approved_usd, sub: `${num(d.total.approved)} bonuses` },
        { label: 'Still pending', tone: 'pending', usd: (d.total.needs_call_usd || 0) + (d.total.with_finance_usd || 0) + (d.total.waiting_broker_usd || 0),
          sub: `${num(d.total.needs_call)} need call + MT5 · ${num(d.total.with_finance)} with finance · ${num(d.total.waiting_broker)} broker admin` },
        { label: 'Rejected', tone: 'rejected', usd: d.total.rejected_usd, sub: `${num(d.total.rejected)} bonuses` },
      ]}
      columns={[
        { key: 'usd', label: 'All (USD)', type: 'money' },
        { key: 'count', label: 'Bonuses', type: 'number' },
        { label: 'Needs call + MT5', tone: 'pending', get: r => r.needs_call, fmt: (v, r) => both(r.needs_call, r.needs_call_usd) },
        { label: 'With finance', tone: 'pending', get: r => r.with_finance, fmt: (v, r) => both(r.with_finance, r.with_finance_usd) },
        { label: 'Broker admin', tone: 'pending', get: r => r.waiting_broker, fmt: (v, r) => both(r.waiting_broker, r.waiting_broker_usd) },
        { label: 'Approved', tone: 'approved', get: r => r.approved, fmt: (v, r) => `${num(r.approved)} · collected ${aedOnly(r.approved_collected_aed)} · bonus ${usd(r.approved_usd)}` },
        { label: 'Rejected', tone: 'rejected', get: r => r.rejected, fmt: (v, r) => both(r.rejected, r.rejected_usd) },
      ]}
    />
  );
}
