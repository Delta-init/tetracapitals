import { col } from "../db";
import { toObjectId } from "../lib/id";
import { notify } from "../lib/notify";
import { CLOSED_STAGES } from "./followups";
import { uaeToday } from "./followupReminders";

/* ────────────────────────────────────────────────────────────────────────────
   A follow-up with a time (the user, 2026-10-10): its CS — the student's
   primary mentor now — is reminded on the bell, their phone and the browser
   15 minutes before it, and again at the time. Each goes once for that date
   and time (`time_reminder.soon` / `.now` keep which one was sent), so a new
   time gets its own reminders. Claimed on the follow-up before it is sent, so
   several copies of the backend send it once. A reminder more than an hour
   late (the server was down) isn't sent. FOLLOWUP_REMINDERS=off keeps a server
   out of it, like the 10:00 email.
──────────────────────────────────────────────────────────────────────────── */

const MINUTE = 60_000;
const SOON_MS = 15 * MINUTE;
const LATE_MS = 60 * MINUTE;

/** "14:30" → "2:30 PM", as the portal shows it. */
const ampm = (t: string) => { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

/** When a follow-up's date and time (UAE, UTC+4) is, in ms. */
export const dueAt = (date: string, time: string) => Date.parse(`${date}T${time}:00+04:00`);

async function claim(id: unknown, which: "soon" | "now", key: string): Promise<boolean> {
  const r = await col("student_followups").updateOne(
    { _id: id as any, [`time_reminder.${which}`]: { $ne: key } },
    { $set: { [`time_reminder.${which}`]: key } },
  );
  return r.modifiedCount === 1;
}

/** One look: today's timed follow-ups that are due a reminder now. Returns how many were sent. */
export async function timeReminderTick(now = Date.now()): Promise<number> {
  const today = uaeToday(now);
  const due = (await col("student_followups")
    .find({ next_followup_date: today, next_followup_time: { $gt: "" }, stage: { $nin: [...CLOSED_STAGES] } })
    .toArray()) as any[];
  if (!due.length) return 0;
  const ids = [...new Set(due.map((f) => String(f.student_id)))].map(toObjectId).filter(Boolean);
  const students = (await col("students")
    .find({ _id: { $in: ids as any[] } }, { projection: { full_name: 1, student_code: 1, primary_mentor_id: 1 } })
    .toArray()) as any[];
  const byId = new Map(students.map((s) => [String(s._id), s]));

  let sent = 0;
  for (const f of due) {
    const s = byId.get(String(f.student_id));
    const cs = String(s?.primary_mentor_id ?? "");
    if (!s || !cs) continue;
    const at = dueAt(f.next_followup_date, f.next_followup_time);
    if (!Number.isFinite(at)) continue;
    const which = now >= at ? (now < at + LATE_MS ? "now" : null) : now >= at - SOON_MS ? "soon" : null;
    if (!which) continue;
    const key = `${f.next_followup_date} ${f.next_followup_time}`;
    if (!(await claim(f._id, which, key))) continue;
    const name = String(s.full_name ?? "").trim() || s.student_code || "A student";
    const what = [f.target_outcome, f.client_said].filter(Boolean).join(" — ");
    await notify([cs], {
      type: "followup_time",
      title: which === "soon" ? `Follow-up at ${ampm(f.next_followup_time)}: ${name}` : `Follow-up now: ${name}`,
      body: `${which === "soon" ? `In ${Math.max(1, Math.round((at - now) / MINUTE))} min` : `Due at ${ampm(f.next_followup_time)}`}${what ? ` · ${what}` : ""}`.slice(0, 300),
      link: `/StudentDetail?id=${String(s._id)}`,
    });
    sent++;
  }
  return sent;
}

/** Every minute. */
export function startTimeReminderWorker(): void {
  if (/^(off|false|0|no)$/i.test(process.env.FOLLOWUP_REMINDERS ?? "")) return;
  setInterval(() => void timeReminderTick().catch((err) => console.error("[followup-time] run failed", err)), MINUTE);
}
