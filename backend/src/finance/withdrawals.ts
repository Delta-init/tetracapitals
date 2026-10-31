import { col } from "../db";
import { config } from "../config";
import { toObjectId } from "../lib/id";
import { backoffMs, financeFundingConfigured, FinancePermanentError, goesToFinance, kickFinanceFunding, postToFinance } from "./funding";

/* ────────────────────────────────────────────────────────────────────────────
   A payment finance approved, then not counted here (the user, 2026-10-31:
   one AED 2,000 payment was raised three times; finance approved all three,
   a broker admin rejected two as repeats — and finance kept all three on the
   invoice, so its Collected was AED 4,000 over the portal's).

   Finance records a course payment on its invoice when it approves it
   (finance/funding.ts — the first of the two approvals). Rejected or
   cancelled here after that, or deleted, it is no payment: finance is told to
   take it back off (finance-delta POST /integrations/tetra-deposits/
   withdrawals), on the same signed link and the same beat as the requests
   themselves, tried again until finance answers. Sent back to the CS for
   correction it is still PENDING, and nothing is sent.

   `finance_withdrawals`, one per request (its id):
     state  queued   to be sent (retried with backoff)
            done     finance took it off (or never had it, or had already)
            kept     finance kept it — a bank line reconciled against it; an
                     accountant takes it off there by hand
            refused  finance would not take the message (malformed)
   The request, while it exists, carries the same as `finance_withdrawal`.
──────────────────────────────────────────────────────────────────────────── */

const PATH = "/api/v1/integrations/tetra-deposits/withdrawals";
const GONE = ["REJECTED", "CANCELLED"];
const BATCH = 20;

/** Finance approved it, so its payment is on a finance invoice. */
export const financeRecorded = (tx: any): boolean =>
  goesToFinance(tx) && tx?.finance_approval?.state === "decided" && tx?.finance_approval?.decision === "approved";

/** Counted until now and not any more: rejected or cancelled here — or deleted (`after` null). */
export function stoppedCounting(before: any, after: any | null): boolean {
  if (!financeRecorded(before)) return false;
  if (!after) return !GONE.includes(String(before.status));
  return !GONE.includes(String(before.status)) && GONE.includes(String(after.status));
}

/** Finance is told to take the payment off — queued, sent on the next beat. Safe to call again. */
export async function queueWithdrawal(tx: any, byName: string, reason: string, why: "rejected" | "cancelled" | "deleted"): Promise<void> {
  const now = new Date().toISOString();
  await col("finance_withdrawals").updateOne(
    { _id: String(tx._id) as any },
    {
      $setOnInsert: {
        funding_id: String(tx._id), student_name: String(tx.student_name ?? ""), student_code: String(tx.student_code ?? ""),
        product: String(tx.course_payment?.product ?? ""), amount_aed: Number(tx.course_payment?.paid_today_aed ?? tx.amount_aed ?? 0),
        org: tx.finance_approval?.org === "bangalore" ? "bangalore" : "delta_hq", queued_at: now,
      },
      $set: { state: "queued", why, by_name: byName, reason: reason.slice(0, 500), attempts: 0, next_attempt_at: now, last_error: null },
    },
    { upsert: true },
  );
  await col("funding_transactions").updateOne({ _id: tx._id }, { $set: { finance_withdrawal: { state: "queued", at: now } } });
  kickFinanceFunding();
}

/** After a request changed (or was deleted — `after` null): finance is told if it stopped counting. Never throws. */
export async function afterFundingChange(before: any, after: any | null, byName: string): Promise<void> {
  try {
    if (!stoppedCounting(before, after)) return;
    const why = !after ? "deleted" : after.status === "CANCELLED" ? "cancelled" : "rejected";
    await queueWithdrawal(after ?? before, byName, String(after?.rejection_reason ?? ""), why);
  } catch (err) {
    console.error("[finance withdrawals] could not queue", { id: String(before?._id), err });
  }
}

async function settle(w: any, set: Record<string, unknown>): Promise<void> {
  await col("finance_withdrawals").updateOne({ _id: w._id, state: "queued" }, { $set: set });
  if (set.state && set.state !== "queued") {
    const oid = toObjectId(String(w.funding_id));
    if (oid) {
      await col("funding_transactions").updateOne({ _id: oid }, {
        $set: { finance_withdrawal: { state: set.state, at: new Date().toISOString(), message: String(set.message ?? "") } },
      });
    }
  }
}

async function sendOne(w: any): Promise<void> {
  const attempts = (w.attempts ?? 0) + 1;
  const later = (message: string) => settle(w, {
    attempts, last_error: message, last_attempt_at: new Date().toISOString(),
    next_attempt_at: new Date(Date.now() + backoffMs(attempts)).toISOString(),
  });
  const orgId = w.org === "bangalore" ? config.financeOrgIdBangalore : config.financeOrgId;
  if (!orgId) return later(`${w.org === "bangalore" ? "FINANCE_ORG_ID_BANGALORE" : "FINANCE_ORG_ID"} is not set on the CS Portal server`);
  try {
    const result = await postToFinance(PATH, { externalId: String(w.funding_id), byName: String(w.by_name ?? ""), reason: String(w.reason ?? "") }, orgId);
    const outcome = String(result?.outcome ?? "");
    const message = String(result?.message ?? "");
    if (outcome === "pending") return later(message || "Being decided in finance again");
    const state = outcome === "kept" ? "kept" : "done";
    await settle(w, { state, outcome, message, attempts, done_at: new Date().toISOString(), last_error: null });
    console.log(`[finance withdrawals] ${w.funding_id} (${w.student_name}): ${outcome}${message ? ` — ${message}` : ""}`);
  } catch (err) {
    const message = (err as Error).message || "Delta Finance could not be reached";
    if (err instanceof FinancePermanentError) {
      await settle(w, { state: "refused", message, attempts, last_error: message });
      console.warn(`[finance withdrawals] Delta Finance will not take ${w.funding_id}: ${message}`);
      return;
    }
    await later(message);
  }
}

/** Sends whatever is due. Exported for the tests; the finance worker's pass calls it (finance/funding.ts). */
export async function sendDueWithdrawals(): Promise<number> {
  if (!financeFundingConfigured()) return 0;
  const due = await col("finance_withdrawals")
    .find({ state: "queued", next_attempt_at: { $lte: new Date().toISOString() } })
    .sort({ next_attempt_at: 1 })
    .limit(BATCH)
    .toArray();
  for (const w of due) await sendOne(w);
  return due.length;
}
