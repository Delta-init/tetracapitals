import ReportShell, { num } from '@/components/reports/ReportShell';

/* Deposit report (the user, 2026-10-11): approved deposits, when approved — per person (whoever raised the request),
   team and month (backend functions/reports.ts getMoneyReport). */
export default function DepositReport() {
  return (
    <ReportShell
      title="Deposit report" fn="getMoneyReport" body={{ kind: 'deposit' }}
      description="Approved deposits, when they were approved — for whoever raised each request, their team and its location."
      cards={d => [
        { label: 'Deposits approved', open: 'count', usd: d.total.usd },
        { label: 'Requests', open: 'count', value: num(d.total.count) },
        { label: 'Average deposit', open: 'count', usd: d.total.count ? d.total.usd / d.total.count : 0 },
        { label: 'People depositing for', open: 'count', value: num(d.people.length), sub: 'with at least one approved deposit' },
      ]}
      columns={[
        { key: 'usd', label: 'Deposits (AED)', open: 'count', type: 'money' },
        { key: 'count', label: 'Requests', open: 'count', type: 'number' },
        { key: 'students', label: 'Students', open: 'count', type: 'number' },
        { label: 'Average', open: 'count', type: 'money', get: r => (r.count ? r.usd / r.count : 0) },
      ]}
    />
  );
}
