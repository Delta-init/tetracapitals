import ReportShell, { aed, num } from '@/components/reports/ReportShell';

const aedOnly = (n) => `AED ${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* Bonus report (the user, 2026-10-11): bonuses by where they stand — needs a connected call + MT5 (promised at a sales
   close, not sent yet), with finance, waiting for a broker admin, approved, rejected (backend functions/reports.ts
   getBonusReport). */
// Fully in AED, as Funding Requests (the user, 2026-10-13): the AED the student paid (none for a sales close, whose money
// comes through finance), and the MT5 bonus in AED at 3.67.
const bonusPaid = (u, a) => `${aedOnly(a)} paid · ${aed(u)} bonus`;
const both = (n, u, a) => `${num(n)} · ${bonusPaid(u, a)}`;

export default function BonusReport() {
  return (
    <ReportShell
      title="Bonus report" fn="getBonusReport"
      description="Bonuses raised in the period, by where they stand — and those promised at a sales close still waiting for a connected call + MT5."
      cards={d => [
        // What the students paid for the approved bonuses — AED only, the first card (the user, 2026-10-12).
        { label: 'Collected (approved)', tone: 'approved', value: aedOnly(d.total.approved_collected_aed), sub: `paid for ${num(d.total.approved)} approved bonuses` },
        { label: 'Bonuses', value: aedOnly(d.total.aed), sub: `paid · ${aed(d.total.usd)} MT5 bonus · ${num(d.total.count)} in all` },
        { label: 'Approved', tone: 'approved', value: aedOnly(d.total.approved_aed), sub: `paid · ${aed(d.total.approved_usd)} MT5 bonus · ${num(d.total.approved)} bonuses` },
        { label: 'Still pending', tone: 'pending', value: aedOnly((d.total.needs_call_aed || 0) + (d.total.with_finance_aed || 0) + (d.total.waiting_broker_aed || 0)),
          sub: `paid · ${aed((d.total.needs_call_usd || 0) + (d.total.with_finance_usd || 0) + (d.total.waiting_broker_usd || 0))} MT5 bonus · ${num(d.total.needs_call)} need call + MT5 · ${num(d.total.with_finance)} with finance · ${num(d.total.waiting_broker)} broker admin` },
        { label: 'Rejected', tone: 'rejected', value: aedOnly(d.total.rejected_aed), sub: `paid · ${aed(d.total.rejected_usd)} MT5 bonus · ${num(d.total.rejected)} bonuses` },
      ]}
      columns={[
        { label: 'All (paid · MT5 bonus, AED)', get: r => r.aed, fmt: (v, r) => bonusPaid(r.usd, r.aed) },
        { key: 'count', label: 'Bonuses', type: 'number' },
        { label: 'Needs call + MT5', tone: 'pending', get: r => r.needs_call, fmt: (v, r) => both(r.needs_call, r.needs_call_usd, r.needs_call_aed) },
        { label: 'With finance', tone: 'pending', get: r => r.with_finance, fmt: (v, r) => both(r.with_finance, r.with_finance_usd, r.with_finance_aed) },
        { label: 'Broker admin', tone: 'pending', get: r => r.waiting_broker, fmt: (v, r) => both(r.waiting_broker, r.waiting_broker_usd, r.waiting_broker_aed) },
        { label: 'Approved', tone: 'approved', get: r => r.approved, fmt: (v, r) => both(r.approved, r.approved_usd, r.approved_aed) },
        { label: 'Rejected', tone: 'rejected', get: r => r.rejected, fmt: (v, r) => both(r.rejected, r.rejected_usd, r.rejected_aed) },
      ]}
    />
  );
}
