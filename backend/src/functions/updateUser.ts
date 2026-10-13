import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import { serialize, toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";

const ALLOWED = new Set(["super_admin", "admin", "broker_admin", "academic_head", "cs_manager"]);

export async function updateUser(req: Request, caller: AuthUser): Promise<Response> {
  if (!ALLOWED.has(caller.app_role)) return forbidden();
  const body: any = await req.json().catch(() => null);
  if (!body?.userId || !body?.userData) return error("userId and userData are required", 400);
  const oid = toObjectId(body.userId);
  if (!oid) return error("Invalid userId", 400);
  // Forbid password_hash being set through this path; require explicit password endpoint
  let { password_hash, _id, id, ...patch } = body.userData ?? {};
  // A CS Manager (2026-10-13): only a CS account, and only its name, 3CX extension, Up Head (its team) and whether it
  // takes new students — never the role, email, commission plan or status.
  if (caller.app_role === "cs_manager") {
    const target: any = await col("users").findOne({ _id: oid }, { projection: { app_role: 1 } });
    if (target?.app_role !== "cs") return forbidden("A CS Manager edits CS accounts only");
    const MAY = ["full_name", "extension", "extension_source", "up_head_id", "up_head_name", "no_auto_assign"];
    patch = Object.fromEntries(Object.entries(patch).filter(([k]) => MAY.includes(k)));
  }
  patch.updated_date = new Date().toISOString();
  await col("users").updateOne({ _id: oid }, { $set: patch });
  const updated = await col("users").findOne({ _id: oid }, { projection: { password_hash: 0 } });
  return json({ user: serialize(updated) });
}
