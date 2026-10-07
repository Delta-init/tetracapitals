import { ObjectId } from "mongodb";
import { col } from "../db";
import { ok, refuse } from "../students/intake";
import { recordHistory } from "../students/history";
import { financeFundingConfigured, postToFinance, FinancePermanentError, backoffMs, FINANCE_INTAKE_PATH, kickFinanceFunding } from "../finance/funding";
import { progressOf, type UpgradeQuote } from "./upgradeCalc";
import { DEFAULT_PRICE_LIST } from "./priceList";

const courseName = (u: any) => DEFAULT_PRICE_LIST.find((c) => c.code === u?.course)?.name ?? String(u?.course ?? "Course");

/*
 * Course upgrade payments (the user, 2026-10-07 — phase 3): the CS records each
 * payment of a student's upgrade with its receipt; Delta finance accounts
 * approve or reject it, on their Approvals page, as a Tetra Commission request
 * of type COURSE_UPGRADE (finance-delta's tetra-deposit module); the decision
 * comes back to the same door deposits' do (finance/funding.ts
 * handleFundingDecision, which hands it here when the id is not a deposit).
 *
 * Only approved payments count: towards the balance, the steps and the MT5
 * bonus (phase 4 raises the bonus), and an upgrade paid in full is done.
 *
 *   course_payments { upgrade_id, student_id, amount_aed, method, receipt_url, receipt_name, paid_on, note,
 *                     status: pending | approved | rejected,
 *                     finance_approval: { state: queued | sent | decided | refused, attempts, next_attempt_at, … },
 *                     approved_amount_aed?, transaction_id?, reason?, decided_by_name?, decided_at?, recorded_by… }
 */

export const PAYMENT_METHODS = ["Card", "Cash", "Bank transfer", "Payment link", "Tabby"] as const;
const BATCH = 20;

export const approvedAmounts = (payments: any[]): number[] =>
  payments.filter((p) => p.status === "approved").map((p) => Number(p.approved_amount_aed ?? p.amount_aed) || 0);

export async function paymentsOfUpgrade(upgradeId: string): Promise<any[]> {
  return (await col("course_payments").find({ upgrade_id: upgradeId }).sort({ recorded_at: 1 }).toArray()) as any[];
}

/** What finance is shown: the payment, the student, the course and where it stands. */
async function payload(p: any) {
  const u: any = await col("course_upgrades").findOne({ _id: new ObjectId(p.upgrade_id) });
  const s: any = await col("students").findOne({ _id: new ObjectId(p.student_id) }, {
    projection: { full_name: 1, student_code: 1, email: 1, level: 1, team_name: 1, primary_mentor_name: 1 },
  });
  const quote: UpgradeQuote | undefined = u?.quote;
  const before = approvedAmounts(await paymentsOfUpgrade(p.upgrade_id)).reduce((a, b) => a + b, 0);
  const progress = quote ? progressOf(quote, [before + p.amount_aed]) : null;
  const n = (await col("course_payments").countDocuments({ upgrade_id: p.upgrade_id, recorded_at: { $lte: p.recorded_at } }));
  return {
    externalId: String(p._id),
    type: "COURSE_UPGRADE",
    amountMinor: Math.round(p.amount_aed * 100),
    currency: "AED",
    coursePayment: {
      product: courseName(u),
      kind: u?.plan === "full" ? "full" : "partial",
      withBonus: (quote?.bonusUsd ?? 0) > 0,
      bonusUsd: quote?.bonusUsd ?? 0,
      holdAed: progress?.onHoldAed ?? 0,
      balanceAed: progress?.balanceAed ?? 0,
      paidTodayAed: p.amount_aed,
      paidBeforeAed: before,
      price: quote?.dueAed ?? 0,
      priceCurrency: "AED",
    },
    student: {
      id: p.student_id, code: String(s?.student_code ?? ""), name: String(s?.full_name || "Student"),
      email: String(s?.email ?? ""), level: String(s?.level ?? ""),
    },
    team: String(s?.team_name ?? ""),
    paymentMethod: p.method,
    screenshotUrl: /^https?:\/\//i.test(String(p.receipt_url ?? "")) ? String(p.receipt_url).slice(0, 1000) : "",
    notes: [
      `${courseName(u)} upgrade (${u?.plan === "full" ? "full payment" : "installments"}) — payment ${n} of ${quote?.schedule?.length ?? "?"}`,
      p.paid_on ? `Paid on ${p.paid_on}` : "",
      p.note ?? "",
    ].filter(Boolean).join(" · ").slice(0, 2000),
    requestedAt: p.recorded_at,
    requestedBy: String(p.recorded_by_name ?? ""),
    primaryMentor: String(s?.primary_mentor_name ?? ""),
  };
}

async function sendOne(p: any): Promise<void> {
  const now = new Date().toISOString();
  const attempts = (p.finance_approval?.attempts ?? 0) + 1;
  const stillQueued = { _id: p._id, status: "pending", "finance_approval.state": "queued" };
  try {
    const result = await postToFinance(FINANCE_INTAKE_PATH, await payload(p));
    await col("course_payments").updateOne(stillQueued, {
      $set: { "finance_approval.state": "sent", "finance_approval.sent_at": now, "finance_approval.request_id": String(result?.id ?? ""), "finance_approval.attempts": attempts, "finance_approval.last_error": null },
    });
  } catch (err) {
    const message = (err as Error).message || "Delta Finance could not be reached";
    if (err instanceof FinancePermanentError) {
      // Finance will not take it as sent: the CS sees why, and records it again corrected.
      await col("course_payments").updateOne(stillQueued, {
        $set: { status: "rejected", reason: `Delta Finance did not accept it: ${message}`, "finance_approval.state": "refused", "finance_approval.last_error": message, "finance_approval.attempts": attempts },
      });
      return;
    }
    await col("course_payments").updateOne(stillQueued, {
      $set: { "finance_approval.attempts": attempts, "finance_approval.last_attempt_at": now, "finance_approval.next_attempt_at": new Date(Date.now() + backoffMs(attempts)).toISOString(), "finance_approval.last_error": message },
    });
  }
}

/** Sends whatever is due — on the finance funding worker's beat (finance/funding.ts runPass). */
export async function sendDueCoursePayments(): Promise<number> {
  if (!financeFundingConfigured()) return 0;
  const due = (await col("course_payments")
    .find({ status: "pending", "finance_approval.state": "queued", "finance_approval.next_attempt_at": { $lte: new Date().toISOString() } })
    .sort({ "finance_approval.next_attempt_at": 1 })
    .limit(BATCH)
    .toArray()) as any[];
  for (const p of due) await sendOne(p);
  return due.length;
}

/** Record a payment, queued for finance. Validated by the caller (functions/courseUpgrades.ts). */
export async function queueCoursePayment(doc: Record<string, unknown>): Promise<string> {
  const now = new Date().toISOString();
  const ins = await col("course_payments").insertOne({
    ...doc,
    status: "pending",
    finance_approval: { state: "queued", queued_at: now, attempts: 0, next_attempt_at: now },
    recorded_at: now,
  } as any);
  kickFinanceFunding();
  return String(ins.insertedId);
}

/**
 * Finance's decision on a course payment, handed over by handleFundingDecision
 * when the id is not a funding request. Null when it is not a course payment
 * either (the caller answers 410). Safe to repeat: the same decision again is
 * finance retrying.
 */
export async function decideCoursePayment(
  oid: ObjectId,
  d: { decision: string; byName: string; byEmail: string; at: string; note: string; reason: string; transactionId: string; amountMinor: number },
): Promise<Response | null> {
  const p: any = await col("course_payments").findOne({ _id: oid });
  if (!p) return null;
  const decided = p.status === "approved" || p.status === "rejected";
  if (decided) {
    if (p.status === d.decision) return ok({ fundingId: String(p._id), status: p.status, already: true });
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
      ? { approved_amount_aed: d.amountMinor / 100, transaction_id: d.transactionId, ...(d.note ? { finance_note: d.note } : {}) }
      : { reason: d.reason }),
  };
  const res = await col("course_payments").updateOne({ _id: oid, status: "pending" }, { $set: set });
  if (!res.modifiedCount) return ok({ fundingId: String(p._id), status: d.decision, already: true });

  // Paid in full: the upgrade is done, and the course theirs.
  const u: any = await col("course_upgrades").findOne({ _id: new ObjectId(p.upgrade_id) });
  let done = false;
  if (u && approved) {
    const progress = progressOf(u.quote, approvedAmounts(await paymentsOfUpgrade(p.upgrade_id)));
    if (progress.done && u.status === "open") {
      await col("course_upgrades").updateOne({ _id: u._id, status: "open" }, { $set: { status: "done", done_at: d.at } });
      done = true;
    }
  }
  const aed = (n: number) => `AED ${Number(n).toLocaleString("en-US")}`;
  await recordHistory([{
    student_id: p.student_id, at: d.at, type: "course_upgrade", by_id: null, by_name: `${d.byName} (Delta Finance)`,
    text: approved
      ? `Course payment of ${aed(d.amountMinor / 100)} approved by Delta Finance (transaction ${d.transactionId})${done ? " — the upgrade is paid in full" : ""}`
      : `Course payment of ${aed(p.amount_aed)} rejected by Delta Finance: ${d.reason}`,
  }]);
  return ok({ fundingId: String(p._id), status: set.status, upgradeDone: done });
}
