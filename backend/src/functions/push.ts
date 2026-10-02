import { col } from "../db";
import { config } from "../config";
import { json, error } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { pushConfigured, push } from "../lib/notify";

/* ────────────────────────────────────────────────────────────────────────────
   Turning phone / desktop notifications on and off (lib/notify.ts sends them).
   A device is a browser's push subscription, kept per person in
   push_subscriptions — one person can have several (phone, laptop).
──────────────────────────────────────────────────────────────────────────── */

const str = (v: unknown, max = 600) => String(v ?? "").trim().slice(0, max);

/** POST /api/functions/getPushConfig — whether push is set up here, the key a browser subscribes with, and your devices. */
export async function getPushConfig(_req: Request, user: AuthUser): Promise<Response> {
  const enabled = pushConfigured();
  const devices = await col("push_subscriptions").countDocuments({ user_id: user.id });
  return json({ enabled, publicKey: enabled ? config.push.publicKey : "", devices });
}

/** POST /api/functions/savePushSubscription { endpoint, keys: { p256dh, auth } } — this device, for you. Safe to repeat. */
export async function savePushSubscription(req: Request, user: AuthUser): Promise<Response> {
  if (!pushConfigured()) return error("Notifications are not set up on this server", 503);
  const body: any = await req.json().catch(() => ({}));
  const endpoint = str(body?.endpoint, 1000);
  const p256dh = str(body?.keys?.p256dh, 300), auth = str(body?.keys?.auth, 100);
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) return error("Not a push subscription", 400);
  const now = new Date().toISOString();
  // By endpoint: a device someone else used before is yours now.
  await col("push_subscriptions").updateOne(
    { endpoint },
    { $set: { endpoint, keys: { p256dh, auth }, user_id: user.id, user_name: user.full_name || user.email, user_agent: str(req.headers.get("user-agent"), 300), updated_date: now }, $setOnInsert: { created_date: now } },
    { upsert: true },
  );
  return json({ ok: true });
}

/** POST /api/functions/deletePushSubscription { endpoint } — this device stops getting your notifications. */
export async function deletePushSubscription(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const endpoint = str(body?.endpoint, 1000);
  if (!endpoint) return error("endpoint is required", 400);
  const res = await col("push_subscriptions").deleteOne({ endpoint, user_id: user.id });
  return json({ ok: true, removed: res.deletedCount });
}

/** POST /api/functions/sendTestPush — a test notification to all your devices. */
export async function sendTestPush(_req: Request, user: AuthUser): Promise<Response> {
  if (!pushConfigured()) return error("Notifications are not set up on this server", 503);
  const devices = await col("push_subscriptions").countDocuments({ user_id: user.id });
  if (!devices) return error("Turn notifications on on this device first", 400);
  await push([user.id], { type: "test", title: "Notifications are on", body: "This is how new students, follow-ups due and WhatsApp messages will reach you.", link: "/", tag: "test" });
  return json({ ok: true, devices });
}
