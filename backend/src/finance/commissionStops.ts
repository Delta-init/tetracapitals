import { col } from "../db";

/* ────────────────────────────────────────────────────────────────────────────
   Commission counting stopped, and amounts added or deducted — both done by Delta finance on its CS commission page
   (the user, 2026-11-13: "add stop count commission, with approve and record payment; addition/deduction can also be
   updated here"). Nobody sets either in this portal: it stores them (finance/csCommission.ts), follows the stop, and
   shows both to the person they are about (functions/reports.ts — the Commission report).

   A stop — commission_stops { recipient_id, stopped_at, stopped_by, reason, resumed_at: null | ISO, resumed_by } —
   holds while resumed_at is null. While it holds that person is credited nothing more: no credit of their own and none
   as someone's up-line (functions/creditCommission.ts). What they would have had goes to nobody — everyone else gets
   what they would have got anyway. Finance may then approve and pay their month while it is still running.

   A Senior/Junior pool (the user, 2026-11-13: "stop counting from now" — what was earned before stays theirs): the pool
   accrues as before, each accrual in the name of who held the position. An accrual written (created_date) while its
   holder was stopped — from stopped_at until resumed_at, or still — is nobody's, and stays nobody's after a resume: as
   with credits, what a stop leaves out is not made up once it is lifted (inStop, below). Every other accrual of theirs
   — from before a stop, or after a resume — is their share, paid like anyone's when the pool is split, or on its own
   when finance approves them while they are stopped (functions/distributeDepositPool.ts).

   An addition or deduction — commission_adjustments { kind, period, recipient_id, type, amount_minor, currency,
   reason, by, at } — is an amount in AED or INR (minor units) on someone's bonus month or deposit quarter. Finance
   works out the net and pays it; the figures here (credits, in USD) never include it. One taken off again is kept,
   marked removed_at / removed_by, and no longer listed.
──────────────────────────────────────────────────────────────────────────── */

export type Stop = { at: string; by: string; reason: string };
const stopView = (r: any): Stop => ({ at: String(r.stopped_at ?? ""), by: String(r.stopped_by ?? ""), reason: String(r.reason ?? "") });

/** Whose commission counting is stopped right now — recipient id → their stop. Everyone's, or only `ids`'. */
export async function stoppedNow(ids?: string[]): Promise<Map<string, Stop>> {
  const rows = (await col("commission_stops").find({ resumed_at: null, ...(ids ? { recipient_id: { $in: ids } } : {}) }).sort({ stopped_at: 1 }).toArray()) as any[];
  const out = new Map<string, Stop>();
  for (const r of rows) if (r.recipient_id && !out.has(String(r.recipient_id))) out.set(String(r.recipient_id), stopView(r));
  return out;
}
/** Each person's stops, open and resumed, as [from, until) in ms — an open one until forever. */
export type StopWindows = Map<string, Array<[number, number]>>;
export function windowsOf(stopRows: any[]): StopWindows {
  const out: StopWindows = new Map();
  for (const r of stopRows) {
    const id = String(r.recipient_id ?? "");
    if (id) out.set(id, [...(out.get(id) ?? []), [Date.parse(String(r.stopped_at ?? "")), r.resumed_at ? Date.parse(String(r.resumed_at)) : Infinity]]);
  }
  return out;
}
/** Everyone's stop windows, or only `ids`'. */
export async function stopWindows(ids?: string[]): Promise<StopWindows> {
  return windowsOf((await col("commission_stops").find(ids ? { recipient_id: { $in: ids } } : {}).toArray()) as any[]);
}
/** A pool accrual its holder has no share of: written while they were stopped. One with no readable date they keep. */
export const inStop = (accrual: any, windows: StopWindows): boolean => {
  const at = Date.parse(String(accrual?.created_date ?? ""));
  return (windows.get(String(accrual?.recipient_id ?? "")) ?? []).some(([from, until]) => at >= from && at < until);
};
/** One person's stop, or null when their commission is being counted. */
export const stopOf = async (recipientId: string): Promise<Stop | null> => (await stoppedNow([recipientId])).get(recipientId) ?? null;

export type Adjustment = { id: string; type: string; amount_minor: number; currency: string; reason: string; by: string; at: string };
/** An addition or deduction as finance is told it, and as the Commission report shows it. */
export const adjustmentView = (r: any): Adjustment => ({
  id: String(r._id), type: String(r.type ?? ""), amount_minor: Number(r.amount_minor) || 0, currency: String(r.currency ?? ""),
  reason: String(r.reason ?? ""), by: String(r.by ?? ""), at: String(r.at ?? ""),
});

/** The additions and deductions still standing, oldest first — a period's, one person's in it, or (no match) all. */
export async function adjustmentRows(match: { kind?: string; period?: string; recipient_id?: string } = {}): Promise<any[]> {
  return (await col("commission_adjustments").find({ ...match, removed_at: null }).sort({ at: 1 }).toArray()) as any[];
}
