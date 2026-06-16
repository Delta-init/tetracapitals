import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";

const ALLOWED = new Set(["super_admin", "admin", "broker_admin", "finance_admin"]);

/** Format `2026-06-08` → `JUNE 08` to match production reason strings. */
function reasonForDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  const monthName = new Date(Date.UTC(y, m - 1, d)).toLocaleString("en-US", { month: "long" }).toUpperCase();
  return `1% DEPOSIT COMMISSION PAID ON ${monthName} ${String(d).padStart(2, "0")}`;
}

/**
 * POST /api/functions/releaseDailyPayout
 * Body: { mentor_id, date: 'YYYY-MM-DD', invoice_number? }
 *
 * Computes 1% of the mentor's net approved deposit on that calendar day
 * (DEPOSIT + BONUS − WITHDRAWAL) and writes a single ManualCommissionAdjustment
 * with that negative amount. The adjustment carries structured fields
 * (`payout_kind`, `payout_date`, `invoice_number`) plus the legacy `reason` /
 * `notes` shape so it shows up identically to the historical "1% DEPOSIT
 * COMMISSION PAID ON …" entries already in production.
 *
 * Server computes the amount from the date — the frontend never sends it —
 * so a tampered client can't overpay.
 */
export async function releaseDailyPayout(req: Request, user: AuthUser): Promise<Response> {
  if (!ALLOWED.has(user.app_role)) return forbidden("Only super_admin / broker_admin / finance_admin can release daily payouts");

  const body: any = await req.json().catch(() => null);
  if (!body) return error("Body required", 400);
  const { mentor_id, date, invoice_number } = body;
  if (!mentor_id || !date) return error("mentor_id and date are required", 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return error("Invalid date format — expected YYYY-MM-DD", 400);

  // Idempotency: don't release the same mentor/date twice.
  const existing = await col("manual_commission_adjustments").findOne({
    mentor_id, payout_kind: "daily_1pct", payout_date: date,
  } as any);
  if (existing) return error(`Already released for ${date}`, 409);

  // Resolve mentor.
  const mOid = toObjectId(mentor_id);
  if (!mOid) return error("Invalid mentor_id", 400);
  const mentor = await col("users").findOne({ _id: mOid });
  if (!mentor) return error("Mentor not found", 404);

  // Compute net for the calendar day in UTC.
  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(`${date}T23:59:59.999Z`);
  const txs = await col("funding_transactions").find({ status: "APPROVED" }).toArray();
  let net = 0;
  for (const t of txs as any[]) {
    const attr = t.initiating_mentor_id || t.primary_mentor_id;
    if (attr !== mentor_id) continue;
    const ts = new Date(t.requested_at || t.created_date);
    if (ts < dayStart || ts > dayEnd) continue;
    if (t.type === "DEPOSIT" || t.type === "BONUS") net += t.amount_usd || 0;
    else if (t.type === "WITHDRAWAL") net -= t.amount_usd || 0;
  }
  if (net <= 0) return error("Net deposit is zero or negative for this date — nothing to release", 400);

  const payoutAmount = Math.round(net * 0.01 * 100) / 100; // 1% rounded to cents
  const reason = reasonForDate(date);
  const now = new Date().toISOString();

  const doc: any = {
    mentor_id,
    mentor_name: (mentor as any).full_name,
    amount_usd: -payoutAmount,
    adjustment_type: "DEDUCTION",
    reason,
    notes: invoice_number || "",
    invoice_number: invoice_number || "",
    payout_kind: "daily_1pct",
    payout_date: date,
    net_deposit_usd: net,
    created_by_id: user.id,
    created_by_name: user.full_name,
    created_date: now,
    updated_date: now,
  };
  const res = await col("manual_commission_adjustments").insertOne(doc);

  await col("logs").insertOne({
    timestamp: now,
    user_id: user.id, user_email: user.email, user_name: user.full_name, user_role: user.app_role,
    action_type: "release_daily_payout",
    entity_type: "ManualCommissionAdjustment",
    entity_id: res.insertedId.toString(),
    details: JSON.stringify({
      mentor: (mentor as any).full_name, date, net,
      payout: doc.amount_usd, invoice: invoice_number || null,
    }),
    success: true,
    created_date: now,
  } as any);

  return json({
    adjustment_id: res.insertedId.toString(),
    mentor_name: (mentor as any).full_name,
    net_deposit_usd: net,
    amount_usd: doc.amount_usd,
    reason,
    invoice_number: doc.invoice_number,
  });
}
