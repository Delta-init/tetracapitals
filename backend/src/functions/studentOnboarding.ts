import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { visibleMentorIds, isStudentOf } from "../students/followups";
import { recordHistory } from "../students/history";
import { courseLabel } from "../students/tags";
import { sendMail, mailConfigured } from "../lib/mailer";
import { status as whatsAppStatus, sendText, intlNumbers } from "../whatsapp/service";

/* ────────────────────────────────────────────────────────────────────────────
   Onboarding: a student is Onboarded once they have been sent their welcome —
   an email (from the portal's mailbox, as "Delta Institutions"; a reply goes to
   whoever sent it) and/or a WhatsApp (from the sending CS's own WhatsApp) — or
   marked so without sending (welcomed before the portal had this). Changed by
   the student's CS (or a CS they are Common with), the people above them and
   admins, as Enrolled; each change is in the student's history.

     POST /api/functions/getOnboardingDraft { studentId }
          → the welcome written for them, to change before it goes
     POST /api/functions/setOnboarding { studentId, onboarded: false }  → Not onboarded
     POST /api/functions/setOnboarding { studentId, onboarded: true }   → Onboarded, nothing sent
     POST /api/functions/setOnboarding { studentId, onboarded: true,
          email?: { to, subject, body }, whatsapp?: { to, text } }
          → sent; Onboarded once at least one of them has gone
──────────────────────────────────────────────────────────────────────────── */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLOSED_PREFIX = "Closed - ";
const who = (u: AuthUser) => u.full_name || u.email || "somebody";

/** The student, when this person may onboard them — or the answer saying why not. */
async function studentFor(body: any, user: AuthUser): Promise<any> {
  const oid = toObjectId(String(body?.studentId ?? ""));
  if (!oid) return error("studentId is required", 400);
  const s: any = await col("students").findOne({ _id: oid });
  if (!s) return notFound();
  const visible = await visibleMentorIds(user);
  if (visible && !isStudentOf(s, visible)) {
    return forbidden("Only this student's CS (or a CS they are Common with), the people above them and admins can onboard them");
  }
  return s;
}

/** "SANJU K" / "sanju k" → "Sanju": the first name, as a person would write it. */
function firstName(full: unknown): string {
  const first = String(full ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first) return "";
  return first === first.toUpperCase() || first === first.toLowerCase() ? first[0]!.toUpperCase() + first.slice(1).toLowerCase() : first;
}

/** Their courses: the "Closed - <course>" tags, and the LMS's. */
function coursesOf(s: any): string[] {
  const tags = (Array.isArray(s.tags) ? s.tags : [])
    .filter((t: unknown): t is string => typeof t === "string" && t.startsWith(CLOSED_PREFIX))
    .map((t: string) => t.slice(CLOSED_PREFIX.length).trim());
  return [...new Set([...tags, ...(s.lms_course ? [courseLabel(s.lms_course)] : [])].filter(Boolean))];
}
const and = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The welcome, written for this student by the person sending it — the email and the WhatsApp. */
function welcome(s: any, user: AuthUser) {
  const name = firstName(s.full_name);
  const me = who(user);
  const cs = user.app_role === "cs";
  const course = and(coursesOf(s));
  const toCourse = course ? ` — and to ${course}` : "";
  const subject = `Welcome to Delta Institutions${name ? `, ${name}` : ""}!`;
  const body = [
    name ? `Dear ${name},` : "Hello,",
    `Welcome to Delta Institutions${toCourse}! We're delighted to have you with us.`,
    cs
      ? `I'm ${me}, your Client Success contact. I'll help you get set up — access to your learning platform, your class schedule and anything else you need — and I'll be with you throughout your journey with us.`
      : `I'm ${me} from the Delta Institutions team. We'll help you get set up — access to your learning platform, your class schedule and anything else you need — and we'll be with you throughout your journey with us.`,
    `If you have any questions, simply reply to this email${cs ? " or message me on WhatsApp" : ""}.`,
    [`Warm regards,`, me, cs ? "Client Success · Delta Institutions" : "Delta Institutions", user.email ?? ""].filter(Boolean).join("\n"),
  ].join("\n\n");
  const text = [
    `Hi${name ? ` ${name}` : ""} 👋`,
    `Welcome to Delta Institutions${toCourse}! I'm ${me}, your Client Success contact. I'll help you get set up, and I'm here for any questions along the way.`,
    `Feel free to message me here anytime 🙂`,
  ].join("\n\n");
  return { subject, body, text };
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** The message as written, as an email: its paragraphs and line breaks. */
const asHtml = (text: string) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;max-width:600px">` +
  text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("") +
  `</div>`;

/** POST /api/functions/getOnboardingDraft { studentId } — what the Onboarding window opens with. */
export async function getOnboardingDraft(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const s = await studentFor(body, user);
  if (s instanceof Response) return s;
  const w = welcome(s, user);
  const emails = String(s.email ?? "").match(/[^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+/g) ?? [];
  const numbers = intlNumbers(s.phone);
  const whatsAppWhyNot = user.app_role !== "cs" ? "WhatsApp goes from a CS's own WhatsApp — only a CS can send it"
    : whatsAppStatus(user.id).status !== "connected" ? "Your WhatsApp is not linked — link it on the WhatsApp page" : "";
  return json({
    onboarded: s.onboarded === true,
    onboarded_at: s.onboarded_at ?? null,
    onboarded_by_name: s.onboarded_by_name ?? "",
    sent_before: s.onboarding ?? null,
    email: {
      to: emails[0] ?? "", subject: w.subject, body: w.body, reply_to: user.email ?? "",
      can_send: mailConfigured(), why_not: mailConfigured() ? "" : "Email is not set up on this server",
    },
    whatsapp: { to: numbers[0] ?? "", numbers, text: w.text, can_send: !whatsAppWhyNot, why_not: whatsAppWhyNot },
  });
}

/** POST /api/functions/setOnboarding — see the top of this file. */
export async function setOnboarding(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const s = await studentFor(body, user);
  if (s instanceof Response) return s;
  const now = new Date().toISOString();
  const by = who(user);
  const base = { student_id: String(s._id), at: now, by_id: user.id, by_name: by };
  const was = s.onboarded === true;

  if (body?.onboarded !== true) {
    if (!was) return json({ onboarded: false, unchanged: true });
    await col("students").updateOne({ _id: s._id }, {
      $set: { onboarded: false, updated_date: now },
      $unset: { onboarded_at: "", onboarded_by_id: "", onboarded_by_name: "" },
    });
    await recordHistory([{ ...base, type: "onboarding_changed", text: "Marked as not onboarded", from: true, to: false }]);
    return json({ onboarded: false });
  }

  const email = body?.email && typeof body.email === "object" ? body.email : null;
  const whatsapp = body?.whatsapp && typeof body.whatsapp === "object" ? body.whatsapp : null;
  const sent: { email?: Record<string, string>; whatsapp?: Record<string, string> } = {};
  const failed: { email?: string; whatsapp?: string } = {};

  if (email) {
    const to = String(email.to ?? "").trim(), subject = String(email.subject ?? "").trim().slice(0, 300);
    const message = String(email.body ?? "").trim().slice(0, 20_000);
    if (!EMAIL.test(to)) failed.email = "That is not an email address";
    else if (!subject || !message) failed.email = "The email needs a subject and a message";
    else {
      const r = await sendMail({ to, subject, text: message, html: asHtml(message), fromName: "Delta Institutions", replyTo: user.email || undefined });
      if (r.ok) sent.email = { to, subject, at: now, message_id: r.messageId };
      else failed.email = r.error;
    }
  }
  if (whatsapp) {
    const to = String(whatsapp.to ?? "").trim().slice(0, 40), text = String(whatsapp.text ?? "").trim().slice(0, 4000);
    if (user.app_role !== "cs") failed.whatsapp = "WhatsApp goes from a CS's own WhatsApp — only a CS can send it";
    else if (!to || !text) failed.whatsapp = "WhatsApp needs a number and a message";
    else {
      try {
        const saved = await sendText({ id: user.id, name: by }, to, text);
        sent.whatsapp = { to: String(saved?.chat || to), at: now };
      } catch (err) {
        failed.whatsapp = err instanceof Error ? err.message : "WhatsApp did not answer";
      }
    }
  }

  const markOnly = !email && !whatsapp;
  if (!markOnly && !sent.email && !sent.whatsapp) {
    return error(`Nothing was sent — ${[failed.email && `email: ${failed.email}`, failed.whatsapp && `WhatsApp: ${failed.whatsapp}`].filter(Boolean).join("; ")}`, 502);
  }
  if (markOnly && was) return json({ onboarded: true, unchanged: true });

  const set: Record<string, unknown> = { onboarded: true, onboarded_at: now, onboarded_by_id: user.id, onboarded_by_name: by, updated_date: now };
  if (!markOnly) set.onboarding = { ...sent, by_id: user.id, by_name: by, at: now };
  await col("students").updateOne({ _id: s._id }, { $set: set });

  const went = [sent.email && `welcome email to ${sent.email.to}`, sent.whatsapp && `WhatsApp to ${/^\d+$/.test(sent.whatsapp.to!) ? `+${sent.whatsapp.to}` : sent.whatsapp.to}`].filter(Boolean).join(" and ");
  const missed = [failed.email && `the email did not go: ${failed.email}`, failed.whatsapp && `the WhatsApp did not go: ${failed.whatsapp}`].filter(Boolean).join("; ");
  await recordHistory([{
    ...base, type: "onboarding_changed",
    text: markOnly ? "Marked as onboarded — no message sent" : `${was ? "Onboarding sent again" : "Onboarded"} — ${went} sent${missed ? ` (${missed})` : ""}`,
    from: was, to: markOnly ? true : { onboarded: true, ...sent },
  }]);
  return json({ onboarded: true, sent, failed });
}
