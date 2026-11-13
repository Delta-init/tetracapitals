import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { toObjectId } from "../lib/id";
import { loadTeams } from "../students/teams";

/* ────────────────────────────────────────────────────────────────────────────
   TV amounts (the user, 2026-11-13): amounts a Super Admin adds by hand for a
   CS, counted on the CS TV board only — in the CS's month and today, their team,
   the totals, the ranking and the latest payments (pop-up and voice too) — and
   shown there like any payment. Nowhere else: not the Leaderboard page, the
   Dashboard, reports, commission or finance. Kept in `cs_tv_extras`, with who
   added each; removing one takes it off the board. functions/csTv.ts adds them in.
──────────────────────────────────────────────────────────────────────────── */

export const EXTRAS = "cs_tv_extras";
const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const round = (n: number) => Math.round(n * 100) / 100;
let onChange: () => void = () => {};
/** csTv.ts registers its cache clear here, so a change shows on the next refresh. */
export const onExtrasChange = (f: () => void) => { onChange = f; };

/** The location's active CSs, for the picker. */
async function csOf(location: "dubai" | "bangalore") {
  const index = await loadTeams();
  return ((await col("users").find({ app_role: "cs", status: { $ne: "inactive" } }, { projection: { full_name: 1 } }).toArray()) as any[])
    .filter((u) => (index.teamOf(String(u._id))?.location ?? "dubai") === location)
    .map((u) => ({ id: String(u._id), name: String(u.full_name ?? "").trim(), team: index.teamOf(String(u._id))?.name ?? "No team" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** POST getCsTvExtras { location, month? (YYYY-MM) } → { extras, cs, products } — Super Admins. */
export async function getCsTvExtras(req: Request, user: AuthUser): Promise<Response> {
  if (user.app_role !== "super_admin") return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const location = body?.location === "bangalore" ? "bangalore" : "dubai";
  const month = /^\d{4}-\d{2}$/.test(str(body?.month)) ? str(body.month) : new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 7);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const from = new Date(Date.UTC(y, m - 1, 1) - 4 * 3600_000).toISOString(), to = new Date(Date.UTC(y, m, 1) - 4 * 3600_000).toISOString();
  const extras = ((await col(EXTRAS).find({ location, at: { $gte: from, $lt: to } }).sort({ at: -1 }).toArray()) as any[])
    .map((e) => ({ id: String(e._id), cs_id: e.cs_id, cs_name: e.cs_name, aed: e.aed, product: e.product, at: e.at, added_by: e.created_by_name, added_at: e.created_date }));
  const products = ((await col("funding_transactions").distinct("course_payment.product", { "course_payment.product": { $exists: true } })) as any[])
    .map((p) => String(p ?? "").trim()).filter(Boolean).sort();
  return json({ location, month, extras, cs: await csOf(location), products, total_aed: round(extras.reduce((s, e) => s + (Number(e.aed) || 0), 0)) });
}

/** POST addCsTvExtra { cs_id, aed, product, at? (ISO, default now; never in the future) } — Super Admins. */
export async function addCsTvExtra(req: Request, user: AuthUser): Promise<Response> {
  if (user.app_role !== "super_admin") return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(str(body?.cs_id, 40));
  const cs: any = oid ? await col("users").findOne({ _id: oid as any, app_role: "cs", status: { $ne: "inactive" } }, { projection: { full_name: 1 } }) : null;
  if (!cs) return error("Pick an active CS", 400);
  const aed = round(Number(body?.aed));
  if (!Number.isFinite(aed) || aed <= 0 || aed > 1_000_000) return error("Give an amount in AED, more than 0", 400);
  const product = str(body?.product, 60);
  if (!product) return error("Give the course", 400);
  const at = body?.at ? new Date(String(body.at)) : new Date();
  if (Number.isNaN(at.getTime())) return error("That date isn't right", 400);
  if (at.getTime() > Date.now() + 60_000) return error("Not a time still to come", 400);
  const index = await loadTeams();
  const doc = {
    location: index.teamOf(String(cs._id))?.location ?? "dubai", cs_id: String(cs._id), cs_name: String(cs.full_name ?? "").trim(),
    aed, product, at: at.toISOString(), created_by_id: user.id, created_by_name: user.full_name ?? "", created_date: new Date().toISOString(),
  };
  const r = await col(EXTRAS).insertOne(doc as any);
  onChange();
  return json({ ok: true, id: String(r.insertedId) });
}

/** POST removeCsTvExtra { id } — Super Admins. */
export async function removeCsTvExtra(req: Request, user: AuthUser): Promise<Response> {
  if (user.app_role !== "super_admin") return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(str(body?.id, 40));
  const r = oid ? await col(EXTRAS).deleteOne({ _id: oid as any }) : null;
  if (!r?.deletedCount) return notFound("Already removed");
  onChange();
  return json({ ok: true });
}
