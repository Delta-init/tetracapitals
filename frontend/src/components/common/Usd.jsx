/* A dollar amount with its AED underneath, at the portal's fixed 3.67 (the user, 2026-10-12 — every report in AED too). */
export const AED_PER_USD = 3.67;
const fmt = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Usd({ v, className = '' }) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return <span className={className}>—</span>;
  return (
    <span className={`inline-flex flex-col leading-tight ${className}`}>
      <span>${fmt(v)}</span>
      <span className="text-[11px] font-normal text-slate-400">AED {fmt(Number(v) * AED_PER_USD)}</span>
    </span>
  );
}
