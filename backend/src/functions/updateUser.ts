import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import { serialize, toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";

const ALLOWED = new Set(["super_admin", "admin", "broker_admin", "academic_head"]);

export async function updateUser(req: Request, caller: AuthUser): Promise<Response> {
  if (!ALLOWED.has(caller.app_role)) return forbidden();
  const body: any = await req.json().catch(() => null);
  if (!body?.userId || !body?.userData) return error("userId and userData are required", 400);
  const oid = toObjectId(body.userId);
  if (!oid) return error("Invalid userId", 400);
  // Forbid password_hash being set through this path; require explicit password endpoint
  const { password_hash, _id, id, ...patch } = body.userData ?? {};
  patch.updated_date = new Date().toISOString();
  await col("users").updateOne({ _id: oid }, { $set: patch });
  const updated = await col("users").findOne({ _id: oid }, { projection: { password_hash: 0 } });
  return json({ user: serialize(updated) });
}
