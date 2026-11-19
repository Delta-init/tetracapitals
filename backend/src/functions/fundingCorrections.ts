import { ObjectId } from "mongodb";
import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import {
  BONUS_APPROVERS, FinancePermanentError, awaitingBroker, financeFundingConfigured, recheckAtFinance, recheckUpdate, usdPerInrOf, withFinance,
  type RecheckAsk,
} from "../finance/funding";
import { canWorkOn } from "../students/followups";
import { recordHistory } from "../students/history";
import { MT5_LOGIN, mt5LoginOf, mt5Owner, keepMt5 } from "../students/mt5";
import { notify } from "../lib/notify";
import { csManagerReach } from "../lib/userLocation";

/* ────────────────────────────────────────────────────────────────────────────
   Sent back for correction (the user, 2026-10-12): on MT5 Approvals a broker
   admin (or a Super Admin) who finds the student's email or the MT5 login
   wrong sends the request back to the CS instead of rejecting it — it stays
   PENDING, marked `returned` (what is wrong, a note, who, when), and leaves
   the approvers' list. The CS corrects just that — the student's email (saved
   on the student, as Edit details saves it) and/or the request's MT5 login —
   and sends it straight back to the approvers: never to finance again.
   Deposits, withdrawals and bonuses alike. Every step is in `corrections` on
   the request and in the student's history; it may go back and forth again.

   Send back to the CS, or to finance (the user, 2026-11-19: "send back to
   sales or send back to finance"). The amount and the receipt can be sent back
   too. A bonus finance approved can go to finance instead, to check its money
   again (finance/funding.ts recheckAtFinance); and a CS correcting the amount
   or the receipt of one sends it through finance again on the way back — the
   money is finance's to confirm. An email or MT5 login still goes straight
   back to the approvers.
──────────────────────────────────────────────────────────────────────────── */

export const RETURN_FIELDS = ["email", "mt5", "amount", "receipt", "other"] as const;
/** What finance is asked to check again: the money and its proof. */
export const FINANCE_FIELDS = ["amount", "receipt", "other"] as const;
const FIELD_LABEL: Record<string, string> = {
  email: "the student's email", mt5: "the MT5 login", amount: "the amount", receipt: "the receipt", other: "something else",
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const who = (u: AuthUser) => u.full_name || u.email || "somebody";
const what = (fields: string[]) => fields.map((f) => FIELD_LABEL[f] ?? f).join(" and ");
const AED_PER_USD = 3.67;
const cents = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Finance's refusal or silence, said to whoever asked — and nothing here changed. */
function financeRefused(err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  return err instanceof FinancePermanentError
    ? error(`Delta Finance didn't take it back: ${message}`, 409)
    : error(`Delta Finance can't be reached just now (${message}) — nothing was changed; try again`, 502);
}

/** A bonus finance approved and the broker admins have now: one that can go back to finance. */
const financeApproved = (tx: any) => awaitingBroker(tx) && !tx.bonus_credit && financeFundingConfigured();

/** Whom a sent-back request goes to: whoever raised it, else the student's CS. */
function csOf(tx: any, student: any): string[] {
  return [...new Set([String(tx.requested_by_id ?? ""), String(tx.initiating_mentor_id ?? ""), String(student?.primary_mentor_id ?? "")].filter(Boolean))].slice(0, 2);
}

/** Requests sent back and not corrected yet — for this person (raised by them, or their student's). */
export function returnedFilter(userId: string): Record<string, any> {
  return { status: "PENDING", "returned.at": { $exists: true }, $or: [{ requested_by_id: userId }, { initiating_mentor_id: userId }, { primary_mentor_id: userId }] };
}

/**
 * Everything waiting for this person to correct (the user, 2026-10-13): sent back by a broker admin (returnedFilter),
 * or by accounts — rejected to be corrected (finance_approval.sent_back) and not sent again yet — theirs.
 */
export function needsCorrectionFilter(userId: string): Record<string, any> {
  return { $or: [
    returnedFilter(userId),
    { status: "REJECTED", "finance_approval.sent_back": true, resubmitted_as: { $in: [null, ""] },
      $or: [{ requested_by_id: userId }, { initiating_mentor_id: userId }, { created_by: userId }] },
  ] };
}

/** Every CS's waiting to be corrected — a CS Manager's count (2026-10-13). */
export const NEEDS_CORRECTION_ALL: Record<string, any> = { $or: [
  { status: "PENDING", "returned.at": { $exists: true } },
  { status: "REJECTED", "finance_approval.sent_back": true, resubmitted_as: { $in: [null, ""] } },
] };

/**
 * POST /api/functions/sendFundingBack { id, to?: "cs" | "finance", fields: ["email" | "mt5" | "amount" | "receipt" | "other"], note }
 * — a broker admin or a Super Admin. To the CS (the default): whoever raised it corrects it. To finance (2026-11-19): a
 * bonus finance approved, its amount, its receipt or something else to check again — a note required.
 */
export async function sendFundingBack(req: Request, user: AuthUser): Promise<Response> {
  if (!BONUS_APPROVERS.includes(user.app_role)) return forbidden("Only a broker admin or a Super Admin sends a request back");
  const body: any = await req.json().catch(() => ({}));
  if (!ObjectId.isValid(String(body?.id ?? ""))) return error("id is required", 400);
  const to = body?.to === undefined || body?.to === null || body?.to === "" ? "cs" : String(body.to);
  if (to !== "cs" && to !== "finance") return error('Send it back to "cs" or to "finance"', 400);
  const allowed: readonly string[] = to === "finance" ? FINANCE_FIELDS : RETURN_FIELDS;
  const asked: string[] = (Array.isArray(body?.fields) ? body.fields : []).map((f: unknown) => String(f));
  const fields = [...new Set(asked)].filter((f) => allowed.includes(f));
  if (!fields.length) {
    return error(to === "finance"
      ? "Say what finance should check again: the amount, the receipt or something else"
      : "Say what is wrong: the email, the MT5 login, the amount, the receipt or something else", 400);
  }
  const note = String(body?.note ?? "").trim().slice(0, 500);
  if (to === "finance" && !note) return error("Tell finance in the note what to check again", 400);
  if (fields.includes("other") && !note) return error("Say what is wrong in the note", 400);
  const tx: any = await col("funding_transactions").findOne({ _id: new ObjectId(String(body.id)) });
  if (!tx) return notFound();
  if (tx.status !== "PENDING") return error(`This request is already ${String(tx.status).toLowerCase()}`, 409);
  if (withFinance(tx)) return error("Delta finance still has this request — it can be sent back once it reaches you", 409);
  if (tx.returned?.at) return error("This request is already with the CS for correction", 409);
  if (to === "finance" && !financeApproved(tx)) {
    return error(financeFundingConfigured()
      ? "Only a bonus Delta Finance approved goes back to finance — send this one to the CS"
      : "The Delta Finance link isn't set up on this server — send it to the CS", 409);
  }
  // A Bangalore team's bonus: Bangalore's broker admins' (2026-10-15).
  const elsewhere = await (await import("../finance/bonusLocation")).bonusLocationRefusal(tx, user.id, user.app_role);
  if (elsewhere) return error(elsewhere, 403);

  const now = new Date().toISOString();
  const student: any = tx.student_id && ObjectId.isValid(String(tx.student_id)) ? await col("students").findOne({ _id: new ObjectId(String(tx.student_id)) }, { projection: { primary_mentor_id: 1, full_name: 1, email: 1 } }) : null;
  if (to === "finance") return sendToFinance(tx, student, user, fields, note, now);
  // The email as it was, so the CS's correction starts from it.
  const returned = { at: now, by_id: user.id, by_name: who(user), fields, note, email: String(student?.email ?? "") };
  await col("funding_transactions").updateOne({ _id: tx._id, status: "PENDING", "returned.at": { $exists: false } }, {
    $set: { returned, updated_date: now },
    $unset: { corrected: "" },
    $push: { corrections: { kind: "sent_back", ...returned } } as any,
  });
  const kind = String(tx.type ?? "").toLowerCase();
  if (tx.student_id) {
    await recordHistory([{ student_id: String(tx.student_id), at: now, type: "funding_returned", by_id: user.id, by_name: who(user),
      text: `${tx.type} request of $${Number(tx.amount_usd || 0).toLocaleString("en-US")} sent back to the CS to correct ${what(fields)}${note ? `: ${note}` : ""}`.slice(0, 400) } as any]);
  }
  await notify(csOf(tx, student), {
    type: "funding_returned",
    title: `Correct a ${kind} request: ${String(student?.full_name ?? tx.student_name ?? "").trim() || "a student"}`,
    body: `${who(user)} sent it back — ${what(fields)} looks wrong${note ? `: ${note}` : ""}. ${
      financeApproved(tx) && fields.some((f) => f === "amount" || f === "receipt")
        ? "A new amount or receipt goes to finance again, then back for approval."
        : "Correct it and it goes straight back for approval."}`.slice(0, 300),
    link: "/MyFundingRequests",
  });
  return json({ ok: true, returned });
}

/**
 * The broker admin's "Send back to finance" (2026-11-19): finance takes it back first — its payment off the invoice,
 * pending there again — and only then is it marked here, so a refusal leaves it on MT5 Approvals as it was.
 */
async function sendToFinance(tx: any, student: any, user: AuthUser, fields: string[], note: string, now: string): Promise<Response> {
  const ask: RecheckAsk = { from: "broker_admin", by_id: user.id, by_name: who(user), fields, note };
  let sent;
  try {
    sent = await recheckAtFinance(tx, ask, now);
  } catch (err) {
    return financeRefused(err);
  }
  const update = recheckUpdate(tx, ask, now, sent);
  const res = await col("funding_transactions").updateOne(
    { _id: tx._id, status: "PENDING", "finance_approval.state": "decided", "returned.at": { $exists: false } },
    { ...update, $unset: { ...update.$unset, corrected: "" }, $push: { ...update.$push, corrections: { kind: "sent_to_finance", ...ask, at: now } } } as any,
  );
  if (!res.modifiedCount) {
    console.warn(`[funding] ${tx._id} went back to finance but changed here meanwhile — finance's next decision settles it`);
    return error("This request changed meanwhile — open the page again", 409);
  }
  if (tx.student_id) {
    await recordHistory([{ student_id: String(tx.student_id), at: now, type: "funding_returned", by_id: user.id, by_name: who(user),
      text: `${tx.type} request of $${Number(tx.amount_usd || 0).toLocaleString("en-US")} sent back to Delta Finance to check ${what(fields)} again: ${note}`.slice(0, 400) } as any]);
  }
  // Whoever raised it, so they know where it is — nothing for them to do unless finance sends it to them.
  await notify(csOf(tx, student), {
    type: "funding_returned",
    title: `With finance to check again: ${String(student?.full_name ?? tx.student_name ?? "").trim() || "a student"}'s ${String(tx.type ?? "").toLowerCase()} request`,
    body: `${who(user)} sent it to Delta Finance — ${what(fields)}: ${note}. Nothing to do unless finance sends it to you.`.slice(0, 300),
    link: "/MyFundingRequests",
  });
  return json({ ok: true, rechecking: { at: now, ...ask } });
}

/**
 * POST /api/functions/correctFundingRequest { id, email?, mt5Login?, amount?, receiptUrl?, receiptName?, note? }
 * Whoever raised it, the student's CS (or a CS they're Common with), the people above them and admins: the student's
 * email, the request's MT5 login, and (2026-11-19) its amount — in the currency it was typed in — and its receipt; then
 * straight back to the approvers. A bonus finance approved whose amount or receipt changes goes through finance again
 * first: the money is finance's to confirm (recheckAtFinance). Several payments on one request: their amounts and
 * receipts aren't changed here — the broker admin sends it to finance instead.
 */
export async function correctFundingRequest(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  if (!ObjectId.isValid(String(body?.id ?? ""))) return error("id is required", 400);
  const tx: any = await col("funding_transactions").findOne({ _id: new ObjectId(String(body.id)) });
  if (!tx) return notFound();
  if (tx.status !== "PENDING" || !tx.returned?.at) return error("This request isn't waiting for a correction", 409);
  const student: any = tx.student_id && ObjectId.isValid(String(tx.student_id)) ? await col("students").findOne({ _id: new ObjectId(String(tx.student_id)) }) : null;
  const mine = [tx.requested_by_id, tx.initiating_mentor_id].map(String).includes(user.id);
  // A CS Manager corrects any CS's (the user, 2026-10-12) — they create and correct, never approve or reject.
  const reach = await csManagerReach(user);
  const managerOk = !!reach && [tx.primary_mentor_id, tx.initiating_mentor_id, tx.requested_by_id].some((id) => reach.ids.includes(String(id ?? "")));
  if (!mine && !managerOk && !(student && canWorkOn(user, student))) return forbidden("Only whoever raised it, the student's CS, a CS Manager or the people above them correct it");

  const now = new Date().toISOString();
  const changed: string[] = [];

  // ── Everything asked is checked before anything is written ──
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 200) : null;
  const emailChanges = email !== null && !!student && email !== String(student.email ?? "").trim().toLowerCase();
  if (emailChanges) {
    if (!EMAIL.test(email!)) return error("That is not an email address", 400);
    const taken: any = await col("students").findOne(
      { _id: { $ne: student._id }, email: { $regex: `^${email!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } },
      { projection: { student_code: 1, full_name: 1 } },
    );
    if (taken) return error(`${taken.student_code} ${taken.full_name} already has this email`, 409);
  }
  const login = typeof body?.mt5Login === "string" ? mt5LoginOf(body.mt5Login) : null;
  const loginChanges = login !== null && login !== String(tx.mt5_login ?? "");
  if (loginChanges) {
    if (!MT5_LOGIN.test(login!)) return error("The MT5 login is its number — digits only", 400);
    const holder = await mt5Owner(login!);
    if (holder !== null && holder !== String(tx.student_id)) return error("That MT5 login is saved for another student — check the number", 409);
  }
  // The amount, in the currency it was typed in (2026-11-19): its AED and USD and the course payment with it.
  const payments: any[] = Array.isArray(tx.payments) ? tx.payments : [];
  const several = "This request was paid in several payments — their amounts and receipts aren't changed here. Ask the broker admin to send it to finance.";
  const currency = ["AED", "USD", "INR"].includes(String(tx.amount_currency ?? "").toUpperCase()) ? String(tx.amount_currency).toUpperCase() : "USD";
  const typedBefore = cents(Number(tx.amount_original) > 0 ? Number(tx.amount_original) : currency === "AED" ? Number(tx.amount_aed) || 0 : Number(tx.amount_usd) || 0);
  const amountSet: Record<string, unknown> = {};
  let amountNow: { typed: number; usd: number; aed: number } | null = null;
  if (body?.amount !== undefined && body?.amount !== null && String(body.amount).trim() !== "") {
    const typed = cents(Number(String(body.amount).replace(/,/g, "")));
    if (!Number.isFinite(typed) || !(typed > 0)) return error("The amount is a number above 0", 400);
    if (typed !== typedBefore) {
      if (payments.length > 1) return error(several, 409);
      const usd = currency === "USD" ? typed : currency === "AED" ? cents(typed / AED_PER_USD) : cents(typed * usdPerInrOf(tx));
      const aed = currency === "AED" ? typed : cents(usd * AED_PER_USD);
      amountNow = { typed, usd, aed };
      Object.assign(amountSet, { amount_original: typed, amount_usd: usd, amount_aed: aed });
      if (tx.course_payment) {
        amountSet["course_payment.paid_today_aed"] = aed;
        amountSet["course_payment.paid_total_aed"] = cents((Number(tx.course_payment.paid_before_aed) || 0) + aed);
      }
      if (payments.length === 1) amountSet["payments.0.amount"] = typed;
      changed.push(`amount ${currency} ${fmt(typedBefore)} → ${currency} ${fmt(typed)}`);
    }
  }
  // The receipt (2026-11-19): a file uploaded in the correction.
  const receiptUrl = typeof body?.receiptUrl === "string" ? body.receiptUrl.trim() : "";
  const receiptName = String(body?.receiptName ?? "").trim().slice(0, 200);
  const receiptSet: Record<string, unknown> = {};
  if (receiptUrl && receiptUrl !== String(tx.screenshot_url ?? "")) {
    if (!/^https?:\/\//i.test(receiptUrl) || receiptUrl.length > 1000) return error("Upload the receipt again — that isn't a file's link", 400);
    if (payments.length > 1) return error(several, 409);
    receiptSet.screenshot_url = receiptUrl;
    if (payments.length === 1) Object.assign(receiptSet, { "payments.0.receipt_url": receiptUrl, "payments.0.receipt_name": receiptName });
    changed.push("receipt replaced");
  }
  const note = String(body?.note ?? "").trim().slice(0, 500);
  if (!changed.length && !emailChanges && !loginChanges && !note) return error("Correct what was sent back, or say in the note why it is right", 400);
  // The money changed on a bonus finance approved: through finance again (2026-11-19).
  const moneyChanged = !!amountNow || !!receiptSet.screenshot_url;
  const viaFinance = moneyChanged && financeApproved(tx);

  // ── Written ──
  if (emailChanges) {
    await col("students").updateOne({ _id: student._id }, { $set: { email, updated_date: now } });
    await recordHistory([{ student_id: String(student._id), at: now, type: "details_changed", by_id: user.id, by_name: who(user),
      text: `Details changed — Email: ${String(student.email ?? "").trim() || "none"} → ${email} (sent back on a ${tx.type} request)`, from: { email: student.email ?? "" }, to: { email } } as any]);
    changed.unshift(`email → ${email}`);
  }
  if (loginChanges) {
    if (student) await keepMt5(student, login!, { email: user.email, name: who(user) }, "correction");
    changed.splice(emailChanges ? 1 : 0, 0, `MT5 ${tx.mt5_login || "—"} → ${login}`);
  }
  let financeUpdate: ReturnType<typeof recheckUpdate> | null = null;
  if (viaFinance) {
    // Finance sees it as corrected: the new amount and receipt, and the MT5 login.
    const asCorrected = {
      ...tx,
      ...(amountNow ? { amount_original: amountNow.typed, amount_usd: amountNow.usd, amount_aed: amountNow.aed } : {}),
      ...(amountNow && tx.course_payment ? { course_payment: { ...tx.course_payment, paid_today_aed: amountNow.aed, paid_total_aed: amountSet["course_payment.paid_total_aed"] } } : {}),
      ...(receiptSet.screenshot_url ? { screenshot_url: receiptSet.screenshot_url } : {}),
      ...(payments.length === 1 ? { payments: [{
        ...payments[0],
        ...(amountNow ? { amount: amountNow.typed } : {}),
        ...(receiptSet.screenshot_url ? { receipt_url: receiptSet.screenshot_url, receipt_name: receiptName } : {}),
      }] } : {}),
      ...(loginChanges ? { mt5_login: login } : {}),
    };
    const ask: RecheckAsk = {
      from: "cs", by_id: user.id, by_name: who(user),
      fields: [...(amountNow ? ["amount"] : []), ...(receiptSet.screenshot_url ? ["receipt"] : [])],
      note: [changed.filter((c) => /^amount|^receipt/.test(c)).join(", "), note].filter(Boolean).join(" — "),
    };
    try {
      financeUpdate = recheckUpdate(tx, ask, now, await recheckAtFinance(asCorrected, ask, now));
    } catch (err) {
      return financeRefused(err);
    }
  }

  const corrected = { at: now, by_id: user.id, by_name: who(user), changed, note, ...(viaFinance ? { to_finance: true } : {}) };
  const set = { corrected, updated_date: now, ...(loginChanges ? { mt5_login: login } : {}), ...amountSet, ...receiptSet };
  const res = await col("funding_transactions").updateOne({ _id: tx._id, status: "PENDING", "returned.at": tx.returned.at }, {
    $set: financeUpdate ? { ...set, ...financeUpdate.$set } : set,
    $unset: { returned: "", ...(financeUpdate?.$unset ?? {}) },
    $push: { corrections: { kind: "corrected", ...corrected }, ...(financeUpdate?.$push ?? {}) } as any,
  });
  if (!res.modifiedCount) return error("This request changed meanwhile — open it again", 409);
  if (tx.student_id) {
    await recordHistory([{ student_id: String(tx.student_id), at: now, type: "funding_returned", by_id: user.id, by_name: who(user),
      text: `${tx.type} request corrected and sent ${viaFinance ? "to Delta Finance to check again" : "back for approval"}${changed.length ? ` — ${changed.join(", ")}` : ""}${note ? ` (${note})` : ""}`.slice(0, 400) } as any]);
  }
  if (viaFinance) {
    // With finance now: whoever sent it back is told; the approvers hear when finance approves it (bonusToBroker).
    await notify([String(tx.returned.by_id ?? "")].filter(Boolean), {
      type: "funding_corrected",
      title: `Corrected — with finance: ${String(student?.full_name ?? tx.student_name ?? "").trim() || "a student"}'s ${String(tx.type ?? "").toLowerCase()} request`,
      body: `${who(user)} corrected it — ${changed.join(", ")}${note ? ` (${note})` : ""}. Delta Finance checks it again and it comes back to MT5 Approvals.`.slice(0, 300),
      link: "/BonusApprovals",
    });
    return json({ ok: true, corrected, with_finance: true });
  }
  // Straight back to whoever sent it, and the other approvers — a bonus's, its location's (2026-10-15).
  const { bonusDeciderIds, bonusLocationOf } = await import("../finance/bonusLocation");
  const approvers = tx.type === "BONUS"
    ? await bonusDeciderIds(await bonusLocationOf(tx))
    : ((await col("users").find({ app_role: { $in: BONUS_APPROVERS }, status: { $ne: "inactive" } }, { projection: { _id: 1 } }).toArray()) as any[]).map((u) => String(u._id));
  await notify([...new Set([String(tx.returned.by_id ?? ""), ...approvers].filter(Boolean))], {
    type: "funding_corrected",
    title: `Corrected: ${String(student?.full_name ?? tx.student_name ?? "").trim() || "a student"}'s ${String(tx.type ?? "").toLowerCase()} request`,
    body: `${who(user)} corrected it${changed.length ? ` — ${changed.join(", ")}` : ""}${note ? ` (${note})` : ""}. It's back on MT5 Approvals.`.slice(0, 300),
    link: "/BonusApprovals",
  });
  return json({ ok: true, corrected });
}

/**
 * POST /api/functions/setFundingTransactionId { id, transactionId, note? } (the user, 2026-10-13) — a broker admin or a
 * Super Admin corrects the transaction ID of an approved deposit, withdrawal or bonus on MT5 Approvals. Unique across
 * requests (and Not credited yet answers); each change kept in `transaction_id_changes` and the student's history.
 */
export async function setFundingTransactionId(req: Request, user: AuthUser): Promise<Response> {
  if (!BONUS_APPROVERS.includes(user.app_role)) return forbidden("Only a broker admin or a Super Admin changes a transaction ID");
  const body: any = await req.json().catch(() => ({}));
  if (!ObjectId.isValid(String(body?.id ?? ""))) return error("id is required", 400);
  const txnId = String(body?.transactionId ?? "").trim().slice(0, 100);
  if (!txnId) return error("The transaction ID is required", 400);
  const note = String(body?.note ?? "").trim().slice(0, 300);
  const tx: any = await col("funding_transactions").findOne({ _id: new ObjectId(String(body.id)) });
  if (!tx) return notFound();
  if (tx.status !== "APPROVED") return error("Only an approved request's transaction ID is changed here", 409);
  if (String(tx.transaction_id ?? "") === txnId) return json({ ok: true, unchanged: true });
  const taken = (await col("funding_transactions").findOne({ transaction_id: txnId, _id: { $ne: tx._id } }, { projection: { student_code: 1 } }))
    || (await col("credit_requests").findOne({ "decided.transaction_id": txnId }, { projection: { student_code: 1 } }));
  if (taken) return error(`That transaction ID is used already${(taken as any).student_code ? ` (${(taken as any).student_code})` : ""}`, 409);
  const now = new Date().toISOString();
  const change = { at: now, by_id: user.id, by_name: who(user), from: String(tx.transaction_id ?? ""), to: txnId, note };
  const res = await col("funding_transactions").updateOne({ _id: tx._id, status: "APPROVED", transaction_id: tx.transaction_id ?? null }, {
    $set: { transaction_id: txnId, updated_date: now }, $push: { transaction_id_changes: change } as any,
  });
  if (!res.modifiedCount) return error("This request changed meanwhile — open the page again", 409);
  if (tx.student_id) {
    await recordHistory([{ student_id: String(tx.student_id), at: now, type: "funding_corrected", by_id: user.id, by_name: who(user),
      text: `${tx.type} of $${Number(tx.amount_usd || 0).toLocaleString("en-US")}: transaction ID changed from ${change.from || "none"} to ${txnId}${note ? ` (${note})` : ""}`.slice(0, 400) } as any]);
  }
  return json({ ok: true, transaction_id: txnId });
}
