import { col } from "../db";

/* ────────────────────────────────────────────────────────────────────────────
   A funding request's commission put on the amount it should be on (the user, 2026-11-07: Praveen, STU-2991 — his
   7 Oct course payment was put right from AED 2,000 to AED 1,835 on 31 Oct, and its commission stayed on 2,000).

   A course payment's commission is on the AED the student paid, at 3.67 (functions/creditCommission.ts). When that
   amount is corrected afterwards, each of its credits not paid out yet — "accrued", or "pooled" in a Senior/Junior
   pool — gets the new base and its own % of it. One paid out already (released, distributed) is never changed, only
   listed, so finance can be told.
──────────────────────────────────────────────────────────────────────────── */

export const AED_PER_USD = 3.67;
const UNPAID = new Set(["accrued", "pooled"]);
const cents = (n: number) => Math.round(n * 100) / 100;

/** What a course payment's commission is on: the AED paid, at 3.67 — as creditCommission works it out. */
export const courseBaseUsd = (paidAed: number) => cents(paidAed / AED_PER_USD);

export interface BaseChange {
  id: any;
  recipient: string;
  level: number;
  position: string;
  percentage: number;
  status: string;
  before: { base_amount: number; full_amount?: number; commission_usd: number; updated_date?: string };
  after: { base_amount: number; full_amount: number; commission_usd: number };
}

/** The request's credits on another base than `baseUsd`: those to change, and those already paid out (left alone). */
export async function commissionBaseChanges(transactionId: string, baseUsd: number): Promise<{ change: BaseChange[]; paidOut: BaseChange[] }> {
  const credits = (await col("commission_credits").find({ transaction_id: transactionId, from_pool: { $ne: true } }).toArray()) as any[];
  const change: BaseChange[] = [], paidOut: BaseChange[] = [];
  for (const c of credits) {
    const base = Number(c.base_amount) || 0;
    if (Math.abs(base - baseUsd) <= 0.01) continue;
    // A withdrawal's credit is negative: keep its sign.
    const newBase = base < 0 ? -Math.abs(baseUsd) : baseUsd;
    const row: BaseChange = {
      id: c._id, recipient: String(c.recipient_name ?? ""), level: Number(c.level) || 0, position: String(c.position ?? ""),
      percentage: Number(c.percentage) || 0, status: String(c.status ?? ""),
      before: { base_amount: c.base_amount, ...(c.full_amount !== undefined ? { full_amount: c.full_amount } : {}), commission_usd: c.commission_usd, ...(c.updated_date ? { updated_date: c.updated_date } : {}) },
      after: { base_amount: newBase, full_amount: newBase, commission_usd: Math.round(newBase * (Number(c.percentage) || 0)) / 100 },
    };
    (UNPAID.has(row.status) ? change : paidOut).push(row);
  }
  return { change, paidOut };
}

/** Writes the changes (only to credits still not paid out — checked again as each is written). Returns how many. */
export async function applyBaseChanges(changes: BaseChange[], by: string): Promise<number> {
  const now = new Date().toISOString();
  let n = 0;
  for (const c of changes) {
    const r = await col("commission_credits").updateOne(
      { _id: c.id, status: { $in: [...UNPAID] } },
      { $set: { ...c.after, base_corrected_from: c.before.base_amount, base_corrected_at: now, base_corrected_by: by, updated_date: now } },
    );
    n += r.modifiedCount;
  }
  return n;
}

/** Puts credits back as `before` said (for an undo file). */
export async function undoBaseChanges(changes: Array<{ id: any; before: Record<string, unknown> }>, toId: (id: string) => any): Promise<void> {
  for (const c of changes) {
    await col("commission_credits").updateOne(
      { _id: toId(String(c.id)) },
      { $set: c.before, $unset: { base_corrected_from: "", base_corrected_at: "", base_corrected_by: "", ...(!("full_amount" in c.before) ? { full_amount: "" } : {}), ...(!("updated_date" in c.before) ? { updated_date: "" } : {}) } },
    );
  }
}

export const describeChange = (c: BaseChange) =>
  `${c.recipient.padEnd(20)} ${`L${c.level}${c.position ? ` ${c.position}` : ""}`.padEnd(16)} ${String(c.percentage).padStart(4)}%  ` +
  `on AED ${(c.before.base_amount * AED_PER_USD).toFixed(2)} → ${(c.after.base_amount * AED_PER_USD).toFixed(2)}  ` +
  `commission AED ${(c.before.commission_usd * AED_PER_USD).toFixed(2)} → ${(c.after.commission_usd * AED_PER_USD).toFixed(2)}  (${c.status})`;
