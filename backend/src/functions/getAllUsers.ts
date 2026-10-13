import { col } from "../db";
import { json, forbidden } from "../lib/response";
import { serializeMany } from "../lib/id";
import type { AuthUser } from "../auth/middleware";

const ALLOWED = new Set([
  "super_admin", "admin", "broker_admin", "academic_head",
  "academic_admin", "admin_supervisor", "finance_admin",
  // CS Managers (2026-10-13): the Personnel page shows them the CS accounts only (View as, a few details to edit).
  "cs_manager",
]);

export async function getAllUsers(_req: Request, user: AuthUser): Promise<Response> {
  if (!ALLOWED.has(user.app_role)) return forbidden();
  const docs = await col("users")
    .find({}, { projection: { password_hash: 0 } })
    .sort({ created_date: -1 })
    .limit(2000)
    .toArray();
  return json({ users: serializeMany(docs) });
}
