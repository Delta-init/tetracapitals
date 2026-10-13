import { ObjectId } from "mongodb";
import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { BONUS_APPROVERS, withFinance } from "../finance/funding";
import { canWorkOn } from "../students/followups";
import { recordHistory } from "../students/history";
import { MT5_LOGIN, mt5LoginOf, mt5Owner, keepMt5 } from "../students/mt5";
import { notify } from "../lib/notify";

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
──────────────────────────────────────────────────────────────────────────── */

export const RETURN_FIELDS = ["email", "mt5", "other"] as const;
const FIELD_LABEL: Record<string, string> = { email: "the student's email", mt5: "the MT5 login", other: "something else" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const who = (u: AuthUser) => u.full_name || u.email || "somebody";
const what = (fields: string[]) => fields.map((f) => FIELD_LABEL[f] ?? f).join(" and ");

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

/** POST /api/functions/sendFundingBack { id, fields: ["email" | "mt5" | "other"], note } — a broker admin or a Super Admin. */
export async function sendFundingBack(req: Request, user: AuthUser): Promise<Response> {
  if (!BONUS_APPROVERS.includes(user.app_role)) return forbidden("Only a broker admin or a Super Admin sends a request back");
  const body: any = await req.json().catch(() => ({}));
  if (!ObjectId.isValid(String(body?.id ?? ""))) return error("id is required", 400);
  const asked: string[] = (Array.isArray(body?.fields) ? body.fields : []).map((f: unknown) => String(f));
  const fields = [...new Set(asked)].filter((f) => (RETURN_FIELDS as readonly string[]).includes(f));
  if (!fields.length) return error("Say what is wrong: the email, the MT5 login or something else", 400);
  const note = String(body?.note ?? "").trim().slice(0, 500);
  if (fields.includes("other") && !note) return error("Say what is wrong in the note", 400);
  const tx: any = await col("funding_transactions").findOne({ _id: new ObjectId(String(body.id)) });
  if (!tx) return notFound();
  if (tx.status !== "PENDING") return error(`This request is already ${String(tx.status).toLowerCase()}`, 409);
  if (withFinance(tx)) return error("Delta finance still has this request — it can be sent back once it reaches you", 409);
  if (tx.returned?.at) return error("This request is already with the CS for correction", 409);

  const now = new Date().toISOString();
  const student: any = tx.student_id && ObjectId.isValid(String(tx.student_id)) ? await col("students").findOne({ _id: new ObjectId(String(tx.student_id)) }, { projection: { primary_mentor_id: 1, full_name: 1, email: 1 } }) : null;
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
    body: `${who(user)} sent it back — ${what(fields)} looks wrong${note ? `: ${note}` : ""}. Correct it and it goes straight back for approval.`.slice(0, 300),
    link: "/MyFundingRequests",
  });
  return json({ ok: true, returned });
}

/**
 * POST /api/functions/correctFundingRequest { id, email?, mt5Login?, note? }
 * Whoever raised it, the student's CS (or a CS they're Common with), the people above them and admins: the student's
 * email and/or the request's MT5 login — then straight back to the approvers.
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
  if (!mine && user.app_role !== "cs_manager" && !(student && canWorkOn(user, student))) return forbidden("Only whoever raised it, the student's CS, a CS Manager or the people above them correct it");

  const now = new Date().toISOString();
  const changed: string[] = [];
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 200) : null;
  if (email !== null && student && email !== String(student.email ?? "").trim().toLowerCase()) {
    if (!EMAIL.test(email)) return error("That is not an email address", 400);
    const taken: any = await col("students").findOne(
      { _id: { $ne: student._id }, email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } },
      { projection: { student_code: 1, full_name: 1 } },
    );
    if (taken) return error(`${taken.student_code} ${taken.full_name} already has this email`, 409);
    await col("students").updateOne({ _id: student._id }, { $set: { email, updated_date: now } });
    await recordHistory([{ student_id: String(student._id), at: now, type: "details_changed", by_id: user.id, by_name: who(user),
      text: `Details changed — Email: ${String(student.email ?? "").trim() || "none"} → ${email} (sent back on a ${tx.type} request)`, from: { email: student.email ?? "" }, to: { email } } as any]);
    changed.push(`email → ${email}`);
  }
  const login = typeof body?.mt5Login === "string" ? mt5LoginOf(body.mt5Login) : null;
  if (login !== null && login !== String(tx.mt5_login ?? "")) {
    if (!MT5_LOGIN.test(login)) return error("The MT5 login is its number — digits only", 400);
    const holder = await mt5Owner(login);
    if (holder !== null && holder !== String(tx.student_id)) return error("That MT5 login is saved for another student — check the number", 409);
    if (student) await keepMt5(student, login, { email: user.email, name: who(user) }, "correction");
    changed.push(`MT5 ${tx.mt5_login || "—"} → ${login}`);
  }
  const note = String(body?.note ?? "").trim().slice(0, 500);
  if (!changed.length && !note) return error("Correct what was sent back, or say in the note why it is right", 400);

  const corrected = { at: now, by_id: user.id, by_name: who(user), changed, note };
  const res = await col("funding_transactions").updateOne({ _id: tx._id, status: "PENDING", "returned.at": tx.returned.at }, {
    $set: { corrected, updated_date: now, ...(login !== null && login !== String(tx.mt5_login ?? "") ? { mt5_login: login } : {}) },
    $unset: { returned: "" },
    $push: { corrections: { kind: "corrected", ...corrected } } as any,
  });
  if (!res.modifiedCount) return error("This request changed meanwhile — open it again", 409);
  if (tx.student_id) {
    await recordHistory([{ student_id: String(tx.student_id), at: now, type: "funding_returned", by_id: user.id, by_name: who(user),
      text: `${tx.type} request corrected and sent back for approval${changed.length ? ` — ${changed.join(", ")}` : ""}${note ? ` (${note})` : ""}`.slice(0, 400) } as any]);
  }
  // Straight back to whoever sent it, and the other approvers.
  const approvers = ((await col("users").find({ app_role: { $in: BONUS_APPROVERS }, status: { $ne: "inactive" } }, { projection: { _id: 1 } }).toArray()) as any[]).map((u) => String(u._id));
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
