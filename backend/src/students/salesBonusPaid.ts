import { col } from "../db";
import { toObjectId } from "../lib/id";

/* ────────────────────────────────────────────────────────────────────────────
   The sales-close bonus waits for the course to be paid in full (the user,
   2026-10-17: "partial payment from the sales never gets the bonus in the
   commission portal — only after the full payment is finished can the bonus
   request be raised for this student").

   A course sold at a sales close still owing (finance's course fees: its
   balance, kept up to date by finance's fee updates — finance/feeUpdates.ts)
   has its bonus held: not sent to be credited, from the call log or the Bonus
   pending badge, and — one raised before this — not approved by a broker
   admin. Its student stays "onboarding verification pending" meanwhile, so the
   sales CRM's commission for the close waits too. Paid in full, it goes as
   before. Only the sales-close bonus: a course-upgrade bonus, and every bonus a
   CS raises, are not held.
──────────────────────────────────────────────────────────────────────────── */

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
const feeFor = (student: any, sc: any) =>
  (Array.isArray(student?.course_fees) ? student.course_fees : []).find((f: any) =>
    (sc?.invoice_id && String(f?.invoice_id ?? "") === String(sc.invoice_id)) || (sc?.invoice_number && String(f?.invoice_number ?? "") === String(sc.invoice_number)));

/** Why a sales-close bonus credit can't be approved yet — its course still owes — or null. */
export async function salesBonusOwedRefusal(tx: any): Promise<string | null> {
  if (tx?.type !== "BONUS" || tx?.bonus_credit !== "sales_close") return null;
  const oid = toObjectId(String(tx.student_id ?? ""));
  if (!oid) return null;
  const student: any = await col("students").findOne({ _id: oid }, { projection: { course_fees: 1 } });
  const fee = feeFor(student, tx.sales_close);
  const owed = owedOf(fee);
  if (!owed) return null;
  return `${owedText(owed, fee.currency)} is still owed on ${fee.invoice_number || "this course"} — the sales bonus is approved once the course is paid in full`;
}

/** Of these funding requests, the sales-close bonus credits whose course still owes: what each owes, by request id. */
export async function owedSalesCredits(txs: any[]): Promise<Map<string, { minor: number; currency: string }>> {
  const out = new Map<string, { minor: number; currency: string }>();
  const credits = txs.filter((t) => t?.bonus_credit === "sales_close" && t?.student_id);
  if (!credits.length) return out;
  const oids = [...new Set(credits.map((t) => String(t.student_id)))].map(toObjectId).filter(Boolean);
  const students = new Map(((await col("students").find({ _id: { $in: oids as any[] } }, { projection: { course_fees: 1 } }).toArray()) as any[])
    .map((s) => [String(s._id), s]));
  for (const t of credits) {
    const fee = feeFor(students.get(String(t.student_id)), t.sales_close);
    const owed = owedOf(fee);
    if (owed) out.set(String(t._id), { minor: owed, currency: String(fee.currency || "AED") });
  }
  return out;
}
