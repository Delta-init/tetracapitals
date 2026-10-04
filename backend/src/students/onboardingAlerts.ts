import { col } from "../db";
import { config } from "../config";
import { toObjectId } from "../lib/id";
import { mailConfigured, sendMail } from "../lib/mailer";
import { notify, type Notice } from "../lib/notify";
import { leadersOf } from "./followupReminders";
import { loadTeams } from "./teams";

/* ────────────────────────────────────────────────────────────────────────────
   New students from finance, waiting to be onboarded (the user, 2026-10-03).

   Every student not onboarded yet is on the Not onboarded page, and counted
   in the sidebar, until they are (functions/studentOnboarding.ts) — whatever
   they came from: finance, an LMS sign-up, added by hand, a sheet (the user,
   2026-10-04). From 25 September 2026 (00:00 UAE) on: everyone added before
   was marked onboarded (scripts/onboard-old-students.ts). Inactive students
   are left out. The alerts below are for new students from finance only
   (finance/students.ts — they carry `finance_invoice_id`).

   Still not onboarded 6 hours after arriving: their CS's leaders — their
   team's Chief Mentor and any CS Manager above them, as the overdue
   follow-up alert (followupReminders.ts) — and every Super Admin get one
   email and one notice (the bell, their phone), once per student; several
   at once go in one email. Not at night: what comes due between 21:00 and
   09:00 UAE goes at 09:00. Only students who arrived since the alerts were
   first switched on (app_settings "onboarding_alerts".since) — the ones
   already waiting then are on the page, not alerted. A test CS's students
   alert nobody, and test users are never told.

   A student is claimed (`onboarding_alert`) before anyone is told, so two
   copies of the backend never tell anyone twice. Every email is kept in
   `onboarding_alerts`, one per person per run: sent (with the mail server's
   message id), failed (tried again twice, 30 minutes apart, without the
   students onboarded meanwhile), or skipped and why.
──────────────────────────────────────────────────────────────────────────── */

export const WAIT_HOURS = 6;
const WAIT_MS = WAIT_HOURS * 3_600_000;
const UAE_OFFSET_MS = 4 * 3_600_000;   // UTC+4, no daylight saving
const DAY_FROM = 9;                     // alerts go from 09:00…
const DAY_TO = 21;                      // …until 20:59 UAE; the night's wait for 09:00
const TICK_MS = 5 * 60_000;
const STUCK_AFTER_MS = 15 * 60_000;     // claimed or sending this long: the process died mid-way
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 30 * 60_000;
const PER_RUN = 300;                    // students a run takes; any more go 5 minutes later
const SHOW_MAX = 40;                    // rows in an email
const SETTINGS_ID = "onboarding_alerts";
const ALERTS = "onboarding_alerts";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEST_EMAIL = /@deltatest\.dev$/i;

/** Everyone added before this was marked onboarded (scripts/onboard-old-students.ts): the page starts here. */
export const NOT_ONBOARDED_SINCE = new Date("2026-09-25T00:00:00+04:00").toISOString();

/**
 * Students not onboarded yet, whatever they came from — what the Not onboarded page lists and the sidebar counts.
 * `lateAt` (ms): only the ones that had waited 6 hours or more by then.
 */
export function notOnboardedFilter(lateAt?: number): Record<string, any> {
  const created: Record<string, unknown> = { $type: "string", $gte: NOT_ONBOARDED_SINCE };
  if (lateAt !== undefined) created.$lte = new Date(lateAt - WAIT_MS).toISOString();
  return { onboarded: { $ne: true }, status: { $ne: "INACTIVE" }, created_date: created };
}

/** Of those, the new ones from finance — what the alerts are about, and what turns the sidebar's number red. */
export function newFromFinanceFilter(lateAt?: number): Record<string, any> {
  return { ...notOnboardedFilter(lateAt), finance_invoice_id: { $exists: true, $nin: [null, ""] } };
}

const iso = (ms: number) => new Date(ms).toISOString();
const uaeHour = (now: number) => new Date(now + UAE_OFFSET_MS).getUTCHours();
const daytime = (now: number) => uaeHour(now) >= DAY_FROM && uaeHour(now) < DAY_TO;
/** "3 Oct, 14:05" — UAE time. */
const uaeTime = (at: string) =>
  new Date(Date.parse(at) + UAE_OFFSET_MS).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
const longDate = (now: number) =>
  new Date(now + UAE_OFFSET_MS).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const waited = (at: string, now: number) => {
  const h = Math.max(0, Math.floor((now - Date.parse(at)) / 3_600_000));
  return h < 48 ? `${h} hour${h === 1 ? "" : "s"}` : `${Math.floor(h / 24)} days`;
};
const firstName = (n: string) => { const f = n.trim().split(/\s+/)[0] || ""; return f ? f[0]!.toUpperCase() + f.slice(1) : "there"; };

/** When the alerts were first switched on — set once, by the first run anywhere. */
async function alertsSince(now: number): Promise<string> {
  const settings = col("app_settings");
  try {
    const doc: any = await settings.findOneAndUpdate(
      { _id: SETTINGS_ID } as any,
      { $setOnInsert: { since: iso(now) } },
      { upsert: true, returnDocument: "after" },
    );
    if (doc?.since) return String(doc.since);
  } catch {
    // Two servers creating it at the same moment: the other one's stands.
  }
  const doc: any = await settings.findOne({ _id: SETTINGS_ID } as any);
  return String(doc?.since || iso(now));
}

interface Item {
  student_id: string;
  name: string;
  code: string;
  phone: string;
  course: string;
  cs_name: string;
  team_name: string;
  arrived: string;
}

type Skip = { code: "no_user" | "inactive" | "test_user" | "no_email" | "not_configured"; reason: string } | null;

/** Why this person gets no email — no_user / inactive / test_user also get no notice. */
function skipFor(user: any, configured: boolean): Skip {
  if (!user) return { code: "no_user", reason: "Their account was not found" };
  if (user.status === "inactive") return { code: "inactive", reason: "Their account is inactive" };
  const email = String(user.email ?? "").trim();
  if (user.is_test || TEST_EMAIL.test(email)) return { code: "test_user", reason: "Test user — not told" };
  if (!EMAIL.test(email)) return { code: "no_email", reason: "No valid email address" };
  if (!configured) return { code: "not_configured", reason: "Email is not set up on the server" };
  return null;
}
const untold = (skip: Skip) => !!skip && ["no_user", "inactive", "test_user"].includes(skip.code);

/* ── the email and the notice ─────────────────────────────────────────────── */

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const th = (t: string) => `<th align="left" style="padding:8px 10px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0">${t}</th>`;
const td = (html: string, extra = "") => `<td valign="top" style="padding:9px 10px;font-size:13px;color:#0f172a;border-bottom:1px solid #f1f5f9;${extra}">${html}</td>`;
const small = (html: string, color = "#64748b") => `<div style="margin-top:3px;font-size:12px;color:${color}">${html}</div>`;
const nameOf = (i: Item) => i.name || i.code || "A student";
const pageLink = () => (config.appBaseUrl ? `${config.appBaseUrl}/NotOnboarded` : "");

function buildEmail(person: { name: string; to: string }, items: Item[], now: number) {
  const n = items.length;
  const one = n === 1;
  const headline = one ? `${nameOf(items[0]!)} isn't onboarded yet` : `${n} new students aren't onboarded yet`;
  const intro = `${one ? "This new student" : "These new students"} came from finance more than ${WAIT_HOURS} hours ago and ${one ? "hasn't" : "haven't"} been onboarded — no welcome email or WhatsApp has gone to them. You hear about each one once; they stay on the Not onboarded page until their CS onboards them.`;
  const shown = items.slice(0, SHOW_MAX);
  const rows = shown.map((i) => {
    const code = i.code ? ` <span style="font-family:monospace;font-size:11px;color:#94a3b8">${esc(i.code)}</span>` : "";
    return `<tr>${td(`<strong>${esc(i.name || "Student")}</strong>${code}${i.course ? small(esc(i.course)) : ""}`)}${td(esc(i.phone || "—"), "white-space:nowrap")}${td(`${esc(i.cs_name || "No CS")}${i.team_name ? small(esc(i.team_name)) : ""}`)}${td(`${esc(uaeTime(i.arrived))}${small(`${esc(waited(i.arrived, now))} ago`, "#be123c")}`, "white-space:nowrap")}</tr>`;
  }).join("");
  const more = n > shown.length ? `<p style="margin:8px 0 0;font-size:12px;color:#64748b">…and ${n - shown.length} more in the portal.</p>` : "";
  const link = pageLink();
  const button = link
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 6px"><tr><td style="border-radius:10px;background:#002950"><a href="${esc(link)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">Open Not onboarded</a></td></tr></table>`
    : "";
  const footnote = `Sent by the Delta Commission Portal when a new student from finance is still not onboarded ${WAIT_HOURS} hours after arriving — to their CS's Chief Mentor and CS Manager, and the Super Admins. What comes due overnight goes at 09:00 (UAE).`;

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden">
<tr><td style="background:#002950;padding:22px 24px">
<div style="font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#7CF0B5">Delta · Onboarding</div>
<div style="margin-top:6px;font-size:21px;font-weight:700;color:#ffffff">${esc(headline)}</div>
<div style="margin-top:4px;font-size:13px;color:#b3cbe4">${esc(longDate(now))}</div>
</td></tr>
<tr><td style="padding:22px 24px 10px">
<p style="margin:0 0 10px;font-size:15px">Hi ${esc(firstName(person.name))},</p>
<p style="margin:0;font-size:14px;line-height:1.55;color:#334155">${esc(intro)}</p>
<div style="margin:22px 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#be123c">Not onboarded after ${WAIT_HOURS} hours (${n})</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr style="background:#f8fafc">${th("Student")}${th("Phone")}${th("CS")}${th("Arrived (UAE)")}</tr>${rows}</table>${more}
${button}
</td></tr>
<tr><td style="padding:16px 24px 22px;font-size:12px;line-height:1.5;color:#94a3b8;border-top:1px solid #f1f5f9">${esc(footnote)}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `Hi ${firstName(person.name)},`,
    "",
    intro,
    "",
    `NOT ONBOARDED AFTER ${WAIT_HOURS} HOURS (${n})`,
    ...shown.map((i) => `- ${i.name || "Student"}${i.code ? ` (${i.code})` : ""} · ${i.phone || "no phone"} · ${i.cs_name || "no CS"}${i.team_name ? `, ${i.team_name}` : ""} · arrived ${uaeTime(i.arrived)}, ${waited(i.arrived, now)} ago${i.course ? ` · ${i.course}` : ""}`),
    ...(n > shown.length ? [`…and ${n - shown.length} more in the portal.`] : []),
    ...(link ? ["", `Open Not onboarded: ${link}`] : []),
    "",
    "— Delta Commission Portal",
  ].join("\n");

  const subject = one ? `Not onboarded after ${WAIT_HOURS} hours: ${nameOf(items[0]!)}` : `${n} new students not onboarded after ${WAIT_HOURS} hours`;
  return { to: person.to, subject, html, text };
}

function noticeOf(items: Item[]): Notice {
  const first = items[0]!;
  const one = items.length === 1;
  return {
    type: "onboarding_late",
    title: one ? `Not onboarded after ${WAIT_HOURS} hours: ${nameOf(first)}` : `${items.length} new students not onboarded after ${WAIT_HOURS} hours`,
    body: one
      ? `${nameOf(first)}${first.code ? ` (${first.code})` : ""} — ${first.cs_name || "no CS"}, from finance at ${uaeTime(first.arrived)} UAE. No welcome has gone yet.`
      : `${items.slice(0, 4).map(nameOf).join(", ")}${items.length > 4 ? ` and ${items.length - 4} more` : ""} — from finance, no welcome yet.`,
    link: one ? `/StudentDetail?id=${first.student_id}` : "/NotOnboarded",
    tag: one ? `onboarding-${first.student_id}` : "onboarding-late",
    renotify: true,
  };
}

/* ── the runs ─────────────────────────────────────────────────────────────── */

/** Not told yet — or claimed by a run that died before telling anyone. */
const claimable = (now: number) => ({
  $or: [
    { onboarding_alert: { $exists: false } },
    { "onboarding_alert.status": "claimed", "onboarding_alert.claimed_at": { $lt: iso(now - STUCK_AFTER_MS) } },
  ],
});

/** One email: only the students still not onboarded go in it. */
async function deliver(alert: any, now: number): Promise<"sent" | "failed" | "skipped"> {
  const ids = (alert.items as Item[]).map((i) => toObjectId(i.student_id)).filter(Boolean) as any[];
  const still = new Set((await col("students").find({ _id: { $in: ids }, onboarded: { $ne: true } }, { projection: { _id: 1 } }).toArray()).map((s) => String(s._id)));
  const items = (alert.items as Item[]).filter((i) => still.has(i.student_id));
  const at = iso(now);
  if (!items.length) {
    await col(ALERTS).updateOne({ _id: alert._id }, { $set: { status: "skipped", reason: "All onboarded meanwhile", last_attempt_at: at } });
    return "skipped";
  }
  const res = await sendMail(buildEmail({ name: alert.person_name, to: alert.to }, items, now));
  await col(ALERTS).updateOne({ _id: alert._id }, {
    $set: res.ok
      ? { status: "sent", sent_at: at, message_id: res.messageId, emailed_ids: items.map((i) => i.student_id), last_attempt_at: at }
      : { status: "failed", error: res.error, last_attempt_at: at },
    $inc: { attempts: 1 },
    ...(res.ok ? { $unset: { error: "" } } : {}),
  });
  return res.ok ? "sent" : "failed";
}

export interface AlertRun { students: number; sent: number; failed: number; skipped: number }

/**
 * Students from finance still not onboarded 6 hours after arriving, not alerted yet: claimed, then their CS's
 * leaders and the Super Admins told — one notice and one email each, listing all of theirs.
 */
export async function runOnboardingAlerts(now = Date.now()): Promise<AlertRun> {
  const run: AlertRun = { students: 0, sent: 0, failed: 0, skipped: 0 };
  const since = await alertsSince(now);
  const filter = newFromFinanceFilter(now);
  if (since > filter.created_date.$gte) filter.created_date.$gte = since;
  const due = (await col("students")
    .find({ ...filter, ...claimable(now) }, {
      projection: { full_name: 1, student_code: 1, phone: 1, lms_course: 1, primary_mentor_id: 1, primary_mentor_name: 1, team_name: 1, created_date: 1 },
    })
    .sort({ created_date: 1 })
    .limit(PER_RUN)
    .toArray()) as any[];
  if (!due.length) return run;

  const at = iso(now);
  const mine: any[] = [];
  for (const s of due) {
    // Onboarded meanwhile, or another copy of the backend took it: not this run's.
    const res = await col("students").updateOne(
      { _id: s._id, onboarded: { $ne: true }, ...claimable(now) },
      { $set: { onboarding_alert: { status: "claimed", claimed_at: at } } },
    );
    if (res.modifiedCount === 1) mine.push(s);
  }
  if (!mine.length) return run;
  run.students = mine.length;

  const teams = await loadTeams();
  const superAdmins = [...teams.userById.values()].filter((u) => u.app_role === "super_admin").map((u) => String(u._id));
  const byPerson = new Map<string, Item[]>();
  const nobody = new Set<string>();
  for (const s of mine) {
    const cs = String(s.primary_mentor_id ?? "");
    const csUser = cs ? teams.userById.get(cs) : null;
    if (csUser && TEST_EMAIL.test(String(csUser.email ?? ""))) { nobody.add(String(s._id)); continue; }   // a test CS's student
    const item: Item = {
      student_id: String(s._id),
      name: String(s.full_name ?? "").trim(),
      code: String(s.student_code ?? ""),
      phone: String(s.phone ?? "").replace(/^[\s'`"]+/, "").trim(),
      course: String(s.lms_course ?? "").trim(),
      cs_name: String(csUser?.full_name || s.primary_mentor_name || ""),
      team_name: String(s.team_name ?? ""),
      arrived: String(s.created_date),
    };
    for (const person of new Set([...(cs ? leadersOf(cs, teams) : []), ...superAdmins])) {
      byPerson.set(person, [...(byPerson.get(person) ?? []), item]);
    }
  }

  const users = (await col("users")
    .find({ _id: { $in: [...byPerson.keys()].map(toObjectId).filter(Boolean) as any[] } }, { projection: { email: 1, full_name: 1, status: 1, is_test: 1, app_role: 1 } })
    .toArray()) as any[];
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const configured = mailConfigured();
  const told = new Map<string, { id: string; name: string }[]>();
  const alerts: any[] = [];
  for (const [person, items] of byPerson) {
    const u = byId.get(person);
    const skip = skipFor(u, configured);
    if (!untold(skip)) {
      const name = String(u.full_name || u.email || "");
      for (const i of items) told.set(i.student_id, [...(told.get(i.student_id) ?? []), { id: person, name }]);
      await notify([person], noticeOf(items));
    }
    const alert = {
      at, person_id: person, person_name: String(u?.full_name || ""), role: String(u?.app_role ?? ""), to: String(u?.email ?? "").trim(),
      items, student_ids: items.map((i) => i.student_id),
      ...(skip ? { status: "skipped", reason: skip.reason, skip_code: skip.code, attempts: 0 } : { status: "sending", attempts: 0, last_attempt_at: at }),
    };
    const { insertedId } = await col(ALERTS).insertOne(alert as any);
    if (skip) run.skipped++;
    else alerts.push({ ...alert, _id: insertedId });
  }

  // Told (or nobody to tell): never again for these students.
  for (const s of mine) {
    const id = String(s._id);
    await col("students").updateOne({ _id: s._id }, {
      $set: { onboarding_alert: { status: "done", claimed_at: at, at, told: told.get(id) ?? [], ...(nobody.has(id) ? { reason: "Test CS — nobody is told" } : {}) } },
    });
  }

  for (const alert of alerts) {
    const r = await deliver(alert, now);
    run[r]++;
  }
  return run;
}

/** Emails that failed, or a run that died while sending: again, up to 3 tries, 30 minutes apart. */
export async function retryOnboardingAlerts(now = Date.now()): Promise<number> {
  const waiting = (await col(ALERTS).find({
    attempts: { $lt: MAX_ATTEMPTS },
    $or: [
      { status: "failed", last_attempt_at: { $lt: iso(now - RETRY_AFTER_MS) } },
      { status: "sending", last_attempt_at: { $lt: iso(now - STUCK_AFTER_MS) } },
    ],
  }).limit(50).toArray()) as any[];
  let again = 0;
  for (const a of waiting) {
    // Taken by this server only if nobody else took it since.
    const res = await col(ALERTS).updateOne({ _id: a._id, status: a.status, last_attempt_at: a.last_attempt_at }, { $set: { status: "sending", last_attempt_at: iso(now) } });
    if (res.modifiedCount !== 1) continue;
    await deliver(a, now);
    again++;
  }
  return again;
}

/* ── the worker ──────────────────────────────────────────────────────────── */

/** One look: the clock starts when the alerts are first switched on; during the day, tell and retry. */
export async function onboardingAlertTick(now = Date.now()): Promise<void> {
  await alertsSince(now);
  if (!daytime(now)) return;
  const r = await runOnboardingAlerts(now);
  if (r.students) {
    console.log(`[onboarding alerts] ${r.students} student${r.students === 1 ? "" : "s"} not onboarded after ${WAIT_HOURS} hours: ${r.sent} email${r.sent === 1 ? "" : "s"} sent, ${r.failed} failed, ${r.skipped} not sent`);
  }
  await retryOnboardingAlerts(now);
}

/** Every 5 minutes. ONBOARDING_ALERTS=off keeps this server from telling anyone (e.g. a laptop on the live database). */
export function startOnboardingAlertWorker(): void {
  if (/^(off|false|0|no)$/i.test(process.env.ONBOARDING_ALERTS ?? "")) {
    console.log("[onboarding alerts] off on this server (ONBOARDING_ALERTS=off)");
    return;
  }
  const tick = () => onboardingAlertTick().catch((err) => console.error("[onboarding alerts] run failed", err));
  setTimeout(() => void tick(), 120_000);
  setInterval(() => void tick(), TICK_MS);
}
