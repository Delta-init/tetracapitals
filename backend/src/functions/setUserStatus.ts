import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";

const ALLOWED = new Set(["super_admin", "admin"]);

/**
 * POST /api/functions/setUserStatus
 * Body: { userId, status: "active" | "inactive" }
 *
 * Super Admin / Admin: switch an account on or off from the Personnel page —
 * the same switch the Root portal has (portal/service.ts /set-user-role), so a
 * switched-off account can be brought back here too (the user, 2026-10-05: a
 * broker admin whose password was reset still could not sign in, being off).
 * Off: they cannot sign in, and a session they have open stops at once
 * (auth/middleware.ts refuses an inactive account on every request).
 *
 * Nobody switches themselves off, and only a Super Admin switches a Super
 * Admin off. Writes an audit Log row.
 */
export async function setUserStatus(req: Request, caller: AuthUser): Promise<Response> {
  if (!ALLOWED.has(caller.app_role)) return forbidden("Only a Super Admin or an Admin can switch accounts on or off");

  const body: any = await req.json().catch(() => null);
  const status = String(body?.status ?? "").trim().toLowerCase();
  if (status !== "active" && status !== "inactive") return error('status must be "active" or "inactive"', 400);
  const oid = toObjectId(String(body?.userId ?? ""));
  if (!oid) return error("Invalid userId", 400);
  const target: any = await col("users").findOne({ _id: oid }, { projection: { password_hash: 0 } });
  if (!target) return notFound("User not found");

  if (status === "inactive") {
    if (String(target._id) === caller.id) return error("You can't switch yourself off", 400);
    if (target.app_role === "super_admin" && caller.app_role !== "super_admin") {
      return forbidden("Only a Super Admin can switch a Super Admin off");
    }
  }
  const was = target.status === "inactive" ? "inactive" : "active";
  if (was === status) return json({ ok: true, user_id: String(target._id), status, changed: false });

  const now = new Date().toISOString();
  await col("users").updateOne(
    { _id: oid },
    { $set: { status, updated_date: now, status_changed_by_id: caller.id, status_changed_by_name: caller.full_name, status_changed_at: now } },
  );
  await col("logs").insertOne({
    timestamp: now,
    user_id: caller.id, user_email: caller.email, user_name: caller.full_name, user_role: caller.app_role,
    action_type: "set_user_status",
    entity_type: "User",
    entity_id: String(target._id),
    details: JSON.stringify({ target_user: target.full_name, target_email: target.email, from: was, to: status }),
    success: true,
    created_date: now,
  } as any);

  return json({ ok: true, user_id: String(target._id), status, changed: true });
}
