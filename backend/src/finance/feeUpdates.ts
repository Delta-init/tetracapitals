import { declaredPaymentsOf, link } from "./students";
import { col } from "../db";
import { config } from "../config";
import { ok, refuse, secretMatches, text } from "../students/intake";
import { recordHistory } from "../students/history";
import { isDay, moneyText } from "./balanceDue";

/* ────────────────────────────────────────────────────────────────────────────
   POST /api/v1/integrations/finance/fee-updates — an enrolment's money changed
   in Delta finance (the user, 2026-10-11).

   Finance sends one whenever an invoice of a student it sent here changes: the
   approval, a payment recorded, edited or deleted, a void, a credit note, a new
   next due date. Server to server, `x-finance-secret` as for new students.

     { invoiceId, invoiceNumber, email, course, currency, totalMinor, paidMinor, balanceMinor,
       status: "partial" | "paid" | "void" | "deleted", nextDueOn: "YYYY-MM-DD" | null,
       payments: [{ amountMinor, paidOn: "YYYY-MM-DD", method }], updatedAt }

   The student's `course_fees` entry for that invoice takes it: fee_minor (the
   total), paid_minor, balance_minor, currency, status, next_due_on, payments
   and updated_at (finance's). 404 UNKNOWN_INVOICE when no student here has
   that invoice — finance stops sending it. Safe to repeat: the same update
   again changes nothing, and an older one (updatedAt before the one kept)
   never overwrites a newer.
──────────────────────────────────────────────────────────────────────────── */

export const FEE_STATUSES = ["partial", "paid", "void", "deleted"] as const;
export type FeeStatus = (typeof FEE_STATUSES)[number];

export interface FeeUpdate {
  invoiceId: string;
  invoiceNumber: string;
  email: string;
  course: string;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  status: FeeStatus;
  nextDueOn: string | null;
  payments: { amount_minor: number; paid_on: string; method: string }[];
  updatedAt: string;
  /**
   * What the counsellor declared collected at the close, and how, with each declared payment and its receipt, and the
   * close's receipt (the user, 2026-10-12 — finance sends them from then on, and its backfill for the rest). Absent
   * from an older finance: left as they are here.
   */
  declared?: { paidMinor: number | null; method: string; payments: ReturnType<typeof declaredPaymentsOf>; receiptUrl: string; receiptName: string };
}

const minor = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

/** What finance sent, read — or why it cannot be. A payment line that cannot be read is left out, never the update. */
export function readFeeUpdate(body: unknown): { update: FeeUpdate } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Body must be a JSON object" };
  const b = body as Record<string, unknown>;
  const invoiceId = text(b.invoiceId, 64);
  if (!invoiceId) return { error: "invoiceId is required" };
  const total = minor(b.totalMinor), paid = minor(b.paidMinor), balance = minor(b.balanceMinor);
  if (total === null || paid === null || balance === null) return { error: "totalMinor, paidMinor and balanceMinor must be whole numbers of cents, 0 or more" };
  const currency = text(b.currency, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { error: "currency must be a 3-letter code" };
  const status = text(b.status, 20) as FeeStatus;
  if (!FEE_STATUSES.includes(status)) return { error: `status must be one of ${FEE_STATUSES.join(", ")}` };
  const nextDueOn = b.nextDueOn === null || b.nextDueOn === undefined || b.nextDueOn === "" ? null : String(b.nextDueOn);
  if (nextDueOn !== null && !isDay(nextDueOn)) return { error: "nextDueOn must be YYYY-MM-DD or null" };
  const at = typeof b.updatedAt === "string" ? Date.parse(b.updatedAt) : NaN;
  if (!Number.isFinite(at)) return { error: "updatedAt must be a date and time" };
  const payments = (Array.isArray(b.payments) ? b.payments : []).slice(0, 500).flatMap((p: any) => {
    const amount = minor(p?.amountMinor);
    const on = String(p?.paidOn ?? "").slice(0, 10);
    return amount !== null && isDay(on) ? [{ amount_minor: amount, paid_on: on, method: text(p?.method, 60) }] : [];
  });
  const hasDeclared = "declaredPaidMinor" in b || "declaredPayments" in b || "receipt" in b;
  const receipt = b.receipt && typeof b.receipt === "object" ? (b.receipt as Record<string, unknown>) : null;
  return {
    update: {
      invoiceId, invoiceNumber: text(b.invoiceNumber, 64), email: text(b.email).toLowerCase(), course: text(b.course),
      currency, totalMinor: total, paidMinor: paid, balanceMinor: balance, status, nextDueOn, payments,
      updatedAt: new Date(at).toISOString(),
      ...(hasDeclared ? { declared: {
        paidMinor: minor(b.declaredPaidMinor), method: text(b.declaredPaymentMethod, 60),
        payments: declaredPaymentsOf(b.declaredPayments), receiptUrl: link(receipt?.url), receiptName: text(receipt?.name, 200),
      } } : {}),
    },
  };
}

type Outcome = "applied" | "already" | "older";

/** Onto one student's entry for the invoice, unless what is there is as new or newer. Retries a write that raced. */
async function applyTo(studentId: unknown, u: FeeUpdate): Promise<Outcome> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const s: any = await col("students").findOne({ _id: studentId as never }, { projection: { course_fees: 1 } });
    const entry = (s?.course_fees ?? []).find((f: any) => f?.invoice_id === u.invoiceId);
    if (!entry) return "already";   // gone between the look-up and now (a merge): nothing to change on this one
    const kept = typeof entry.updated_at === "string" ? entry.updated_at : "";
    if (kept && kept > u.updatedAt) return "older";
    if (kept && kept === u.updatedAt) return "already";
    const res = await col("students").updateOne(
      // Only while the entry is still as read: a newer update landing meanwhile is never overwritten.
      { _id: studentId as never, course_fees: { $elemMatch: { invoice_id: u.invoiceId, updated_at: kept ? kept : { $in: [null] } } } },
      {
        $set: {
          "course_fees.$.fee_minor": u.totalMinor,
          "course_fees.$.paid_minor": u.paidMinor,
          "course_fees.$.balance_minor": u.balanceMinor,
          "course_fees.$.currency": u.currency,
          "course_fees.$.status": u.status,
          "course_fees.$.next_due_on": u.nextDueOn,
          "course_fees.$.payments": u.payments,
          "course_fees.$.updated_at": u.updatedAt,
          "course_fees.$.received_at": new Date().toISOString(),
          ...(u.invoiceNumber && !entry.invoice_number ? { "course_fees.$.invoice_number": u.invoiceNumber } : {}),
          // What accounts recorded is this update's paid; the counsellor's own figure and receipts when finance sent them.
          "course_fees.$.recorded_minor": u.paidMinor,
          ...(u.declared?.paidMinor != null ? { "course_fees.$.collected_minor": u.declared.paidMinor } : {}),
          ...(u.declared?.method ? { "course_fees.$.collected_method": u.declared.method } : {}),
          ...(u.declared?.payments.length ? { "course_fees.$.declared_payments": u.declared.payments } : {}),
          ...(u.declared && (u.declared.receiptUrl || u.declared.payments.find((p) => p.receipt_url))
            ? (entry.receipt_url ? {} : {
              "course_fees.$.receipt_url": u.declared.receiptUrl || u.declared.payments.find((p) => p.receipt_url)!.receipt_url,
              "course_fees.$.receipt_name": u.declared.receiptName || u.declared.payments.find((p) => p.receipt_url)!.receipt_name,
            }) : {}),
        },
      },
    );
    if (res.modifiedCount) {
      await recordChange(String(studentId), entry, u);
      return "applied";
    }
  }
  throw new Error("The course fees kept changing while this update was written");
}

/** One history line when something a person would notice changed: paid, balance, status or the next due date. */
async function recordChange(studentId: string, was: any, u: FeeUpdate): Promise<void> {
  const changed = Number(was.paid_minor) !== u.paidMinor || Number(was.balance_minor) !== u.balanceMinor
    || String(was.status ?? "") !== u.status || String(was.next_due_on ?? "") !== String(u.nextDueOn ?? "");
  if (!changed) return;
  const course = u.course || was.course || "a course";
  const what = u.status === "void" ? "voided" : u.status === "deleted" ? "deleted" : u.status === "paid" ? "paid in full" : `next instalment due ${u.nextDueOn ?? "— no date yet"}`;
  await recordHistory([{
    student_id: studentId, at: new Date().toISOString(), type: "course_fees", by_id: null, by_name: "Delta finance",
    text: `Course fees updated by Delta finance — ${course}${u.invoiceNumber ? `, invoice ${u.invoiceNumber}` : ""}: paid ${moneyText(u.paidMinor, u.currency)} of ${moneyText(u.totalMinor, u.currency)}, balance ${moneyText(u.balanceMinor, u.currency)} — ${what}`,
    from: { paid_minor: was.paid_minor ?? null, balance_minor: was.balance_minor ?? null, status: was.status ?? null, next_due_on: was.next_due_on ?? null },
    to: { paid_minor: u.paidMinor, balance_minor: u.balanceMinor, status: u.status, next_due_on: u.nextDueOn },
    via: "finance",
  }]);
}

export async function handleFeeUpdate(req: Request): Promise<Response> {
  if (!config.financeS2sSecret) return refuse(503, "INTEGRATION_DISABLED", "The Delta finance link is not configured on this server");
  if (!secretMatches(req.headers.get("x-finance-secret"), config.financeS2sSecret)) return refuse(401, "UNAUTHORISED", "Bad secret");
  const read = readFeeUpdate(await req.json().catch(() => null));
  if ("error" in read) return refuse(400, "VALIDATION_ERROR", read.error);
  const u = read.update;

  // Normally one student; two only if a duplicate was never merged — each keeps the same money.
  const students = await col("students").find({ "course_fees.invoice_id": u.invoiceId }, { projection: { _id: 1 } }).limit(10).toArray();
  if (!students.length) return refuse(404, "UNKNOWN_INVOICE", "No student here has this invoice's course fees");
  const outcomes: Outcome[] = [];
  for (const s of students) outcomes.push(await applyTo(s._id, u));
  const applied = outcomes.includes("applied");
  return ok({
    applied,
    already: !applied && outcomes.includes("already"),
    ...(outcomes.every((o) => o === "older") ? { ignored: "older" } : {}),
    students: students.length,
  });
}
