import { localFromUsd } from '@/components/utils/displayCurrency';

/* A dollar amount with its AED underneath, at the portal's fixed 3.67 (the user, 2026-10-12 — every report in AED too).
   In the viewer's own currency since 2026-11-03 ("commission in AED same as the funding request page"): INR for a
   Bangalore team, as Funding Requests shows it (components/utils/displayCurrency.js). Only what is shown — commission
   is worked out and kept in USD. */
export const AED_PER_USD = 3.67;
const fmt = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Usd({ v, className = '' }) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return <span className={className}>—</span>;
  return (
    <span className={`inline-flex flex-col leading-tight ${className}`}>
      <span>{Number(v) < 0 ? '-' : ''}${fmt(Math.abs(Number(v)))}</span>
      <span className="text-[11px] font-normal text-slate-400">{localFromUsd(v, { decimals: true })}</span>
    </span>
  );
}
