import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { isAdmin } from "../students/followups";

/* ────────────────────────────────────────────────────────────────────────────
   What is behind a quarterly commission ledger's numbers (the user,
   2026-10-27: the reports' breakdown on Commission Reports too).

   A ledger is a snapshot made when its quarter closed (generateQuarterlyLedgers,
   or by hand on Quarter Closing): net deposit = approved deposits − withdrawals
   the person raised in the quarter; gross = net × the rate; adjusted gross =
   gross + manual adjustments + the buffer carried in; release 75% and buffer
   25% of it. Here the requests and adjustments are counted again as they are
   today, beside what the ledger says — so a ledger gone out of date shows.
   Read only.
──────────────────────────────────────────────────────────────────────────── */

const cents = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** POST /api/functions/getLedgerBreakdown { ledgerId } — admin roles any ledger; anyone else their own. */
export async function getLedgerBreakdown(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(String(body?.ledgerId ?? ""));
  if (!oid) return error("ledgerId is required", 400);
  const ledger: any = await col("commission_ledgers").findOne({ _id: oid });
  if (!ledger) return notFound();
  if (!isAdmin(user) && String(ledger.mentor_id) !== user.id) return forbidden();

  const mentorId = String(ledger.mentor_id ?? "");
  const start = Date.parse(`${ledger.start_date}T00:00:00.000Z`);
  const end = Date.parse(`${ledger.end_date}T23:59:59.999Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return error("This ledger has no start and end dates", 422);
  const inQuarter = (v: unknown) => { const t = Date.parse(String(v ?? "")); return Number.isFinite(t) && t >= start && t <= end; };

  // The requests the net deposit is made of: approved, raised by them (or their student's, raised by nobody) in the quarter.
  const txs = ((await col("funding_transactions").find({
    type: { $in: ["DEPOSIT", "WITHDRAWAL"] }, status: "APPROVED",
    $or: [{ initiating_mentor_id: mentorId }, { initiating_mentor_id: { $in: [null, ""] }, primary_mentor_id: mentorId }],
  }, { projection: { type: 1, amount_usd: 1, amount_aed: 1, student_id: 1, requested_at: 1, approved_at: 1, transaction_id: 1, mt5_login: 1 } }).toArray()) as any[])
    .filter((t) => inQuarter(t.requested_at));
  const ids = [...new Set(txs.map((t) => String(t.student_id ?? "")).filter(Boolean))];
  const students = new Map(((await col("students").find({ _id: { $in: ids.map((id) => toObjectId(id)).filter(Boolean) as any[] } }, { projection: { full_name: 1, student_code: 1 } }).toArray()) as any[])
    .map((s) => [String(s._id), s]));
  const requests = txs
    .map((t) => ({
      id: String(t._id), type: t.type, usd: cents(num(t.amount_usd)), aed: cents(num(t.amount_aed)), at: t.requested_at ?? null, approved_at: t.approved_at ?? null,
      student_id: t.student_id ? String(t.student_id) : "", student_name: students.get(String(t.student_id))?.full_name ?? "", student_code: students.get(String(t.student_id))?.student_code ?? "",
      transaction_id: t.transaction_id ?? "", mt5_login: t.mt5_login ?? "",
    }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const deposits = cents(requests.filter((r) => r.type === "DEPOSIT").reduce((s, r) => s + r.usd, 0));
  const withdrawals = cents(requests.filter((r) => r.type === "WITHDRAWAL").reduce((s, r) => s + r.usd, 0));

  const adjustments = ((await col("manual_commission_adjustments").find({ mentor_id: mentorId }).toArray()) as any[])
    .filter((a) => inQuarter(a.effective_date || a.created_date))
    .map((a) => ({ id: String(a._id), usd: cents(num(a.amount_usd)), at: a.effective_date || a.created_date || null, reason: a.reason || a.notes || a.description || "", by: a.created_by_name || a.adjusted_by_name || "" }));

  // The quarters either side, for the buffer in and out.
  const [y, q] = [num(ledger.year), num(ledger.quarter_number)];
  const label = (yy: number, qq: number) => `${yy}-Q${qq}`;
  const prevLabel = q === 1 ? label(y - 1, 4) : label(y, q - 1);
  const nextLabel = q === 4 ? label(y + 1, 1) : label(y, q + 1);
  const side = async (quarter: string) => {
    const l: any = await col("commission_ledgers").findOne({ mentor_id: ledger.mentor_id, quarter });
    return l ? { id: String(l._id), quarter, buffer_usd: num(l.commission_buffer_usd), carried_in_usd: num(l.buffer_carried_in_usd), status: l.overall_status ?? "" } : { quarter, missing: true };
  };

  const net = num(ledger.net_deposit_usd), gross = num(ledger.gross_commission_usd);
  return json({
    ledger: {
      id: String(ledger._id), mentor_id: mentorId, mentor_name: ledger.mentor_name ?? "", quarter: ledger.quarter, start_date: ledger.start_date, end_date: ledger.end_date,
      net_deposit_usd: net, gross_commission_usd: gross, manual_adjustment_usd: num(ledger.manual_adjustment_usd),
      buffer_carried_in_usd: num(ledger.buffer_carried_in_usd), adjusted_gross_commission_usd: num(ledger.adjusted_gross_commission_usd),
      commission_release_usd: num(ledger.commission_release_usd), commission_buffer_usd: num(ledger.commission_buffer_usd),
      buffer_carried_out_usd: num(ledger.buffer_carried_out_usd), overall_status: ledger.overall_status ?? "",
      closed_by_name: ledger.closed_by_name ?? "", closed_at: ledger.closed_at ?? null,
      // The rate its own numbers imply — 4% when the system made it, maybe another by hand.
      rate: net ? cents((gross / net) * 10000) / 10000 : null,
    },
    today: { deposits_usd: deposits, withdrawals_usd: withdrawals, net_deposit_usd: cents(deposits - withdrawals), adjustments_usd: cents(adjustments.reduce((s, a) => s + a.usd, 0)) },
    requests, adjustments,
    previous: await side(prevLabel),
    next: await side(nextLabel),
  });
}
