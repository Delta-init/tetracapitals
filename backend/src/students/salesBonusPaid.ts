import { col } from "../db";
import { toObjectId } from "../lib/id";

/* ────────────────────────────────────────────────────────────────────────────
   The sales-close bonus waits for the course to be paid in full (the user,
   2026-10-17: "partial payment from the sales never gets the bonus in the
   CS Portal — only after the full payment is finished can the bonus
   request be raised for this student").

   A course sold at a sales close still owing (finance's course fees: its
   balance, kept up to date by finance's fee updates — finance/feeUpdates.ts)
   has its bonus held: not sent to be credited, from the call log or the Bonus
   pending badge, and — one raised before this — not approved by a broker
   admin. Its student stays "onboarding verification pending" meanwhile, so the
   sales CRM's commission for the close waits too. Paid in full, it goes as
   before. Only the sales-close bonus: a course-upgrade bonus, and every bonus a
   CS raises, are not held.

   Half of it before the full payment (the user, 2026-10-27: "minimum 2k+ partial
   payment … he gets 500 USD … if he pays full he gets full", a fixed half):
   once AED 2,000 of the course is paid, half the promised bonus goes to be
   credited (bonus_part "first_half"); paid in full, the rest (bonus_part
   "rest") — or, the first half not approved yet, that one becomes the whole
   bonus again (functions/studentFollowups.ts settleSalesBonusHalves, run on
   every fee update from finance). A credit with no bonus_part is the whole
   bonus. Bangalore's INR courses wait for the full payment, as before.
──────────────────────────────────────────────────────────────────────────── */

/** Paid this much on the course (AED, in fils), half the sales bonus can be credited before the rest is paid. */
export const HALF_FROM_AED_MINOR = 200_000;
const AED_PER_USD = 3.67;

/** What can be credited of a course's sales bonus now: all of it, half of it, or none yet. */
export type SalesBonusStage = "full" | "half" | "held";
export type BonusPart = "first_half" | "rest";

/** What has been paid on a course, in AED fils — null in another currency than AED or USD (Bangalore's INR: left for now). */
function paidAedMinorOf(fee: any): number | null {
  const paid = Number.isFinite(Number(fee?.paid_minor)) ? Number(fee.paid_minor) : Number(fee?.fee_minor) - Number(fee?.balance_minor);
  if (!Number.isFinite(paid)) return null;
  const currency = String(fee?.currency || "AED").toUpperCase();
  return currency === "AED" ? paid : currency === "USD" ? Math.round(paid * AED_PER_USD) : null;
}

/** All of the sales bonus once the course is paid in full (or its balance is unknown); half from AED 2,000 paid; else none. */
export function salesBonusStageOf(fee: any): SalesBonusStage {
  if (!owedOf(fee)) return "full";
  const paid = paidAedMinorOf(fee);
  return paid !== null && paid >= HALF_FROM_AED_MINOR ? "half" : "held";
}

/** The first half of a bonus, to the cent; the rest is what is left of it. */
export const halfOf = (amount: number) => Math.round((amount * 100) / 2) / 100;

/** Whether this credit — the whole bonus, its first half or its rest — can be approved at this stage of the course's payment. */
const approvable = (part: unknown, stage: SalesBonusStage) => stage === "full" || (stage === "half" && part === "first_half");

/** What is still owed on a course sold at a sales close, in its currency's minor units — 0 when paid, voided, or not known. */
export function owedOf(fee: any): number {
  if (!fee || fee.source === "cs_tracker") return 0;
  if (["paid", "void", "deleted"].includes(String(fee.status ?? ""))) return 0;
  const b = Number(fee.balance_minor);
  return Number.isFinite(b) && b > 0 ? Math.round(b) : 0;
}

/** "AED 1,125.00". */
export const owedText = (minor: number, currency: unknown) =>
  `${String(currency || "AED")} ${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The course fee a sales-close bonus credit is for. */
export const feeFor = (student: any, sc: any) =>
  (Array.isArray(student?.course_fees) ? student.course_fees : []).find((f: any) =>
    (sc?.invoice_id && String(f?.invoice_id ?? "") === String(sc.invoice_id)) || (sc?.invoice_number && String(f?.invoice_number ?? "") === String(sc.invoice_number)));

/** Why a sales-close bonus credit can't be approved yet — its course still owes — or null. */
export async function salesBonusOwedRefusal(tx: any): Promise<string | null> {
  if (tx?.type !== "BONUS" || tx?.bonus_credit !== "sales_close") return null;
  const oid = toObjectId(String(tx.student_id ?? ""));
  if (!oid) return null;
  const student: any = await col("students").findOne({ _id: oid }, { projection: { course_fees: 1 } });
  const fee = feeFor(student, tx.sales_close);
  const stage = salesBonusStageOf(fee);
  if (approvable(tx.bonus_part, stage)) return null;
  const owed = `${owedText(owedOf(fee), fee.currency)} is still owed on ${fee.invoice_number || "this course"}`;
  if (tx.bonus_part === "rest") return `${owed} — the rest of the sales bonus is approved once the course is paid in full`;
  if (stage === "half") return `${owed} — half the sales bonus can be credited now: this request for all of it is split in two on the course's next payment update`;
  return `${owed} — the sales bonus is approved once the course is paid in full`;
}

/** Of these funding requests, the sales-close bonus credits not to be approved yet — their course still owes: what each owes, by request id. */
export async function owedSalesCredits(txs: any[]): Promise<Map<string, { minor: number; currency: string }>> {
  const out = new Map<string, { minor: number; currency: string }>();
  const credits = txs.filter((t) => t?.bonus_credit === "sales_close" && t?.student_id);
  if (!credits.length) return out;
  const oids = [...new Set(credits.map((t) => String(t.student_id)))].map(toObjectId).filter(Boolean);
  const students = new Map(((await col("students").find({ _id: { $in: oids as any[] } }, { projection: { course_fees: 1 } }).toArray()) as any[])
    .map((s) => [String(s._id), s]));
  for (const t of credits) {
    const fee = feeFor(students.get(String(t.student_id)), t.sales_close);
    if (!approvable(t.bonus_part, salesBonusStageOf(fee))) out.set(String(t._id), { minor: owedOf(fee), currency: String(fee.currency || "AED") });
  }
  return out;
}
