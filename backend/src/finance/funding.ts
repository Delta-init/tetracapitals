import { createHash, createHmac, randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { col } from "../db";
import { config } from "../config";
import { toObjectId } from "../lib/id";
import { ok, refuse, secretMatches, text } from "../students/intake";
import { recordHistory } from "../students/history";
import { creditCommissionFor } from "../functions/creditCommission";
import { recomputeCoMentorContribution } from "../functions/referrals";
import { notify } from "../lib/notify";

/* ────────────────────────────────────────────────────────────────────────────
   Deposit and bonus requests are approved in Delta finance.

   Every new DEPOSIT request is sent to finance's approvals the moment it is
   raised — signed, through the same door the sales CRM and Media ERP use —
   and the accountants approve or reject it there. So is every new BONUS (a
   course payment), but for a bonus finance's approval is the first of two
   (the user, 2026-10-04): it confirms the money, and the bonus then waits for
   a broker admin or a Super Admin here to credit it and approve
   (awaitingBroker, bonusRefusal below). A sales-close bonus credit
   (`bonus_credit`) skips finance — finance approved it with the enrolment —
   and waits for them straight away. Finance sends the decision
   back to POST /api/v1/integrations/finance/funding-decisions
   (x-finance-secret, as for new students), and only then does it change here:
   approved with everything Tetra Commission's own approval does — commission
   credited up the chain, a Level 1 student's first deposit moving them to
   Level 2, co-mentor contributions, the audit log — or rejected with the
   accountant's reason.

   New requests only. A request raised before the link was configured carries
   no `finance_approval` and is approved here, as before; so are withdrawals.
   While finance has a request, nobody here can approve, reject, delete or
   change what is being approved (crud.ts and the master editor refuse). One
   finance will not take at all — malformed — is handed back and approved here
   (a bonus by a broker admin or a Super Admin).

   `finance_approval` on the funding transaction, the server's alone:
     state  queued   waiting to be sent (retried until finance takes it)
            sent     with finance, waiting for a decision
            decided  finance's decision is recorded here
            refused  finance would not take it; decided here instead
──────────────────────────────────────────────────────────────────────────── */

const INTAKE_PATH = "/api/v1/integrations/tetra-deposits";
/** Course upgrade payments go to the same door, as type COURSE_UPGRADE (courses/coursePayments.ts). */
export const FINANCE_INTAKE_PATH = INTAKE_PATH;
const TIMEOUT_MS = 20_000;
const TICK_MS = 15_000;
const BATCH = 20;

export function financeFundingConfigured(): boolean {
  return Boolean(config.financeApiUrl && config.financeClientId && config.financeIntegrationSecret && config.financeOrgId);
}

/** The requests finance approves: deposits, and bonuses — but not a sales-close bonus credit (see above). */
export const goesToFinance = (doc: any): boolean => doc?.type === "DEPOSIT" || (doc?.type === "BONUS" && !doc?.bonus_credit);

/**
 * Mark a new funding request for finance, if it is one that goes there (goesToFinance), raised PENDING, while the
 * link is configured. Whatever the caller sent as `finance_approval` is dropped either way. Mutates `doc`; true when
 * it was marked, so the caller can send it straight after the insert.
 */
export function stampFundingForFinance(doc: Record<string, any>): boolean {
  delete doc.finance_approval;
  if (!financeFundingConfigured()) return false;
  if (!goesToFinance(doc) || doc.status !== "PENDING") return false;
  const now = new Date().toISOString();
  doc.finance_approval = { state: "queued", queued_at: now, attempts: 0, next_attempt_at: now };
  return true;
}

/**
 * Whether finance has this request to decide, so nobody here may. One still
 * waiting to be sent counts only while the link is on: switched off, it never
 * reached finance and is decided here instead.
 */
export function withFinance(tx: any): boolean {
  if (!tx || tx.status !== "PENDING") return false;
  const state = tx.finance_approval?.state;
  return state === "sent" || (state === "queued" && financeFundingConfigured());
}

export const WITH_FINANCE_MESSAGE = "This request is with Delta Finance for approval — it is approved or rejected there";

/* ── Correct and send again (the user, 2026-10-07) ──────────────────────────
   A rejected request is corrected — every field — and sent as a new request,
   which goes the whole way again (Delta finance knows a request by its id and
   has already decided the old one). The rejected one stays, with its reason,
   and says which request it was sent again as. Once each. */

const MAY_RESEND_ANY = ["super_admin", "admin"];

/**
 * For a new request that names `resubmit_of`: the rejected request it corrects. Claims that one — its
 * `resubmitted_as` set to the new request's id, given here as `data._id` — so it is sent again only once, even
 * twice at the same instant. Mutates `data`; a refusal, or null (also when it corrects nothing).
 */
export async function claimResubmit(data: Record<string, any>, user: { id: string; app_role: string; full_name?: string; email?: string }): Promise<{ status: number; message: string } | null> {
  const from = String(data.resubmit_of ?? "").trim();
  delete data.resubmit_of;
  delete data.resubmit_reason;
  if (!from) return null;
  const oid = toObjectId(from);
  const old: any = oid ? await col("funding_transactions").findOne({ _id: oid }) : null;
  if (!old) return { status: 404, message: "The rejected request to correct wasn't found" };
  if (old.status !== "REJECTED") return { status: 409, message: "Only a rejected request can be corrected and sent again" };
  if (old.resubmitted_as) return { status: 409, message: "This request has already been corrected and sent again" };
  const theirs = [old.requested_by_id, old.initiating_mentor_id, old.created_by].map((v) => String(v ?? "")).includes(user.id);
  if (!theirs && !MAY_RESEND_ANY.includes(user.app_role)) return { status: 403, message: "Only whoever made this request, or an admin, can send it again" };
  const id = new ObjectId();
  const claimed = await col("funding_transactions").updateOne(
    { _id: old._id, status: "REJECTED", resubmitted_as: { $in: [null, ""] } },
    { $set: { resubmitted_as: String(id), resubmitted_at: new Date().toISOString(), resubmitted_by_id: user.id, resubmitted_by_name: user.full_name || user.email || "" } },
  );
  if (!claimed.modifiedCount) return { status: 409, message: "This request has already been corrected and sent again" };
  data._id = id;
  data.resubmit_of = String(oid);
  data.resubmit_reason = String(old.rejection_reason ?? "");
  return null;
}

/** The new request wasn't made after all: the rejected one may be sent again. */
export async function releaseResubmit(data: Record<string, any>): Promise<void> {
  const oid = toObjectId(String(data.resubmit_of ?? ""));
  if (oid && data._id) {
    await col("funding_transactions").updateOne({ _id: oid, resubmitted_as: String(data._id) }, { $unset: { resubmitted_as: "", resubmitted_at: "", resubmitted_by_id: "", resubmitted_by_name: "" } });
  }
}

/* ── A bonus's second approval ─────────────────────────────────────────────── */

/** Who approves a bonus here: a broker admin or a Super Admin (the user, 2026-10-04). */
export const BONUS_APPROVERS = ["broker_admin", "super_admin"];
export const BONUS_APPROVERS_MESSAGE = "A bonus is approved or rejected by a broker admin or a Super Admin";

/** A bonus finance approved, waiting for a broker admin or a Super Admin. */
export const awaitingBroker = (tx: any): boolean =>
  tx?.type === "BONUS" && tx?.status === "PENDING" && tx?.finance_approval?.state === "decided" && tx?.finance_approval?.decision === "approved";

/**
 * For a change to a bonus's status (approve or reject) here: the refusal, or null to go ahead. Only a broker admin
 * or a Super Admin decides a bonus. One finance still has is refused before this, as every request finance has is
 * (financeLock) — so a bonus is decided here once finance approved it, or straight away when it never went there.
 */
export function bonusRefusal(existing: any, data: Record<string, any>, role: string): { status: 403; message: string } | null {
  if (existing?.type !== "BONUS" || !("status" in data) || String(data.status) === String(existing.status)) return null;
  return BONUS_APPROVERS.includes(role) ? null : { status: 403, message: BONUS_APPROVERS_MESSAGE };
}

/**
 * What only the server sets on a funding request, dropped from whatever a caller sends (crud.ts): a sales-close bonus
 * credit is made by the call log (students/followups), never raised — a caller claiming one would skip finance.
 */
export function dropServerFields(doc: Record<string, any>): void {
  delete doc.bonus_credit;
  delete doc.sales_close;
}

/** A new bonus (not a sales-close credit) names the student's MT5 login and carries the payment receipt (the user, 2026-10-04). */
export function bonusMissing(doc: any): string | null {
  if (doc?.type !== "BONUS" || doc?.bonus_credit) return null;
  if (!String(doc.mt5_login ?? "").trim()) return "A bonus needs the student's MT5 login";
  if (!String(doc.screenshot_url ?? "").trim()) return "A bonus needs the payment receipt";
  // Paid in several payments (the user, 2026-10-06): each with its own receipt.
  if (Array.isArray(doc.payments) && doc.payments.some((p: any) => !String(p?.receipt_url ?? "").trim())) {
    return "Every payment of a bonus needs its receipt";
  }
  return null;
}

/** What finance is deciding: nothing here may change these while it has the request. */
const LOCKED = ["status", "amount_usd", "type", "student_id"] as const;

/**
 * For an update to a funding request. Drops `finance_approval` from what the
 * caller sent, and refuses a change to what finance is deciding while finance
 * has it. The message to answer with, or null to go ahead.
 */
export function financeLock(existing: any, data: Record<string, any>): string | null {
  delete data.finance_approval;
  if (!withFinance(existing)) return null;
  const differs = (f: (typeof LOCKED)[number]) =>
    f === "amount_usd" ? Number(data[f]) !== Number(existing[f]) : String(data[f] ?? "") !== String(existing[f] ?? "");
  return LOCKED.some((f) => f in data && differs(f)) ? WITH_FINANCE_MESSAGE : null;
}

/* ── Sending ─────────────────────────────────────────────────────────────── */

/** Finance will never take it as it is. Everything else is waited out. */
export class FinancePermanentError extends Error {}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * A signed POST to finance's integration API, in the scheme its
 * middleware/service-auth.ts checks and the sales CRM's financeClient.ts sends:
 * METHOD \n PATH \n TIMESTAMP \n NONCE \n sha256(body), HMAC-SHA256.
 */
export async function postToFinance(path: string, payload: unknown): Promise<any> {
  const raw = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const signature = createHmac("sha256", config.financeIntegrationSecret)
    .update(["POST", path, timestamp, nonce, sha256(raw)].join("\n"))
    .digest("hex");
  const res = await fetch(`${config.financeApiUrl.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-delta-client": config.financeClientId,
      "x-delta-timestamp": timestamp,
      "x-delta-nonce": nonce,
      "x-delta-signature": signature,
      "x-delta-org": config.financeOrgId,
    },
    body: raw,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body: any = await res.json().catch(() => ({}));
  if (res.ok) return body?.data ?? {};
  const message = String(body?.error?.message ?? body?.message ?? `Delta Finance answered ${res.status}`);
  // A malformed request stays malformed. A bad signature, a finance not
  // deployed yet (404) or switched off (503), a timeout: each comes right when
  // somebody fixes it, and the deposit waits for that rather than being lost.
  if ([400, 409, 422].includes(res.status)) throw new FinancePermanentError(message);
  throw new Error(message);
}

/** A bonus's course payment, as the accountants see it (FundingRequestForm's course_payment). */
function coursePaymentOf(cp: any) {
  if (!cp || typeof cp !== "object") return undefined;
  const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    product: String(cp.product ?? "").trim().slice(0, 160),
    kind: cp.kind === "full" || cp.kind === "partial" ? cp.kind : "",
    withBonus: cp.with_bonus === true,
    bonusUsd: num(cp.bonus_usd),
    holdAed: num(cp.hold_aed),
    balanceAed: num(cp.balance_aed),
    paidTodayAed: num(cp.paid_today_aed),
    paidBeforeAed: num(cp.paid_before_aed ?? cp.before_aed),
    price: num(cp.price),
    priceCurrency: /^[A-Za-z]{3}$/.test(String(cp.price_currency ?? "")) ? String(cp.price_currency).toUpperCase() : "",
  };
}

/** Finance's limit on a request's notes (its tetra-deposit schema) — longer, and it refuses the request for good. */
const NOTES_MAX = 2000;
const twoPlaces = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A payment's collected_on (2026-10-05) as "05 Oct 2026" — "" for one from before the date was asked (the user, 2026-10-07). */
function collectedOn(p: any): string {
  const day = String(p?.collected_on ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const [y, m, d] = day.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  // A day that isn't one (2026-13-45) would roll over into another: left out instead.
  if (at.toISOString().slice(0, 10) !== day) return "";
  return at.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * The notes, and — paid in several payments (the user, 2026-10-06; frontend components/funding/payments.jsx) — every
 * payment with its method, amount, the day it was collected and its receipt: finance takes one method and one receipt,
 * the first payment's. One payment: only the day it was collected is added. Within finance's 2,000 characters; the
 * payments that don't fit are counted instead.
 */
export function notesForFinance(tx: any): string {
  const notes = String(tx?.notes ?? "").trim();
  const list: any[] = Array.isArray(tx?.payments) ? tx.payments : [];
  if (list.length < 2) {
    const on = list.length ? collectedOn(list[0]) : "";
    if (!on) return notes.slice(0, NOTES_MAX);
    const line = `Collected on ${on}`;
    return notes ? `${notes.slice(0, NOTES_MAX - line.length - 2)}\n\n${line}` : line;
  }
  const lines = list.map((p, i) => {
    const currency = /^[A-Z]{3}$/.test(String(p?.currency ?? "")) ? `${p.currency} ` : "";
    const receipt = /^https?:\/\//i.test(String(p?.receipt_url ?? "")) ? String(p.receipt_url) : "no receipt";
    const on = collectedOn(p);
    return `${i + 1}. ${String(p?.method ?? "").trim().slice(0, 60) || "Payment"} · ${currency}${twoPlaces(Number(p?.amount) || 0)}${on ? ` · collected ${on}` : ""} · ${receipt}`;
  });
  const more = (n: number) => `\n… and ${n} more — every receipt is on the request in Tetra Commission`;
  let out = [notes, `Paid in ${list.length} payments:`].filter(Boolean).join("\n\n");
  for (const [i, line] of lines.entries()) {
    const after = lines.length - i - 1;
    // This one, with room left to say how many didn't fit — the last needs no such room.
    if ((out + "\n" + line + (after ? more(after) : "")).length <= NOTES_MAX) out += `\n${line}`;
    else return (out + more(lines.length - i)).slice(0, NOTES_MAX);
  }
  return out.slice(0, NOTES_MAX);
}

/**
 * The same payments as a list, for finance to show each with its receipt (finance-delta's tetraDepositPaymentSchema):
 * in cents of the currency typed. Only when every one is well formed — none at all rather than one that finance would
 * refuse the request for; the notes say them all either way.
 */
export function paymentsForFinance(tx: any): Array<{ method: string; amountMinor: number; currency: string; receiptUrl: string; receiptName: string }> {
  const list: any[] = Array.isArray(tx?.payments) ? tx.payments : [];
  if (list.length < 2 || list.length > 10) return [];
  const out = list.map((p) => {
    const url = String(p?.receipt_url ?? "");
    return {
      method: String(p?.method ?? "").trim(),
      amountMinor: Math.round((Number(p?.amount) || 0) * 100),
      currency: String(p?.currency ?? "").toUpperCase(),
      receiptUrl: /^https?:\/\//i.test(url) && url.length <= 1000 ? url : "",
      receiptName: String(p?.receipt_name ?? "").trim().slice(0, 200),
    };
  });
  return out.every((p) => p.method && p.method.length <= 60 && p.amountMinor > 0 && /^[A-Z]{3}$/.test(p.currency)) ? out : [];
}

/** What the accountants see: the request, the student, and the proof. */
async function depositPayload(tx: any) {
  const sid = tx.student_id ? toObjectId(String(tx.student_id)) : null;
  const student: any = sid
    ? await col("students").findOne({ _id: sid }, { projection: { email: 1, full_name: 1, student_code: 1, student_level: 1, team_name: 1 } })
    : null;
  const accounts = tx.student_id
    ? await col("mt5_accounts").find({ student_id: String(tx.student_id) }).project({ mt5_login: 1, platform: 1 }).limit(20).toArray()
    : [];
  return {
    externalId: String(tx._id),
    // A bonus is a course payment: the money in, and what it earns in MT5 (coursePayment).
    type: tx.type === "BONUS" ? "BONUS" : "DEPOSIT",
    amountMinor: Math.round(Number(tx.amount_usd || 0) * 100),
    currency: "USD",
    ...(Number(tx.amount_original) > 0 && /^[A-Z]{3}$/.test(String(tx.amount_currency ?? ""))
      ? { amountOriginal: Number(tx.amount_original), amountCurrency: String(tx.amount_currency) }
      : {}),
    ...(tx.type === "BONUS" && coursePaymentOf(tx.course_payment) ? { coursePayment: coursePaymentOf(tx.course_payment) } : {}),
    student: {
      id: String(tx.student_id ?? ""),
      code: String(tx.student_code || student?.student_code || ""),
      name: String(tx.student_name || student?.full_name || ""),
      email: String(student?.email ?? ""),
      level: String(student?.student_level ?? ""),
    },
    team: String(student?.team_name ?? ""),
    // Paid in several payments: the first one's method and receipt here, and all of them in the notes.
    paymentMethod: String(tx.payment_method ?? ""),
    mt5Login: String(tx.mt5_login ?? ""),
    mt5Accounts: accounts
      .map((a: any) => ({ login: String(a.mt5_login ?? ""), platform: String(a.platform ?? "") }))
      .filter((a) => a.login),
    screenshotUrl: String(tx.screenshot_url ?? ""),
    // …and each payment with its receipt, which finance lists on the review (the user, 2026-10-06).
    ...(paymentsForFinance(tx).length ? { payments: paymentsForFinance(tx) } : {}),
    notes: notesForFinance(tx),
    requestedAt: String(tx.requested_at || tx.created_date || new Date().toISOString()),
    requestedBy: String(tx.requested_by_name ?? ""),
    initiatingMentor: String(tx.initiating_mentor_name ?? ""),
    primaryMentor: String(tx.primary_mentor_name ?? ""),
    meetingMentor: String(tx.meeting_mentor_name ?? ""),
  };
}

/** Backs off to a quarter of an hour and stays there, still trying. */
export const backoffMs = (attempts: number) => Math.min(2 ** attempts * 1000, 15 * 60_000);

async function sendOne(tx: any): Promise<void> {
  const now = new Date().toISOString();
  const attempts = (tx.finance_approval?.attempts ?? 0) + 1;
  // Only while it is still ours to send: a decision may have come in first.
  const stillQueued = { _id: tx._id, status: "PENDING", "finance_approval.state": "queued" };
  try {
    const result = await postToFinance(INTAKE_PATH, await depositPayload(tx));
    await col("funding_transactions").updateOne(stillQueued, {
      $set: {
        "finance_approval.state": "sent",
        "finance_approval.sent_at": now,
        "finance_approval.request_id": String(result?.id ?? ""),
        "finance_approval.attempts": attempts,
        "finance_approval.last_error": null,
      },
    });
    console.log(`[finance funding] ${String(tx.type).toLowerCase()} ${tx._id} (${tx.student_name ?? "?"}, ${tx.amount_usd} USD) is with Delta Finance`);
  } catch (err) {
    const message = (err as Error).message || "Delta Finance could not be reached";
    if (err instanceof FinancePermanentError) {
      await col("funding_transactions").updateOne(stillQueued, {
        $set: {
          "finance_approval.state": "refused",
          "finance_approval.refused_at": now,
          "finance_approval.reason": message,
          "finance_approval.attempts": attempts,
          "finance_approval.last_error": message,
        },
      });
      console.warn(`[finance funding] Delta Finance will not take deposit ${tx._id}: ${message} — it is approved in Tetra Commission`);
      return;
    }
    await col("funding_transactions").updateOne(stillQueued, {
      $set: {
        "finance_approval.attempts": attempts,
        "finance_approval.last_attempt_at": now,
        "finance_approval.next_attempt_at": new Date(Date.now() + backoffMs(attempts)).toISOString(),
        "finance_approval.last_error": message,
      },
    });
    console.warn(`[finance funding] deposit ${tx._id} not sent yet (attempt ${attempts}): ${message}`);
  }
}

/** Sends whatever is due. Exported for the tests; the worker below calls it. */
export async function sendDueDeposits(): Promise<number> {
  if (!financeFundingConfigured()) return 0;
  const due = await col("funding_transactions")
    .find({
      status: "PENDING",
      "finance_approval.state": "queued",
      "finance_approval.next_attempt_at": { $lte: new Date().toISOString() },
    })
    .sort({ "finance_approval.next_attempt_at": 1 })
    .limit(BATCH)
    .toArray();
  for (const tx of due) await sendOne(tx);
  return due.length;
}

/*
 * Sent the moment a deposit is raised (kickFinanceFunding), in the background;
 * the timer is the safety net that retries whatever could not go. One pass at
 * a time: a slow finance must not have two passes sending the same requests.
 * A kick that lands mid-pass asks for one more.
 */
let started = false;
let running = false;
let again = false;

async function runPass(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      await sendDueDeposits();
      // Course upgrade payments, on the same beat (courses/coursePayments.ts).
      await (await import("../courses/coursePayments")).sendDueCoursePayments();
    } while (again);
  } catch (err) {
    console.error("[finance funding] pass failed", err);
  } finally {
    running = false;
  }
}

/** Send what was just raised now rather than on the next tick. Never throws. */
export function kickFinanceFunding(): void {
  if (!started) return;
  setImmediate(() => void runPass());
}

export function startFinanceFundingWorker(): void {
  if (!financeFundingConfigured()) {
    console.log("[finance funding] Delta Finance is not configured — deposits are approved in Tetra Commission");
    return;
  }
  started = true;
  setTimeout(() => void runPass(), 5_000);
  setInterval(() => void runPass(), TICK_MS);
  console.log("[finance funding] new deposit requests go to Delta Finance for approval");
}

/* ── The decision ────────────────────────────────────────────────────────── */

const isoOr = (v: unknown, fallback: string) => {
  const s = typeof v === "string" ? v : "";
  return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : fallback;
};
/** Ids and logins may have been imported as numbers; match either way. */
const sameIdentifier = (s: string) => (/^\d+$/.test(s) && Number.isSafeInteger(Number(s)) ? { $in: [s, Number(s)] } : s);

function outcome(tx: any, already: boolean, effects: { credited?: number; levelUpgraded?: boolean } = {}) {
  return {
    fundingId: String(tx._id),
    status: tx.status,
    amountUsd: tx.amount_usd,
    transactionId: tx.transaction_id ?? "",
    already,
    credited: effects.credited ?? 0,
    levelUpgraded: effects.levelUpgraded ?? false,
  };
}

/** One audit line per decision, however many times finance delivers it. */
async function logOnce(tx: any, action: string, message: string, byName: string, byEmail: string, newValue: unknown) {
  const now = new Date().toISOString();
  const first = await col("funding_transactions").updateOne(
    { _id: tx._id, "finance_approval.logged_at": { $exists: false } },
    { $set: { "finance_approval.logged_at": now } },
  );
  if (!first.modifiedCount) return;
  await col("logs").insertOne({
    timestamp: now,
    user_id: null,
    user_email: byEmail || null,
    user_name: `${byName} (Delta Finance)`,
    user_role: "delta_finance",
    action_type: action,
    entity_type: "FundingTransaction",
    entity_id: String(tx._id),
    details: JSON.stringify({ message }),
    old_value: null,
    new_value: JSON.stringify(newValue),
    ip_address: null,
    success: true,
    created_date: now,
  } as any);
}

/**
 * Finishing an approval is one request's job at a time: the one that recorded
 * it claims it in the same write, and a repeat takes it over only when that
 * claim has gone stale — its request died part-way. Two at once would each
 * find nothing credited yet, and credit it twice.
 */
const STALE_CLAIM_MS = 2 * 60_000;

async function claimEffects(oid: ObjectId): Promise<boolean> {
  const now = Date.now();
  const res = await col("funding_transactions").updateOne(
    {
      _id: oid,
      status: "APPROVED",
      "finance_approval.effects_at": { $exists: false },
      $or: [
        { "finance_approval.effects_claimed_at": { $exists: false } },
        { "finance_approval.effects_claimed_at": { $lt: new Date(now - STALE_CLAIM_MS).toISOString() } },
      ],
    },
    { $set: { "finance_approval.effects_claimed_at": new Date(now).toISOString() } },
  );
  return res.modifiedCount === 1;
}

/**
 * What an approval does besides the status — everything the Funding Requests
 * page does when an admin approves there. Called by whoever holds the claim.
 * Each step is safe to repeat, so a retry after a failure part-way finishes
 * the job without doing any of it twice. Throws if a step fails, letting go of
 * the claim first: the decision is recorded, and finance's retry comes back
 * here to complete it.
 */
async function applyApproval(oid: ObjectId, byName: string, byEmail: string) {
  try {
    return await approvalEffects(oid, byName, byEmail);
  } catch (err) {
    await col("funding_transactions")
      .updateOne({ _id: oid }, { $unset: { "finance_approval.effects_claimed_at": "" } })
      .catch(() => undefined);
    throw err;
  }
}

async function approvalEffects(oid: ObjectId, byName: string, byEmail: string) {
  const txs = col("funding_transactions");
  const tx: any = await txs.findOne({ _id: oid });
  if (!tx || tx.status !== "APPROVED") return { credited: 0, levelUpgraded: false };
  const now = new Date().toISOString();
  let levelUpgraded = false;

  if (tx.student_id) {
    // A Level 1 student's first approved deposit moves them to Level 2.
    const sid = toObjectId(String(tx.student_id));
    const student: any = sid ? await col("students").findOne({ _id: sid }, { projection: { student_level: 1 } }) : null;
    if (sid && student?.student_level === "LEVEL_1") {
      const earlier = await txs.countDocuments({ student_id: tx.student_id, type: "DEPOSIT", status: "APPROVED", _id: { $ne: oid } });
      if (earlier === 0) {
        const up = await col("students").updateOne(
          { _id: sid, student_level: "LEVEL_1" },
          { $set: { student_level: "LEVEL_2", updated_date: now } },
        );
        if (up.modifiedCount) {
          levelUpgraded = true;
          await recordHistory([{
            student_id: String(sid), at: now, type: "level_changed",
            text: "Level changed from Level 1 to Level 2 — first deposit approved in Delta Finance",
            by_id: null, by_name: `${byName} (Delta Finance)`, from: "LEVEL_1", to: "LEVEL_2",
          }]);
        }
      }
    }
    // Co-mentors' net deposit contributions, now that this deposit counts.
    for (const mentorId of new Set([tx.initiating_mentor_id, tx.primary_mentor_id].filter(Boolean).map(String))) {
      await recomputeCoMentorContribution(String(tx.student_id), mentorId);
    }
  }

  // Commission up the initiator's chain (never twice for one transaction).
  const credit: any = await creditCommissionFor(String(oid));
  await logOnce(
    tx, "approve_funding_transaction",
    `APPROVED transaction for ${tx.student_name ?? "a student"} — approved in Delta Finance by ${byName}`,
    byName, byEmail,
    { status: "APPROVED", amount_usd: tx.amount_usd, transaction_id: tx.transaction_id, approved_by_name: tx.approved_by_name },
  );
  await txs.updateOne(
    { _id: oid },
    { $set: { "finance_approval.effects_at": now }, $unset: { "finance_approval.effects_claimed_at": "" } },
  );
  return { credited: Number(credit?.credited ?? credit?.count ?? 0), levelUpgraded };
}

const logRejection = (tx: any, byName: string, byEmail: string) =>
  logOnce(tx, "reject_funding_transaction",
    `REJECTED transaction for ${tx.student_name ?? "a student"} — rejected in Delta Finance by ${byName}: ${tx.rejection_reason ?? ""}`,
    byName, byEmail, { status: "REJECTED", rejection_reason: tx.rejection_reason ?? "" });

/**
 * Whether a decision on `tx` is settled already — the answer to give if so,
 * null if it is finance's to decide now. The same decision again is finance
 * retrying: yes, and anything a failure left unfinished is finished. Any other
 * decision on a decided request is a conflict finance must be told about.
 */
async function settledAnswer(tx: any, decision: string, byName: string, byEmail: string): Promise<Response | null> {
  const fa = tx.finance_approval;
  if (!fa || (tx.type !== "DEPOSIT" && tx.type !== "BONUS")) {
    return refuse(409, "NOT_WITH_FINANCE", "This funding request was not sent to Delta Finance — it is decided in Tetra Commission");
  }
  // A bonus finance approved is still PENDING here — waiting for a broker admin — and decided as far as finance goes.
  if (tx.status === "PENDING" && !awaitingBroker(tx)) {
    if (fa.state === "refused") {
      return refuse(409, "NOT_WITH_FINANCE", "Delta Finance handed this request back — it is decided in Tetra Commission");
    }
    return null;
  }
  if (fa.state === "decided" && fa.decision === decision) {
    let effects = {};
    // A bonus's approval here is the broker admin's: finance's own does nothing more (handleFundingDecision).
    if (decision === "approved" && tx.type === "DEPOSIT" && !fa.effects_at) {
      // Still being finished by the request that recorded it: finance sends it again shortly.
      if (!(await claimEffects(tx._id))) return refuse(503, "IN_PROGRESS", "This decision is still being recorded — send it again shortly");
      effects = await applyApproval(tx._id, byName, byEmail);
    }
    if (decision === "rejected" && !fa.logged_at) await logRejection(tx, byName, byEmail);
    const fresh = await col("funding_transactions").findOne({ _id: tx._id });
    return ok(outcome(fresh ?? tx, true, effects));
  }
  const who = tx.approved_by_name ? ` by ${tx.approved_by_name}` : "";
  return refuse(409, "ALREADY_DECIDED", `Already ${String(tx.status).toLowerCase()} in Tetra Commission${who}`);
}

/**
 * POST /api/v1/integrations/finance/funding-decisions — the accountants'
 * decision on a deposit they were sent.
 *
 *   { fundingId, financeId, decision: "approved" | "rejected",
 *     amountMinor, transactionId, paymentMethod?, mt5Login?,   (approving)
 *     reason,                                                   (rejecting)
 *     note?, decidedBy: { name, email }, decidedAt }
 *
 * 410 when the request is no longer here, 409 when it is not finance's to
 * decide, was decided otherwise, or its transaction ID is taken — each final,
 * so finance stops sending it. 503 while the same decision, delivered a
 * moment earlier, is still being recorded — finance sends it again. Safe to
 * repeat.
 */
export async function handleFundingDecision(req: Request): Promise<Response> {
  if (!config.financeS2sSecret) return refuse(503, "INTEGRATION_DISABLED", "The Delta finance link is not configured on this server");
  if (!secretMatches(req.headers.get("x-finance-secret"), config.financeS2sSecret)) return refuse(401, "UNAUTHORISED", "Bad secret");

  const body = (await req.json().catch(() => null)) as Record<string, any> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return refuse(400, "VALIDATION_ERROR", "Body must be a JSON object");

  const oid = toObjectId(text(body.fundingId, 40));
  const decision = text(body.decision, 20);
  if (!oid) return refuse(400, "VALIDATION_ERROR", "fundingId is required");
  if (decision !== "approved" && decision !== "rejected") return refuse(400, "VALIDATION_ERROR", "decision must be approved or rejected");

  const now = new Date().toISOString();
  const byName = text(body.decidedBy?.name, 120) || "Delta Finance";
  const byEmail = text(body.decidedBy?.email, 200);
  const at = isoOr(body.decidedAt, now);
  const note = text(body.note, 1000);
  const reason = text(body.reason, 1000);
  const transactionId = text(body.transactionId, 100);
  const amountMinor = Number(body.amountMinor);
  if (decision === "approved") {
    if (!transactionId) return refuse(400, "VALIDATION_ERROR", "transactionId is required to approve");
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      return refuse(400, "VALIDATION_ERROR", "amountMinor must be a positive whole number of cents");
    }
  } else if (reason.length < 3) {
    return refuse(400, "VALIDATION_ERROR", "A reason is required to reject");
  }

  const txs = col("funding_transactions");
  const tx: any = await txs.findOne({ _id: oid });
  if (!tx) {
    // Not a funding request: a course upgrade payment, decided the same way (courses/coursePayments.ts).
    const answer = await (await import("../courses/coursePayments")).decideCoursePayment(oid, {
      decision, byName, byEmail, at, note, reason, transactionId, amountMinor,
    });
    if (answer) return answer;
    return refuse(410, "GONE", "This funding request is no longer in Tetra Commission");
  }
  const settled = await settledAnswer(tx, decision, byName, byEmail);
  if (settled) return settled;
  // A bonus finance approves stays PENDING: the second approval is a broker admin's here (awaitingBroker).
  const firstOfTwo = tx.type === "BONUS" && decision === "approved";

  const set: Record<string, unknown> = {
    ...(firstOfTwo ? {} : { approved_by_id: null, approved_by_name: `${byName} (Delta Finance)`, approved_at: at }),
    updated_date: now,
    "finance_approval.state": "decided",
    "finance_approval.decision": decision,
    "finance_approval.decided_at": at,
    "finance_approval.decided_by_name": byName,
    "finance_approval.decided_by_email": byEmail,
    "finance_approval.request_id": text(body.financeId, 40) || String(tx.finance_approval?.request_id ?? ""),
    "finance_approval.note": note,
    "finance_approval.last_error": null,
  };

  if (decision === "approved") {
    // The same check the approval dialog makes: one transaction ID, one request.
    const dup: any = await txs.findOne(
      { transaction_id: sameIdentifier(transactionId), _id: { $ne: oid } },
      { projection: { student_name: 1 } },
    );
    if (dup) {
      return refuse(409, "DUPLICATE_TRANSACTION_ID",
        `Transaction ID ${transactionId} is already used by another funding request${dup.student_name ? ` (${dup.student_name})` : ""}`);
    }
    if (!firstOfTwo) {
      set.status = "APPROVED";
      // Claimed in the same write that approves it: finishing it is this request's job.
      set["finance_approval.effects_claimed_at"] = now;
    }
    set.amount_usd = amountMinor / 100;
    set.transaction_id = transactionId;
    if (amountMinor !== Math.round(Number(tx.amount_usd || 0) * 100)) set.requested_amount_usd = tx.amount_usd;
    const paymentMethod = text(body.paymentMethod, 60);
    if (paymentMethod) set.payment_method = paymentMethod;
    const mt5Login = text(body.mt5Login, 60);
    if (mt5Login) {
      const account: any = tx.student_id
        ? await col("mt5_accounts").findOne({ student_id: String(tx.student_id), mt5_login: sameIdentifier(mt5Login) }, { projection: { _id: 1 } })
        : null;
      set.mt5_login = mt5Login;
      set.mt5_account_id = account ? String(account._id) : "";
    }
  } else {
    set.status = "REJECTED";
    set.rejection_reason = reason;
  }

  const res = await txs.updateOne({ _id: oid, status: "PENDING" }, { $set: set });
  if (!res.matchedCount) {
    // Decided between the read and the write — by this same decision arriving twice, or not.
    const raced: any = await txs.findOne({ _id: oid });
    if (!raced) return refuse(410, "GONE", "This funding request is no longer in Tetra Commission");
    return (await settledAnswer(raced, decision, byName, byEmail)) ?? refuse(409, "CONFLICT", "The decision could not be recorded — send it again");
  }

  let effects = {};
  if (firstOfTwo) await bonusToBroker(tx, byName, byEmail);
  else if (decision === "approved") effects = await applyApproval(oid, byName, byEmail);
  else await logRejection({ ...tx, rejection_reason: reason }, byName, byEmail);
  const fresh = await txs.findOne({ _id: oid });
  console.log(`[finance funding] ${String(tx.type).toLowerCase()} ${oid} ${decision} in Delta Finance by ${byName}${firstOfTwo ? " — now with the broker admins" : ""}`);
  return ok(outcome(fresh ?? tx, false, effects));
}

/**
 * Finance approved a bonus's payment: one audit line, and the broker admins and Super Admins told it is theirs to
 * credit and approve now (the bell and a push). Never throws.
 */
async function bonusToBroker(tx: any, byName: string, byEmail: string): Promise<void> {
  try {
    await logOnce(tx, "accounts_approve_bonus",
      `Bonus for ${tx.student_name ?? "a student"} approved in Delta Finance by ${byName} — waiting for a broker admin`,
      byName, byEmail, { finance_approval: "approved", amount_usd: tx.amount_usd });
    const approvers = (await col("users")
      .find({ app_role: { $in: BONUS_APPROVERS }, status: { $ne: "inactive" } }, { projection: { _id: 1 } })
      .toArray()).map((u: any) => String(u._id));
    await notify(approvers, {
      type: "bonus_to_approve",
      title: `Bonus to approve: ${tx.student_name || tx.student_code || "a student"}`,
      body: `Delta Finance approved the payment${tx.course_payment?.bonus_usd ? ` — credit the $${tx.course_payment.bonus_usd} MT5 bonus` : ""}${tx.mt5_login ? ` in ${tx.mt5_login}` : ""} and approve it.`,
      link: "/FundingRequests",
      tag: `bonus-${String(tx._id)}`,
    });
  } catch (err) {
    console.error("[finance funding] could not tell the broker admins", err instanceof Error ? err.message : err);
  }
}
