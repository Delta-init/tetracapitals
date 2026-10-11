import { col } from "../db";
import { config } from "../config";
import { toObjectId } from "../lib/id";
import { mailConfigured, sendMail, type SendResult } from "../lib/mailer";
import { notify } from "../lib/notify";
import { dueSoonFilter, owingFeesOf, dueStateOf, uaeDay, moneyText } from "../finance/balanceDue";

/* ────────────────────────────────────────────────────────────────────────────
   Balance payment reminders to the CS (the user, 2026-10-11). Every day at
   10:00 UAE, each CS hears — one email, and the bell and a push — about their
   students whose next instalment on a course Delta finance sold them is due in
   3, 2 or 1 days, due today, or overdue (finance/balanceDue.ts). Finance emails
   the student itself; nothing goes to a student from here.

   Once each: before an item goes in anybody's reminder it is claimed in
   `balance_reminder_claims` under (student, invoice, due date, how far off) —
   "3", "2", "1", "0" (today) or "overdue" — so the same instalment is told
   once at each step, and once when it goes overdue, however many servers run.
   A payment moves the due date (a new one is told again); a student paid in
   full, or whose invoice was voided, drops out: what is owed is read again
   right before each CS's reminder is claimed.

   Each day's reminder per CS is kept in `balance_reminders`: sent (the mail
   server accepted it), failed (retried up to 3 times that day), or skipped and
   why (no email address, email not set up on the server). The CS's own
   student only: no CS, a test user or an inactive account is told nothing.
──────────────────────────────────────────────────────────────────────────── */

const SEND_HOUR = 10;
const LAST_HOUR = 19;
const UAE_OFFSET_MS = 4 * 3_600_000;
const TICK_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 30 * 60_000;
const SETTINGS_ID = "balance_reminders";
const DIGESTS = "balance_reminders";
const CLAIMS = "balance_reminder_claims";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEST_EMAIL = /@deltatest\.dev$/i;

export type ReminderKind = "3" | "2" | "1" | "0" | "overdue";

export interface BalanceItem {
  student_id: string;
  student_name: string;
  student_code: string;
  phone: string;
  invoice_id: string;
  invoice_number: string;
  course: string;
  currency: string;
  balance_minor: number;
  next_due_on: string;
  days_left: number;
  kind: ReminderKind;
}

export interface BalanceRunSummary { date: string; told: number; items: number; sent: number; failed: number; skipped: number; not_told: number }

type Send = (msg: { to: string; subject: string; html: string; text: string }) => Promise<SendResult>;

const iso = () => new Date().toISOString();
const uaeHour = (now: number) => new Date(now + UAE_OFFSET_MS).getUTCHours();

/** Each owing instalment due within 3 days or overdue on `today`, by the student's CS now ("" = no CS). */
async function collectDue(today: string, studentIds?: string[]): Promise<Map<string, BalanceItem[]>> {
  const filter: Record<string, any> = dueSoonFilter(today);
  if (studentIds) filter._id = { $in: studentIds.map(toObjectId).filter(Boolean) };
  const students = (await col("students")
    .find(filter, { projection: { full_name: 1, student_code: 1, phone: 1, primary_mentor_id: 1, course_fees: 1, status: 1 } })
    .toArray()) as any[];
  const out = new Map<string, BalanceItem[]>();
  for (const s of students) {
    const cs = String(s.primary_mentor_id ?? "");
    for (const f of owingFeesOf(s)) {
      const { state, daysLeft } = dueStateOf(f.next_due_on, today);
      if (state !== "soon" && state !== "overdue") continue;
      const item: BalanceItem = {
        student_id: String(s._id), student_name: String(s.full_name ?? "").trim(), student_code: String(s.student_code ?? ""),
        phone: String(s.phone ?? "").replace(/^[\s'`"]+/, "").trim(),
        invoice_id: String(f.invoice_id), invoice_number: String(f.invoice_number ?? ""), course: String(f.course ?? ""),
        currency: String(f.currency ?? ""), balance_minor: Number(f.balance_minor) || 0, next_due_on: String(f.next_due_on),
        days_left: daysLeft!, kind: state === "overdue" ? "overdue" : (String(daysLeft) as ReminderKind),
      };
      if (!out.has(cs)) out.set(cs, []);
      out.get(cs)!.push(item);
    }
  }
  return out;
}

const claimKey = (i: BalanceItem) => `${i.student_id}|${i.invoice_id}|${i.next_due_on}|${i.kind}`;

/** Claim each item for `csId`'s reminder today; the ones somebody already had are left out. */
async function claim(items: BalanceItem[], csId: string, date: string): Promise<BalanceItem[]> {
  const won: BalanceItem[] = [];
  for (const i of items) {
    try {
      await col(CLAIMS).insertOne({ _id: claimKey(i), cs_id: csId, date, student_id: i.student_id, invoice_id: i.invoice_id, due: i.next_due_on, kind: i.kind, at: iso() } as any);
      won.push(i);
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }
  return won;
}

/* ── the email ───────────────────────────────────────────────────────────── */

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const longDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const firstName = (n: string) => { const f = n.trim().split(/\s+/)[0] || ""; return f ? f[0]!.toUpperCase() + f.slice(1) : "there"; };
const when = (i: BalanceItem) => (i.kind === "overdue" ? `${-i.days_left} day${i.days_left === -1 ? "" : "s"} overdue` : i.days_left === 0 ? "due today" : `due in ${i.days_left} day${i.days_left === 1 ? "" : "s"}`);

const SECTIONS: { title: string; color: string; match: (i: BalanceItem) => boolean }[] = [
  { title: "Overdue", color: "#be123c", match: (i) => i.kind === "overdue" },
  { title: "Due today", color: "#b45309", match: (i) => i.kind === "0" },
  { title: "Due in the next 3 days", color: "#0369a1", match: (i) => i.kind === "1" || i.kind === "2" || i.kind === "3" },
];
const byDue = (a: BalanceItem, b: BalanceItem) => a.next_due_on.localeCompare(b.next_due_on) || a.student_name.localeCompare(b.student_name);

export function countsText(items: BalanceItem[]): string {
  const over = items.filter((i) => i.kind === "overdue").length;
  const today = items.filter((i) => i.kind === "0").length;
  const soon = items.length - over - today;
  return [over ? `${over} overdue` : "", today ? `${today} due today` : "", soon ? `${soon} due soon` : ""].filter(Boolean).join(", ");
}

export function buildBalanceEmail(date: string, csName: string, to: string, items: BalanceItem[]) {
  const link = config.appBaseUrl ? `${config.appBaseUrl}/BalancePayments` : "";
  const th = (t: string, right = false) => `<th align="${right ? "right" : "left"}" style="padding:8px 10px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0">${t}</th>`;
  const td = (h: string, extra = "") => `<td valign="top" style="padding:9px 10px;font-size:13px;color:#0f172a;border-bottom:1px solid #f1f5f9;${extra}">${h}</td>`;
  const tables = SECTIONS.map(({ title, color, match }) => {
    const rows = items.filter(match).sort(byDue);
    if (!rows.length) return "";
    const body = rows.map((i) => `<tr>${td(`<strong>${esc(i.student_name || "Student")}</strong>${i.student_code ? ` <span style="font-family:monospace;font-size:11px;color:#94a3b8">${esc(i.student_code)}</span>` : ""}<div style="font-size:12px;color:#64748b">${esc(i.phone || "no phone")}</div>`)}${td(`${esc(i.course || "Course")}${i.invoice_number ? `<div style="font-size:12px;color:#64748b">${esc(i.invoice_number)}</div>` : ""}`)}${td(esc(moneyText(i.balance_minor, i.currency)), "white-space:nowrap;text-align:right;font-weight:600")}${td(`${esc(shortDate(i.next_due_on))}<div style="font-size:12px;color:${color}">${esc(when(i))}</div>`, "white-space:nowrap")}</tr>`).join("");
    return `<div style="margin:22px 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${color}">${esc(title)} (${rows.length})</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr style="background:#f8fafc">${th("Student")}${th("Course")}${th("Balance", true)}${th("Next due")}</tr>${body}</table>`;
  }).join("\n");
  const counts = countsText(items);
  const button = link
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 6px"><tr><td style="border-radius:10px;background:#002950"><a href="${esc(link)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">Open Balance payments</a></td></tr></table>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden">
<tr><td style="background:#002950;padding:22px 24px">
<div style="font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#7CF0B5">Delta · Balance payments</div>
<div style="margin-top:6px;font-size:21px;font-weight:700;color:#ffffff">${esc(counts[0]!.toUpperCase() + counts.slice(1))}</div>
<div style="margin-top:4px;font-size:13px;color:#b3cbe4">${esc(longDate(date))}</div>
</td></tr>
<tr><td style="padding:22px 24px 10px">
<p style="margin:0 0 10px;font-size:15px">Hi ${esc(firstName(csName))},</p>
<p style="margin:0;font-size:14px;line-height:1.55;color:#334155">These students' next course instalment is due soon or overdue. Delta Finance reminds the student by email too; a call from you helps. Record the payment on the Balance payments page when they pay — Delta Finance approves it.</p>
${tables}
${button}
</td></tr>
<tr><td style="padding:16px 24px 22px;font-size:12px;line-height:1.5;color:#94a3b8;border-top:1px solid #f1f5f9">Sent by the Delta Commission Portal at 10:00 (UAE): 3, 2 and 1 days before an instalment is due, on the day, and once when it goes overdue.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    `Hi ${firstName(csName)},`, "",
    `Balance payments for ${longDate(date)}: ${counts}.`,
    ...SECTIONS.flatMap(({ title, match }) => {
      const rows = items.filter(match).sort(byDue);
      return rows.length ? ["", `${title.toUpperCase()} (${rows.length})`, ...rows.map((i) => `- ${i.student_name || "Student"}${i.student_code ? ` (${i.student_code})` : ""} · ${i.course} · ${moneyText(i.balance_minor, i.currency)} · ${shortDate(i.next_due_on)} (${when(i)})`)] : [];
    }),
    ...(link ? ["", `Open Balance payments: ${link}`] : []),
    "", "— Delta Commission Portal",
  ].join("\n");
  return { to, subject: `Balance payments: ${counts}`, html, text };
}

/* ── sending ─────────────────────────────────────────────────────────────── */

async function attempt(d: any, send: Send, by: string): Promise<"sent" | "failed" | "skipped"> {
  const at = iso();
  const res = await send(buildBalanceEmail(d.date, d.cs_name, d.to, d.items));
  const set = res.ok
    ? { status: "sent", sent_at: at, message_id: res.messageId, reason: "", last_error: "" }
    : res.notConfigured
      ? { status: "skipped", reason_code: "not_configured", reason: "Email is not set up on the server" }
      : { status: "failed", reason_code: "send_failed", reason: `Sending failed: ${res.error}`, last_error: res.error };
  await col(DIGESTS).updateOne({ _id: d._id }, {
    $set: { ...set, updated_at: at, last_attempt_at: at },
    $inc: { attempts: res.ok || !res.notConfigured ? 1 : 0 },
    $push: { history: { at, by, to: d.to, ok: res.ok, ...(res.ok ? { message_id: res.messageId } : { error: res.error }) } } as any,
  });
  return set.status as "sent" | "failed" | "skipped";
}

/**
 * The day's reminders: for each CS, what is due in 3, 2 or 1 days, today, or overdue and not told yet — claimed,
 * then the bell and a push, then the email. `send` is the mailer (a test passes its own); `now` the moment it runs.
 */
export async function runBalanceReminders(now = Date.now(), opts: { send?: Send; by?: string } = {}): Promise<BalanceRunSummary> {
  const send = opts.send ?? sendMail;
  const by = opts.by ?? "Schedule";
  const date = uaeDay(now);
  const summary: BalanceRunSummary = { date, told: 0, items: 0, sent: 0, failed: 0, skipped: 0, not_told: 0 };
  const groups = await collectDue(date);
  const ids = [...groups.keys()].filter(Boolean);
  const users = (await col("users")
    .find({ _id: { $in: ids.map(toObjectId).filter(Boolean) as any[] } }, { projection: { email: 1, full_name: 1, status: 1, is_test: 1 } })
    .toArray()) as any[];
  const byUser = new Map(users.map((u) => [String(u._id), u]));
  const configured = opts.send ? true : mailConfigured();

  for (const [cs, listed] of groups) {
    const u = byUser.get(cs);
    const email = String(u?.email ?? "").trim();
    if (!cs || !u || u.status === "inactive" || u.is_test || TEST_EMAIL.test(email)) { summary.not_told += listed.length; continue; }
    // What is owed, read again now: a payment, a void or a new due date since the list was made counts.
    const fresh = (await collectDue(date, [...new Set(listed.map((i) => i.student_id))])).get(cs) ?? [];
    const items = await claim(fresh, cs, date);
    if (!items.length) continue;
    summary.told++;
    summary.items += items.length;
    await notify([cs], {
      type: "balance_payments_due",
      title: `Balance payments: ${countsText(items)}`,
      body: items.slice(0, 3).map((i) => `${i.student_name || i.student_code || "Student"} (${when(i)})`).join(", ") + (items.length > 3 ? ` and ${items.length - 3} more` : ""),
      link: "/BalancePayments",
      tag: `balance-due-${date}`,
      renotify: true,
    });
    const skip = !EMAIL.test(email) ? "No valid email address" : !configured ? "Email is not set up on the server" : "";
    const at = iso();
    const d: any = {
      date, cs_id: cs, cs_name: String(u.full_name ?? ""), to: email, items, kinds: [...new Set(items.map((i) => i.kind))],
      status: skip ? "skipped" : "sending", reason: skip, attempts: 0, history: [], triggered_by: by, created_at: at, updated_at: at, last_attempt_at: skip ? null : at,
    };
    d._id = (await col(DIGESTS).insertOne(d)).insertedId;
    if (skip) { summary.skipped++; continue; }
    summary[await attempt(d, send, by)]++;
  }
  await col("app_settings").updateOne({ _id: SETTINGS_ID } as any, { $set: { last_run: { ...summary, at: iso(), by } } }, { upsert: true });
  return summary;
}

/** Today's failed emails get another go — with only what is still owed (a student who paid since is left out). */
export async function retryBalanceReminders(now = Date.now(), opts: { send?: Send } = {}): Promise<number> {
  const date = uaeDay(now);
  const due = (await col(DIGESTS).find({
    date, status: "failed", attempts: { $lt: MAX_ATTEMPTS }, last_attempt_at: { $lt: new Date(now - RETRY_AFTER_MS).toISOString() },
  }).toArray()) as any[];
  let tried = 0;
  for (const d of due) {
    const still = new Set(((await collectDue(date, [...new Set((d.items as BalanceItem[]).map((i) => i.student_id))])).get(d.cs_id) ?? []).map(claimKey));
    const items = (d.items as BalanceItem[]).filter((i) => still.has(claimKey(i)));
    if (!items.length) {
      await col(DIGESTS).updateOne({ _id: d._id }, { $set: { status: "skipped", reason: "Nothing left to remind about — paid since", updated_at: iso() } });
      continue;
    }
    await col(DIGESTS).updateOne({ _id: d._id }, { $set: { items, status: "sending", last_attempt_at: iso() } });
    await attempt({ ...d, items }, opts.send ?? sendMail, "Retry");
    tried++;
  }
  return tried;
}

/** Claim `date`'s run: true for exactly one caller, however many servers ask. */
async function claimDay(date: string): Promise<boolean> {
  try {
    const res = await col("app_settings").updateOne(
      { _id: SETTINGS_ID, last_run_date: { $ne: date } } as any,
      { $set: { last_run_date: date, last_run_started_at: iso() } },
      { upsert: true },
    );
    return res.modifiedCount === 1 || res.upsertedCount === 1;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
}

/** One look: from 10:00 UAE run the day once, then retry what failed. */
export async function balanceReminderTick(now = Date.now(), opts: { send?: Send } = {}): Promise<BalanceRunSummary | null> {
  const hour = uaeHour(now);
  if (hour < SEND_HOUR || hour > LAST_HOUR) return null;
  const date = uaeDay(now);
  let ran: BalanceRunSummary | null = null;
  if (await claimDay(date)) {
    ran = await runBalanceReminders(now, { ...opts, by: "Schedule" });
    console.log(`[balance reminders] ${date}: ${ran.told} CS told about ${ran.items} instalment(s) — emails sent ${ran.sent}, failed ${ran.failed}, not sent ${ran.skipped}`);
  }
  await retryBalanceReminders(now, opts);
  return ran;
}

/** Every 5 minutes. BALANCE_REMINDERS=off keeps this server from telling anyone (e.g. a laptop on the live database). */
export function startBalanceReminderWorker(): void {
  if (/^(off|false|0|no)$/i.test(process.env.BALANCE_REMINDERS ?? "")) {
    console.log("[balance reminders] off on this server (BALANCE_REMINDERS=off)");
    return;
  }
  const tick = () => balanceReminderTick().catch((err) => console.error("[balance reminders] run failed", err));
  setTimeout(() => void tick(), 120_000);
  setInterval(() => void tick(), TICK_MS);
}
