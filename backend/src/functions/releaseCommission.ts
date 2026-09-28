import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";

const ALLOWED = new Set(["super_admin", "admin", "broker_admin", "finance_admin"]);

/**
 * POST /api/functions/releaseCommission
 * Body: { ids: string[] }  (commission_credit ids to mark paid/released)
 *
 * Marks the given accrued commission credits as "released" (paid). The caller
 * (Monthly / Quarter closing page) passes the exact credit ids for the period,
 * so period boundaries always match what's shown on screen. Idempotent.
 */
export async function releaseCommission(req: Request, user: AuthUser): Promise<Response> {
  if (!ALLOWED.has(user.app_role)) return forbidden("Not allowed to release commission");
  const body: any = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
  if (!ids.length) return error("ids (non-empty array) required", 400);

  const oids = ids.map((id) => toObjectId(id)).filter((o): o is NonNullable<typeof o> => !!o);
  if (!oids.length) return error("No valid ids", 400);

  const now = new Date().toISOString();
  const res = await col("commission_credits").updateMany(
    { _id: { $in: oids }, status: { $ne: "released" } },
    { $set: { status: "released", released_at: now, released_by_id: user.id, released_by_name: user.full_name } },
  );
  return json({ ok: true, released: res.modifiedCount });
}
