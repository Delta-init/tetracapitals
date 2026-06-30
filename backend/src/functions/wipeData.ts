import { col, db } from "../db";
import { json, error, forbidden } from "../lib/response";
import type { AuthUser } from "../auth/middleware";

/**
 * POST /api/functions/wipeData
 * Body: { confirm: "WIPE", keepEmail?: string }
 *
 * super_admin only. Drops every document in every collection EXCEPT the
 * caller themselves (or the user matching keepEmail if provided), so the
 * operator can still log in afterwards. Indexes are kept; the running
 * backend has them already.
 *
 * No audit log is written — there is nothing left to audit against.
 */
export async function wipeData(req: Request, caller: AuthUser): Promise<Response> {
  if (caller.app_role !== "super_admin") return forbidden("super_admin only");
  const body: any = await req.json().catch(() => null);
  if (!body || body.confirm !== "WIPE") return error('Body must include { confirm: "WIPE" }', 400);

  const keepEmail = ((body.keepEmail as string) || caller.email).toLowerCase();
  const admin = await col("users").findOne({ email: keepEmail });
  if (!admin) return error(`No user with email ${keepEmail} — refusing to wipe`, 400);

  const collections = await db().listCollections().toArray();
  const summary: Record<string, number> = {};
  let total = 0;
  for (const c of collections) {
    if (c.name.startsWith("system.")) continue;
    let n = 0;
    if (c.name === "users") {
      const res = await col("users").deleteMany({ _id: { $ne: admin._id } });
      n = res.deletedCount;
    } else {
      const res = db().collection(c.name).deleteMany({});
      n = (await res).deletedCount;
    }
    summary[c.name] = n;
    total += n;
  }

  return json({ ok: true, total_deleted: total, kept_user: { email: keepEmail, id: admin._id.toString() }, per_collection: summary });
}
