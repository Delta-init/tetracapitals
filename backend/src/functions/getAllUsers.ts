import { col } from "../db";
import { json, forbidden } from "../lib/response";
import { serializeMany } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { csManagerReach } from "../lib/userLocation";
import { toObjectId } from "../lib/id";

const ALLOWED = new Set([
  "super_admin", "admin", "broker_admin", "academic_head",
  "academic_admin", "admin_supervisor", "finance_admin",
  // CS Managers (2026-10-13): the Personnel page shows them the CS accounts only (View as, a few details to edit).
  "cs_manager",
]);

export async function getAllUsers(_req: Request, user: AuthUser): Promise<Response> {
  if (!ALLOWED.has(user.app_role)) return forbidden();
  // A CS Manager: their own location's people only (2026-10-14).
  const reach = await csManagerReach(user);
  const docs = await col("users")
    .find(reach ? { _id: { $in: [...reach.ids, user.id].map((id) => toObjectId(id)).filter(Boolean) as any[] } } : {}, { projection: { password_hash: 0 } })
    .sort({ created_date: -1 })
    .limit(2000)
    .toArray();
  return json({ users: serializeMany(docs) });
}
