import ReportShell, { aed, num } from '@/components/reports/ReportShell';

/* Commission report (the user, 2026-11-09: "everyone's commission and the breakdown"): every commission credit in the
   period, by the person it is paid to — own (their position's level) vs pool share, bonus vs deposit — and every number
   opens the credits behind it (backend functions/reports.ts getCommissionReport). A credit counts in the month its
   payment was raised, as "Your commission this month" on the Dashboard. */

const amt = (n, u) => `${aed(u)} · ${num(n)}`;

/* What Delta finance has done to someone's commission (the user, 2026-11-13; backend finance/commissionStops.ts) — shown
   so they know why their figure differs, changed only in Delta finance: counting stopped (nothing more is credited to
   them until finance resumes it), and amounts finance added or deducted on a bonus month or deposit quarter. Each is
   its own line, in its own currency — never added into the commission figures, which stay the credits. */
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' }) : '—');
/** "AED 500.00" from minor units. */
const minor = (a) => `${a.currency} ${((Number(a.amount_minor) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (a) => `${a.type === 'deduction' ? '−' : '+'} ${minor(a)}`;
/** "Bonus · Nov 2026", "Deposit · Q4 2026". */
const periodOf = (a) => {
  if (a.kind === 'deposit') return `Deposit · ${String(a.period).slice(5)} ${String(a.period).slice(0, 4)}`;
  const [y, m] = String(a.period).split('-').map(Number);
  return `Bonus · ${new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
};

function FinanceNotes({ d }) {
  const stopped = d.stopped || [], adjustments = d.adjustments || [];
  if (!stopped.length && !adjustments.length) return null;
  // Someone looking at their own needs no name on each line.
  const named = d.scope !== 'own';
  return (
    <div className="space-y-3">
      {stopped.map(s => (
        <div key={`${s.recipient_id}|${s.at}`} className={`rounded-xl border px-4 py-3 text-sm ${s.resumed_at ? 'border-slate-200 bg-slate-50 text-slate-700' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
          <p className="font-medium">{named && `${s.name}: `}Commission counting stopped on {day(s.at)} — {s.reason}</p>
          <p className="mt-0.5 text-xs">
            {s.resumed_at ? `Counted again from ${day(s.resumed_at)} — nothing was credited in between.` : 'Nothing more is credited until Delta finance resumes it.'}
            {s.by ? ` Stopped by ${s.by} (Delta finance).` : ''}
          </p>
        </div>
      ))}
      {adjustments.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-soft">
          <div className="border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-900">Additions and deductions by Delta finance</p>
            <p className="text-xs text-slate-500">Paid with, or taken off, the commission of that month or quarter — not part of the figures on this page.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  {named && <th className="px-4 py-2.5">Person</th>}
                  <th className="px-4 py-2.5">For</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5">Reason</th>
                  <th className="px-4 py-2.5">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {adjustments.map(a => (
                  <tr key={a.id}>
                    {named && <td className="px-4 py-2.5 font-medium text-slate-900">{a.name}</td>}
                    <td className="whitespace-nowrap px-4 py-2.5">{periodOf(a)}</td>
                    <td className={`px-4 py-2.5 font-medium ${a.type === 'deduction' ? 'text-rose-700' : 'text-emerald-700'}`}>{a.type === 'deduction' ? 'Deduction' : 'Addition'}</td>
                    <td className={`whitespace-nowrap px-4 py-2.5 text-right tabular-nums ${a.type === 'deduction' ? 'text-rose-700' : 'text-emerald-700'}`}>{signed(a)}</td>
                    <td className="px-4 py-2.5">{a.reason}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{[a.by, day(a.at)].filter(Boolean).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** Under a person's name, beside their commission: counting stopped, and each addition or deduction. */
function personNote(r, d) {
  const stop = (d.stopped || []).find(s => s.recipient_id === r.id && !s.resumed_at);
  const theirs = (d.adjustments || []).filter(a => a.recipient_id === r.id);
  if (!stop && !theirs.length) return null;
  return (
    <div className="mt-0.5 space-y-0.5 text-xs">
      {stop && <div className="font-medium text-rose-700">Counting stopped on {day(stop.at)} — {stop.reason}</div>}
      {theirs.map(a => <div key={a.id} className={a.type === 'deduction' ? 'text-rose-700' : 'text-emerald-700'}>{signed(a)} · {periodOf(a)} · {a.reason}</div>)}
    </div>
  );
}

export default function CommissionReport() {
  return (
    <ReportShell
      title="Commission report" fn="getCommissionReport" details="commission"
      description="Everyone's commission in the period — their own level and their pool shares, from bonuses and deposits. Open any number for the credits behind it."
      sortNote="Highest commission first"
      extra={d => <FinanceNotes d={d} />}
      rowNote={personNote}
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
