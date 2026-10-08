import { col } from "../db";
import { callLms, lmsConfigured } from "../lib/lms";
import { notify } from "../lib/notify";

/* ────────────────────────────────────────────────────────────────────────────
   A mentor's own schedule, told to them in the portal (the user, 2026-10-08):
   the bell (and push) when a session is booked with them, moved or cancelled,
   when a class of ours is put on, moved or cancelled — and 30 minutes before
   each class or session.

   Nothing changes in the LMS: every 2 minutes the portal reads the mentors'
   schedule (the same LMS answer as Mentor Calendar, functions/mentorCalendar.ts)
   for the next 14 days and compares it with what it saw last time, kept in
   `mentor_schedule_items`. A mentor is the portal person with the same email.
   The first look only takes note — nobody hears about what was already there.
   An LMS that doesn't answer is skipped: nothing is taken for cancelled.

   MENTOR_SCHEDULE_ALERTS=off keeps a server out of it.
──────────────────────────────────────────────────────────────────────────── */

const EVERY_MS = 2 * 60_000;
const AHEAD_DAYS = 14;
const REMIND_MINS = 30;
const COLL = "mentor_schedule_items";
const TZ = "Asia/Dubai";

export const mentorScheduleAlertsOn = () => lmsConfigured() && process.env.MENTOR_SCHEDULE_ALERTS !== "off";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: TZ, weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

type Item = { key: string; kind: "class" | "meeting"; mentor_email: string; title: string; starts_at: string; duration: number; status: string; with: string };

/** Each mentor's classes of ours and sessions booked with them, from the LMS's answer. */
export function itemsOf(mentors: any[]): Item[] {
  const out: Item[] = [];
  for (const m of mentors ?? []) {
    const email = String(m?.email ?? "").trim().toLowerCase();
    if (!email) continue;
    for (const c of m.classes ?? []) {
      if (!c?.id || !c.mine) continue;   // another academy's class: its time only, never ours to tell about
      out.push({ key: `class:${c.id}`, kind: "class", mentor_email: email, title: String(c.title || "Class"), starts_at: String(c.startsAt), duration: Number(c.durationMins) || 0, status: String(c.status || ""), with: "" });
    }
    for (const v of m.meetings ?? []) {
      if (!v?.id) continue;
      out.push({ key: `meeting:${v.id}`, kind: "meeting", mentor_email: email, title: String(v.title || "Session"), starts_at: String(v.startsAt), duration: Number(v.durationMins) || 0, status: "booked", with: (v.attendeeNames ?? []).join(", ") });
    }
  }
  return out;
}

const label = (i: Item) => (i.kind === "class" ? `Class: ${i.title}` : `${i.title}${i.with ? ` — with ${i.with}` : ""}`);

let running = false;

/** One look: what changed for each mentor since the last, and who to tell. Returns how many notices went. */
export async function checkMentorSchedules(now = new Date()): Promise<{ ok: boolean; sent: number; error?: string }> {
  if (running) return { ok: false, sent: 0, error: "A run is already going" };
  running = true;
  try {
    const to = new Date(now.getTime() + AHEAD_DAYS * 864e5);
    let data: any;
    try {
      data = await callLms("/mentors", { query: { from: now.toISOString(), to: to.toISOString() }, verb: "list its mentors" });
    } catch (err) {
      return { ok: false, sent: 0, error: err instanceof Error ? err.message : String(err) };
    }
    const items = itemsOf(data?.mentors ?? []);
    const users = (await col("users").find({ status: { $ne: "inactive" } }, { projection: { email: 1 } }).toArray()) as any[];
    const userOf = new Map(users.map((u) => [String(u.email ?? "").trim().toLowerCase(), String(u._id)]));
    const coll = col(COLL);
    const first = (await coll.estimatedDocumentCount()) === 0;
    const known = new Map(((await coll.find({ starts_at: { $gte: new Date(now.getTime() - 864e5).toISOString() } }).toArray()) as any[]).map((d) => [d._id, d]));
    const iso = now.toISOString();
    let sent = 0;
    const tell = async (i: Item, title: string, body: string) => {
      const uid = userOf.get(i.mentor_email);
      if (!uid || first) return;
      await notify([uid], { title, body, type: "mentor_schedule", link: "/MentorCalendar" });
      sent++;
    };

    const seen = new Set<string>();
    for (const i of items) {
      seen.add(i.key);
      const was: any = known.get(i.key);
      const cancelled = i.status === "cancelled";
      if (!was) {
        if (!cancelled) await tell(i, i.kind === "class" ? "New class on your schedule" : "New session booked with you", `${label(i)} · ${when(i.starts_at)}`);
        await coll.insertOne({ _id: i.key, ...i, first_seen_at: iso, seen_at: iso, ...(cancelled ? { cancelled_at: iso } : {}) } as any);
        continue;
      }
      const set: Record<string, any> = { ...i, seen_at: iso };
      if (cancelled && !was.cancelled_at) {
        await tell(i, i.kind === "class" ? "Class cancelled" : "Session cancelled", `${label(i)} · was ${when(i.starts_at)}`);
        set.cancelled_at = iso;
      } else if (!cancelled && was.starts_at !== i.starts_at) {
        await tell(i, i.kind === "class" ? "Class moved" : "Session moved", `${label(i)} · now ${when(i.starts_at)} (was ${when(was.starts_at)})`);
        set.reminded_at = null;   // the new time gets its own reminder
      }
      if (was.gone_at) set.gone_at = null;
      await coll.updateOne({ _id: i.key } as any, { $set: set });
    }

    // Booked before and gone from the LMS's answer while still ahead: cancelled (a session the LMS stops listing).
    for (const [key, was] of known) {
      if (seen.has(key) || was.gone_at || was.cancelled_at) continue;
      if (new Date(was.starts_at) <= now || new Date(was.starts_at) > to) continue;
      await tell(was, was.kind === "class" ? "Class cancelled" : "Session cancelled", `${label(was)} · was ${when(was.starts_at)}`);
      await coll.updateOne({ _id: key } as any, { $set: { gone_at: iso } });
    }

    // 30 minutes before.
    const soon = new Date(now.getTime() + REMIND_MINS * 60_000).toISOString();
    for (const d of (await coll.find({ starts_at: { $gt: iso, $lte: soon }, reminded_at: { $in: [null, undefined] }, cancelled_at: { $exists: false }, gone_at: { $in: [null, undefined] } }).toArray()) as any[]) {
      const mins = Math.max(1, Math.round((new Date(d.starts_at).getTime() - now.getTime()) / 60_000));
      await tell(d, `Starts in ${mins} minutes`, `${label(d)} · ${when(d.starts_at)}`);
      await coll.updateOne({ _id: d._id }, { $set: { reminded_at: iso } });
    }
    return { ok: true, sent };
  } finally {
    running = false;
  }
}

export function startMentorScheduleWorker(): void {
  if (!mentorScheduleAlertsOn()) {
    console.log(`[mentor schedule] off on this server (${lmsConfigured() ? "MENTOR_SCHEDULE_ALERTS=off" : "no LMS link: LMS_API_URL / LMS_SERVICE_SECRET"})`);
    return;
  }
  const tick = async () => {
    const r = await checkMentorSchedules().catch((err) => ({ ok: false, sent: 0, error: String(err) }));
    if (r.ok) { if (r.sent) console.log(`[mentor schedule] ${r.sent} notices sent`); }
    else if (r.error !== "A run is already going") console.error(`[mentor schedule] not run: ${r.error}`);
  };
  setTimeout(() => void tick(), 90_000);
  setInterval(() => void tick(), EVERY_MS);
}
