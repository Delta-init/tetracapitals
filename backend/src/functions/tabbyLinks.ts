import { ObjectId } from "mongodb";
import { col } from "../db";
import { config } from "../config";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { userCanReadDoc } from "../entities/crud";
import { canWorkOn } from "../students/followups";
import { intlNumbers, toIntl } from "../whatsapp/service";
import { tabbyConfigured, createSession, sendLink, cancelSession, getPayment, TabbyError } from "../lib/tabby";

/* ────────────────────────────────────────────────────────────────────────────
   Tabby payment links for a student. Their CS (or a CS they are Common with),
   Super Admin or Admin makes one for an amount: Tabby checks the student can
   pay with Tabby, then texts them the link. Every link is kept in
   `tabby_links` — who made it, for what, and where it stands, looked up at
   Tabby while it can still change. A link lasts 20 minutes (Tabby's default).
   Links only: payments are captured on Tabby's side, nothing here moves money.

   status: CREATING (asking Tabby) · NOT_ELIGIBLE (Tabby said no up front) ·
   ERROR (Tabby could not be asked) · then Tabby's own: CREATED (waiting) ·
   AUTHORIZED / CLOSED (paid) · REJECTED (declined at checkout) · EXPIRED
   (ran out, or cancelled here).

   No new links since 2026-10-03, for anyone (the user's choice): a CS asks
   for a payment link and a Super Admin pastes it in — paymentLinks.ts.
──────────────────────────────────────────────────────────────────────────── */

const LINKS_OFF = true;
const LINKS = "tabby_links";
const MAX_AMOUNT = 100_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUPLICATE_MS = 60_000;          // the same link asked for again this soon (a double click) gives back the first
const RECHECK_MS = 10_000;            // a waiting link is looked up at Tabby at most this often…
const RECHECK_OLD_MS = 10 * 60_000;   // …and an hour after it was made (Tabby says EXPIRED by then), only now and then
const str = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max);
const who = (u: AuthUser) => u.full_name || u.email || "somebody";

async function studentFor(id: unknown): Promise<any> {
  const oid = toObjectId(str(id, 40));
  return oid ? col("students").findOne({ _id: oid }) : null;
}

/** What the page shows. The link itself only while it can still be paid. */
function view(l: any) {
  const waiting = l.status === "CREATED";
  return {
    id: String(l._id),
    amount: l.amount,
    currency: l.currency,
    description: l.description,
    phone: l.phone,
    email: l.email ?? "",
    lang: l.lang,
    reference_id: l.reference_id,
    status: l.status,
    paid: l.status === "AUTHORIZED" || l.status === "CLOSED",
    url: waiting ? l.url ?? "" : "",
    message: l.message ?? "",
    sms_sent: !!l.sms_sent,
    sms_error: l.sms_error ?? "",
    created_by_name: l.created_by_name ?? "",
    created_at: l.created_at,
    paid_at: l.paid_at ?? null,
    cancelled_by_name: l.cancelled_by_name ?? "",
    cancelled_at: l.cancelled_at ?? null,
  };
}

/** A waiting link, as Tabby has it now (not more often than RECHECK_*, unless `now`). Never throws — it stays as it was. */
async function refresh(l: any, now = false): Promise<void> {
  if (l.status !== "CREATED" || !l.payment_id) return;
  const age = Date.now() - Date.parse(l.created_at);
  const since = Date.now() - Date.parse(l.checked_at || l.created_at);
  if (!now && since < (age > 60 * 60_000 ? RECHECK_OLD_MS : RECHECK_MS)) return;
  const at = new Date().toISOString();
  try {
    const p = await getPayment(l.payment_id);
    const set: Record<string, any> = { checked_at: at };
    if (p.status && p.status !== "CREATED") {
      set.status = p.status;
      if (p.status === "AUTHORIZED" || p.status === "CLOSED") set.paid_at = at;
    }
    await col(LINKS).updateOne({ _id: l._id, status: "CREATED" }, { $set: set });
    Object.assign(l, set);
  } catch (err) {
    console.error(`[tabby] could not check link ${l._id}: ${err instanceof Error ? err.message : err}`);
  }
}

async function audit(user: AuthUser, action: string, l: any, extra: Record<string, unknown> = {}) {
  await col("logs").insertOne({
    timestamp: new Date().toISOString(),
    user_id: user.id, user_email: user.email, user_name: who(user), user_role: user.app_role,
    action_type: action,
    entity_type: "Student",
    entity_id: l.student_id,
    details: JSON.stringify({ student: l.student_name, student_code: l.student_code, amount: `${l.currency} ${l.amount}`, for: l.description, phone: l.phone, reference: l.reference_id, ...extra }),
    success: true,
  } as any).catch((err) => console.error("[tabby] audit log not written", err));
}

/**
 * POST /api/functions/getTabbyLinks { studentId }
 * → { configured, currency, can_create, numbers, email, links } — for whoever may see the student.
 */
export async function getTabbyLinks(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const student = await studentFor(body?.studentId);
  if (!student) return notFound();
  if (!(await userCanReadDoc(user, "Student", student))) return forbidden();
  const links = (await col(LINKS).find({ student_id: String(student._id) }).sort({ created_at: -1 }).limit(50).toArray()) as any[];
  if (tabbyConfigured()) await Promise.all(links.map((l) => refresh(l)));
  const canCreate = canWorkOn(user, student);
  return json({
    configured: tabbyConfigured(),
    currency: config.tabby.currency,
    can_create: canCreate,
    // To fill in a new link — only for who can send one.
    numbers: canCreate ? intlNumbers(student.phone) : [],
    email: canCreate && EMAIL.test(String(student.email ?? "").trim()) ? String(student.email).trim() : "",
    links: links.map(view),
  });
}

/**
 * POST /api/functions/createTabbyLink { studentId, amount, description, phone, email?, lang? }
 * The student's CS (or Common CS), Super Admin or Admin. Tabby texts the link to `phone`.
 * → { link } — NOT_ELIGIBLE with Tabby's message when it won't take the student for this amount.
 */
export async function createTabbyLink(req: Request, user: AuthUser): Promise<Response> {
  if (LINKS_OFF) return forbidden("Tabby links are switched off — ask for a payment link on the student's page instead");
  if (!tabbyConfigured()) return error("Tabby isn't set up on the server yet (TABBY_SECRET_KEY, TABBY_MERCHANT_CODE)", 400);
  const body: any = await req.json().catch(() => ({}));
  const student = await studentFor(body?.studentId);
  if (!student) return notFound();
  if (!canWorkOn(user, student)) return forbidden("Only the student's CS, Super Admin or Admin can send them a Tabby link");

  const value = Number(String(body?.amount ?? "").replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return error("Enter the amount", 400);
  if (value > MAX_AMOUNT) return error(`That is more than ${MAX_AMOUNT.toLocaleString("en-US")} — check the amount`, 400);
  const amount = (Math.round(value * 100) / 100).toFixed(2);
  const description = str(body?.description, 200);
  if (!description) return error("Say what it is for", 400);
  const digits = toIntl(body?.phone);
  if (digits.length < 9 || digits.length > 15) return error("Enter the student's mobile number, with the country code", 400);
  const phone = `+${digits}`;
  const email = str(body?.email, 200);
  if (email && !EMAIL.test(email)) return error("That email doesn't look right", 400);
  const lang = body?.lang === "ar" ? "ar" : "en";

  // A double click: the same link a moment ago comes back instead of a second SMS.
  const dup: any = await col(LINKS).findOne(
    { student_id: String(student._id), amount, phone, status: { $in: ["CREATING", "CREATED"] }, created_at: { $gt: new Date(Date.now() - DUPLICATE_MS).toISOString() } },
    { sort: { created_at: -1 } },
  );
  if (dup) return json({ link: view(dup), duplicate: true });

  const _id = new ObjectId();
  const now = new Date().toISOString();
  const l: any = {
    _id,
    student_id: String(student._id),
    student_name: String(student.full_name ?? "").trim(),
    student_code: String(student.student_code ?? ""),
    mentor_id: String(student.primary_mentor_id ?? ""),
    amount,
    currency: config.tabby.currency,
    description,
    phone,
    email,
    lang,
    reference_id: `PL-${String(student.student_code || "STU").replace(/[^\w-]/g, "")}-${_id.toHexString().slice(-8).toUpperCase()}`,
    status: "CREATING",
    created_by_id: user.id,
    created_by_name: who(user),
    created_at: now,
    updated_at: now,
  };
  await col(LINKS).insertOne(l);

  const set: Record<string, any> = {};
  try {
    const s = await createSession({
      amount,
      description,
      referenceId: l.reference_id,
      lang,
      buyer: { phone, name: l.student_name, email },
      registeredSince: student.created_date ? new Date(student.created_date).toISOString() : undefined,
      customer: l.student_code || undefined,
    });
    set.session_id = s.sessionId;
    set.payment_id = s.paymentId;
    if (s.status === "rejected") {
      Object.assign(set, { status: "NOT_ELIGIBLE", rejection_reason: s.reason, message: s.message });
    } else {
      Object.assign(set, { status: "CREATED", url: s.url, checked_at: new Date().toISOString() });
      try {
        await sendLink(s.sessionId);
        set.sms_sent = true;
      } catch (err) {
        set.sms_sent = false;
        set.sms_error = err instanceof Error ? err.message : String(err);
      }
    }
  } catch (err) {
    Object.assign(set, { status: "ERROR", message: err instanceof TabbyError ? err.message : "Tabby could not be asked — try again" });
    if (!(err instanceof TabbyError)) console.error("[tabby] link failed", err);
  }
  set.updated_at = new Date().toISOString();
  await col(LINKS).updateOne({ _id }, { $set: set });
  Object.assign(l, set);
  await audit(user, "tabby_link_created", l, { status: l.status, sms_sent: !!l.sms_sent });
  return json({ link: view(l) });
}

/** POST /api/functions/cancelTabbyLink { id } — a link not paid yet stops working (Tabby: EXPIRED). */
export async function cancelTabbyLink(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(str(body?.id, 40));
  const l: any = oid ? await col(LINKS).findOne({ _id: oid }) : null;
  if (!l) return notFound();
  const student = await studentFor(l.student_id);
  if (!student || !canWorkOn(user, student)) return forbidden();
  if (l.status !== "CREATED" || !l.session_id) return error("Only a link that is still waiting can be cancelled", 400);
  try {
    const out = await cancelSession(l.session_id);
    if (out === "cancelled") {
      const set = { status: "EXPIRED", cancelled_by_id: user.id, cancelled_by_name: who(user), cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      await col(LINKS).updateOne({ _id: l._id, status: "CREATED" }, { $set: set });
      Object.assign(l, set);
      await audit(user, "tabby_link_cancelled", l);
    } else {
      // Too late to cancel: paid, declined or run out — show which.
      await refresh(l, true);
    }
    return json({ link: view(l), too_late: out === "finalized" });
  } catch (err) {
    return error(err instanceof TabbyError ? err.message : "Tabby could not be asked — try again", 502);
  }
}
