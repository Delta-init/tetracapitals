import ReportShell, { aed, num } from '@/components/reports/ReportShell';

/* Commission report (the user, 2026-11-09: "everyone's commission and the breakdown"): every commission credit in the
   period, by the person it is paid to — own (their position's level) vs pool share, bonus vs deposit — and every number
   opens the credits behind it (backend functions/reports.ts getCommissionReport). A credit counts in the month its
   payment was raised, as "Your commission this month" on the Dashboard. */

const amt = (n, u) => `${aed(u)} · ${num(n)}`;

export default function CommissionReport() {
  return (
    <ReportShell
      title="Commission report" fn="getCommissionReport" details="commission"
      description="Everyone's commission in the period — their own level and their pool shares, from bonuses and deposits. Open any number for the credits behind it."
      sortNote="Highest commission first"
      cards={d => [
        { label: 'Total commission', open: 'count', usd: d.total.usd, sub: `${num(d.total.count)} credits · ${num(d.people?.length)} people` },
        { label: 'Own commission', open: 'own', usd: d.total.own_usd, sub: `${num(d.total.own)} credits at their position's level` },
        { label: 'Pool shares', open: 'pool', usd: d.total.pool_usd, sub: `${num(d.total.pool)} credits from Senior / Junior pools` },
        { label: 'From bonuses', open: 'bonus', usd: d.total.bonus_usd, sub: `${num(d.total.bonus)} credits` },
        { label: 'From deposits', open: 'deposit', usd: d.total.deposit_usd, sub: `${num(d.total.deposit)} credits` },
      ]}
      columns={[
        { key: 'usd', label: 'Total commission (AED)', type: 'money', open: 'count' },
        { label: 'Own', open: 'own', get: r => r.own_usd, fmt: (v, r) => (r.own ? amt(r.own, r.own_usd) : '—') },
        { label: 'Pool share', open: 'pool', get: r => r.pool_usd, fmt: (v, r) => (r.pool ? amt(r.pool, r.pool_usd) : '—') },
        { label: 'Bonus', open: 'bonus', get: r => r.bonus_usd, fmt: (v, r) => (r.bonus ? amt(r.bonus, r.bonus_usd) : '—') },
        { label: 'Deposit', open: 'deposit', get: r => r.deposit_usd, fmt: (v, r) => (r.deposit ? amt(r.deposit, r.deposit_usd) : '—') },
        { key: 'count', label: 'Credits', type: 'number', open: 'count' },
        { key: 'students', label: 'Students', type: 'number' },
      ]}
    />
  );
}
