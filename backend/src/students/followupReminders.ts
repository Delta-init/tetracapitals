import { randomBytes } from "node:crypto";
import { col } from "../db";
import { config } from "../config";
import { toObjectId } from "../lib/id";
import { mailConfigured, sendMail } from "../lib/mailer";
import { CLOSED_STAGES, followupStatus } from "./followups";

/* ────────────────────────────────────────────────────────────────────────────
   Follow-up reminder emails. Every day at 10:00 UAE time, everyone whose
   students have follow-ups due that day — or overdue — gets ONE email listing
   them. "Everyone" = the student's primary mentor NOW (the follow-up's owner).

   Every reminder is kept in `followup_reminders`, one per person per day,
   with what happened to it:
     sent     — the mail server accepted it; its message id is kept as proof
     failed   — the error; retried (up to 3 tries) later the same day
     skipped  — not sent, and why: no email address, a test user, inactive,
                email not set up on the server…
   Each follow-up also carries its latest reminder (`last_reminder`), and
   "seen" is when the person opened the portal from the email's button.

   One email per person per day, even with several copies of the backend
   running: the day's record is claimed (unique key) before anything is sent.
──────────────────────────────────────────────────────────────────────────── */

const SEND_HOUR = 10;                 // UAE time: the day's emails go from 10:00…
const LAST_HOUR = 19;                 // …until 19:59 (a server that was down all morning catches up; later, tomorrow's covers it)
const UAE_OFFSET_MS = 4 * 3_600_000;  // UTC+4, no daylight saving
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 30 * 60_000;
const STUCK_AFTER_MS = 15 * 60_000;   // "sending" this long = the process died mid-send
const SHOW_MAX = 40;                  // rows per section in the email
const TICK_MS = 5 * 60_000;
const SETTINGS_ID = "followup_reminders";
const REMINDERS = "followup_reminders";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const uaeToday = (now = Date.now()) => new Date(now + UAE_OFFSET_MS).toISOString().slice(0, 10);
const uaeHour = (now = Date.now()) => new Date(now + UAE_OFFSET_MS).getUTCHours();
const iso = () => new Date().toISOString();

export type SkipCode = "no_mentor" | "no_user" | "inactive" | "test_user" | "no_email" | "not_configured" | "nothing_due";

interface Item {
  followup_id: string;
  student_id: string;
  student_name: string;
  student_code: string;
  phone: string;
  target_outcome: string;
  stage: string;
  next_followup_date: string;
  status: "DUE TODAY" | "OVERDUE";
  client_said: string;
}

interface Digest {
  mentor_id: string;          // "" = students with no mentor
  mentor_name: string;
  to: string;
  items: Item[];
  skip?: { code: SkipCode; reason: string };
}

export interface RunSummary { date: string; sent: number; failed: number; skipped: number; already: number }

/* ── settings (last run, last test) ──────────────────────────────────────── */

export async function getReminderSettings(): Promise<Record<string, any>> {
  const doc: any = await col("app_settings").findOne({ _id: SETTINGS_ID } as any);
  const { _id, ...rest } = doc ?? {};
  return rest;
}

async function saveSettings(patch: Record<string, unknown>) {
  await col("app_settings").updateOne({ _id: SETTINGS_ID } as any, { $set: patch }, { upsert: true });
}

/** Claim `date`'s daily run: true for exactly one caller, however many servers ask. */
async function claimDay(date: string): Promise<boolean> {
  try {
    const res = await col("app_settings").updateOne(
      { _id: SETTINGS_ID, last_run_date: { $ne: date } } as any,
      { $set: { last_run_date: date, last_run_started_at: iso() } },
      { upsert: true },
    );
    return res.modifiedCount === 1 || res.upsertedCount === 1;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false; // already today's
    throw err;
  }
}

/* ── who is due what ─────────────────────────────────────────────────────── */

function skipFor(mentorId: string, user: any, configured: boolean): Digest["skip"] {
  if (!mentorId) return { code: "no_mentor", reason: "These students have no mentor" };
  if (!user) return { code: "no_user", reason: "The mentor's account was not found" };
  if (user.status === "inactive") return { code: "inactive", reason: "The mentor's account is inactive" };
  const email = String(user.email ?? "").trim();
  if (user.is_test || /@deltatest\.dev$/i.test(email)) return { code: "test_user", reason: "Test user — reminders are not emailed" };
  if (!EMAIL.test(email)) return { code: "no_email", reason: "No valid email address" };
  if (!configured) return { code: "not_configured", reason: "Email is not set up on the server" };
  return undefined;
}

/**
 * Open follow-ups due on `date` or before, grouped by the student's mentor
 * now. `mentorId` narrows it to one person ("" = students with no mentor).
 */
async function collectDigests(date: string, mentorId?: string): Promise<Digest[]> {
  const followups = (await col("student_followups")
    .find(
      { stage: { $nin: [...CLOSED_STAGES] }, next_followup_date: { $gt: "", $lte: date } },
      { projection: { student_id: 1, target_outcome: 1, stage: 1, next_followup_date: 1, client_said: 1 } },
    )
    .toArray()) as any[];
  if (!followups.length) return [];

  const studentFilter: Record<string, any> = {
    _id: { $in: [...new Set(followups.map((f) => String(f.student_id)))].map(toObjectId).filter(Boolean) },
  };
  if (mentorId !== undefined) studentFilter.primary_mentor_id = mentorId ? mentorId : { $in: [null, ""] };
  const students = (await col("students")
    .find(studentFilter, { projection: { full_name: 1, student_code: 1, phone: 1, primary_mentor_id: 1, primary_mentor_name: 1 } })
    .toArray()) as any[];
  const byStudent = new Map(students.map((s) => [String(s._id), s]));

  const groups = new Map<string, Item[]>();
  const nameOf = new Map<string, string>();
  for (const f of followups) {
    const s = byStudent.get(String(f.student_id));
    if (!s) continue;
    const status = followupStatus(f, date);
    if (status !== "DUE TODAY" && status !== "OVERDUE") continue;
    const m = String(s.primary_mentor_id ?? "");
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m)!.push({
      followup_id: String(f._id),
      student_id: String(s._id),
      student_name: String(s.full_name ?? "").trim(),
      student_code: String(s.student_code ?? ""),
      phone: String(s.phone ?? "").replace(/^[\s'`"]+/, "").trim(),
      target_outcome: String(f.target_outcome ?? ""),
      stage: String(f.stage ?? ""),
      next_followup_date: String(f.next_followup_date),
      status,
      client_said: String(f.client_said ?? "").trim(),
    });
    if (s.primary_mentor_name) nameOf.set(m, String(s.primary_mentor_name));
  }
  if (!groups.size) return [];

  const users = (await col("users")
    .find(
      { _id: { $in: [...groups.keys()].map(toObjectId).filter(Boolean) as any[] } },
      { projection: { email: 1, full_name: 1, status: 1, is_test: 1 } },
    )
    .toArray()) as any[];
  const byUser = new Map(users.map((u) => [String(u._id), u]));
  const configured = mailConfigured();

  return [...groups.entries()].map(([m, items]) => {
    // Due today (A–Z), then overdue — the longest waiting first.
    items.sort((a, b) => (a.status !== b.status
      ? (a.status === "DUE TODAY" ? -1 : 1)
      : a.status === "OVERDUE" && a.next_followup_date !== b.next_followup_date
        ? (a.next_followup_date < b.next_followup_date ? -1 : 1)
        : a.student_name.localeCompare(b.student_name)));
    const u = byUser.get(m);
    return {
      mentor_id: m,
      mentor_name: String(u?.full_name || nameOf.get(m) || ""),
      to: String(u?.email ?? "").trim(),
      items,
      skip: skipFor(m, u, configured),
    };
  });
}

const itemFields = (items: Item[]) => ({
  items,
  followup_ids: items.map((i) => i.followup_id),
  due_today: items.filter((i) => i.status === "DUE TODAY").length,
  overdue: items.filter((i) => i.status === "OVERDUE").length,
});

/* ── the email ───────────────────────────────────────────────────────────── */

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const longDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const firstName = (n: string) => { const f = n.trim().split(/\s+/)[0] || ""; return f ? f[0].toUpperCase() + f.slice(1) : "there"; };

/** Where the email's button goes: through the API (noting it was opened), or straight to the portal. */
function openLink(token: string): string {
  if (!config.appBaseUrl) return "";
  const api = config.publicBaseUrl.replace(/\/+$/, "");
  const apiReachable = /^https?:\/\//.test(api) && (!/localhost|127\.0\.0\.1/.test(api) || /localhost|127\.0\.0\.1/.test(config.appBaseUrl));
  return apiReachable ? `${api}/api/reminders/open/${token}` : `${config.appBaseUrl}/StudentFollowups`;
}

function buildEmail(date: string, d: Digest, link: string) {
  const due = d.items.filter((i) => i.status === "DUE TODAY");
  const late = d.items.filter((i) => i.status === "OVERDUE");
  const counts = [due.length ? `${due.length} due today` : "", late.length ? `${late.length} overdue` : ""].filter(Boolean).join(", ");
  const subject = `Follow-ups for ${shortDate(date)}: ${counts}`;

  const th = (t: string) => `<th align="left" style="padding:8px 10px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0">${t}</th>`;
  const td = (html: string, extra = "") => `<td valign="top" style="padding:9px 10px;font-size:13px;color:#0f172a;border-bottom:1px solid #f1f5f9;${extra}">${html}</td>`;
  const section = (title: string, color: string, rows: Item[], overdue: boolean) => {
    if (!rows.length) return "";
    const shown = rows.slice(0, SHOW_MAX);
    const body = shown.map((i) => {
      const said = i.client_said ? `<div style="margin-top:3px;font-size:12px;color:#64748b">“${esc(i.client_said.slice(0, 140))}${i.client_said.length > 140 ? "…" : ""}”</div>` : "";
      const code = i.student_code ? ` <span style="font-family:monospace;font-size:11px;color:#94a3b8">${esc(i.student_code)}</span>` : "";
      const late = daysBetween(i.next_followup_date, date);
      return `<tr>${td(`<strong>${esc(i.student_name || "Student")}</strong>${code}${said}`)}${td(esc(i.phone || "—"), "white-space:nowrap")}${td(esc(i.target_outcome))}${td(esc(i.stage))}${overdue ? td(`${esc(shortDate(i.next_followup_date))}<div style="font-size:12px;color:#be123c">${late} day${late === 1 ? "" : "s"} late</div>`, "white-space:nowrap") : ""}</tr>`;
    }).join("");
    const more = rows.length > shown.length ? `<p style="margin:8px 0 0;font-size:12px;color:#64748b">…and ${rows.length - shown.length} more in the portal.</p>` : "";
    return `<div style="margin:22px 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${color}">${title} (${rows.length})</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr style="background:#f8fafc">${th("Student")}${th("Phone")}${th("Target")}${th("Stage")}${overdue ? th("Was due") : ""}</tr>${body}</table>${more}`;
  };
  const button = link
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 6px"><tr><td style="border-radius:10px;background:#002950"><a href="${esc(link)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">Open my follow-ups</a></td></tr></table>`
    : "";

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden">
<tr><td style="background:#002950;padding:22px 24px">
<div style="font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#7CF0B5">Delta · Follow-ups</div>
<div style="margin-top:6px;font-size:21px;font-weight:700;color:#ffffff">${esc(counts[0].toUpperCase() + counts.slice(1))}</div>
<div style="margin-top:4px;font-size:13px;color:#b3cbe4">${esc(longDate(date))}</div>
</td></tr>
<tr><td style="padding:22px 24px 10px">
<p style="margin:0 0 10px;font-size:15px">Hi ${esc(firstName(d.mentor_name))},</p>
<p style="margin:0;font-size:14px;line-height:1.55;color:#334155">These students are waiting for your follow-up. Call them, then log what they said in the portal.</p>
${section("Due today", "#b45309", due, false)}
${section("Overdue", "#be123c", late, true)}
${button}
</td></tr>
<tr><td style="padding:16px 24px 22px;font-size:12px;line-height:1.5;color:#94a3b8;border-top:1px solid #f1f5f9">Sent by the Delta Commission Portal at 10:00 (UAE) on days you have follow-ups due. Logging a call with a new follow-up date takes the student off this list.</td></tr>
</table></td></tr></table></body></html>`;

  const line = (i: Item, overdue: boolean) => `- ${i.student_name || "Student"}${i.student_code ? ` (${i.student_code})` : ""} · ${i.phone || "no phone"} · ${i.target_outcome} · ${i.stage}${overdue ? ` · was due ${shortDate(i.next_followup_date)}` : ""}`;
  const text = [
    `Hi ${firstName(d.mentor_name)},`,
    "",
    `Your follow-ups for ${longDate(date)}: ${counts}.`,
    ...(due.length ? ["", `DUE TODAY (${due.length})`, ...due.slice(0, SHOW_MAX).map((i) => line(i, false))] : []),
    ...(late.length ? ["", `OVERDUE (${late.length})`, ...late.slice(0, SHOW_MAX).map((i) => line(i, true))] : []),
    ...(link ? ["", `Open your follow-ups: ${link}`] : []),
    "",
    "— Delta Commission Portal",
  ].join("\n");

  return { to: d.to, subject, html, text };
}

/* ── sending ─────────────────────────────────────────────────────────────── */

/** Mirror a reminder's outcome onto its follow-ups (what each row shows). */
async function markFollowups(r: any) {
  const ids = (r.followup_ids ?? []).map(toObjectId).filter(Boolean);
  if (!ids.length) return;
  await col("student_followups").updateMany({ _id: { $in: ids } }, {
    $set: {
      last_reminder: {
        reminder_id: String(r._id), date: r.date, status: r.status, reason: r.reason ?? "",
        at: r.sent_at ?? r.last_attempt_at ?? r.created_at, to: r.to ?? "", seen_at: r.seen_at ?? null,
      },
    },
  });
}

/** Send `d` for the reminder record `r` (already claimed as "sending"), and store the outcome. */
async function attempt(r: any, d: Digest, date: string, by: string): Promise<"sent" | "failed" | "skipped"> {
  const at = iso();
  const res = await sendMail(buildEmail(date, d, openLink(r.token)));
  const set: Record<string, any> = res.ok
    ? { status: "sent", sent_at: at, message_id: res.messageId, smtp_response: res.response, accepted: res.accepted, reason_code: null, reason: "", last_error: "" }
    : res.notConfigured
      ? { status: "skipped", reason_code: "not_configured", reason: "Email is not set up on the server" }
      : { status: "failed", reason_code: "send_failed", reason: `Sending failed: ${res.error}`, last_error: res.error };
  const entry = { at, by, to: d.to, ok: res.ok, ...(res.ok ? { message_id: res.messageId } : { error: res.error }) };
  await col(REMINDERS).updateOne({ _id: r._id }, {
    $set: { ...set, updated_at: at, last_attempt_at: at },
    $inc: { attempts: res.ok || !res.notConfigured ? 1 : 0 },
    $push: { history: entry } as any,
  });
  Object.assign(r, set, { updated_at: at, last_attempt_at: at });
  await markFollowups(r);
  return set.status;
}

/** A person's first reminder of the day: claim it, then send (or record why not). */
async function deliverNew(date: string, d: Digest, by: string): Promise<"sent" | "failed" | "skipped" | "already"> {
  const now = iso();
  const r: any = {
    key: `${date}|${d.mentor_id || "none"}`,
    date,
    mentor_id: d.mentor_id,
    mentor_name: d.mentor_name,
    to: d.to,
    ...itemFields(d.items),
    status: d.skip ? "skipped" : "sending",
    reason_code: d.skip?.code ?? null,
    reason: d.skip?.reason ?? "",
    attempts: 0,
    token: randomBytes(18).toString("base64url"),
    seen_at: null,
    seen_count: 0,
    triggered_by: by,
    history: [],
    created_at: now,
    updated_at: now,
    last_attempt_at: d.skip ? null : now,
  };
  try {
    r._id = (await col(REMINDERS).insertOne(r)).insertedId;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return "already";
    throw err;
  }
  if (d.skip) { await markFollowups(r); return "skipped"; }
  return attempt(r, d, date, by);
}

/**
 * Try an existing reminder again (a retry, or someone's "Send again"), with
 * what is due NOW for that person — a student followed up since isn't
 * reminded about again. Only if nobody else changed it since it was read.
 */
async function redeliver(r: any, by: string): Promise<{ status: string; reason?: string } | null> {
  const at = iso();
  const claimed: any = await col(REMINDERS).findOneAndUpdate(
    { _id: r._id, status: r.status, updated_at: r.updated_at },
    { $set: { status: "sending", updated_at: at, last_attempt_at: at } },
    { returnDocument: "after" },
  );
  if (!claimed) return null;
  const [d] = await collectDigests(r.date, r.mentor_id);
  const finish = async (set: Record<string, any>) => {
    await col(REMINDERS).updateOne({ _id: claimed._id }, { $set: { ...set, updated_at: iso() }, $push: { history: { at, by, ok: false, error: set.reason } } as any });
    Object.assign(claimed, set);
    await markFollowups(claimed);
    return { status: set.status, reason: set.reason };
  };
  if (!d) return finish({ status: "skipped", reason_code: "nothing_due", reason: "Nothing left to remind about — already followed up" });
  await col(REMINDERS).updateOne({ _id: claimed._id }, { $set: { ...itemFields(d.items), to: d.to, mentor_name: d.mentor_name } });
  Object.assign(claimed, itemFields(d.items), { to: d.to });
  if (d.skip) return finish({ status: "skipped", reason_code: d.skip.code, reason: d.skip.reason });
  const status = await attempt(claimed, d, r.date, by);
  return { status, reason: claimed.reason };
}

/**
 * The day's run: one reminder for everyone with something due and none yet
 * today. A "Run now" doesn't stand in for the 10:00 run — that still comes,
 * and only reaches people who haven't had today's.
 */
export async function runReminders(date = uaeToday(), by = "Schedule"): Promise<RunSummary> {
  const summary: RunSummary = { date, sent: 0, failed: 0, skipped: 0, already: 0 };
  for (const d of await collectDigests(date)) summary[await deliverNew(date, d, by)]++;
  await saveSettings({ last_run: { ...summary, at: iso(), by } });
  return summary;
}

/** Today's failed sends (and ones waiting for email to be set up) get another go. */
export async function retryReminders(date = uaeToday(), now = Date.now()): Promise<number> {
  const or: any[] = [
    { status: "failed", attempts: { $lt: MAX_ATTEMPTS }, last_attempt_at: { $lt: new Date(now - RETRY_AFTER_MS).toISOString() } },
    { status: "sending", last_attempt_at: { $lt: new Date(now - STUCK_AFTER_MS).toISOString() } },
  ];
  if (mailConfigured()) or.push({ status: "skipped", reason_code: "not_configured" });
  const due = (await col(REMINDERS).find({ date, $or: or }).toArray()) as any[];
  let tried = 0;
  for (const r of due) if (await redeliver(r, "Retry")) tried++;
  return tried;
}

/** "Send again" for one of today's reminders. */
export async function resendReminder(id: string, by: string): Promise<{ ok: true; status: string; reason?: string } | { ok: false; error: string }> {
  const oid = toObjectId(id);
  const r: any = oid ? await col(REMINDERS).findOne({ _id: oid }) : null;
  if (!r) return { ok: false, error: "Reminder not found" };
  if (r.date !== uaeToday()) return { ok: false, error: "Only today's reminders can be sent again" };
  if (r.status === "sending" && Date.now() - Date.parse(r.last_attempt_at || r.updated_at) < STUCK_AFTER_MS) return { ok: false, error: "It is being sent right now" };
  const out = await redeliver(r, by);
  return out ? { ok: true, ...out } : { ok: false, error: "It changed meanwhile — refresh and try again" };
}

/** The email's button was used: note it (first time and count), for the reminder and its follow-ups. */
export async function markReminderSeen(token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return false;
  const at = iso();
  const before: any = await col(REMINDERS).findOneAndUpdate(
    { token },
    { $inc: { seen_count: 1 }, $set: { last_seen_at: at } },
    { projection: { _id: 1, seen_at: 1 } },
  );
  if (!before) return false;
  if (!before.seen_at) {
    await col(REMINDERS).updateOne({ _id: before._id, seen_at: null }, { $set: { seen_at: at } });
    await col("student_followups").updateMany(
      { "last_reminder.reminder_id": String(before._id), "last_reminder.seen_at": null },
      { $set: { "last_reminder.seen_at": at } },
    );
  }
  return true;
}

/** A sample reminder to `to`, so the mail set-up can be checked without waiting for 10:00. */
export async function sendTestReminder(to: string, by: string) {
  const date = uaeToday();
  const sample: Digest = {
    mentor_id: "test", mentor_name: by, to, items: [
      { followup_id: "", student_id: "", student_name: "Sample Student", student_code: "DLT-0001", phone: "+971500000000", target_outcome: "DSLP", stage: "Contacted", next_followup_date: date, status: "DUE TODAY", client_said: "Asked to call back after the market opens" },
      { followup_id: "", student_id: "", student_name: "Another Student", student_code: "DLT-0002", phone: "+919800000000", target_outcome: "Additional Deposit / Top-up", stage: "Qualified", next_followup_date: new Date(Date.parse(`${date}T12:00:00Z`) - 3 * 86_400_000).toISOString().slice(0, 10), status: "OVERDUE", client_said: "" },
    ],
  };
  const email = buildEmail(date, sample, config.appBaseUrl ? `${config.appBaseUrl}/StudentFollowups` : "");
  const res = await sendMail({ ...email, subject: `[Test] ${email.subject}` });
  await saveSettings({ last_test: { at: iso(), to, by, ok: res.ok, ...(res.ok ? { message_id: res.messageId } : { error: res.error }) } });
  return res;
}

/* ── the worker ──────────────────────────────────────────────────────────── */

/** One look: after 10:00 UAE run the day once, then retry what failed. */
export async function reminderTick(now = Date.now()): Promise<void> {
  const hour = uaeHour(now);
  if (hour < SEND_HOUR || hour > LAST_HOUR) return;
  const date = uaeToday(now);
  const s = await getReminderSettings();
  if (s.last_run_date !== date && (await claimDay(date))) {
    const r = await runReminders(date, "Schedule");
    console.log(`[reminders] ${date}: sent ${r.sent}, failed ${r.failed}, not sent ${r.skipped}${r.already ? `, ${r.already} already had today's` : ""}`);
  }
  await retryReminders(date, now);
}

/** Every 5 minutes. FOLLOWUP_REMINDERS=off keeps this server from sending (e.g. a laptop on the live database). */
export function startReminderWorker(): void {
  if (/^(off|false|0|no)$/i.test(process.env.FOLLOWUP_REMINDERS ?? "")) {
    console.log("[reminders] off on this server (FOLLOWUP_REMINDERS=off)");
    return;
  }
  const tick = () => reminderTick().catch((err) => console.error("[reminders] run failed", err));
  setTimeout(() => void tick(), 90_000);
  setInterval(() => void tick(), TICK_MS);
}

export const reminderWorkerOn = () => !/^(off|false|0|no)$/i.test(process.env.FOLLOWUP_REMINDERS ?? "");
export const REMINDER_SEND_TIME = `${String(SEND_HOUR).padStart(2, "0")}:00 UAE`;
