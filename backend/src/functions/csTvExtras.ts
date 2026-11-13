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

   Which board (2026-11-14 — "this is needed in the Dubai TV… Bangalore
   employees"): each amount says the boards it shows on — `screens`, Dubai's,
   Bangalore's or both — so a Bangalore CS can stand on the Dubai TV with what
   was added for them. One with no `screens` (every amount before that day) shows
   on its CS's own board, as it always did.

   Root's "CS TV amounts" page adds, changes and removes them too, through
   /api/v1/service/cs-tv-amounts (portal/service.ts) — Bangalore's CSs only.
──────────────────────────────────────────────────────────────────────────── */

export const EXTRAS = "cs_tv_extras";
export type Screen = "dubai" | "bangalore";
const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const round = (n: number) => Math.round(n * 100) / 100;
const isScreen = (v: unknown): v is Screen => v === "dubai" || v === "bangalore";
let onChange: () => void = () => {};
/** csTv.ts registers its cache clear here, so a change shows on the next refresh. */
export const onExtrasChange = (f: () => void) => { onChange = f; };

/** The boards an amount shows on: its `screens`, else its CS's own board. */
export const screensOf = (e: any): Screen[] => {
  const said = (Array.isArray(e?.screens) ? e.screens : []).filter(isScreen) as Screen[];
  return said.length ? [...new Set(said)] : [e?.location === "bangalore" ? "bangalore" : "dubai"];
};
/** The Mongo filter for the amounts one board shows. */
export const onScreen = (screen: Screen) => ({ $or: [{ screens: screen }, { screens: { $exists: false }, location: screen }] });
const showOn = (e: any): Screen | "both" => { const s = screensOf(e); return s.length > 1 ? "both" : s[0]!; };
/** `show_on` as asked — "dubai", "bangalore" or "both"; nothing said: the CS's own board. Null when it's none of those. */
function screensAsked(v: unknown, home: Screen): Screen[] | null {
  if (v === undefined || v === null || v === "") return [home];
  if (v === "both") return ["dubai", "bangalore"];
  return isScreen(v) ? [v] : null;
}

/** Who added or changed an amount — a Super Admin here, or a root admin on Root's page. */
export interface ExtraBy { id?: string; name: string }

/** The location's active CSs, for the picker. */
async function csOf(location: Screen) {
  const index = await loadTeams();
  return ((await col("users").find({ app_role: "cs", status: { $ne: "inactive" } }, { projection: { full_name: 1 } }).toArray()) as any[])
    .filter((u) => (index.teamOf(String(u._id))?.location ?? "dubai") === location)
    .map((u) => ({ id: String(u._id), name: String(u.full_name ?? "").trim(), team: index.teamOf(String(u._id))?.name ?? "No team" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const amountOf = (v: unknown): number | string => {
  const aed = round(Number(v));
  return !Number.isFinite(aed) || aed <= 0 || aed > 1_000_000 ? "Give an amount in AED, more than 0" : aed;
};
const whenOf = (v: unknown): Date | string => {
  const at = v ? new Date(String(v)) : new Date();
  if (Number.isNaN(at.getTime())) return "That date isn't right";
  return at.getTime() > Date.now() + 60_000 ? "Not a time still to come" : at;
};

/** One location's CSs' amounts in a month (YYYY-MM, Dubai's; this month when it isn't one), with the picker's lists. */
export async function listExtras(location: Screen, monthAsked: unknown) {
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(str(monthAsked)) ? str(monthAsked) : new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 7);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const from = new Date(Date.UTC(y, m - 1, 1) - 4 * 3600_000).toISOString(), to = new Date(Date.UTC(y, m, 1) - 4 * 3600_000).toISOString();
  const extras = ((await col(EXTRAS).find({ location, at: { $gte: from, $lt: to } }).sort({ at: -1 }).toArray()) as any[])
    .map((e) => ({ id: String(e._id), cs_id: e.cs_id, cs_name: e.cs_name, aed: e.aed, product: e.product, at: e.at, show_on: showOn(e), added_by: e.created_by_name, added_at: e.created_date }));
  const products = ((await col("funding_transactions").distinct("course_payment.product", { "course_payment.product": { $exists: true } })) as any[])
    .map((p) => String(p ?? "").trim()).filter(Boolean).sort();
  return { location, month, extras, cs: await csOf(location), products, total_aed: round(extras.reduce((s, e) => s + (Number(e.aed) || 0), 0)) };
}

/**
 * Add one: { cs_id, aed, product, at? (ISO, default now; never in the future), show_on? }. A sentence when it can't be.
 * `only`: the asker adds for that location's CSs alone (Root's page: Bangalore's).
 */
export async function addExtra(body: any, by: ExtraBy, only?: Screen): Promise<string | { id: string }> {
  const oid = toObjectId(str(body?.cs_id, 40));
  const cs: any = oid ? await col("users").findOne({ _id: oid as any, app_role: "cs", status: { $ne: "inactive" } }, { projection: { full_name: 1 } }) : null;
  if (!cs) return "Pick an active CS";
  const home: Screen = (await loadTeams()).teamOf(String(cs._id))?.location ?? "dubai";
  if (only && home !== only) return `Pick one of ${only === "bangalore" ? "Bangalore" : "Dubai"}'s CSs`;
  const aed = amountOf(body?.aed);
  if (typeof aed === "string") return aed;
  const product = str(body?.product, 60);
  if (!product) return "Give the course";
  const at = whenOf(body?.at);
  if (typeof at === "string") return at;
  const screens = screensAsked(body?.show_on, home);
  if (!screens) return "Show it on Dubai's TV, Bangalore's, or both";
  const doc = {
    location: home, screens, cs_id: String(cs._id), cs_name: String(cs.full_name ?? "").trim(),
    aed, product, at: at.toISOString(), created_by_id: by.id ?? "", created_by_name: by.name, created_date: new Date().toISOString(),
  };
  const r = await col(EXTRAS).insertOne(doc as any);
  onChange();
  return { id: String(r.insertedId) };
}

/**
 * Change one: { id, aed?, product?, at?, show_on? } — whatever is given; whose it is stays (remove it and add another).
 * Null when it's gone (or not `only`'s); a sentence when what's given can't be.
 */
export async function updateExtra(body: any, by: ExtraBy, only?: Screen): Promise<string | null | { id: string }> {
  const oid = toObjectId(str(body?.id, 40));
  const had: any = oid ? await col(EXTRAS).findOne({ _id: oid as any, ...(only ? { location: only } : {}) }) : null;
  if (!had) return null;
  const set: Record<string, unknown> = {};
  if (body?.aed !== undefined) { const aed = amountOf(body.aed); if (typeof aed === "string") return aed; set.aed = aed; }
  if (body?.product !== undefined) { const product = str(body.product, 60); if (!product) return "Give the course"; set.product = product; }
  if (body?.at !== undefined && body.at !== null && body.at !== "") { const at = whenOf(body.at); if (typeof at === "string") return at; set.at = at.toISOString(); }
  if (body?.show_on !== undefined) {
    const screens = screensAsked(body.show_on, had.location === "bangalore" ? "bangalore" : "dubai");
    if (!screens) return "Show it on Dubai's TV, Bangalore's, or both";
    set.screens = screens;
  }
  if (!Object.keys(set).length) return "Nothing to change";
  await col(EXTRAS).updateOne({ _id: oid as any }, { $set: { ...set, updated_by_name: by.name, updated_date: new Date().toISOString() } });
  onChange();
  return { id: String(had._id) };
}

/** Remove one — false when it's already gone (or not `only`'s). */
export async function removeExtra(id: unknown, only?: Screen): Promise<boolean> {
  const oid = toObjectId(str(id, 40));
  const r = oid ? await col(EXTRAS).deleteOne({ _id: oid as any, ...(only ? { location: only } : {}) }) : null;
  if (!r?.deletedCount) return false;
  onChange();
  return true;
}

/** POST getCsTvExtras { location, month? (YYYY-MM) } → { extras, cs, products } — Super Admins. */
export async function getCsTvExtras(req: Request, user: AuthUser): Promise<Response> {
  if (user.app_role !== "super_admin") return forbidden();
  const body: any = await req.json().catch(() => ({}));
  return json(await listExtras(body?.location === "bangalore" ? "bangalore" : "dubai", body?.month));
}

/** POST addCsTvExtra { cs_id, aed, product, at? (ISO, default now; never in the future), show_on? } — Super Admins. */
export async function addCsTvExtra(req: Request, user: AuthUser): Promise<Response> {
  if (user.app_role !== "super_admin") return forbidden();
  const r = await addExtra(await req.json().catch(() => ({})), { id: user.id, name: user.full_name ?? "" });
  return typeof r === "string" ? error(r, 400) : json({ ok: true, id: r.id });
}

/** POST removeCsTvExtra { id } — Super Admins. */
export async function removeCsTvExtra(req: Request, user: AuthUser): Promise<Response> {
  if (user.app_role !== "super_admin") return forbidden();
  const body: any = await req.json().catch(() => ({}));
  return (await removeExtra(body?.id)) ? json({ ok: true }) : notFound("Already removed");
}
