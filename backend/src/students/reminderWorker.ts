import { col } from "../db";
import { notify } from "../lib/notify";
import { REMINDERS } from "../functions/reminders";

/* ────────────────────────────────────────────────────────────────────────────
   Reminders told (the user, 2026-10-28; functions/reminders.ts): whoever set
   one gets the bell, a push to their phone and computer, and the portal's
   chime, 15 minutes before and at the time — each once (`warned_at`,
   `notified_at`, claimed before it is sent, so several copies of the backend
   send it once). One that came due while the server was down is still told
   when it is back, up to a day late. Every 30 seconds; REMINDERS=off keeps a
   server out of it.
──────────────────────────────────────────────────────────────────────────── */

const MINUTE = 60_000;
const SOON_MS = 15 * MINUTE;
const LATE_MS = 24 * 60 * MINUTE;
const EVERY_MS = 30_000;

const at = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Dubai" }).toUpperCase();

async function claim(id: unknown, field: "warned_at" | "notified_at"): Promise<boolean> {
  const r = await col(REMINDERS).updateOne({ _id: id as any, [field]: null }, { $set: { [field]: new Date().toISOString() } });
  return r.modifiedCount === 1;
}

const linkOf = (r: any) => (r.student_id ? `/StudentDetail?id=${r.student_id}` : "/Reminders");
const about = (r: any) => (r.student_name ? ` · ${r.student_name}${r.student_code ? ` (${r.student_code})` : ""}` : "");

/** One look: the reminders due a notice now. Returns how many were sent. */
export async function reminderTick(now = Date.now()): Promise<number> {
  let sent = 0;
  // At the time (and up to a day late).
  const due = (await col(REMINDERS).find({
    done: { $ne: true }, notified_at: null,
    remind_at: { $lte: new Date(now).toISOString(), $gte: new Date(now - LATE_MS).toISOString() },
  }).limit(500).toArray()) as any[];
  for (const r of due) {
    if (!(await claim(r._id, "notified_at"))) continue;
    // No "in 15 min" after the time itself has been told.
    await col(REMINDERS).updateOne({ _id: r._id, warned_at: null }, { $set: { warned_at: new Date(now).toISOString() } });
    await notify([r.owner_id], {
      type: "reminder", title: `Reminder: ${r.title}`, body: `Now — ${at(r.remind_at)}${about(r)}${r.note ? ` · ${r.note}` : ""}`.slice(0, 300),
      link: linkOf(r), tag: `reminder-${r._id}`, renotify: true,
    });
    sent++;
  }
  // 15 minutes before.
  const soon = (await col(REMINDERS).find({
    done: { $ne: true }, warned_at: null, notified_at: null,
    remind_at: { $gt: new Date(now).toISOString(), $lte: new Date(now + SOON_MS).toISOString() },
  }).limit(500).toArray()) as any[];
  for (const r of soon) {
    if (!(await claim(r._id, "warned_at"))) continue;
    const mins = Math.max(1, Math.round((Date.parse(r.remind_at) - now) / MINUTE));
    await notify([r.owner_id], {
      type: "reminder", title: `In ${mins} min: ${r.title}`, body: `At ${at(r.remind_at)}${about(r)}${r.note ? ` · ${r.note}` : ""}`.slice(0, 300),
      link: linkOf(r), tag: `reminder-${r._id}`,
    });
    sent++;
  }
  return sent;
}

export function startRemindersWorker(): void {
  if (/^(off|false|0|no)$/i.test(process.env.REMINDERS ?? "")) return;
  setInterval(() => void reminderTick().catch((err) => console.error("[reminders] run failed", err)), EVERY_MS);
}
