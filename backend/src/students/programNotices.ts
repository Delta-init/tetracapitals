import { randomBytes } from "node:crypto";
import { col } from "../db";
import { config } from "../config";
import { sendMail, mailConfigured } from "../lib/mailer";
import { notify } from "../lib/notify";
import { locationOfUser } from "../lib/userLocation";
import { onboardingEmail } from "../functions/studentOnboarding";
import { status as whatsAppStatus, sendText, intlNumbers } from "../whatsapp/service";

/* ────────────────────────────────────────────────────────────────────────────
   Program messages (the user, 2026-10-15) — the students picked for a program
   (when it is made, and any added later) are told by email and on WhatsApp,
   and asked to confirm. Four templates (the user's names):

     program_enrolment        WhatsApp, from the student's own CS's WhatsApp
     program_enrolment_email  email, as "Delta Institutions", with Open my LMS
                              and Confirm my seat buttons
     program_confirmed        WhatsApp, once they confirm
     program_confirmed_email  email, once they confirm

   They confirm by replying YES to the WhatsApp (NO: "can't attend", their CS
   told), by the email's Confirm my seat page (a secret link for that student
   and program — a button there, so a mail scanner opening it confirms
   nothing), or their CS marks it by hand. A CS's own WhatsApp can't show
   buttons (only a Business number can), so the WhatsApp asks for a reply.

   Each student's messages and answer: program_notices (one per program and
   student email). A CS whose WhatsApp isn't linked: the email still goes, the
   WhatsApp is noted not sent, with why, to Resend later. WhatsApps go one at
   a time, a few seconds apart, so a big program doesn't flood a CS's number.
   Times in Dubai — India time for a Bangalore team's student.
   PROGRAM_NOTICES=off on the server sends nothing.
──────────────────────────────────────────────────────────────────────────── */

export const PROGRAM_NOTICES = "program_notices";
/* Students picked who have no LMS account (the user, 2026-10-15): the LMS can't book them, so the portal keeps them
   on the program as guests (program_guests: program_id, email, student_id, name) — they get the same messages, with the
   Google Meet link instead of "it's in your LMS", and a WhatsApp with each class's link before it starts. */
export const PROGRAM_GUESTS = "program_guests";
const GUEST_REMINDERS = "program_guest_reminders";
const REMIND_BEFORE_MS = 30 * 60_000;
const LMS_URL = "https://lms.deltainstitutions.com";
const WA_GAP_MS = Number(process.env.PROGRAM_NOTICES_GAP_MS ?? 5000);
const off = () => /^(off|false|0|no)$/i.test(process.env.PROGRAM_NOTICES ?? "");
/* No program WhatsApps from a CS's own WhatsApp (the user, 2026-10-15): program WhatsApps go only from the LMS, through
   its Business number (Creatyvot). The emails, the Confirm my seat page and the guests' class links (by email now)
   carry on. PROGRAM_CS_WHATSAPP=on brings the CS WhatsApps back. */
const csWhatsAppOn = () => /^(on|true|1|yes)$/i.test(process.env.PROGRAM_CS_WHATSAPP ?? "");
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const firstName = (full: unknown) => String(full ?? "").trim().split(/\s+/)[0] || "there";
const ordinal = (n: number) => `${n}${[11, 12, 13].includes(n % 100) ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} & ${xs[xs.length - 1]}`);

/* ── The wording ─────────────────────────────────────────────────────────── */

/** "Every Monday & Wednesday" / "Every month on the 5th". */
export function daysText(p: any): string {
  if (p?.repeat === "monthly") return p?.monthDay ? `Every month on the ${ordinal(Number(p.monthDay))}` : "Every month";
  const days = [...new Set((p?.weekdays ?? []).map(Number))].sort((a: any, b: any) => ((a + 6) % 7) - ((b + 6) % 7)) as number[];
  return days.length === 7 ? "Every day" : `Every ${list(days.map((d) => DAY_NAMES[d] ?? "").filter(Boolean))}`;
}
const dateText = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

/** The Meet link a guest joins by: the program's own, else the next class's room ("" in person or before the LMS has one). */
export function meetLinkOf(p: any): string {
  if (p?.isOnline === false) return "";
  if (p?.meetingMode === "link" && p?.meetingUrl) return String(p.meetingUrl);
  const now = Date.now();
  const next = (p?.classes ?? []).find((c: any) => c.status === "scheduled" && c.meetUrl && new Date(c.startsAt).getTime() + (Number(p?.durationMins) || 60) * 60_000 > now);
  return next ? String(next.meetUrl) : "";
}

/** The details a student's messages show — times in their own academy's zone; a guest (no LMS account) the Meet link. */
export function detailsFor(p: any, tz: "Asia/Dubai" | "Asia/Kolkata", guest = false) {
  const zone = tz === "Asia/Kolkata" ? "India time" : "Dubai time";
  const next = p?.nextClassAt ? new Date(p.nextClassAt) : null;
  const at = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  const onDay = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: tz });
  // The time: from a real class (so India time is right), else the program's own (Dubai) time.
  const time = next ? at(next) : (() => { const [h, m] = String(p?.time ?? "").split(":").map(Number); return Number.isFinite(h) ? at(new Date(Date.UTC(2000, 0, 1, h! - 4, m || 0))) : String(p?.time ?? ""); })();
  // A student added after it started: from their next class, not a date gone by.
  const startDay = String(p?.startDate ?? "");
  const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
  const from = next && (!startDay || startDay < today) ? onDay(next) : dateText(startDay);
  return {
    title: String(p?.title ?? "the program"),
    mentor: String(p?.mentor?.name ?? "").trim() || "our mentor",
    days: daysText(p),
    time, zone,
    duration: `${Number(p?.durationMins) || 60} minutes`,
    start: from,
    end: dateText(String(p?.endDate ?? "")),
    where: p?.isOnline === false ? String(p?.location ?? "").trim() || "At the academy"
      : guest ? (meetLinkOf(p) ? `Online — Google Meet: ${meetLinkOf(p)}` : "Online (Google Meet — we send you the link before each class)")
      : "Online (Google Meet, the link is in your LMS)",
    firstClass: next ? onDay(next) : from,
    guest,
    meet: guest ? meetLinkOf(p) : "",
  };
}
export type Details = ReturnType<typeof detailsFor>;

/** The four templates, filled. */
export const templates = {
  program_enrolment: (name: string, d: Details, cs: string) =>
    `Hi ${name} 👋\n\n` +
    `You've been enrolled in *${d.title}* at Delta Institutions with ${d.mentor}.\n\n` +
    `📅 ${d.days}\n⏰ ${d.time} (${d.zone}) · ${d.duration}\n🗓️ From ${d.start} to ${d.end}\n📍 ${d.where}\n\n` +
    (d.guest
      ? `Join on Google Meet${d.meet ? `: ${d.meet}` : ""} — we'll also send you each class's link before it starts. Ask ${cs || "your counsellor"} for an LMS account to see your classes there too.\n\n`
      : `The classes are already in your LMS account under Live Classes — join each one from there.\n\n`) +
    `Please reply *YES* to confirm you'll attend, or *NO* if this timing doesn't suit you.\n\n` +
    `${cs ? `${cs}, your Delta Institutions counsellor` : "Delta Institutions"}`,
  program_confirmed: (name: string, d: Details, cs: string) =>
    `Thank you ${name} ✅\n\n` +
    `Your seat in *${d.title}* is confirmed. Your first class is on ${d.firstClass} at ${d.time} (${d.zone}).\n\n` +
    `We'll remind you before each class. If you ever can't make it, just message us here.\n\n` +
    `See you there!\n${cs ? `${cs}, Delta Institutions` : "Delta Institutions"}`,
  program_enrolment_email: (name: string, d: Details, cs: string) => ({
    subject: `You're enrolled: ${d.title} starts ${d.start}`,
    body:
      `Dear ${name},\n\n` +
      `You have been enrolled in *${d.title}* at Delta Institutions, led by ${d.mentor}.\n\n` +
      `*Schedule*\n- Days: ${d.days}\n- Time: ${d.time} (${d.zone}), ${d.duration}\n- Dates: ${d.start} to ${d.end}\n- Where: ${d.where}\n\n` +
      (d.guest
        ? `*How to join*\nJoin on Google Meet${d.meet ? ` — ${d.meet}` : ""}. We'll send you each class's link before it starts.${cs ? ` Ask ${cs} for an LMS account to see your classes there too.` : ""}\n\n`
        : `*How to join*\nLog in to your LMS account and open Live Classes — each class is there to join.\n\n`) +
      `Please confirm your seat with the button below${cs ? `, or tell ${cs}, your counsellor, on WhatsApp` : ""}.\n\n` +
      `${cs ? `If you have any questions, contact ${cs}, your counsellor.\n\n` : ""}` +
      `Warm regards,\nDelta Institutions`,
  }),
  program_confirmed_email: (name: string, d: Details, cs: string) => ({
    subject: `Your seat is confirmed: ${d.title}`,
    body:
      `Dear ${name},\n\n` +
      `Thank you for confirming. Your seat in *${d.title}* is reserved.\n\n` +
      `- First class: ${d.firstClass} at ${d.time} (${d.zone})\n- Schedule: ${d.days}, until ${d.end}\n\n` +
      `We'll send you a reminder before each class.\n\n` +
      `Warm regards,\n${cs ? `${cs}\n` : ""}Delta Institutions`,
  }),
};

/** The email as the welcome email looks, with its buttons above the footer. */
export function emailHtml(body: string, subject: string, buttons: { label: string; url: string; color: string }[]): string {
  const html = onboardingEmail.asHtml(body, subject);
  if (!buttons.length) return html;
  const row = `<tr><td align="center" style="padding:4px 32px 26px">` + buttons.map((b) =>
    `<a href="${b.url}" style="display:inline-block;margin:4px 6px;padding:12px 26px;border-radius:999px;background:${b.color};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;text-decoration:none">${b.label}</a>`).join("") + `</td></tr>`;
  const footer = `<tr><td align="center" style="padding:16px 32px 22px;border-top`;
  return html.includes(footer) ? html.replace(footer, row + footer) : html;
}
const confirmUrl = (token: string) => `${config.publicBaseUrl.replace(/\/+$/, "")}/api/programs/confirm/${token}`;

/* ── Sending ─────────────────────────────────────────────────────────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let waQueue: Promise<unknown> = Promise.resolve();
/** WhatsApps one after another, a gap between — across every program being sent at once. */
const queued = <T>(run: () => Promise<T>): Promise<T> => {
  const next = waQueue.then(run, run);
  waQueue = next.then(() => sleep(WA_GAP_MS), () => sleep(WA_GAP_MS));
  return next;
};

/** Who a student is in the portal, and their CS. */
async function portalStudent(email: string) {
  const s: any = await col("students").findOne({ email: new RegExp(`^${esc(email)}$`, "i") },
    { projection: { full_name: 1, phone: 1, email: 1, primary_mentor_id: 1, primary_mentor_name: 1 } });
  return s;
}
// (locationOfUser answers "bangalore" in lower case — compared as such: before 2026-10-15 every student got Dubai time.)
const tzOf = async (csId: string) => (String(await locationOfUser(csId).catch(() => "")).toLowerCase() === "bangalore" ? "Asia/Kolkata" : "Asia/Dubai") as "Asia/Dubai" | "Asia/Kolkata";

async function sendWhatsApp(csId: string, csName: string, phone: unknown, text: string) {
  if (!csWhatsAppOn()) return { status: "skipped", why: "Program WhatsApps go from the LMS, not a CS's WhatsApp" };
  if (!csId) return { status: "skipped", why: "The student has no CS" };
  const number = intlNumbers(phone)[0];
  if (!number) return { status: "skipped", why: "No phone number on the student" };
  if (whatsAppStatus(csId).status !== "connected") return { status: "skipped", why: `${csName || "Their CS"}'s WhatsApp is not linked` };
  return queued(async () => {
    try {
      const saved: any = await sendText({ id: csId, name: csName }, number, text);
      return { status: "sent", to: String(saved?.chat || number), at: new Date().toISOString() };
    } catch (err) {
      return { status: "failed", why: err instanceof Error ? err.message : "WhatsApp did not answer" };
    }
  });
}

async function sendEmail(to: string, mail: { subject: string; body: string }, buttons: { label: string; url: string; color: string }[], replyTo?: string) {
  if (!to) return { status: "skipped", why: "No email" };
  if (!mailConfigured()) return { status: "skipped", why: "Email is not set up on this server" };
  const logo = onboardingEmail.logo;
  const r: any = await sendMail({ to, subject: mail.subject, text: onboardingEmail.asText(mail.body) + buttons.map((b) => `\n\n${b.label}: ${b.url}`).join(""),
    html: emailHtml(mail.body, mail.subject, buttons), fromName: "Delta Institutions", log: { kind: "Program" }, ...(replyTo ? { replyTo } : {}), ...(logo ? { attachments: [logo] } : {}) })
    .catch((err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return r?.ok === false || r?.sent === false ? { status: "failed", why: String(r?.error ?? r?.reason ?? "The email did not go") } : { status: "sent", at: new Date().toISOString() };
}

/**
 * Tell these students (default: every student on it) about a program they're on — once each, unless `again`.
 * Returns at once; the sending carries on in the background.
 */
export async function sendProgramNotices(program: any, emails?: string[], opts: { again?: boolean; by?: string } = {}): Promise<number> {
  if (off() || !program?.id) return 0;
  const on = new Map<string, any>((program.students ?? []).map((s: any) => [String(s.email ?? "").toLowerCase(), s]));
  const want = (emails ?? [...on.keys()]).map((e) => e.toLowerCase()).filter((e) => on.has(e));
  let started = 0;
  for (const email of want) {
    const key = { program_id: String(program.id), student_email: email };
    const had: any = await col(PROGRAM_NOTICES).findOne(key);
    if (had && !opts.again) continue;
    const s = await portalStudent(email);
    const csId = String(s?.primary_mentor_id ?? ""), csName = String(s?.primary_mentor_name ?? "").trim();
    const token = had?.token || randomBytes(24).toString("base64url");
    await col(PROGRAM_NOTICES).updateOne(key, {
      $set: { ...key, program_title: String(program.title ?? ""), student_id: s ? String(s._id) : "", student_name: s?.full_name || on.get(email)?.name || "",
        cs_id: csId, cs_name: csName, token, sending: true, sent_by: opts.by ?? "", sent_at: new Date().toISOString() },
      $setOnInsert: { response: null, created_at: new Date().toISOString() },
    }, { upsert: true });
    started++;
    void (async () => {
      const guest = on.get(email)?.guest === true;
      const d = detailsFor(program, await tzOf(csId), guest);
      const name = firstName(s?.full_name || on.get(email)?.name);
      const mail = templates.program_enrolment_email(name, d, csName);
      // A guest has no LMS to open: the Meet link instead, when there is one.
      const first = guest ? (d.meet ? [{ label: "Join on Google Meet", url: d.meet, color: "#0f766e" }] : []) : [{ label: "Open my LMS", url: LMS_URL, color: "#0f766e" }];
      const [mailed, whatsapp] = await Promise.all([
        sendEmail(email, mail, [...first, { label: "Confirm my seat", url: confirmUrl(token), color: "#16a34a" }]),
        sendWhatsApp(csId, csName, s?.phone, templates.program_enrolment(name, d, csName)),
      ]);
      await col(PROGRAM_NOTICES).updateOne(key, { $set: { email: mailed, whatsapp, sending: false } });
    })().catch((err) => {
      console.error("[programs] could not send a program's messages", err);
      void col(PROGRAM_NOTICES).updateOne(key, { $set: { sending: false, email: { status: "failed", why: "Sending stopped — try Resend" } } });
    });
  }
  return started;
}

/* ── The answer ──────────────────────────────────────────────────────────── */

/** Confirmed or can't attend — the confirmation messages on a yes; their CS told on a no. */
export async function recordAnswer(notice: any, answer: "confirmed" | "declined" | null, via: string, program?: any): Promise<void> {
  const key = { program_id: notice.program_id, student_email: notice.student_email };
  await col(PROGRAM_NOTICES).updateOne(key, { $set: { response: answer, responded_via: answer ? via : "", responded_at: answer ? new Date().toISOString() : null } });
  if (answer === "declined" && notice.cs_id && via !== "by hand") {
    void notify([notice.cs_id], {
      type: "program_declined", title: `Can't attend · ${notice.program_title}`,
      body: `${notice.student_name || notice.student_email} said the timing doesn't suit them.`, link: "/Programs", tag: `program-${notice.program_id}`,
    }).catch(() => {});
  }
  if (answer !== "confirmed" || notice.confirmed_sent || off()) return;
  await col(PROGRAM_NOTICES).updateOne(key, { $set: { confirmed_sent: { at: new Date().toISOString() } } });
  void (async () => {
    const p = program ?? (await import("../lib/lms")).callLms(`/programs/${notice.program_id}`, { verb: "find the program" });
    const d = detailsFor(await p, await tzOf(notice.cs_id));
    const s = await portalStudent(notice.student_email);
    const name = firstName(s?.full_name || notice.student_name);
    const [mailed, whatsapp] = await Promise.all([
      sendEmail(notice.student_email, templates.program_confirmed_email(name, d, notice.cs_name), []),
      sendWhatsApp(notice.cs_id, notice.cs_name, s?.phone, templates.program_confirmed(name, d, notice.cs_name)),
    ]);
    await col(PROGRAM_NOTICES).updateOne(key, { $set: { confirmed_sent: { at: new Date().toISOString(), email: mailed, whatsapp } } });
  })().catch((err) => {
    console.error("[programs] could not send the confirmation", err instanceof Error ? err.message : err);
    void col(PROGRAM_NOTICES).updateOne(key, { $set: { confirmed_sent: { at: new Date().toISOString(), failed: err instanceof Error ? err.message : "It did not go" } } });
  });
}

const YES = /^(yes|y|yes please|yeah|yep|ok|okay|sure|confirm|confirmed|i confirm|done|haan|ha|👍|✅)[\s.!👍✅🙏]*$/i;
const NO = /^(no|n|nope|not|no sorry|sorry no|can'?t|cannot|not possible)[\s.!]*$/i;

/** A WhatsApp in to a CS: a YES or NO from a student asked about a program, answering their latest open one. */
export async function onWhatsAppReply(ownerId: string, studentIds: string[], text: string): Promise<void> {
  const t = String(text ?? "").trim();
  if (!studentIds.length || t.length > 40) return;
  const answer = YES.test(t) ? "confirmed" : NO.test(t) ? "declined" : null;
  if (!answer) return;
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const notice: any = await col(PROGRAM_NOTICES).findOne(
    { cs_id: ownerId, student_id: { $in: studentIds }, "whatsapp.status": "sent", response: null, sent_at: { $gte: since } },
    { sort: { sent_at: -1 } });
  if (notice) await recordAnswer(notice, answer, "whatsapp");
}

/* ── The email's Confirm my seat page ────────────────────────────────────── */

const page = (title: string, text: string, form = "") =>
  new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
    `<body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a"><div style="max-width:440px;margin:60px auto;padding:28px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;text-align:center">` +
    `<h1 style="font-size:20px;margin:0 0 12px">${title}</h1><p style="font-size:15px;line-height:1.6;color:#334155;margin:0">${text}</p>${form}` +
    `<p style="margin:24px 0 0;font-size:12px;color:#64748b">Delta Institutions</p></div></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
const h = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** GET shows a Confirm button; POST confirms. */
export async function handleProgramConfirm(req: Request, token: string): Promise<Response> {
  const notice: any = await col(PROGRAM_NOTICES).findOne({ token });
  if (!notice) return page("Link not found", "This confirmation link isn't valid any more. Please contact your counsellor.");
  const title = h(notice.program_title);
  if (notice.response === "confirmed") return page("You're confirmed ✅", `Your seat in <strong>${title}</strong> is reserved. See you there!`);
  if (req.method !== "POST") {
    return page("Confirm your seat", `${h(firstName(notice.student_name))}, please confirm you'll attend <strong>${title}</strong>.`,
      `<form method="post" style="margin-top:20px"><button type="submit" style="padding:12px 28px;border:0;border-radius:999px;background:#16a34a;color:#fff;font-size:15px;font-weight:700;cursor:pointer">Confirm my seat</button></form>`);
  }
  await recordAnswer(notice, "confirmed", "email");
  return page("You're confirmed ✅", `Thank you. Your seat in <strong>${title}</strong> is reserved — we've sent the details to your email.`);
}

/* ── Guests: each class's link before it starts ──────────────────────────── */

/**
 * Every few minutes: a guest (no LMS account) of an online program gets the next class's Google Meet link on WhatsApp
 * (from their CS) about 30 minutes before it starts — else by email — once per class. Students on the LMS get the
 * LMS's own reminders.
 */
export async function guestReminderTick(fetchProgram: (id: string) => Promise<any>, now = Date.now()): Promise<number> {
  if (off()) return 0;
  const guests = (await col(PROGRAM_GUESTS).find({}).toArray()) as any[];
  if (!guests.length) return 0;
  const byProgram = new Map<string, any[]>();
  for (const g of guests) byProgram.set(g.program_id, [...(byProgram.get(g.program_id) ?? []), g]);
  let sent = 0;
  for (const [programId, list] of byProgram) {
    const p: any = await fetchProgram(programId).catch(() => null);
    if (!p || p.status !== "active" || p.isOnline === false) continue;
    const soon = (p.classes ?? []).filter((c: any) => c.status === "scheduled" && c.meetUrl
      && new Date(c.startsAt).getTime() > now && new Date(c.startsAt).getTime() - now <= REMIND_BEFORE_MS);
    for (const c of soon) {
      for (const g of list) {
        const key = { class_id: String(c.id), email: String(g.email) };
        const claimed = await col(GUEST_REMINDERS).updateOne(key, { $setOnInsert: { ...key, program_id: programId, at: new Date().toISOString() } }, { upsert: true });
        if (!claimed.upsertedCount) continue;
        const s = await portalStudent(g.email);
        const csId = String(s?.primary_mentor_id ?? ""), csName = String(s?.primary_mentor_name ?? "").trim();
        const tz = await tzOf(csId);
        const time = new Date(c.startsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
        const name = firstName(s?.full_name || g.name);
        const text = `Hi ${name} 👋\n\n*${p.title}* starts at ${time} (${tz === "Asia/Kolkata" ? "India time" : "Dubai time"}).\n\nJoin on Google Meet: ${c.meetUrl}\n\n${csName ? `${csName}, Delta Institutions` : "Delta Institutions"}`;
        let r: any = await sendWhatsApp(csId, csName, s?.phone, text);
        if (r.status !== "sent") r = await sendEmail(g.email, { subject: `${p.title} starts at ${time} — join on Google Meet`, body: text }, [{ label: "Join on Google Meet", url: c.meetUrl, color: "#0f766e" }]);
        await col(GUEST_REMINDERS).updateOne(key, { $set: { result: r } });
        if (r.status === "sent") sent++;
      }
    }
  }
  return sent;
}

let guestTimer: ReturnType<typeof setInterval> | null = null;
/** Every 5 minutes. */
export function startGuestReminderWorker(fetchProgram: (id: string) => Promise<any>): void {
  if (guestTimer) return;
  guestTimer = setInterval(() => { void guestReminderTick(fetchProgram).catch((err) => console.error("[programs] guest reminders", err)); }, 5 * 60_000);
}
