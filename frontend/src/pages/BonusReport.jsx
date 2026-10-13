import ReportShell, { usd, num } from '@/components/reports/ReportShell';

const aedOnly = (n) => `AED ${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* Bonus report (the user, 2026-10-11): bonuses by where they stand — needs a connected call + MT5 (promised at a sales
   close, not sent yet), with finance, waiting for a broker admin, approved, rejected (backend functions/reports.ts
   getBonusReport). */
// As Funding Requests shows a bonus (the user, 2026-10-13): the MT5 bonus in USD, and the AED the student paid (none for
// a sales close, whose money comes through finance).
const bonusPaid = (u, a) => `${usd(u)} bonus${Number(a) > 0 ? ` · ${aedOnly(a)} paid` : ''}`;
const both = (n, u, a) => `${num(n)} · ${bonusPaid(u, a)}`;

export default function BonusReport() {
  return (
    <ReportShell
      title="Bonus report" fn="getBonusReport"
      description="Bonuses raised in the period, by where they stand — and those promised at a sales close still waiting for a connected call + MT5."
      cards={d => [
        // What the students paid for the approved bonuses — AED only, the first card (the user, 2026-10-12).
        { label: 'Collected (approved)', tone: 'approved', value: aedOnly(d.total.approved_collected_aed), sub: `paid for ${num(d.total.approved)} approved bonuses` },
        { label: 'Bonuses', value: usd(d.total.usd), sub: `MT5 bonus · ${aedOnly(d.total.aed)} paid · ${num(d.total.count)} in all` },
        { label: 'Approved', tone: 'approved', value: usd(d.total.approved_usd), sub: `MT5 bonus · ${aedOnly(d.total.approved_aed)} paid · ${num(d.total.approved)} bonuses` },
        { label: 'Still pending', tone: 'pending', value: usd((d.total.needs_call_usd || 0) + (d.total.with_finance_usd || 0) + (d.total.waiting_broker_usd || 0)),
          sub: `MT5 bonus · ${aedOnly((d.total.needs_call_aed || 0) + (d.total.with_finance_aed || 0) + (d.total.waiting_broker_aed || 0))} paid · ${num(d.total.needs_call)} need call + MT5 · ${num(d.total.with_finance)} with finance · ${num(d.total.waiting_broker)} broker admin` },
        { label: 'Rejected', tone: 'rejected', value: usd(d.total.rejected_usd), sub: `MT5 bonus · ${aedOnly(d.total.rejected_aed)} paid · ${num(d.total.rejected)} bonuses` },
      ]}
      columns={[
        { label: 'All (MT5 bonus · paid)', get: r => r.usd, fmt: (v, r) => bonusPaid(r.usd, r.aed) },
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
