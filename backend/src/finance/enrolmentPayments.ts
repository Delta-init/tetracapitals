import { ObjectId } from "mongodb";
import { col } from "../db";
import { ok, refuse } from "../students/intake";
import { recordHistory } from "../students/history";
import { notify } from "../lib/notify";
import { financeFundingConfigured, postToFinance, FinancePermanentError, backoffMs, FINANCE_INTAKE_PATH, kickFinanceFunding } from "./funding";
import { moneyText } from "./balanceDue";

/*
 * Balance payments (the user, 2026-10-11): the next payment a student makes on
 * a course Delta finance sold them, recorded by their CS on the Balance
 * payments page with its receipt. Delta finance accounts approve it — a Tetra
 * Commission request of type ENROLMENT_PAYMENT in their Tetra Deposits /
 * Approvals queue, through the same signed door deposits and course upgrade
 * payments use — and approving it records the payment on the invoice there.
 * The decision comes back to /funding-decisions (finance/funding.ts hands it
 * here when the id is not a funding request or a course upgrade payment), and
 * the invoice's new paid / balance / next due date follows as a fee update
 * (finance/feeUpdates.ts). Nothing here changes the balance itself.
 *
 *   enrolment_payments { student_id, invoice_id, invoice_number, course, currency, amount_minor, method, paid_on,
 *                        receipt_url, receipt_name, note, balance_minor_then,
 *                        status: pending | approved | rejected,
 *                        finance_approval: { state: queued | sent | decided | refused, attempts, next_attempt_at, … },
 *                        approved_amount_minor?, transaction_id?, reason?, decided_by_name?, decided_at?,
 *                        recorded_by, recorded_by_name, recorded_by_email, recorded_at }
 */

export const ENROLMENT_PAYMENTS = "enrolment_payments";
const BATCH = 20;

/** What finance is shown: the payment, the invoice it is for, the student, and who recorded it. */
async function payload(p: any) {
  const s: any = await col("students").findOne({ _id: new ObjectId(p.student_id) }, {
    projection: { full_name: 1, student_code: 1, email: 1, student_level: 1, team_name: 1, primary_mentor_name: 1 },
  });
  const receiptUrl = /^https?:\/\//i.test(String(p.receipt_url ?? "")) ? String(p.receipt_url).slice(0, 1000) : "";
  const cs = { name: String(p.recorded_by_name ?? ""), email: String(p.recorded_by_email ?? "") };
  return {
    externalId: String(p._id),
    type: "ENROLMENT_PAYMENT",
    amountMinor: p.amount_minor,
    currency: p.currency,
    invoiceId: p.invoice_id,
    invoiceNumber: p.invoice_number ?? "",
    course: p.course ?? "",
    method: p.method,
    paidOn: p.paid_on,
    receiptUrl,
    receiptName: String(p.receipt_name ?? "").slice(0, 200),
    cs,
    // The same, together — and in the fields every request already has, for the queue's columns.
    enrolmentPayment: {
      invoiceId: p.invoice_id, invoiceNumber: p.invoice_number ?? "", course: p.course ?? "", amountMinor: p.amount_minor,
      currency: p.currency, method: p.method, paidOn: p.paid_on, receiptUrl, receiptName: String(p.receipt_name ?? "").slice(0, 200),
      balanceMinor: Number(p.balance_minor_then) || 0, cs,
    },
    student: {
      id: p.student_id, code: String(s?.student_code ?? ""), name: String(s?.full_name || "Student"),
      email: String(s?.email ?? ""), level: String(s?.student_level ?? ""),
    },
    team: String(s?.team_name ?? ""),
    paymentMethod: p.method,
    screenshotUrl: receiptUrl,
    notes: [
      `Balance payment on ${p.course || "a course"}${p.invoice_number ? ` — invoice ${p.invoice_number}` : ""}`,
      `Paid on ${p.paid_on}`,
      `Balance before it ${moneyText(p.balance_minor_then, p.currency)}`,
      p.note ?? "",
    ].filter(Boolean).join(" · ").slice(0, 2000),
    requestedAt: p.recorded_at,
    requestedBy: cs.name,
    primaryMentor: String(s?.primary_mentor_name ?? ""),
  };
}

async function sendOne(p: any): Promise<void> {
  const now = new Date().toISOString();
  const attempts = (p.finance_approval?.attempts ?? 0) + 1;
  const stillQueued = { _id: p._id, status: "pending", "finance_approval.state": "queued" };
  try {
    const result = await postToFinance(FINANCE_INTAKE_PATH, await payload(p));
    await col(ENROLMENT_PAYMENTS).updateOne(stillQueued, {
      $set: { "finance_approval.state": "sent", "finance_approval.sent_at": now, "finance_approval.request_id": String(result?.id ?? ""), "finance_approval.attempts": attempts, "finance_approval.last_error": null },
    });
  } catch (err) {
    const message = (err as Error).message || "Delta Finance could not be reached";
    if (err instanceof FinancePermanentError) {
      // Finance will not take it as sent (more than the balance, the invoice not open…): the CS sees why and records it again.
      const res = await col(ENROLMENT_PAYMENTS).updateOne(stillQueued, {
        $set: { status: "rejected", reason: `Delta Finance did not accept it: ${message}`, decided_at: now, "finance_approval.state": "refused", "finance_approval.last_error": message, "finance_approval.attempts": attempts },
      });
      if (res.modifiedCount) await tellCs(p, false, `Delta Finance did not accept it: ${message}`);
      return;
    }
    await col(ENROLMENT_PAYMENTS).updateOne(stillQueued, {
      $set: { "finance_approval.attempts": attempts, "finance_approval.last_attempt_at": now, "finance_approval.next_attempt_at": new Date(Date.now() + backoffMs(attempts)).toISOString(), "finance_approval.last_error": message },
    });
  }
}

/** Sends whatever is due — on the finance funding worker's beat (finance/funding.ts runPass). */
export async function sendDueEnrolmentPayments(): Promise<number> {
  if (!financeFundingConfigured()) return 0;
  const due = (await col(ENROLMENT_PAYMENTS)
    .find({ status: "pending", "finance_approval.state": "queued", "finance_approval.next_attempt_at": { $lte: new Date().toISOString() } })
    .sort({ "finance_approval.next_attempt_at": 1 })
    .limit(BATCH)
    .toArray()) as any[];
  for (const p of due) await sendOne(p);
  return due.length;
}

/** Record a payment, queued for finance. Validated by the caller (functions/balancePayments.ts). */
export async function queueEnrolmentPayment(doc: Record<string, unknown>): Promise<string> {
  const now = new Date().toISOString();
  const ins = await col(ENROLMENT_PAYMENTS).insertOne({
    ...doc,
    status: "pending",
    finance_approval: { state: "queued", queued_at: now, attempts: 0, next_attempt_at: now },
    recorded_at: now,
  } as any);
  kickFinanceFunding();
  return String(ins.insertedId);
}

/** The CS who recorded it hears the outcome — the bell and a push. Never throws. */
async function tellCs(p: any, approved: boolean, why: string): Promise<void> {
  if (!p.recorded_by) return;
  const s: any = await col("students").findOne({ _id: new ObjectId(p.student_id) }, { projection: { full_name: 1, student_code: 1 } }).catch(() => null);
  const name = String(s?.full_name ?? "").trim() || s?.student_code || "a student";
  await notify([String(p.recorded_by)], {
    type: approved ? "balance_payment_approved" : "balance_payment_rejected",
    title: approved ? `Payment approved: ${name}` : `Payment turned down: ${name}`,
    body: approved
      ? `${moneyText(p.amount_minor, p.currency)} on ${p.course || "their course"} — Delta Finance recorded it; the balance updates shortly.`
      : `${moneyText(p.amount_minor, p.currency)} on ${p.course || "their course"} — ${why}`,
    link: `/StudentDetail?id=${p.student_id}&tab=courses`,
    tag: `balance-payment-${String(p._id)}`,
  });
}

/**
 * Finance's decision on a balance payment, handed over by handleFundingDecision when the id is neither a funding
 * request nor a course upgrade payment. Null when it is not one of these either (the caller answers 410). Safe to
 * repeat: the same decision again is finance retrying.
 */
export async function decideEnrolmentPayment(
  oid: ObjectId,
  d: { decision: string; byName: string; byEmail: string; at: string; note: string; reason: string; transactionId: string; amountMinor: number },
): Promise<Response | null> {
  const p: any = await col(ENROLMENT_PAYMENTS).findOne({ _id: oid });
  if (!p) return null;
  if (p.status === "approved" || p.status === "rejected") {
    if (p.status === d.decision && p.finance_approval?.state === "decided") return ok({ fundingId: String(p._id), status: p.status, already: true });
    return refuse(409, "ALREADY_DECIDED", `Already ${p.status} in Tetra Commission`);
  }
  const approved = d.decision === "approved";
  const set: Record<string, unknown> = {
    status: approved ? "approved" : "rejected",
    decided_by_name: `${d.byName} (Delta Finance)`,
    decided_by_email: d.byEmail,
    decided_at: d.at,
    "finance_approval.state": "decided",
    "finance_approval.decision": d.decision,
    ...(approved
      ? { approved_amount_minor: d.amountMinor, ...(d.transactionId ? { transaction_id: d.transactionId } : {}), ...(d.note ? { finance_note: d.note } : {}) }
      : { reason: d.reason }),
  };
  const res = await col(ENROLMENT_PAYMENTS).updateOne({ _id: oid, status: "pending" }, { $set: set });
  if (!res.modifiedCount) return ok({ fundingId: String(p._id), status: d.decision, already: true });

  const amount = approved ? d.amountMinor : p.amount_minor;
  const corrected = approved && d.amountMinor !== p.amount_minor ? ` (recorded as ${moneyText(p.amount_minor, p.currency)})` : "";
  await recordHistory([{
    student_id: p.student_id, at: d.at, type: "course_fees", by_id: null, by_name: `${d.byName} (Delta Finance)`,
    text: approved
      ? `Balance payment of ${moneyText(amount, p.currency)}${corrected} on ${p.course || "a course"}${p.invoice_number ? `, invoice ${p.invoice_number}` : ""} approved by Delta Finance${d.transactionId ? ` (transaction ${d.transactionId})` : ""}`
      : `Balance payment of ${moneyText(amount, p.currency)} on ${p.course || "a course"} turned down by Delta Finance: ${d.reason}`,
  }]);
  await tellCs({ ...p, amount_minor: amount }, approved, d.reason);
  return ok({ fundingId: String(p._id), status: set.status });
}
