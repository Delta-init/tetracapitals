import { ObjectId } from "mongodb";
import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { userCanReadDoc } from "../entities/crud";
import { commonIds } from "../students/followups";
import { recordHistory } from "../students/history";
import { notify } from "../lib/notify";
import { sendMail, mailConfigured } from "../lib/mailer";
import { onboardingEmail } from "./studentOnboarding";

/* ────────────────────────────────────────────────────────────────────────────
   Payment links, asked for by a CS and pasted in by a Super Admin — in place
   of Tabby's automatic links (the user, 2026-10-03). A student's CS (or a CS
   they are Common with) asks: the platform (Tabby, Tamara, SmartInvoice or
   BillXpro), an amount, what it is for, a note. Every Super Admin is told;
   one of them makes the link there — or on another platform — and pastes
   it in on the Payment Links page. It is then emailed to the student (from
   the portal's mailbox as "Delta Institutions"; a reply goes to the CS) and
   shows on the student's page, for the CS to copy or send on their WhatsApp.
   The CS also has the Payment Links page with what they asked for; their
   sidebar counts the answers (link ready, turned down) they haven't seen —
   cs_seen_at, set once they open that page or the student's page.
   Nothing here moves money.

   payment_link_requests.status: pending → approved (url) · rejected (reason)
   · cancelled (by the CS who asked, while pending). Each step goes in the
   student's history and tells whoever is waiting on it.
──────────────────────────────────────────────────────────────────────────── */

const REQUESTS = "payment_link_requests";
const CURRENCY = "AED";
const MAX_AMOUNT = 100_000;
const DUPLICATE_MS = 60_000;   // the same request again this soon (a double click) gives back the first
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUS_WORD: Record<string, string> = { pending: "waiting", approved: "approved", rejected: "turned down", cancelled: "cancelled" };
/** Where a link is made: the CS picks one when asking (`platform`); the Super Admin may make it on another (`made_on`). */
const PLATFORMS: Record<string, string> = { tabby: "Tabby", tamara: "Tamara", smartinvoice: "SmartInvoice", billxpro: "BillXpro" };
const str = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max);
const platformOf = (v: unknown) => (PLATFORMS[str(v, 20).toLowerCase()] ? str(v, 20).toLowerCase() : "");
/** "Tabby payment link" — or just "payment link" for a request from before the platform was asked. */
const linkName = (platform?: string) => `${platform && PLATFORMS[platform] ? `${PLATFORMS[platform]} ` : ""}payment link`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const who = (u: AuthUser) => u.full_name || u.email || "somebody";
const money = (amount: number) => `${CURRENCY} ${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const isSuperAdmin = (u: AuthUser) => u.app_role === "super_admin";
/** Only a CS asks, for their own students (Common ones too). */
const mayRequest = (u: AuthUser, s: any) =>
  u.app_role === "cs" && (String(s?.primary_mentor_id ?? "") === u.id || commonIds(s).includes(u.id));
/** The first email address on the student's record (some hold two). */
const emailOf = (s: any) => (String(s?.email ?? "").match(/[^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+/g) ?? []).find((e) => EMAIL.test(e)) ?? "";

async function studentFor(id: unknown): Promise<any> {
  const oid = toObjectId(str(id, 40));
  return oid ? col("students").findOne({ _id: oid }) : null;
}
async function requestFor(id: unknown): Promise<any> {
  const oid = toObjectId(str(id, 40));
  return oid ? col(REQUESTS).findOne({ _id: oid }) : null;
}

/** A web address to open — http(s) only, so nothing else ends up behind the link. */
function cleanUrl(v: unknown): string | null {
  try {
    const u = new URL(str(v, 2000));
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".") ? u.href : null;
  } catch {
    return null;
  }
}

/** What the pages show. */
function view(r: any, user: AuthUser) {
  return {
    id: String(r._id),
    student_id: r.student_id,
    student_name: r.student_name,
    student_code: r.student_code,
    team_name: r.team_name ?? "",
    amount: r.amount,
    currency: r.currency,
    description: r.description,
    note: r.note ?? "",
    platform: r.platform ?? "",
    made_on: r.status === "approved" ? r.made_on ?? r.platform ?? "" : "",
    status: r.status,
    requested_by_id: r.requested_by_id,
    requested_by_name: r.requested_by_name,
    created_at: r.created_at,
    mine: r.requested_by_id === user.id,
    url: r.status === "approved" ? r.url ?? "" : "",
    admin_note: r.admin_note ?? "",
    approved_by_name: r.approved_by_name ?? "",
    approved_at: r.approved_at ?? null,
    emailed_to: r.email?.to ?? "",
    emailed_at: r.email?.at ?? null,
    email_error: r.email_error ?? "",
    reject_reason: r.reject_reason ?? "",
    rejected_by_name: r.rejected_by_name ?? "",
    rejected_at: r.rejected_at ?? null,
    cancelled_at: r.cancelled_at ?? null,
    // A link ready or a turn-down the CS who asked hasn't seen yet (the sidebar counts these).
    new: r.requested_by_id === user.id && (r.status === "approved" || r.status === "rejected") && !r.cs_seen_at,
  };
}

/** The answers (link ready, turned down) to what `user` asked for, marked seen — the sidebar stops counting them. */
async function markAnswersSeen(user: AuthUser, filter: Record<string, unknown> = {}) {
  await col(REQUESTS).updateMany(
    { ...filter, requested_by_id: user.id, status: { $in: ["approved", "rejected"] }, cs_seen_at: { $exists: false } },
    { $set: { cs_seen_at: new Date().toISOString() } },
  );
}

/** The email the student gets: the link, what it is for, and that a reply reaches their CS. */
function linkEmail(r: any, s: any) {
  const name = String(s?.full_name ?? r.student_name ?? "").trim().split(/\s+/)[0] || "Student";
  const subject = `Your ${linkName(r.made_on)} — ${money(r.amount)}`;
  const text = [
    `Dear ${name},`,
    `Here is your ${linkName(r.made_on)} for *${money(r.amount)}* (${r.description}):`,
    r.url,
    `Please open it to complete your payment. If you have any questions, just reply to this email — ${r.requested_by_name}, your Client Success contact, will help you.`,
    "Best regards,\nDelta Institutions",
  ].join("\n\n");
  return { subject, text };
}

/**
 * POST /api/functions/getPaymentLinks { studentId, markSeen? }
 *   → { can_request, can_approve, currency, requests } — a student's requests, for whoever may see the student.
 * POST /api/functions/getPaymentLinks { markSeen? }
 *   → { can_approve, requests, email_ready? } — the Payment Links page: every request for a Super Admin (a waiting
 *     one carries the student's email, where the link will go); for a CS, the ones they asked for.
 * markSeen: the answers to what the caller asked for (on that student, or all) are seen — each still shows `new`
 * in this answer, then the sidebar stops counting it.
 */
export async function getPaymentLinks(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const markSeen = body?.markSeen === true;
  if (body?.studentId) {
    const student = await studentFor(body.studentId);
    if (!student) return notFound();
    if (!(await userCanReadDoc(user, "Student", student))) return forbidden();
    const list = await col(REQUESTS).find({ student_id: String(student._id) }).sort({ created_at: -1 }).limit(50).toArray();
    const requests = list.map((r) => view(r, user));
    if (markSeen && requests.some((r) => r.new)) await markAnswersSeen(user, { student_id: String(student._id) });
    return json({ can_request: mayRequest(user, student), can_approve: isSuperAdmin(user), currency: CURRENCY, requests });
  }

  if (user.app_role === "cs") {
    const list = await col(REQUESTS).find({ requested_by_id: user.id }).sort({ created_at: -1 }).limit(1000).toArray();
    const requests = list.map((r) => view(r, user));
    if (markSeen && requests.some((r) => r.new)) await markAnswersSeen(user);
    return json({ can_approve: false, requests });
  }
  if (!isSuperAdmin(user)) return forbidden("Only a Super Admin, or the CS who asked, sees payment link requests");
  const list = (await col(REQUESTS).find({}).sort({ created_at: -1 }).limit(2000).toArray()) as any[];
  const waiting = [...new Set(list.filter((r) => r.status === "pending").map((r) => r.student_id))].map(toObjectId).filter(Boolean) as ObjectId[];
  const students = waiting.length ? await col("students").find({ _id: { $in: waiting } }, { projection: { email: 1 } }).toArray() : [];
  const emailById = new Map(students.map((s: any) => [String(s._id), emailOf(s)]));
  return json({
    can_approve: true,
    email_ready: mailConfigured(),
    requests: list.map((r) => ({ ...view(r, user), ...(r.status === "pending" ? { student_email: emailById.get(r.student_id) ?? "" } : {}) })),
  });
}

/**
 * POST /api/functions/requestPaymentLink { studentId, platform, amount, description, note? }
 * The student's CS (or a CS they are Common with), on the platform the link should be made on
 * (tabby, tamara, smartinvoice, billxpro). Every Super Admin is told.
 */
export async function requestPaymentLink(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const student = await studentFor(body?.studentId);
  if (!student) return notFound();
  if (!mayRequest(user, student)) return forbidden("Only the student's CS (or a CS they are Common with) can ask for a payment link");

  const platform = platformOf(body?.platform);
  if (!platform) return error("Choose the platform — Tabby, Tamara, SmartInvoice or BillXpro", 400);
  const value = Number(String(body?.amount ?? "").replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return error("Enter the amount", 400);
  if (value > MAX_AMOUNT) return error(`That is more than ${MAX_AMOUNT.toLocaleString("en-US")} — check the amount`, 400);
  const amount = Math.round(value * 100) / 100;
  const description = str(body?.description, 200);
  if (!description) return error("Say what it is for", 400);
  const note = str(body?.note, 1000);
  const sid = String(student._id);

  const dup: any = await col(REQUESTS).findOne({
    student_id: sid, requested_by_id: user.id, platform, amount, description, status: "pending",
    created_at: { $gt: new Date(Date.now() - DUPLICATE_MS).toISOString() },
  });
  if (dup) return json({ request: view(dup, user), duplicate: true });

  const now = new Date().toISOString();
  const r: any = {
    _id: new ObjectId(),
    student_id: sid,
    student_name: str(student.full_name, 200),
    student_code: String(student.student_code ?? ""),
    team_name: String(student.team_name ?? ""),
    amount,
    currency: CURRENCY,
    platform,
    description,
    note,
    status: "pending",
    requested_by_id: user.id,
    requested_by_name: who(user),
    requested_by_email: user.email ?? "",
    created_at: now,
    updated_at: now,
  };
  await col(REQUESTS).insertOne(r);
  await recordHistory([{
    student_id: sid, at: now, type: "payment_link", text: `${cap(linkName(platform))} asked for: ${money(amount)} — ${description}`,
    by_id: user.id, by_name: who(user), to: { request_id: String(r._id), status: "pending" },
  }]);
  const admins = await col("users").find({ app_role: "super_admin", status: { $ne: "inactive" } }, { projection: { _id: 1 } }).toArray();
  await notify(admins.map((a: any) => String(a._id)), {
    type: "payment_link_request",
    title: "Payment link asked for",
    body: `${who(user)} asks for a ${PLATFORMS[platform]} link: ${money(amount)} for ${r.student_name} — ${description}`,
    link: "/PaymentLinks",
    tag: `payment-link-${r._id}`,
  });
  return json({ request: view(r, user) });
}

/**
 * POST /api/functions/approvePaymentLink { id, url, platform?, note?, email?: boolean }
 * Super Admin: the link they made, pasted in — on the platform the CS asked for, or on `platform` when they made it
 * elsewhere. Emailed to the student unless `email: false`; the CS who asked is told.
 */
export async function approvePaymentLink(req: Request, user: AuthUser): Promise<Response> {
  if (!isSuperAdmin(user)) return forbidden("Only a Super Admin approves payment links");
  const body: any = await req.json().catch(() => ({}));
  const r = await requestFor(body?.id);
  if (!r) return notFound();
  if (r.status !== "pending") return error(`This request is already ${STATUS_WORD[r.status] ?? r.status}`, 409);
  const url = cleanUrl(body?.url);
  if (!url) return error("Paste the payment link — a web address starting with https://", 400);
  if (body?.platform && !platformOf(body.platform)) return error("Choose the platform — Tabby, Tamara, SmartInvoice or BillXpro", 400);
  const madeOn = platformOf(body?.platform) || r.platform || "";

  const now = new Date().toISOString();
  const set = {
    status: "approved", url, ...(madeOn ? { made_on: madeOn } : {}), admin_note: str(body?.note, 1000),
    approved_by_id: user.id, approved_by_name: who(user), approved_at: now, updated_at: now,
  };
  // Two Super Admins at once: only the first one counts.
  const res = await col(REQUESTS).updateOne({ _id: r._id, status: "pending" }, { $set: set });
  if (res.modifiedCount !== 1) return error("Someone else dealt with this request just now — reload", 409);
  Object.assign(r, set);

  const student: any = await studentFor(r.student_id);
  if (body?.email !== false) {
    const to = emailOf(student);
    let emailError = "";
    if (!to) emailError = "There is no email on the student's record";
    else if (!mailConfigured()) emailError = "Email is not set up on this server";
    else {
      const m = linkEmail(r, student);
      const { asHtml, asText, logo } = onboardingEmail;   // Delta's email, as the welcome
      const sent = await sendMail({
        to, subject: m.subject, text: asText(m.text), html: asHtml(m.text, m.subject),
        fromName: "Delta Institutions", replyTo: r.requested_by_email || undefined, ...(logo ? { attachments: [logo] } : {}),
      });
      if (sent.ok) r.email = { to, subject: m.subject, at: new Date().toISOString(), message_id: sent.messageId };
      else emailError = sent.error;
    }
    if (emailError) r.email_error = emailError;
    await col(REQUESTS).updateOne({ _id: r._id }, { $set: r.email ? { email: r.email } : { email_error: emailError } });
  }

  await recordHistory([{
    student_id: r.student_id, at: now, type: "payment_link",
    text: `${cap(linkName(madeOn))} sent: ${money(r.amount)} — ${r.description}`
      + `${r.platform && madeOn !== r.platform ? ` (asked for ${PLATFORMS[r.platform]})` : ""}${r.email ? ` (emailed to ${r.email.to})` : ""}`,
    by_id: user.id, by_name: who(user), from: "pending", to: { request_id: String(r._id), status: "approved" },
  }]);
  await notify([r.requested_by_id], {
    type: "payment_link_ready",
    title: "Payment link ready",
    body: `${money(r.amount)} for ${r.student_name}${madeOn ? ` on ${PLATFORMS[madeOn]}` : ""}${r.email ? " — emailed to them." : "."} Copy it or send it on WhatsApp from their page.`,
    link: `/StudentDetail?id=${r.student_id}`,
    tag: `payment-link-${r._id}`,
  });
  return json({ request: view(r, user) });
}

/** POST /api/functions/rejectPaymentLink { id, reason } — Super Admin; the CS who asked sees why. */
export async function rejectPaymentLink(req: Request, user: AuthUser): Promise<Response> {
  if (!isSuperAdmin(user)) return forbidden("Only a Super Admin turns down payment link requests");
  const body: any = await req.json().catch(() => ({}));
  const r = await requestFor(body?.id);
  if (!r) return notFound();
  if (r.status !== "pending") return error(`This request is already ${STATUS_WORD[r.status] ?? r.status}`, 409);
  const reason = str(body?.reason, 1000);
  if (!reason) return error("Say why — the CS sees it", 400);

  const now = new Date().toISOString();
  const set = { status: "rejected", reject_reason: reason, rejected_by_id: user.id, rejected_by_name: who(user), rejected_at: now, updated_at: now };
  const res = await col(REQUESTS).updateOne({ _id: r._id, status: "pending" }, { $set: set });
  if (res.modifiedCount !== 1) return error("Someone else dealt with this request just now — reload", 409);
  Object.assign(r, set);
  await recordHistory([{
    student_id: r.student_id, at: now, type: "payment_link", text: `${cap(linkName(r.platform))} turned down: ${money(r.amount)} — ${r.description} (${reason})`,
    by_id: user.id, by_name: who(user), from: "pending", to: { request_id: String(r._id), status: "rejected" },
  }]);
  await notify([r.requested_by_id], {
    type: "payment_link_rejected",
    title: "Payment link turned down",
    body: `${money(r.amount)} for ${r.student_name}: ${reason}`,
    link: `/StudentDetail?id=${r.student_id}`,
    tag: `payment-link-${r._id}`,
  });
  return json({ request: view(r, user) });
}

/** POST /api/functions/cancelPaymentLinkRequest { id } — whoever asked, while it is still waiting. */
export async function cancelPaymentLinkRequest(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const r = await requestFor(body?.id);
  if (!r) return notFound();
  if (r.requested_by_id !== user.id) return forbidden("Only who asked for it can cancel it");
  if (r.status !== "pending") return error(`This request is already ${STATUS_WORD[r.status] ?? r.status}`, 409);
  const now = new Date().toISOString();
  const res = await col(REQUESTS).updateOne({ _id: r._id, status: "pending" }, { $set: { status: "cancelled", cancelled_at: now, updated_at: now } });
  if (res.modifiedCount !== 1) return error("A Super Admin dealt with it just now — reload", 409);
  Object.assign(r, { status: "cancelled", cancelled_at: now });
  await recordHistory([{
    student_id: r.student_id, at: now, type: "payment_link", text: `${cap(linkName(r.platform))} request cancelled: ${money(r.amount)} — ${r.description}`,
    by_id: user.id, by_name: who(user), from: "pending", to: { request_id: String(r._id), status: "cancelled" },
  }]);
  return json({ request: view(r, user) });
}
