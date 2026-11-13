import { col } from "../db";

/* ────────────────────────────────────────────────────────────────────────────
   Commission counting stopped, and amounts added or deducted — both done by Delta finance on its CS commission page
   (the user, 2026-11-13: "add stop count commission, with approve and record payment; addition/deduction can also be
   updated here"). Nobody sets either in this portal: it stores them (finance/csCommission.ts), follows the stop, and
   shows both to the person they are about (functions/reports.ts — the Commission report).

   A stop — commission_stops { recipient_id, stopped_at, stopped_by, reason, resumed_at: null | ISO, resumed_by } —
   holds while resumed_at is null. While it holds that person is credited nothing more: no credit of their own and none
   as someone's up-line (functions/creditCommission.ts), and no share of a Senior/Junior pool split meanwhile
   (functions/distributeDepositPool.ts). What they would have had goes to nobody — everyone else gets what they would
   have got anyway. Finance may then approve and pay their month while it is still running.

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
