import bcrypt from "bcryptjs";
import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";

const ALLOWED = new Set(["super_admin", "admin"]);

/**
 * POST /api/functions/resetUserPassword
 * Body: { userId, newPassword }
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
  await col("users").updateOne(
    { _id: oid },
    { $set: { password_hash, updated_date: now, password_reset_by_id: caller.id, password_reset_by_name: caller.full_name, password_reset_at: now } },
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
      // Never log the new password value itself.
    }),
    success: true,
    created_date: now,
  } as any);

  return json({ ok: true, user_id: userId, user_email: (target as any).email });
}
