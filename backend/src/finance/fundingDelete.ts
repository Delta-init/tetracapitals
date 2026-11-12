import { col } from "../db";
import { config } from "../config";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import { buildScopeFilter } from "../lib/scope";
import type { AuthUser } from "../auth/middleware";
import { recordHistory } from "../students/history";
import { ok, refuse, secretMatches, text } from "../students/intake";
import { FinancePermanentError, financeFundingConfigured, goesToFinance, kickFinanceFunding, postToFinance } from "./funding";
import { bonusLocationOf } from "./bonusLocation";

/* ────────────────────────────────────────────────────────────────────────────
   Deleting a funding request that never counted (the user, 2026-11-12: "delete
   the funding request when on the pending and reject time — for the CS and
   super admin and CS manager also; when deleted it will remove from the
   finance portal also"; and finance's Super Admin and Managers delete one
   there, which takes it off here).

   Who, here: a Super Admin any; a CS Manager and a CS what they see on the
   Funding Requests page (lib/scope.ts — a CS their own students', a CS
   Manager their location's). Only PENDING or REJECTED: an approved request is
   reversed by a Super Admin, as before (the master editor). A reason, always.

   Finance has it:
     still deciding it  finance is asked first and the request goes only once
                        finance has taken its copy off — so finance never
                        approves a request that is gone. Finance approved it a
                        moment earlier, or cannot be reached: not deleted, and
                        the person is told why.
     decided it         (rejected) deleted here at once; finance is told on
                        the withdrawals queue (finance/withdrawals.ts),
                        retried until it answers.
   Deleted in finance (POST /api/v1/integrations/finance/funding-deleted):
   the same, the other way — a pending or rejected request goes; an approved
   one stays and finance is told so.

   Nothing is lost: the whole request is kept in `deleted_funding_requests`
   (who, when, why, from where), a line goes on the student's history and in
   the logs. Pending and rejected requests were never credited, so no
   commission moves.
──────────────────────────────────────────────────────────────────────────── */

export const FUNDING_DELETERS = ["super_admin", "cs_manager", "cs"];
const DELETABLE = ["PENDING", "REJECTED"];
const WITHDRAWALS_PATH = "/api/v1/integrations/tetra-deposits/withdrawals";
export const DELETED_FUNDING = "deleted_funding_requests";

const money = (tx: any) => `${Number(tx?.amount_usd ?? 0).toLocaleString("en-US")} USD`;
const kind = (tx: any) => String(tx?.type ?? "request").toLowerCase();

/** Kept whole, then taken off the list; false when it changed meanwhile (nothing done). */
async function removeRequest(tx: any, by: { id: string | null; name: string; role: string; from: "cs_portal" | "finance" }, reason: string): Promise<boolean> {
  const now = new Date().toISOString();
  await col(DELETED_FUNDING).updateOne(
    { _id: tx._id },
    { $set: { doc: tx, student_id: String(tx.student_id ?? ""), student_code: String(tx.student_code ?? ""), deleted_at: now, by_id: by.id, by_name: by.name, by_role: by.role, from: by.from, reason } },
    { upsert: true },
  );
  const gone = await col("funding_transactions").deleteOne({ _id: tx._id, status: tx.status });
  if (!gone.deletedCount) {
    await col(DELETED_FUNDING).deleteOne({ _id: tx._id });
    return false;
  }
  const where = by.from === "finance" ? " in Delta Finance" : "";
  if (tx.student_id) {
    await recordHistory([{
      student_id: String(tx.student_id), at: now, type: "funding_deleted", by_id: by.id, by_name: by.name,
      text: `${by.name} deleted a ${String(tx.status).toLowerCase()} ${kind(tx)} request of ${money(tx)}${where}: ${reason}`,
      from: { type: tx.type, status: tx.status, amount_usd: tx.amount_usd },
    }]);
  }
  await col("logs").insertOne({
    timestamp: now, user_id: by.id, user_name: by.name, user_role: by.role,
    action_type: "delete_funding_request", entity_type: "FundingTransaction", entity_id: String(tx._id),
    details: JSON.stringify({ student: tx.student_name, student_code: tx.student_code, type: tx.type, status: tx.status, amount_usd: tx.amount_usd, reason, from: by.from }),
    success: true, created_date: now,
  } as any);
  return true;
}

/** Which finance organization has it: the one it was sent to, else where its team is. */
async function financeOrgFor(tx: any): Promise<string> {
  const org = tx.finance_approval?.org;
  if (org === "bangalore") return config.financeOrgIdBangalore;
  if (org === "delta_hq") return config.financeOrgId;
  return (await bonusLocationOf(tx)) === "bangalore" ? config.financeOrgIdBangalore : config.financeOrgId;
}

/** Finance had it and decided it (or it was rejected here after): told to take its copy off, in the background. */
async function queueFinanceRemoval(tx: any, byName: string, reason: string): Promise<void> {
  const now = new Date().toISOString();
  await col("finance_withdrawals").updateOne(
    { _id: String(tx._id) as any },
    {
      $setOnInsert: {
        funding_id: String(tx._id), student_name: String(tx.student_name ?? ""), student_code: String(tx.student_code ?? ""),
        product: String(tx.course_payment?.product ?? ""), amount_aed: Number(tx.course_payment?.paid_today_aed ?? tx.amount_aed ?? 0),
        org: tx.finance_approval?.org === "bangalore" ? "bangalore" : "delta_hq", queued_at: now,
      },
      $set: { state: "queued", why: "deleted", removal: true, by_name: byName, reason: reason.slice(0, 500), attempts: 0, next_attempt_at: now, last_error: null },
    },
    { upsert: true },
  );
  kickFinanceFunding();
}

/** A CS's own: raised by them or for them, or for a student whose CS (or a Common CS) they are. */
async function csOwns(tx: any, userId: string): Promise<boolean> {
  if ([tx.primary_mentor_id, tx.initiating_mentor_id, tx.requested_by_id, tx.created_by].map((v) => String(v ?? "")).includes(userId)) return true;
  const sid = toObjectId(String(tx.student_id ?? ""));
  if (!sid) return false;
  return !!(await col("students").findOne({ _id: sid, $or: [{ primary_mentor_id: userId }, { "common_cs.id": userId }] }, { projection: { _id: 1 } }));
}

type Outcome = { status: number; message: string } | null;

/**
 * Finance is still deciding it: its copy comes off first. null = gone there (or it never had it) — go ahead;
 * otherwise why not, and the request is left as it was.
 */
async function takeOffFinanceFirst(tx: any, byName: string, reason: string): Promise<Outcome> {
  const state = tx.finance_approval?.state;
  // Held while finance is asked, so the sender does not send it meanwhile (it sends only "queued" ones).
  const held = await col("funding_transactions").updateOne(
    { _id: tx._id, status: "PENDING", "finance_approval.state": state },
    { $set: { "finance_approval.state": "removing", "finance_approval.removing_from": state } },
  );
  if (!held.matchedCount) return { status: 409, message: "It changed meanwhile — open it again" };
  const putBack = () => col("funding_transactions").updateOne(
    { _id: tx._id, "finance_approval.state": "removing" },
    { $set: { "finance_approval.state": state }, $unset: { "finance_approval.removing_from": "" } },
  );
  try {
    const orgId = await financeOrgFor(tx);
    if (!orgId) throw new Error("The finance organization is not set on the CS Portal server");
    const result = await postToFinance(WITHDRAWALS_PATH, { externalId: String(tx._id), byName, reason, deleted: true, expect: ["pending", "rejected"] }, orgId);
    const outcome = String(result?.outcome ?? "");
    if (["removed", "already", "unknown"].includes(outcome)) return null;
    await putBack();
    if (outcome === "decided") return { status: 409, message: String(result?.message || "Delta Finance decided it a moment ago — open it again") };
    // An older finance, which does not take a pending request off yet.
    return { status: 503, message: "Delta Finance cannot take a pending request off yet — it is rejected there for now" };
  } catch (err) {
    await putBack();
    if (err instanceof FinancePermanentError) return { status: 409, message: `Delta Finance would not take it off: ${(err as Error).message}` };
    return { status: 503, message: "Delta Finance could not be reached just now — try again in a minute" };
  }
}

/**
 * POST /api/functions/deleteFundingRequest { id, reason }
 * A pending or rejected request, by a Super Admin, a CS Manager or a CS (what they can see).
 */
export async function deleteFundingRequest(req: Request, caller: AuthUser): Promise<Response> {
  if (!FUNDING_DELETERS.includes(caller.app_role)) return forbidden("A funding request is deleted by its CS, a CS Manager or a Super Admin");
  const body: any = await req.json().catch(() => null);
  const oid = toObjectId(String(body?.id ?? ""));
  if (!oid) return error("id required", 400);
  const reason = String(body?.reason ?? "").trim().slice(0, 500);
  if (reason.length < 3) return error("Say why it is deleted (3 letters or more)", 400);

  const scope = caller.app_role === "super_admin" ? null : await buildScopeFilter(caller, "FundingTransaction");
  const tx: any = await col("funding_transactions").findOne(scope ? { $and: [{ _id: oid }, scope] } : { _id: oid });
  if (!tx) return notFound("Funding request not found");
  // A CS: their own students' requests, whatever their role's configured reach (the user, 2026-11-12) — raised by them
  // or for them, or the student's CS (or a Common CS) is them.
  if (caller.app_role === "cs" && !(await csOwns(tx, caller.id))) return notFound("Funding request not found");
  if (!DELETABLE.includes(String(tx.status))) {
    return error(`Only a pending or rejected request is deleted — this one is ${String(tx.status).toLowerCase()}`, 409);
  }
  if (tx.finance_approval?.state === "removing") return error("It is being deleted already", 409);
  const byName = caller.full_name || caller.email || "";

  const financeDeciding = tx.status === "PENDING" && goesToFinance(tx)
    && (tx.finance_approval?.state === "sent" || (tx.finance_approval?.state === "queued" && financeFundingConfigured()));
  if (financeDeciding) {
    const refused = await takeOffFinanceFirst(tx, byName, reason);
    if (refused) return error(refused.message, refused.status);
  }

  const done = await removeRequest(tx, { id: caller.id, name: byName, role: caller.app_role, from: "cs_portal" }, reason);
  if (!done) return error("It changed meanwhile — open it again", 409);

  // Finance decided it (rejected): its copy comes off too — unless it is being taken off already.
  const financeHasDecided = tx.finance_approval?.state === "decided" && !tx.finance_withdrawal;
  if (financeHasDecided && financeFundingConfigured()) await queueFinanceRemoval(tx, byName, reason);
  return json({
    ok: true,
    finance: financeDeciding ? "removed" : financeHasDecided ? "queued" : "none",
  });
}

/**
 * POST /api/v1/integrations/finance/funding-deleted { fundingId, byName, reason }, x-finance-secret.
 * A pending or rejected request deleted in Delta Finance by a Super Admin or a Manager: taken off here too.
 */
export async function handleFinanceFundingDeleted(req: Request): Promise<Response> {
  if (!config.financeS2sSecret) return refuse(503, "INTEGRATION_DISABLED", "The Delta finance link is not configured on this server");
  if (!secretMatches(req.headers.get("x-finance-secret"), config.financeS2sSecret)) return refuse(401, "UNAUTHORISED", "Bad secret");
  const body = (await req.json().catch(() => null)) as Record<string, any> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return refuse(400, "VALIDATION_ERROR", "Body must be a JSON object");
  const oid = toObjectId(text(body.fundingId, 40));
  if (!oid) return refuse(400, "VALIDATION_ERROR", "fundingId is required");
  const who = text(body.byName, 120) || "Delta Finance";
  const reason = text(body.reason, 500) || "Deleted in Delta Finance";

  const tx: any = await col("funding_transactions").findOne({ _id: oid });
  if (!tx) {
    const before = await col(DELETED_FUNDING).findOne({ _id: oid });
    return ok({ outcome: before ? "already" : "unknown", message: before ? "Deleted in CS Portal already" : "CS Portal has no such request" });
  }
  if (!DELETABLE.includes(String(tx.status))) {
    return ok({ outcome: "kept", message: `It is ${String(tx.status).toLowerCase()} in CS Portal — not deleted there` });
  }
  const done = await removeRequest(tx, { id: null, name: `${who} (Delta Finance)`, role: "finance", from: "finance" }, reason);
  if (!done) return refuse(409, "CHANGED", "It changed meanwhile in CS Portal — try again");
  console.log(`[finance funding] ${kind(tx)} ${tx._id} (${tx.student_name ?? "?"}) deleted in Delta Finance by ${who}`);
  return ok({ outcome: "deleted", message: "Deleted in CS Portal too" });
}
