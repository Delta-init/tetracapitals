import { ObjectId } from "mongodb";
import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { canWorkOn } from "../students/followups";
import { recordHistory } from "../students/history";
import { MT5_LOGIN, mt5LoginOf, mt5Of, mt5Owner, keepMt5 } from "../students/mt5";
import { BONUS_APPROVERS, withFinance } from "../finance/funding";
import { creditCommissionFor } from "./creditCommission";
import { notify } from "../lib/notify";

/* ────────────────────────────────────────────────────────────────────────────
   Not credited yet (the user, 2026-10-13): a CS, a CS Manager or a Super
   Admin tells the broker admins a student's bonus is still not in their MT5 —
   the MT5 login, the amount, the bonus request it is (when one was raised)
   and what is missing. Broker admins (and Super Admins) answer it on the Not
   Credited Yet page:
     credited          credited now — the transaction ID required;
     already_credited  it was in already — a note of when / where;
     rejected          not to be credited — the reason.
   A linked bonus request still waiting for a broker admin is approved with
   it (credited: with that transaction ID; already credited: marked so), so it
   is never credited twice; one still with finance is left to finance. A
   request is a record of the credit only — no commission of its own; the
   linked request's, approved here, is credited as MT5 Approvals does.
   Whoever raised it and the student's CS are told; every step is in the
   student's history. One open request per student and bonus (or MT5).
──────────────────────────────────────────────────────────────────────────── */

const COLL = "credit_requests";
const RAISE_ANY = ["super_admin", "admin", "cs_manager"];
const SEE_ALL = ["super_admin", "admin", "cs_manager", ...BONUS_APPROVERS];
const STATUSES = ["open", "credited", "already_credited", "rejected"] as const;
const AED_PER_USD = 3.67;
const who = (u: AuthUser) => u.full_name || u.email || "somebody";
const str = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max);
const isLink = (v: unknown) => /^https?:\/\//i.test(String(v ?? ""));
const cents = (n: number) => Math.round(n * 100) / 100;
const moneyText = (amount: number, currency: string) => (currency === "USD" ? `$${amount.toLocaleString("en-US")}` : `${currency} ${amount.toLocaleString("en-US")}`);

const mayRaise = (user: AuthUser, student: any) => RAISE_ANY.includes(user.app_role) || (user.app_role === "cs" && canWorkOn(user, student));
const mayDecide = (user: AuthUser) => BONUS_APPROVERS.includes(user.app_role);

/** A bonus request, as the page shows it beside the credit request. */
const txCard = (t: any) => t ? {
  id: String(t._id), type: t.type, status: t.status, amount_usd: t.amount_usd, amount_currency: t.amount_currency, amount_original: t.amount_original,
  requested_at: t.requested_at || t.created_date, requested_by_name: t.requested_by_name, transaction_id: t.transaction_id ?? "",
  bonus_credit: t.bonus_credit ?? "", course: t.course_payment?.product || t.sales_close?.course || (Array.isArray(t.tags) ? t.tags[0] : "") || "",
  mt5_login: t.mt5_login ?? "", payments: t.payments ?? [], screenshot_url: t.screenshot_url ?? "", with_finance: withFinance(t),
} : null;

/** Who to tell about a request: whoever raised it and the student's CS. */
const peopleOf = (r: any) => [...new Set([String(r.raised_by_id ?? ""), String(r.cs_id ?? "")].filter(Boolean))];

/**
 * POST /api/functions/getCreditRequestOptions { studentId } — for the Raise window: the student's bonus requests
 * (newest first) and saved MT5 logins.
 */
export async function getCreditRequestOptions(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(str(body?.studentId, 40));
  if (!oid) return error("studentId is required", 400);
  const student: any = await col("students").findOne({ _id: oid }, { projection: { primary_mentor_id: 1, common_cs: 1, full_name: 1 } });
  if (!student) return notFound();
  if (!mayRaise(user, student)) return forbidden("Only the student's CS, a CS Manager or a Super Admin raises it");
  const txs = (await col("funding_transactions").find({ student_id: String(oid), type: "BONUS" }).sort({ requested_at: -1 }).limit(25).toArray()) as any[];
  const open = (await col(COLL).find({ student_id: String(oid), status: "open" }, { projection: { funding_tx_id: 1, mt5_login: 1 } }).toArray()) as any[];
  return json({ bonuses: txs.map(txCard), mt5: await mt5Of(String(oid)), open: open.map((o) => ({ funding_tx_id: o.funding_tx_id ?? "", mt5_login: o.mt5_login })) });
}

/**
 * POST /api/functions/raiseCreditRequest { studentId, mt5Login, amount, currency: "USD" | "AED", fundingTxId?, note, screenshot?: { url, name } }
 * → { id }
 */
export async function raiseCreditRequest(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(str(body?.studentId, 40));
  if (!oid) return error("Pick the student", 400);
  const student: any = await col("students").findOne({ _id: oid }, { projection: { full_name: 1, student_code: 1, primary_mentor_id: 1, primary_mentor_name: 1, team_name: 1, common_cs: 1 } });
  if (!student) return notFound("That student wasn't found");
  if (!mayRaise(user, student)) return forbidden("Only the student's CS, a CS Manager or a Super Admin raises it");
  const login = mt5LoginOf(body?.mt5Login);
  if (!MT5_LOGIN.test(login)) return error("The MT5 login is its number — digits only", 400);
  const owner = await mt5Owner(login);
  if (owner !== null && owner !== String(oid)) return error("That MT5 login is saved for another student — check the number", 409);
  const currency = body?.currency === "AED" ? "AED" : "USD";
  const amount = cents(Number(body?.amount));
  if (!(amount > 0) || amount > 1_000_000) return error("The bonus amount is needed", 400);
  const note = str(body?.note, 1000);
  if (note.length < 5) return error("Say what is missing — a few words at least", 400);
  let tx: any = null;
  const txId = str(body?.fundingTxId, 40);
  if (txId) {
    tx = ObjectId.isValid(txId) ? await col("funding_transactions").findOne({ _id: new ObjectId(txId) }) : null;
    if (!tx || String(tx.student_id) !== String(oid) || tx.type !== "BONUS") return error("That bonus request isn't this student's", 400);
  }
  // One open request per student and bonus request — or, with none picked, per MT5 login.
  const dup: any = await col(COLL).findOne({ student_id: String(oid), status: "open", ...(tx ? { funding_tx_id: String(tx._id) } : { funding_tx_id: "", mt5_login: login }) });
  if (dup) return error(`There is an open request for this already — raised by ${dup.raised_by_name} on ${String(dup.raised_at).slice(0, 10)}`, 409);
  const shot = body?.screenshot && isLink(body.screenshot.url) ? { url: str(body.screenshot.url, 2048), name: str(body.screenshot.name, 200) } : null;

  const now = new Date().toISOString();
  const doc = {
    student_id: String(oid), student_name: String(student.full_name ?? "").trim(), student_code: student.student_code ?? "",
    cs_id: student.primary_mentor_id ?? "", cs_name: student.primary_mentor_name ?? "", team_name: student.team_name ?? "",
    mt5_login: login, amount, currency, amount_usd: currency === "USD" ? amount : cents(amount / AED_PER_USD),
    funding_tx_id: tx ? String(tx._id) : "", note, screenshot_url: shot?.url ?? "", screenshot_name: shot?.name ?? "",
    status: "open", raised_by_id: user.id, raised_by_name: who(user), raised_by_role: user.app_role, raised_at: now, updated_at: now,
  };
  const { insertedId } = await col(COLL).insertOne(doc as any);
  await keepMt5(student, login, { email: user.email, name: who(user) }, "credit request");
  await recordHistory([{ student_id: String(oid), at: now, type: "credit_request", by_id: user.id, by_name: who(user),
    text: `Bonus not credited — ${moneyText(amount, currency)} in MT5 ${login} sent to the broker admins${tx ? " (for a bonus request already raised)" : ""}: ${note}`.slice(0, 400) } as any]);
  const approvers = ((await col("users").find({ app_role: { $in: BONUS_APPROVERS }, status: { $ne: "inactive" } }, { projection: { _id: 1 } }).toArray()) as any[]).map((u) => String(u._id));
  await notify(approvers, {
    type: "credit_request", title: `Bonus not credited: ${doc.student_name || "a student"}`,
    body: `${who(user)}: ${moneyText(amount, currency)} in MT5 ${login} — ${note}`.slice(0, 300), link: "/NotCreditedYet",
  });
  return json({ ok: true, id: String(insertedId) });
}

/**
 * POST /api/functions/listCreditRequests { status?: "open" | "credited" | "already_credited" | "rejected" | "all", search?, from?, to? }
 * A CS their own students' and the ones they raised; CS Managers, Super Admins, admins and broker admins everyone's.
 * → { rows (with student and the linked bonus request), counts, may_decide, may_raise_any }
 */
export async function listCreditRequests(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const all = SEE_ALL.includes(user.app_role);
  if (!all && user.app_role !== "cs") return forbidden();
  const scope: Record<string, any> = all ? {} : { $or: [{ raised_by_id: user.id }, { cs_id: user.id }] };
  const status = (STATUSES as readonly string[]).includes(String(body?.status)) ? String(body.status) : body?.status === "all" ? "" : "open";
  const parts: Record<string, any>[] = [scope];
  if (status) parts.push({ status });
  const from = str(body?.from, 40), to = str(body?.to, 40);
  const field = status === "open" || !status ? "raised_at" : "decided.at";
  if (from || to) parts.push({ [field]: { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) } });
  const q = str(body?.search, 100);
  if (q) {
    const re = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    parts.push({ $or: [{ student_name: re }, { student_code: re }, { mt5_login: re }, { cs_name: re }, { raised_by_name: re }, { note: re }, { "decided.transaction_id": re }] });
  }
  const rows = (await col(COLL).find({ $and: parts }).sort(status === "open" ? { raised_at: 1 } : { "decided.at": -1, raised_at: -1 }).limit(2000).toArray()) as any[];
  const txIds = rows.map((r) => r.funding_tx_id).filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const txs = new Map(((await col("funding_transactions").find({ _id: { $in: txIds } }).toArray()) as any[]).map((t) => [String(t._id), t]));
  const counts: Record<string, number> = {};
  for (const s of STATUSES) counts[s] = await col(COLL).countDocuments({ $and: [scope, { status: s }] });
  return json({
    rows: rows.map(({ _id, ...r }) => ({ id: String(_id), ...r, funding_tx: txCard(txs.get(r.funding_tx_id)) })),
    counts, may_decide: mayDecide(user), may_raise_any: RAISE_ANY.includes(user.app_role) || user.app_role === "cs",
  });
}

/** The open requests waiting for a broker admin — the sidebar's number. */
export const openCreditRequests = () => col(COLL).countDocuments({ status: "open" });

/**
 * POST /api/functions/decideCreditRequest { id, action: "credited" | "already_credited" | "rejected", transactionId?, mt5Login?, note?, reason? }
 * Broker admins and Super Admins. → { ok, status, linked?: "approved" | "with_finance" | "decided" }
 */
export async function decideCreditRequest(req: Request, user: AuthUser): Promise<Response> {
  if (!mayDecide(user)) return forbidden("Only a broker admin or a Super Admin answers it");
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(str(body?.id, 40));
  if (!oid) return error("id is required", 400);
  const r: any = await col(COLL).findOne({ _id: oid });
  if (!r) return notFound();
  if (r.status !== "open") return error(`This request is already ${String(r.status).replace("_", " ")}`, 409);
  const action = String(body?.action);
  if (!["credited", "already_credited", "rejected"].includes(action)) return error("action must be credited, already_credited or rejected", 400);
  const now = new Date().toISOString();
  const decided: Record<string, any> = { at: now, by_id: user.id, by_name: who(user) };
  if (action === "credited") {
    const txnId = str(body?.transactionId, 100);
    if (!txnId) return error("The transaction ID is required", 400);
    const taken = (await col("funding_transactions").findOne({ transaction_id: txnId, _id: { $ne: ObjectId.isValid(r.funding_tx_id) ? new ObjectId(r.funding_tx_id) : new ObjectId() } }, { projection: { _id: 1 } }))
      || (await col(COLL).findOne({ "decided.transaction_id": txnId }, { projection: { _id: 1 } }));
    if (taken) return error("That transaction ID is used already", 409);
    const login = mt5LoginOf(body?.mt5Login) || r.mt5_login;
    if (!MT5_LOGIN.test(login)) return error("The MT5 login is its number — digits only", 400);
    Object.assign(decided, { transaction_id: txnId, mt5_login: login, note: str(body?.note, 500) });
  } else if (action === "already_credited") {
    const note = str(body?.note, 500);
    if (note.length < 3) return error("Say when or where it was credited", 400);
    Object.assign(decided, { note, transaction_id: str(body?.transactionId, 100) });
  } else {
    const reason = str(body?.reason, 500);
    if (reason.length < 3) return error("Say why", 400);
    decided.reason = reason;
  }
  const res = await col(COLL).updateOne({ _id: oid, status: "open" }, { $set: { status: action, decided, updated_at: now } });
  if (!res.modifiedCount) return error("This request was answered meanwhile — open the page again", 409);

  // Its bonus request, still waiting for a broker admin: approved with it — never credited twice.
  let linked: string | undefined;
  if (action !== "rejected" && ObjectId.isValid(r.funding_tx_id)) {
    const tx: any = await col("funding_transactions").findOne({ _id: new ObjectId(r.funding_tx_id) });
    if (tx?.status !== "PENDING") linked = "decided";
    else if (withFinance(tx)) linked = "with_finance";
    else {
      const set: Record<string, any> = {
        status: "APPROVED", approved_at: now, approved_by_id: user.id, approved_by_name: who(user), updated_date: now,
        ...(decided.transaction_id ? { transaction_id: decided.transaction_id } : {}),
        ...(action === "credited" ? { mt5_login: decided.mt5_login } : {}),
        ...(action === "already_credited" ? { already_credited: { at: now, by_id: user.id, by_name: who(user), note: decided.note } } : {}),
        notes: [tx.notes, action === "credited" ? `Credited from a Not credited yet request — ${decided.transaction_id}` : `Already credited in MT5 — ${decided.note}`].filter(Boolean).join("\n"),
      };
      const done = await col("funding_transactions").updateOne({ _id: tx._id, status: "PENDING" }, { $set: set });
      if (done.modifiedCount) {
        linked = "approved";
        try { await creditCommissionFor(String(tx._id)); } catch (err) { console.error("[credit requests] commission credit failed", err); }
      } else linked = "decided";
    }
    if (linked) await col(COLL).updateOne({ _id: oid }, { $set: { "decided.linked": linked } });
  }

  const what = action === "credited" ? `credited in MT5 ${decided.mt5_login} — transaction ${decided.transaction_id}`
    : action === "already_credited" ? `already credited — ${decided.note}` : `rejected — ${decided.reason}`;
  await recordHistory([{ student_id: r.student_id, at: now, type: "credit_request", by_id: user.id, by_name: who(user),
    text: `Bonus not credited (${moneyText(r.amount, r.currency)}, MT5 ${r.mt5_login}): ${what}${linked === "approved" ? "; its bonus request approved" : ""}`.slice(0, 400) } as any]);
  await notify(peopleOf(r), {
    type: "credit_request_decided",
    title: `${r.student_name || "A student"}'s bonus: ${action === "credited" ? "credited" : action === "already_credited" ? "already credited" : "not credited"}`,
    body: `${who(user)} — ${what}`.slice(0, 300), link: "/NotCreditedYet",
  });
  return json({ ok: true, status: action, ...(linked ? { linked } : {}) });
}
