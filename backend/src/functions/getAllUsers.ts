import { col } from "../db";
import { json, forbidden } from "../lib/response";
import { serializeMany } from "../lib/id";
import type { AuthUser } from "../auth/middleware";

const ALLOWED = new Set([
  "super_admin", "admin", "broker_admin", "academic_head",
  "academic_admin", "admin_supervisor", "finance_admin",
]);

export async function getAllUsers(_req: Request, user: AuthUser): Promise<Response> {
  if (!ALLOWED.has(user.app_role)) return forbidden();
  const docs = await col("users")
    .find({}, { projection: { password_hash: 0 } })
    .sort({ created_date: -1 })
    .limit(200)
    .toArray();
  return json({ users: serializeMany(docs) });
}
