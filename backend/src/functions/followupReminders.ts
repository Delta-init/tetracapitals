import { col } from "../db";
import { config } from "../config";
import { json, error, forbidden } from "../lib/response";
import { mailInfo } from "../lib/mailer";
import type { AuthUser } from "../auth/middleware";
import { visibleMentorIds, canEditAny, isAdmin } from "../students/followups";
import {
  uaeToday, getReminderSettings, runReminders, resendReminder as resendOne, sendTestReminder as sendTest,
  markReminderSeen, reminderWorkerOn, REMINDER_SEND_TIME,
} from "../students/followupReminders";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const who = (u: AuthUser) => u.full_name || u.email || "somebody";

/**
 * POST /api/functions/getReminderLog
 * Body: { date? }  (YYYY-MM-DD, default today in UAE time)
 * The day's reminder emails — to whom, what was in them, sent / failed / not
 * sent and why, seen. The same people as the follow-ups: admin roles
 * everyone; Chief Mentor and CS Manager their people; anyone else their own.
 */
export async function getReminderLog(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const today = uaeToday();
  const date = DATE.test(String(body?.date ?? "")) ? String(body.date) : today;
  const visible = await visibleMentorIds(user);
  const filter: Record<string, any> = { date };
  if (visible) filter.mentor_id = { $in: [...visible] };
  const docs = (await col("followup_reminders").find(filter, { projection: { token: 0, key: 0 } }).sort({ mentor_name: 1 }).toArray()) as any[];
  const rows = docs.map(({ _id, ...r }) => ({ id: String(_id), ...r }));
  const counts = {
    total: rows.length,
    sent: rows.filter((r) => r.status === "sent").length,
    seen: rows.filter((r) => r.seen_at).length,
    failed: rows.filter((r) => r.status === "failed").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    sending: rows.filter((r) => r.status === "sending").length,
  };
  const settings = await getReminderSettings();
  const admin = isAdmin(user);
  return json({
    today,
    date,
    rows,
    counts,
    send_time: REMINDER_SEND_TIME,
    mail: admin ? mailInfo() : { configured: mailInfo().configured },
    worker_on: reminderWorkerOn(),
    ran_today: settings.last_run_date === today,
    last_run: admin ? settings.last_run ?? null : null,
    last_test: user.app_role === "super_admin" ? settings.last_test ?? null : null,
    can_resend: canEditAny(user),
    can_run: user.app_role === "super_admin",
  });
}

/** POST /api/functions/resendReminder — Super Admin / Admin. Body: { id }. Today's reminders only. */
export async function resendReminder(req: Request, user: AuthUser): Promise<Response> {
  if (!canEditAny(user)) return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const out = await resendOne(String(body?.id ?? ""), who(user));
  return out.ok ? json(out) : error(out.error, 400);
}

/** POST /api/functions/runRemindersNow — Super Admin: today's reminders now, to everyone who hasn't had one today. */
export async function runRemindersNow(_req: Request, user: AuthUser): Promise<Response> {
  if (user.app_role !== "super_admin") return forbidden();
  return json(await runReminders(uaeToday(), who(user)));
}

/** POST /api/functions/sendTestReminder — Super Admin. Body: { to? } (default: yourself). A sample, to check the mail set-up. */
export async function sendTestReminder(req: Request, user: AuthUser): Promise<Response> {
  if (user.app_role !== "super_admin") return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const to = String(body?.to ?? "").trim() || String(user.email ?? "");
  if (!EMAIL.test(to)) return error("Enter a valid email address", 400);
  const res = await sendTest(to, who(user));
  return res.ok ? json({ ok: true, to, message_id: res.messageId }) : error(res.error, 400);
}

/**
 * GET /api/reminders/open/:token — the button in a reminder email (no sign-in:
 * it is a link in an email). Notes the reminder as seen, then on to the
 * portal's follow-ups.
 */
export async function handleReminderOpen(token: string): Promise<Response> {
  await markReminderSeen(token).catch((err) => console.error("[reminders] could not note seen", err));
  if (!config.appBaseUrl) return new Response("Opened.", { status: 200, headers: { "Content-Type": "text/plain" } });
  return new Response(null, { status: 302, headers: { Location: `${config.appBaseUrl}/StudentFollowups`, "Cache-Control": "no-store" } });
}
