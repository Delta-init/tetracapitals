import { localFromAed, typedLocal } from '@/components/utils/displayCurrency';
import { ReceiptsButton, methodsText, paymentsOf } from '@/components/funding/payments';

/* ────────────────────────────────────────────────────────────────────────────
   The amount, what the student paid, and where a request came from — as MT5
   Approvals shows them (the user, 2026-10-13), shared with Funding Requests so
   the two never disagree. A row is the funding request with `student` (code,
   level, email, CS, team, finance invoices, who closed them — studentInfoOf)
   and `source` (sourceOf).
──────────────────────────────────────────────────────────────────────────── */

export const usdText = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** An AED amount in the viewer's currency — INR on a Bangalore team (utils/displayCurrency.js, 2026-10-14). */
export const aedText = (n) => localFromAed(n);
/** A bonus's amount column is the MT5 bonus to credit, in USD only (the user, 2026-10-13): a course payment's bonus —
 *  not the payment — else the request's amount. */
export const bonusUsdOf = (t) => (t.type === 'BONUS' && t.course_payment ? Number(t.course_payment.bonus_usd) || 0 : Number(t.amount_usd) || 0);
/** A sales-close bonus credited in halves (the course part paid, 2026-10-27): "First half · $500" / "Rest after full payment · $500". */
export const partLabel = (t) => (t.bonus_part === 'first_half' ? `First half · ${usdText(t.amount_usd)}`
  : t.bonus_part === 'rest' ? `Rest after full payment · ${usdText(t.amount_usd)}` : '');
export const bonusLabel = (t) => (t.bonus_part ? `Sales-close bonus credit · ${partLabel(t)} · no commission`
  : t.bonus_credit === 'sales_close' ? 'Sales-close bonus credit · no commission'
  : t.bonus_credit === 'course_upgrade' || t.course_upgrade ? 'Course upgrade bonus'
  : t.course_payment && !(Number(t.course_payment.bonus_usd) > 0) ? 'No MT5 bonus yet — on hold'
  : 'MT5 bonus');
/** Direct from the CS portal: what the student paid with this request, and how — beside the bonus, as a sales close
 *  shows the counsellor's collection; with what waits on hold and the balance. */
export const receivedOf = (t) => {
  if (t.type !== 'BONUS' || t.bonus_credit) return null;
  const cp = t.course_payment;
  const amount = typedLocal(t) || (cp && Number(cp.paid_today_aed) > 0 ? aedText(cp.paid_today_aed)
    : Number(t.amount_original) > 0 ? `${t.amount_currency === 'USD' ? usdText(t.amount_original) : `${t.amount_currency || 'AED'} ${Number(t.amount_original).toLocaleString('en-US', { maximumFractionDigits: 2 })}`}` : null);
  if (!amount) return null;
  return {
    received: amount, method: methodsText(t),
    kind: cp?.kind === 'partial' ? 'Partial payment' : cp?.kind === 'full' ? 'Full payment' : '',
    before: cp && Number(cp.paid_before_aed) > 0 ? aedText(cp.paid_before_aed) : null,
    hold: cp && Number(cp.hold_aed) > 0 ? aedText(cp.hold_aed) : null,
    balance: cp && cp.balance_aed != null ? aedText(cp.balance_aed) : null,
  };
};
/** Where it came from (2026-10-12): the bonus promised at a sales close, a course upgrade, or raised by a CS here. */
export const sourceLabel = (t) => (t.source === 'sales_close' ? 'Sales close' : t.source === 'course_upgrade' ? 'Course upgrade' : 'Direct from CS portal');
/**
 * What the Receipt column and the approval box open (2026-10-12): the request's own receipts — or, when it has none (a
 * sales-close bonus), finance's receipt for its invoice (the student's other invoices' if it names none).
 */
/** The invoices a request is about: a sales-close bonus its own, anything else all of the student's. */
export const invoicesOf = (t) => {
  const all = t.student?.invoices || [];
  const mine = t.sales_close?.invoice_number ? all.filter(f => f.invoice_number === t.sales_close.invoice_number) : [];
  return mine.length ? mine : all;
};
export const financeReceiptsOf = (t) => {
  // Each payment the salesperson declared, with its own receipt (2026-10-12); the invoice's close receipt too — a
  // second file at the close was hidden behind the payments' own (2026-10-31); and every payment finance recorded
  // with its own (2026-10-27: a second payment's receipt never showed). Each once.
  const seen = new Set();
  const once = (r) => (seen.has(r.receipt_url) ? [] : (seen.add(r.receipt_url), [r]));
  const list = invoicesOf(t).flatMap(f => [
    ...(f.payments || []).filter(p => p.receipt_url).map(p => ({ method: `${f.invoice_number} · ${p.method || 'payment'}`, amount: p.amount, currency: f.currency, collected_on: p.paid_on, receipt_url: p.receipt_url, receipt_name: p.receipt_name })),
    ...(f.receipt_url ? [{ method: `Finance receipt · ${f.invoice_number}`, receipt_url: f.receipt_url, receipt_name: f.receipt_name }] : []),
    ...(f.recorded_payments || []).map(p => ({ method: `${f.invoice_number} · ${p.method || 'payment'} (recorded)`, amount: p.amount, currency: f.currency, collected_on: p.paid_on, receipt_url: p.receipt_url, receipt_name: p.receipt_name })),
  ].flatMap(once));
  return list.length ? { payments: list } : null;
};
export const money = (n, cur) => `${cur || 'AED'} ${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
/** "Collected AED 2,250 · tabby · recorded AED 2,250" for each invoice the request is about. */
export const paidLines = (t) => invoicesOf(t).map(f => ({
  key: f.invoice_number,
  collected: f.collected != null ? money(f.collected, f.currency) + (f.collected_method ? ` · ${f.collected_method}` : '') : null,
  recorded: f.recorded != null ? money(f.recorded, f.currency) : null,
  paid: money(f.paid, f.currency), fee: money(f.fee, f.currency), balance: f.balance > 0 ? money(f.balance, f.currency) : null,
}));
/** A course-upgrade bonus: every payment of its upgrade with its receipt — this bonus's own first (2026-10-12). */
export const upgradeReceiptsOf = (t) => {
  const list = [...(t.upgrade_receipts || [])].sort((a, b) => (b.this_one ? 1 : 0) - (a.this_one ? 1 : 0));
  return list.length ? { payments: list.map(p => ({
    method: `${p.this_one ? 'This payment' : 'Upgrade payment'} · ${p.method || '—'}${p.status && p.status !== 'approved' ? ` (${p.status})` : ''}`,
    amount: p.amount_aed, currency: 'AED', collected_on: p.paid_on, receipt_url: p.receipt_url, receipt_name: p.receipt_name,
  })) } : null;
};
/** What a row's receipts open: an upgrade's payments, the request's own (one per payment), or finance's for its invoice. */
export const receiptTxOf = (t) => upgradeReceiptsOf(t) || (paymentsOf(t).some(p => p.receipt_url) ? t : financeReceiptsOf(t) || t);
/** The receipts the approval box adds: an upgrade's payments, or finance's when the request has none of its own. */
export const extraReceiptsOf = (t) => upgradeReceiptsOf(t) || (paymentsOf(t).some(p => p.receipt_url) ? null : financeReceiptsOf(t));

/** Where a request came from, from the request itself — as the MT5 Approvals server says it. */
export const sourceOf = (t) => (t.type !== 'BONUS' ? 'request' : t.bonus_credit === 'sales_close' ? 'sales_close' : t.bonus_credit === 'course_upgrade' ? 'course_upgrade' : 'request');

/** A student record as MT5 Approvals' rows carry it (backend functions/bonusApprovals.ts), built from the Student entity. */
export const studentInfoOf = (s) => (s ? {
  full_name: s.full_name, student_code: s.student_code, email: s.email, cs: s.primary_mentor_name, team: s.team_name, level: s.student_level,
  invoices: (Array.isArray(s.course_fees) ? s.course_fees : []).map(f => ({
    invoice_number: String(f.invoice_number ?? ''), course: String(f.course ?? ''), currency: String(f.currency ?? ''),
    fee: (Number(f.fee_minor) || 0) / 100, paid: (Number(f.paid_minor) || 0) / 100, balance: (Number(f.balance_minor) || 0) / 100,
    receipt_url: /^https?:\/\//i.test(String(f.receipt_url ?? '')) ? String(f.receipt_url) : '', receipt_name: String(f.receipt_name ?? ''),
    collected: f.collected_minor != null ? (Number(f.collected_minor) || 0) / 100 : null, collected_method: String(f.collected_method ?? ''),
    recorded: f.recorded_minor != null ? (Number(f.recorded_minor) || 0) / 100 : null,
    payments: (Array.isArray(f.declared_payments) ? f.declared_payments : []).map(p => ({
      method: String(p.method ?? ''), amount: (Number(p.amount_minor) || 0) / 100, paid_on: String(p.paid_on ?? ''),
      receipt_url: String(p.receipt_url ?? ''), receipt_name: String(p.receipt_name ?? ''),
    })),
    // Each payment finance recorded with its own receipt, as MT5 Approvals has it (2026-10-31: Funding Requests showed
    // only the close's — a second payment's never).
    recorded_payments: (Array.isArray(f.payments) ? f.payments : []).filter(p => /^https?:\/\//i.test(String(p?.receipt_url ?? ''))).map(p => ({
      method: String(p.method ?? ''), amount: (Number(p.amount_minor) || 0) / 100, paid_on: String(p.paid_on ?? ''),
      receipt_url: String(p.receipt_url), receipt_name: String(p.receipt_name ?? ''),
    })),
  })),
  closed_by: (Array.isArray(s.closed_by) ? s.closed_by : []).map(c => ({ name: String(c.name ?? c.email ?? ''), crm: String(c.crm ?? '') })),
} : null);

/** Amount to credit: a bonus's MT5 bonus in USD with what kind it is; a deposit or withdrawal its USD and what was typed. */
export function AmountCell({ t, original, children }) {
  if (t.type === 'BONUS') {
    return (
      <>
        <div className="font-semibold text-slate-800">{usdText(bonusUsdOf(t))}</div>
        <div className={`text-xs ${t.bonus_credit === 'sales_close' ? 'text-amber-700' : bonusUsdOf(t) > 0 ? 'text-emerald-700' : 'text-amber-700'}`}>{bonusLabel(t)}</div>
      </>
    );
  }
  return (
    <>
      <div className="font-semibold text-slate-800">{usdText(t.amount_usd)}</div>
      {original && <div className="text-xs text-slate-400">{original}</div>}
      {children}
    </>
  );
}

/** Paid by the student: what a direct request says was received (else the counsellor's collection), and the receipts. */
export function PaidCell({ t, title }) {
  const r = receivedOf(t);
  const lines = r ? [] : paidLines(t);
  return (
    <>
      {r ? (
        <div>
          <div className="text-slate-800">Received <b>{r.received}{r.method ? ` · ${r.method}` : ''}</b></div>
          {r.kind && <div className="text-slate-500">{r.kind}{r.before ? ` · paid before ${r.before}` : ''}</div>}
          {r.hold && <div className="text-amber-700">On hold {r.hold}</div>}
          {r.balance && <div className="text-slate-500">Balance {r.balance}</div>}
        </div>
      ) : lines.length ? lines.map(l => (
        <div key={l.key} className="mb-1 last:mb-0">
          {lines.length > 1 && <div className="font-mono text-[11px] text-slate-400">{l.key}</div>}
          {l.collected ? <div className="text-slate-800">Collected by counsellor <b>{l.collected}</b></div> : <div className="text-slate-800">Paid <b>{l.paid}</b></div>}
          {l.recorded && <div className="text-slate-500">Recorded {l.recorded}</div>}
          <div className="text-slate-400">of {l.fee}{l.balance ? <span className="text-amber-700"> · owes {l.balance}</span> : ''}</div>
        </div>
      )) : <span className="text-slate-300">—</span>}
      <div className="mt-1.5">
        <ReceiptsButton tx={receiptTxOf(t)} title={title || t.student?.full_name || t.student_name} />
        {receiptTxOf(t) !== t && <span className="ml-1.5 text-[11px] text-slate-400">{upgradeReceiptsOf(t) ? 'upgrade payments' : 'from finance'}</span>}
      </div>
    </>
  );
}

/** The finance invoice it is for, and the student's others. */
export function InvoiceCell({ t }) {
  return (
    <>
      {t.sales_close?.invoice_number && <div className="font-mono font-medium text-slate-800">{t.sales_close.invoice_number}</div>}
      {(t.student?.invoices || []).filter(f => f.invoice_number && f.invoice_number !== t.sales_close?.invoice_number).map((f) => (
        <div key={f.invoice_number} className="text-slate-600"><span className="font-mono">{f.invoice_number}</span> · {f.currency} {Number(f.fee).toLocaleString('en-US')}{f.balance > 0 ? <span className="text-amber-700"> · owes {Number(f.balance).toLocaleString('en-US')}</span> : ''}</div>
      ))}
      {!t.sales_close?.invoice_number && !(t.student?.invoices || []).some(f => f.invoice_number) && <span className="text-slate-300">—</span>}
    </>
  );
}

/** From: Sales close (sold by), Course upgrade, or Direct from CS portal — and who raised it. */
export function SourceCell({ t }) {
  return (
    <>
      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.source === 'sales_close' ? 'bg-violet-50 text-violet-700' : t.source === 'course_upgrade' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700'}`}>
        {sourceLabel(t)}
      </span>
      {t.source === 'sales_close' && t.student?.closed_by?.length > 0 && <div className="mt-0.5 text-xs text-slate-700">Sold by {t.student.closed_by.map(c => c.name).join(', ')}</div>}
      {t.source === 'course_upgrade' && <div className="mt-0.5 text-[11px] text-slate-400">Payment approved by finance</div>}
    </>
  );
}
