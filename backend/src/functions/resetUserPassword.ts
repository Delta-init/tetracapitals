import bcrypt from "bcryptjs";
import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";

const ALLOWED = new Set(["super_admin", "admin"]);

/**
 * POST /api/functions/resetUserPassword
 * Body: { userId, newPassword, activate? }
 *
 * activate: switch a switched-off account back on as well — a new password
 * alone never gets somebody in while the account is off (2026-10-05).
 *
 * Admin-only. Lets a super_admin / admin set a new password for any user.
 * Used by the Personnel page action so an admin can unblock a user who has
 * forgotten their password or for the synthesized mentor accounts imported
 * from Base44 (which were created with an empty password_hash).
 *
 * Writes an audit Log row but NEVER includes the new password value in the
 * log details — only that a reset happened.
 */
export async function resetUserPassword(req: Request, caller: AuthUser): Promise<Response> {
  if (!ALLOWED.has(caller.app_role)) return forbidden("Only super_admin / admin can reset passwords");

  const body: any = await req.json().catch(() => null);
  if (!body) return error("Body required", 400);
  const { userId, newPassword } = body;
  if (!userId || !newPassword) return error("userId and newPassword are required", 400);
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return error("Password must be at least 8 characters", 400);
  }

  const oid = toObjectId(userId);
  if (!oid) return error("Invalid userId", 400);
  const target = await col("users").findOne({ _id: oid });
  if (!target) return error("User not found", 404);

  const password_hash = await bcrypt.hash(newPassword, 10);
  const now = new Date().toISOString();
  const wasOff = (target as any).status === "inactive";
  const switchOn = wasOff && body.activate === true;
  await col("users").updateOne(
    { _id: oid },
    { $set: {
      password_hash, updated_date: now, password_reset_by_id: caller.id, password_reset_by_name: caller.full_name, password_reset_at: now,
      ...(switchOn ? { status: "active", status_changed_by_id: caller.id, status_changed_by_name: caller.full_name, status_changed_at: now } : {}),
    } },
  );

  await col("logs").insertOne({
    timestamp: now,
    user_id: caller.id, user_email: caller.email, user_name: caller.full_name, user_role: caller.app_role,
    action_type: "reset_user_password",
    entity_type: "User",
    entity_id: userId,
    details: JSON.stringify({
      target_user: (target as any).full_name,
      target_email: (target as any).email,
      ...(switchOn ? { switched_on: true } : {}),
      // Never log the new password value itself.
    }),
    success: true,
    created_date: now,
  } as any);

  // status: what they are now — "inactive" means this password won't get them in until somebody switches them on.
  return json({ ok: true, user_id: userId, user_email: (target as any).email, status: wasOff && !switchOn ? "inactive" : "active", switched_on: switchOn });
}
