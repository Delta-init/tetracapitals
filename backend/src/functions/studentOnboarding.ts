import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { visibleMentorIds, isStudentOf } from "../students/followups";
import { recordHistory } from "../students/history";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { sendMail, mailConfigured, type MailAttachment } from "../lib/mailer";
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

/**
 * The welcome — the Academic Department's (2026-10-02), the same words for the email and the WhatsApp. Text between
 * *stars* is bold: WhatsApp shows it so, and the email turns it into bold (the email's plain-text part drops them).
 */
const WELCOME = `Dear {name},

Welcome to Delta Trading Academy! We’re delighted to have you join our institution and are excited to support you on your trading journey.

*Getting Started with the LMS*
All classes, schedules, session bookings, and updates are now managed through our Learning Management System (LMS). Please complete your registration to activate your Student Portal access:

1. Visit the LMS Student Portal: lms.deltainstitutions.com/register?flow=full
2. Complete your details and submit — your registration is typically reviewed and approved by our Admin team within 24 hours.
3. Once approved, log in to access your dashboard, class schedule, and course materials.

A short tutorial video covering the LMS features will also be shared with you separately — we recommend watching it before your first class.

*Important Terms and Conditions*

1. *Minimum Capital Requirements:*
   - For trading courses (e.g., MBT), a minimum deposit of $99 in your live trading account is required ahead of the Module 6 examination. Please ensure your trading account is created and funded in time.
   - Live Trade slots must be pre-booked through the LMS Student Portal.

2. *Class Schedule:*
   - Classes will strictly follow the timetable published on the LMS Student Portal. No additional classes will be provided beyond what is listed.
   - All class updates, rescheduling, and mentor changes will be notified through the LMS.

3. *Homework:*
   - Homework must be completed before attending the next class. Homework details will be available on the LMS portal (Assignment section).

4. *Behavioral Expectations:*
   - Students must behave respectfully towards the faculty and staff at all times.

5. *Punctuality (Important):*
   - Students are expected to be on time for all classes as per the LMS timetable.

6. *Liability for Damages:*
   - Students will be responsible for any damages to company assets.

7. *Office Hours:*
   - The office is open from 10:00 AM to 08:00 PM. You may come for practice sessions within this timeframe after confirming with the academic department.

8. *No Refund Policy (Important):*
   - Please note that there is a strict no-refund policy.

9. *Issues or Suggestions:*
   - Please raise it through the LMS Student Help & Support Section.

10. *Help or Assistance:*
   - For academic support, contact us at academics@deltainstitutions.com or call 971 52 157 0613.

By completing your registration, you confirm your agreement to the terms outlined above.

*Community Channels*
To foster collaboration and communication, please join our community channels using the links below:

- Student Online Community: https://chat.whatsapp.com/DIXG2tN38ePJGvubmHg63j

Once again, welcome to Delta Trading Academy. We look forward to your active participation and commitment. Should you have any questions or require further assistance regarding the LMS or your course, please do not hesitate to contact us.

Best regards,

Academic Department
Delta International Trading Academy Al Qusais, near Al Qusais
Health Centre, Dubai
Al Tawar 5, #Villa 25
T: 971 4 399 9128
M: 971 52 419 2022
www.deltainstitutions.com`;

/** The welcome for this student — the email (subject, message) and the WhatsApp (the same message). */
function welcome(s: any) {
  const name = firstName(s.full_name);
  const message = WELCOME.replace("{name}", name || "Student");
  return { subject: `Welcome to Delta Trading Academy${name ? `, ${name}` : ""}!`, body: message, text: message };
}

/* The email: the message as written, in Delta's colours under the logo (sent with the email, so it shows at once). */
const NAVY = "#0b2a4d", TEAL = "#0e7490", INK = "#1f2937", MUTED = "#64748b";
const LOGO_FILE = join(import.meta.dir, "../../assets/delta-logo-email.png");
const LOGO: MailAttachment | null = existsSync(LOGO_FILE) ? { filename: "delta-logo.png", path: LOGO_FILE, cid: "delta-logo@deltainstitutions.com" } : null;

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** One line: *bold*, and web addresses and email addresses clickable. */
function inline(line: string): string {
  return esc(line)
    .replace(/\*([^*\n]+)\*/g, `<strong style="color:${NAVY}">$1</strong>`)
    .replace(/([\w.+-]+@[\w-]+(?:\.[\w-]+)+)|((?:https?:\/\/|www\.)[^\s<]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|ae)\/[^\s<]*)/gi, (m, email: string | undefined) => {
      const tail = m.match(/[.,;:)]+$/)?.[0] ?? "", link = tail ? m.slice(0, -tail.length) : m;
      const href = email ? `mailto:${link}` : /^https?:\/\//i.test(link) ? link : `https://${link}`;
      return `<a href="${href}" style="color:${TEAL};text-decoration:underline">${link}</a>${tail}`;
    });
}
const row = (mark: string, html: string, indent: number) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:5px 0 5px ${indent}px"><tr>` +
  `<td valign="top" style="width:${mark === "•" ? 16 : 28}px;font-weight:700;color:${mark === "•" ? TEAL : NAVY};font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6">${mark}</td>` +
  `<td style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${INK}">${html}</td></tr></table>`;
/** The message as an email: *titles* on their own line as headings, "1." and "-" lines as lists, the rest as paragraphs. */
function asHtml(text: string, subject: string): string {
  const blocks: string[] = [];
  for (const para of text.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = para.split("\n").filter((l) => l.trim());
    if (lines.length && /^\*[^*]+\*$/.test(lines[0]!.trim())) {
      blocks.push(`<h2 style="margin:26px 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:1.4;color:${NAVY}">${esc(lines.shift()!.trim().slice(1, -1))}</h2>`);
    }
    if (!lines.length) continue;
    let html = "", plain: string[] = [], numbered = false;
    const flush = () => { if (plain.length) { html += `<p style="margin:0 0 4px">${plain.map(inline).join("<br>")}</p>`; plain = []; } };
    for (const line of lines) {
      const num = /^\s*(\d+)\.\s+(.+)$/.exec(line), dot = /^\s*[-•]\s+(.+)$/.exec(line);
      if (num) { flush(); html += row(`${num[1]}.`, inline(num[2]!), 0); numbered = true; }
      else if (dot) { flush(); html += row("•", inline(dot[1]!), numbered ? 28 : 0); }
      else plain.push(line.trim());
    }
    flush();
    blocks.push(`<div style="margin:0 0 14px">${html}</div>`);
  }
  const logo = LOGO
    ? `<img src="cid:${LOGO.cid}" alt="Delta Institutions" width="160" style="display:block;width:160px;max-width:160px;height:auto;border:0;outline:none">`
    : `<div style="font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:700;color:${NAVY}">Delta Institutions</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f1f5f9">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">` +
    `<tr><td align="center" style="padding:28px 24px 22px">${logo}</td></tr>` +
    `<tr><td style="height:4px;line-height:4px;font-size:0;background-color:#22d3ee;background-image:linear-gradient(90deg,#22d3ee,#6ee7b7)">&nbsp;</td></tr>` +
    `<tr><td style="padding:26px 32px 12px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${INK}">${blocks.join("")}</td></tr>` +
    `<tr><td align="center" style="padding:16px 32px 22px;border-top:1px solid #e2e8f0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:${MUTED}">` +
    `Delta International Trading Academy · Al Qusais, Dubai · <a href="https://www.deltainstitutions.com" style="color:${TEAL}">www.deltainstitutions.com</a></td></tr>` +
    `</table></td></tr></table></body></html>`;
}
/** The email's plain-text part: the message without the *stars*. */
const asText = (text: string) => text.replace(/\*([^*\n]+)\*/g, "$1");
/** The welcome and its email, for tests and previews. */
export const onboardingEmail = { welcome, asHtml, asText, logo: LOGO };

/** POST /api/functions/getOnboardingDraft { studentId } — what the Onboarding window opens with. */
export async function getOnboardingDraft(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const s = await studentFor(body, user);
  if (s instanceof Response) return s;
  const w = welcome(s);
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
      const r = await sendMail({ to, subject, text: asText(message), html: asHtml(message, subject), fromName: "Delta Institutions", replyTo: user.email || undefined,
        ...(LOGO ? { attachments: [LOGO] } : {}) });
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
