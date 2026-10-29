import { col } from "../db";
import { lmsConfigured } from "../lib/lms";
import { push } from "../lib/notify";
import type { AuthUser } from "../auth/middleware";
import { LIVE_NOT_JOINED_ROLES, loadLiveNotJoined, liveNotJoinedFor } from "../functions/liveNotJoined";

/* ────────────────────────────────────────────────────────────────────────────
   Not joined yet, on the phone (the user, 2026-10-29): a push at class time to
   everyone who would see it on the "Not joined yet" page (functions/
   liveNotJoined.ts) — CSs, CS Managers, Chiefs and team mentors, not Super
   Admins (they see every class). Push only, no bell: an open portal has the
   window. Its own vibration and tone, and it stays until tapped (push-sw.js).

   Every minute, once a live class is 5 minutes in (a minute late isn't
   missing): one push a class naming who hasn't joined, and another only when
   someone new is missing — what went to whom is kept in `live_not_joined_pushed`.
   Only people with notifications on for a device are looked at.

   LIVE_NOT_JOINED_PUSH=off keeps a server out of it.
──────────────────────────────────────────────────────────────────────────── */

const EVERY_MS = 60_000;
export const GRACE_MINS = 5;
const COLL = "live_not_joined_pushed";

export const liveNotJoinedPushOn = () => lmsConfigured() && process.env.LIVE_NOT_JOINED_PUSH !== "off";

const names = (list: string[]) => (list.length <= 3 ? list.join(", ") : `${list.slice(0, 3).join(", ")} +${list.length - 3}`);

let running = false;

/** One look. Returns how many pushes went. */
export async function pushLiveNotJoined(now = new Date()): Promise<{ ok: boolean; sent: number; error?: string }> {
  if (running) return { ok: false, sent: 0, error: "A run is already going" };
  running = true;
  try {
    let load;
    try {
      load = await loadLiveNotJoined();
    } catch (err) {
      return { ok: false, sent: 0, error: err instanceof Error ? err.message : String(err) };
    }
    const due = load.classes.filter((c) => c.live && now.getTime() - new Date(c.startsAt).getTime() >= GRACE_MINS * 60_000);
    if (!due.length) return { ok: true, sent: 0 };

    const subscribed = (await col("push_subscriptions").distinct("user_id")).map(String);
    const people = (await col("users").find(
      { app_role: { $in: [...LIVE_NOT_JOINED_ROLES] }, status: { $ne: "inactive" } },
      { projection: { email: 1, full_name: 1, app_role: 1 } },
    ).toArray()) as any[];
    const coll = col(COLL);
    const iso = now.toISOString();
    let sent = 0;

    for (const p of people) {
      const uid = String(p._id);
      if (!subscribed.includes(uid)) continue;
      const user: AuthUser = { id: uid, email: String(p.email ?? ""), full_name: p.full_name, app_role: String(p.app_role) };
      for (const c of await liveNotJoinedFor(user, { ...load, classes: due })) {
        const key = `${uid}:${c.id}`;
        const was: any = await coll.findOne({ _id: key } as any);
        const told = new Set<string>(was?.booking_ids ?? []);
        const fresh = c.notJoined.filter((s) => !told.has(s.bookingId));
        if (!fresh.length) continue;
        const n = c.notJoined.length;
        await push([uid], {
          type: "live_not_joined",
          title: `Live now: ${c.title || "a class"} — ${n} not joined`,
          body: `${names(c.notJoined.map((s) => s.student?.name || s.name))} booked and haven't joined. Call them to join.`,
          link: "/LiveNotJoined",
          tag: `live-not-joined-${c.id}`,
          renotify: true,
          ttl: 30 * 60,   // a class over by the time it arrives isn't worth it
        });
        await coll.updateOne({ _id: key } as any, { $addToSet: { booking_ids: { $each: fresh.map((s) => s.bookingId) } }, $set: { user_id: uid, class_id: c.id, at: iso } } as any, { upsert: true });
        sent++;
      }
    }
    await coll.deleteMany({ at: { $lt: new Date(now.getTime() - 2 * 864e5).toISOString() } });
    return { ok: true, sent };
  } finally {
    running = false;
  }
}

export function startLiveNotJoinedPushWorker(): void {
  if (!liveNotJoinedPushOn()) {
    console.log(`[live not joined push] off on this server (${lmsConfigured() ? "LIVE_NOT_JOINED_PUSH=off" : "no LMS link: LMS_API_URL / LMS_SERVICE_SECRET"})`);
    return;
  }
  const tick = async () => {
    const r = await pushLiveNotJoined().catch((err) => ({ ok: false, sent: 0, error: String(err) }));
    if (r.ok) { if (r.sent) console.log(`[live not joined push] ${r.sent} pushes sent`); }
    else if (r.error !== "A run is already going") console.error(`[live not joined push] not run: ${r.error}`);
  };
  setTimeout(() => void tick(), 75_000);
  setInterval(() => void tick(), EVERY_MS);
}
