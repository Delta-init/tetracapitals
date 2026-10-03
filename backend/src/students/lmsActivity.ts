import { col } from "../db";
import { config } from "../config";
import { callLms, lmsConfigured } from "../lib/lms";
import { sendMail, type SendResult } from "../lib/mailer";
import { notify } from "../lib/notify";
import { toObjectId } from "../lib/id";
import { keepClassCompletion, sendDueClassNotices, type LmsClass } from "./classCompletions";

/* ────────────────────────────────────────────────────────────────────────────
   A student's LMS help desk and class assignments, told to their CS.

   Every 2 minutes the Delta LMS is asked what happened since the last time
   (its service API, GET /service/student-activity — the same link as the
   classes, LMS_API_URL / LMS_SERVICE_SECRET): a student opened a Help &
   Support ticket or wrote on one, sent a class assignment, or had one approved
   or rejected. Each is matched to the student here — by their LMS id, else by
   email whatever its case (few students here carry an LMS id) — and told to
   their CS, the student's primary mentor when that is an active CS: the bell,
   a push, and an email. A student with no active CS (Delta Open Students, or a
   CS who was switched off) is told to the super admins instead. Somebody who
   is not a student here is passed over.

   Starts from the moment it is first switched on: nothing from before is
   told. Each event is kept (lms_activity, under the LMS's own key), so asking
   again over the last few minutes, a retry or a second API process never tells
   anybody twice — and the record says who was told and whether the email went.
   An email that fails is tried again on the next runs, MAIL_TRIES in all.

   The LMS stays where tickets are answered and assignments reviewed; the
   student's page here shows both (functions/lmsSupport.ts).

   The same ask brings the live classes a student attended that are now over
   (include=classes): those are kept as class completions, and their CS is
   told ten minutes after the class ended, for a call — no email
   (students/classCompletions.ts).

   LMS_ACTIVITY=off keeps a server out of it.
──────────────────────────────────────────────────────────────────────────── */

const EVERY_MS = 2 * 60_000;
/** Asked again each run: a write the LMS finished late, or a clock that drifted, is still caught. */
const OVERLAP_MS = 5 * 60_000;
const LEASE_MS = 5 * 60_000;            // one run at a time, however many API processes
const SETTINGS_ID = "lms_activity";
const MAIL_TRIES = 3;
const MAIL_BATCH = 50;

/** One thing a student did, as the LMS reports it. */
export interface LmsActivity {
  key: string;
  type: "ticket_opened" | "ticket_reply" | "assignment_submitted" | "assignment_reviewed" | "class_attended";
  at: string;
  student: { lmsUserId: string; email: string; name: string };
  ticket?: { id: string; subject: string; category: string; status: string; message: string };
  assignment?: {
    id: string; title: string; note: string; files: number; course: string; className: string; classAt: string; mentor: string;
    attempt: number; status: string; decision?: "approved" | "rejected"; reason?: string;
  };
  class?: LmsClass;
}

export interface LmsActivityRun {
  at: string;
  ok: boolean;
  error?: string;
  events: number;          // what the LMS answered with, overlap included
  new: number;             // not seen before
  told: number;            // …of a student here, and somebody was told
  not_told: number;        // …of somebody who is not a student here, or with nobody to tell
  mailed: number;          // emails the mail server accepted this run
  mail_failed: number;
  class_notices?: number;  // class completions told this run
}

type Send = (msg: { to: string; subject: string; html: string; text: string }) => Promise<SendResult>;

export const lmsActivityOn = () => lmsConfigured() && !/^(off|false|0|no)$/i.test(process.env.LMS_ACTIVITY ?? "");

/** Hold the run for LEASE_MS — true for exactly one caller. */
async function takeLease(now: Date): Promise<boolean> {
  try {
    const res = await col("app_settings").updateOne(
      { _id: SETTINGS_ID, $or: [{ running_until: { $lt: now.toISOString() } }, { running_until: { $exists: false } }, { running_until: null }] } as any,
      { $set: { running_until: new Date(now.getTime() + LEASE_MS).toISOString() } },
      { upsert: true },
    );
    return res.modifiedCount === 1 || res.upsertedCount === 1;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;   // somebody else holds it
    throw err;
  }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** An active CS by id, or nobody. */
async function activeCs(id: unknown): Promise<any | null> {
  const oid = toObjectId(String(id ?? ""));
  if (!oid) return null;
  return col("users").findOne({ _id: oid, app_role: "cs", status: { $ne: "inactive" } });
}

/** The student here the event is about: by LMS id, else by email whatever its case. */
async function studentFor(ev: LmsActivity): Promise<any | null> {
  const lmsId = String(ev.student?.lmsUserId ?? "").trim();
  if (lmsId) {
    const s = await col("students").findOne({ lms_user_id: lmsId });
    if (s) return s;
  }
  const email = String(ev.student?.email ?? "").trim().toLowerCase();
  if (!email.includes("@")) return null;
  const matches = await col("students").find({ email: { $regex: `^\\s*${escapeRegex(email)}\\s*$`, $options: "i" } }).toArray();
  if (matches.length <= 1) return matches[0] ?? null;
  // The same address on two students (an import and a sign-up): the one an active CS holds, else the newest.
  for (const s of matches) if (await activeCs(s.primary_mentor_id)) return s;
  return matches.sort((a: any, b: any) => String(b.updated_date ?? b.created_date ?? "").localeCompare(String(a.updated_date ?? a.created_date ?? "")))[0];
}

/** Their active CS; with none, every active super admin. */
async function whoToTell(student: any): Promise<{ to: "cs" | "super_admins"; people: any[] }> {
  const cs = await activeCs(student.primary_mentor_id);
  if (cs) return { to: "cs", people: [cs] };
  return { to: "super_admins", people: await col("users").find({ app_role: "super_admin", status: { $ne: "inactive" } }).toArray() };
}

/* ── What each one says ─────────────────────────────────────────────────── */

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const firstName = (name: unknown) => String(name ?? "").trim().split(/\s+/)[0] || "there";
const when = (iso: unknown) => {
  const d = new Date(String(iso ?? ""));
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

interface Told {
  key: string; type: LmsActivity["type"]; at: string;
  student: { id: string; name: string; code: string; email: string };
  ticket?: LmsActivity["ticket"]; assignment?: LmsActivity["assignment"];
  to: "cs" | "super_admins";
}

/** The headline, the one-line notice, and the details — for the email and the bell alike. */
function describe(r: Told): { headline: string; subject: string; line: string; rows: [string, string][] } {
  const who = `${r.student.name}${r.student.code ? ` (${r.student.code})` : ""}`;
  const t = r.ticket, a = r.assignment;
  if (r.type === "ticket_opened" || r.type === "ticket_reply") {
    const opened = r.type === "ticket_opened";
    return {
      headline: opened ? "New support ticket" : "Reply on a support ticket",
      subject: opened ? `New support ticket — ${who}: ${t?.subject ?? ""}` : `${who} replied on a support ticket: ${t?.subject ?? ""}`,
      line: opened ? `${r.student.name} opened a ticket on the Delta LMS help desk: “${t?.subject ?? ""}”.` : `${r.student.name} wrote again on their ticket “${t?.subject ?? ""}”.`,
      rows: [
        ["Ticket", t?.subject ?? ""],
        ["Category", t?.category ?? ""],
        ["Status", t?.status ?? ""],
        [opened ? "What they wrote" : "What they wrote now", t?.message ?? ""],
      ],
    };
  }
  const klass = [a?.className, when(a?.classAt)].filter(Boolean).join(" · ");
  const base: [string, string][] = [["Assignment", a?.title ?? ""], ["Class", klass], ["Course", a?.course ?? ""], ["Mentor", a?.mentor ?? ""], ["Attempt", String(a?.attempt ?? 1)]];
  if (r.type === "assignment_submitted") {
    const again = (a?.attempt ?? 1) > 1;
    return {
      headline: again ? "Assignment sent again" : "Assignment sent",
      subject: `${who} sent ${again ? `a revision of an assignment (attempt ${a?.attempt})` : "an assignment"}: ${a?.title ?? ""}`,
      line: `${r.student.name} sent ${again ? "a revision of " : ""}“${a?.title ?? ""}” for review${a?.className ? `, for ${a.className}` : ""}.`,
      rows: [...base, ["Their note", a?.note ?? ""], ["Files", String(a?.files ?? 0)]],
    };
  }
  const decision = a?.decision === "rejected" ? "rejected" : "approved";
  return {
    headline: `Assignment ${decision}`,
    subject: `${who}'s assignment was ${decision}: ${a?.title ?? ""}`,
    line: `${a?.mentor || "The mentor"} ${decision} ${r.student.name}'s “${a?.title ?? ""}”.${decision === "rejected" ? " They need to change it and send it again." : ""}`,
    rows: [...base, ...(decision === "rejected" ? [["Reason", a?.reason ?? ""] as [string, string]] : [])],
  };
}

function buildEmail(r: Told, person: any): { subject: string; html: string; text: string } {
  const d = describe(r);
  const link = config.appBaseUrl ? `${config.appBaseUrl}/StudentDetail?id=${encodeURIComponent(r.student.id)}` : "";
  const forAdmins = r.to === "super_admins" ? `${r.student.name} has no CS in the portal, so this comes to the super admins.` : "";
  const rows: [string, string][] = [["Student", [r.student.name, r.student.code, r.student.email].filter(Boolean).join(" · ")], ...d.rows.filter(([, v]) => v)];
  const table = rows.map(([k, v]) => `<tr><td valign="top" style="padding:8px 10px;font-size:12px;font-weight:600;color:#64748b;white-space:nowrap;border-bottom:1px solid #f1f5f9">${esc(k)}</td><td style="padding:8px 10px;font-size:13px;color:#0f172a;border-bottom:1px solid #f1f5f9;white-space:pre-wrap">${esc(v)}</td></tr>`).join("");
  const button = link
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px"><tr><td style="border-radius:10px;background:#002950"><a href="${esc(link)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">Open ${esc(firstName(r.student.name))} in the portal</a></td></tr></table>`
    : "";
  const footnote = "Sent by the Delta Commission Portal when one of your students opens or writes on a Delta LMS support ticket, or sends a class assignment or has one reviewed. Tickets are answered on the LMS; the conversation and the assignments are on the student's page in the portal.";
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden">
<tr><td style="background:#002950;padding:22px 24px">
<div style="font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#7CF0B5">Delta · LMS</div>
<div style="margin-top:6px;font-size:21px;font-weight:700;color:#ffffff">${esc(d.headline)}</div>
<div style="margin-top:4px;font-size:13px;color:#b3cbe4">${esc(when(r.at))}</div>
</td></tr>
<tr><td style="padding:22px 24px 10px">
<p style="margin:0 0 10px;font-size:15px">Hi ${esc(firstName(person.full_name))},</p>
<p style="margin:0;font-size:14px;line-height:1.55;color:#334155">${esc(d.line)}${forAdmins ? ` ${esc(forAdmins)}` : ""}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border-collapse:collapse">${table}</table>
${button}
</td></tr>
<tr><td style="padding:16px 24px 22px;font-size:12px;line-height:1.5;color:#94a3b8;border-top:1px solid #f1f5f9">${esc(footnote)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    `Hi ${firstName(person.full_name)},`,
    "",
    d.line + (forAdmins ? ` ${forAdmins}` : ""),
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(link ? ["", `Open ${firstName(r.student.name)} in the portal: ${link}`] : []),
    "",
    footnote,
  ].join("\n");
  return { subject: d.subject, html, text };
}

/* ── The run ────────────────────────────────────────────────────────────── */

/** A class a student attended, now over: kept as a class completion — told later (sendDueClassNotices), never emailed. */
async function takeClass(ev: LmsActivity, now: Date): Promise<"told" | "not_told" | "seen"> {
  const student = ev.class ? await studentFor(ev) : null;
  try {
    await col("lms_activity").insertOne({
      _id: ev.key, type: ev.type, at: ev.at, lms_student: ev.student, class: ev.class ?? null,
      outcome: student ? "class_completion" : "not_a_student", student_id: student ? String(student._id) : null,
      mail: { state: "none", attempts: 0, sent_to: [] }, created_date: now.toISOString(),
    } as any);
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return "seen";
    throw err;
  }
  if (!student) return "not_told";
  await keepClassCompletion(ev.key, ev.class!, student, now);
  return "told";
}

/** Kept, and the bell rung, for one event not seen before; "seen" when it was kept already. */
async function take(ev: LmsActivity, now: Date): Promise<"told" | "not_told" | "seen"> {
  if (ev.type === "class_attended") return takeClass(ev, now);
  const student = await studentFor(ev);
  const base = { _id: ev.key, type: ev.type, at: ev.at, lms_student: ev.student, ticket: ev.ticket ?? null, assignment: ev.assignment ?? null, created_date: now.toISOString() };
  const record: any = student
    ? await (async () => {
      const { to, people } = await whoToTell(student);
      return {
        ...base,
        outcome: people.length ? "told" : "no_one_to_tell",
        student: { id: String(student._id), name: String(student.full_name ?? "").trim() || ev.student.name || "A student", code: student.student_code ?? "", email: student.email ?? ev.student.email },
        to,
        recipients: people.map((p: any) => ({ id: String(p._id), name: p.full_name ?? "", email: String(p.email ?? "").trim(), role: p.app_role })),
        mail: { state: people.some((p: any) => String(p.email ?? "").includes("@")) ? "pending" : "none", attempts: 0, sent_to: [] as string[] },
      };
    })()
    : { ...base, outcome: "not_a_student", mail: { state: "none", attempts: 0, sent_to: [] } };
  try {
    await col("lms_activity").insertOne(record);
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return "seen";   // the overlap, or another process got here first
    throw err;
  }
  if (!student || !record.recipients.length) return "not_told";
  const d = describe(record as Told);
  await notify(record.recipients.map((p: any) => p.id), {
    type: "lms_activity",
    title: d.headline,
    body: d.line,
    link: `/StudentDetail?id=${record.student.id}`,
    tag: `lms-${ev.key}`,
  });
  return "told";
}

/** The emails waiting — new ones, and ones whose sending failed before — each recipient once. */
async function sendWaitingMail(send: Send): Promise<{ sent: number; failed: number }> {
  const due = await col("lms_activity").find({ "mail.state": { $in: ["pending", "retry"] } } as any).sort({ at: 1 }).limit(MAIL_BATCH).toArray();
  let sent = 0, failed = 0;
  for (const rec of due as any[]) {
    const done = new Set<string>(rec.mail?.sent_to ?? []);
    const errors: string[] = [];
    const ids: string[] = [];
    let off = false;
    for (const person of rec.recipients ?? []) {
      const to = String(person.email ?? "").trim();
      if (!to.includes("@") || done.has(to)) continue;
      const res = await send({ ...buildEmail(rec as Told, person), to });
      if (res.ok) { done.add(to); ids.push(res.messageId); sent++; }
      else if (res.notConfigured) { off = true; break; }
      else { errors.push(`${to}: ${res.error}`); failed++; }
    }
    const attempts = (rec.mail?.attempts ?? 0) + 1;
    const state = off ? "off" : !errors.length ? "sent" : attempts < MAIL_TRIES ? "retry" : "failed";
    await col("lms_activity").updateOne({ _id: rec._id } as any, {
      $set: {
        "mail.state": state,
        "mail.attempts": attempts,
        "mail.sent_to": [...done],
        ...(ids.length ? { "mail.message_ids": [...(rec.mail?.message_ids ?? []), ...ids] } : {}),
        ...(state === "sent" ? { "mail.sent_at": new Date().toISOString() } : {}),
        ...(errors.length ? { "mail.error": errors.join("; ").slice(0, 500) } : off ? { "mail.error": "Email is not configured on this server (SMTP settings)" } : {}),
      },
    });
  }
  return { sent, failed };
}

/** Ask the LMS what is new, tell whoever should know, send the emails. */
export async function runLmsActivity(opts: { now?: Date; send?: Send } = {}): Promise<LmsActivityRun> {
  const now = opts.now ?? new Date();
  const run: LmsActivityRun = { at: now.toISOString(), ok: false, events: 0, new: 0, told: 0, not_told: 0, mailed: 0, mail_failed: 0 };
  if (!lmsConfigured()) return { ...run, error: "No LMS link on this server (LMS_API_URL / LMS_SERVICE_SECRET)" };
  if (!(await takeLease(now))) return { ...run, error: "A run is already going" };
  const finish = async (r: LmsActivityRun, extra: Record<string, unknown> = {}) => {
    await col("app_settings").updateOne({ _id: SETTINGS_ID } as any, { $set: { last_run: r, ...(r.ok ? { last_ok_run: r } : {}), running_until: null, ...extra } }, { upsert: true });
    return r;
  };
  try {
    const settings: any = await col("app_settings").findOne({ _id: SETTINGS_ID } as any);
    if (!settings?.cursor) {
      // Switched on now: what students did before is nobody's news.
      return finish({ ...run, ok: true }, { cursor: run.at, started_at: run.at });
    }
    const since = new Date(new Date(settings.cursor).getTime() - OVERLAP_MS).toISOString();
    const data = await callLms<{ events: LmsActivity[]; until: string }>("/student-activity", { query: { since, include: "classes" }, verb: "share what students did" });
    const events = Array.isArray(data?.events) ? data.events : [];
    run.events = events.length;
    for (const ev of events) {
      if (!ev?.key || !ev?.type) continue;
      const r = await take(ev, now);
      if (r === "seen") continue;
      run.new++;
      if (r === "told") run.told++; else run.not_told++;
    }
    run.class_notices = await sendDueClassNotices(now);
    const mail = await sendWaitingMail(opts.send ?? sendMail);
    run.mailed = mail.sent;
    run.mail_failed = mail.failed;
    return finish({ ...run, ok: true }, { cursor: data?.until || run.at });
  } catch (err) {
    return finish({ ...run, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Every 2 minutes (the first shortly after start). LMS_ACTIVITY=off keeps this server out of it. */
export function startLmsActivityWorker(): void {
  if (!lmsActivityOn()) {
    console.log(`[lms activity] off on this server (${lmsConfigured() ? "LMS_ACTIVITY=off" : "no LMS link: LMS_API_URL / LMS_SERVICE_SECRET"})`);
    return;
  }
  const tick = async () => {
    const r = await runLmsActivity().catch((err) => ({ ok: false, error: String(err) }) as LmsActivityRun);
    if (r.ok && (r.new || r.mailed || r.mail_failed || r.class_notices)) {
      console.log(`[lms activity] ${r.new} new: ${r.told} told, ${r.not_told} not (not students here, or nobody to tell); ${r.mailed} email${r.mailed === 1 ? "" : "s"} sent${r.mail_failed ? `, ${r.mail_failed} failed` : ""}${r.class_notices ? `; ${r.class_notices} class completion${r.class_notices === 1 ? "" : "s"} told` : ""}`);
    } else if (!r.ok && r.error !== "A run is already going") console.error(`[lms activity] not run: ${r.error}`);
  };
  setTimeout(() => void tick(), 30_000);
  setInterval(() => void tick(), EVERY_MS);
}
