import { json, error, forbidden } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { config } from "../config";
import { col } from "../db";
import { toObjectId } from "../lib/id";
import { isAdmin } from "../students/followups";
import { getDownlineIds } from "../lib/scope";
import { csManagerReach } from "../lib/userLocation";
import { BUILTIN_MENTOR_ROLES } from "../lib/roles";

/* ────────────────────────────────────────────────────────────────────────────
   My KPIs (the user, 2026-11-09): mentor KPIs are planned, approved and worked
   out in Root only; here they are shown, view only — a mentor their own (no
   ranking), a Chief their team, a CS Manager their location's mentors, an
   admin everyone. Anyone who may see a mentor may ask Root for a correction to
   a frozen month; a root admin decides there. Root answers only once a root
   admin has opened it (observation for 60 days from then — not pay).
   Asked of Root with the shared portal secret (ROOT_ERP_API_URL / ROOT_ERP_SECRET).
──────────────────────────────────────────────────────────────────────────── */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MENTOR_ROLES = new Set<string>(BUILTIN_MENTOR_ROLES);
const str = (v: unknown, max = 2000) => String(v ?? "").trim().slice(0, max);
const monthOf = (v: unknown) => (MONTH.test(str(v, 7)) ? str(v, 7) : new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 7));

class RootRefused extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function callRoot<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const base = config.rootErpApiUrl.trim().replace(/\/+$/, "");
  if (!base || !config.rootErpSecret) throw new RootRefused("The Root portal link isn't configured on this server", 503);
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/service/mentor-kpis${path}`, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", "x-portal-secret": config.rootErpSecret },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new RootRefused("The Root portal could not be reached", 502);
  }
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new RootRefused(String(body?.message ?? `Root refused (${res.status})`), res.status);
  return body?.data as T;
}

/** Root's answer, or what to show instead: closed (not opened yet), not found, or the reason it failed. */
async function fromRoot(fn: () => Promise<unknown>): Promise<Response> {
  try {
    return json(await fn());
  } catch (err) {
    if (err instanceof RootRefused) {
      if (err.status === 409 && /aren't open/.test(err.message)) return json({ closed: true, message: "Mentor KPIs aren't open yet." });
      if (err.status === 404) return json({ missing: true, message: err.message });
      return error(err.message, err.status >= 500 ? 502 : err.status === 409 ? 409 : 400);
    }
    throw err;
  }
}

/** The mentors this person may see, by address: their own; a Chief their team; a CS Manager their location; an admin everyone. */
async function reachOf(user: AuthUser): Promise<{ emails: Set<string>; team: boolean }> {
  const active = { app_role: { $in: [...MENTOR_ROLES] }, status: { $ne: "inactive" } };
  let filter: Record<string, unknown> | null = null;
  if (isAdmin(user)) filter = active;
  else if (user.app_role === "cs_manager") {
    const reach = await csManagerReach(user);
    filter = { ...active, _id: { $in: (reach?.ids ?? []).map(toObjectId).filter(Boolean) } };
  } else if (user.app_role === "chief_mentor") {
    const ids = [user.id, ...(await getDownlineIds(user.id))];
    filter = { ...active, _id: { $in: ids.map(toObjectId).filter(Boolean) } };
  }
  const own = str(user.email).toLowerCase();
  if (!filter) return { emails: new Set(MENTOR_ROLES.has(user.app_role) && own ? [own] : []), team: false };
  const users = (await col("users").find(filter as any, { projection: { email: 1 } }).toArray()) as any[];
  return { emails: new Set(users.map((u) => str(u.email).toLowerCase()).filter((e) => e.includes("@"))), team: true };
}

/** POST /api/functions/getMyKpis { month } — a mentor's own month. */
export async function getMyKpis(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  if (!MENTOR_ROLES.has(user.app_role) || !str(user.email).includes("@")) return forbidden("My KPIs are for mentors");
  const month = monthOf(body?.month);
  return fromRoot(() => callRoot(`/mentor?${new URLSearchParams({ email: str(user.email).toLowerCase(), month })}`));
}

/** POST /api/functions/getTeamKpis { month } — the mentors a Chief, CS Manager or admin may see, A–Z (no ranking). */
export async function getTeamKpis(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const reach = await reachOf(user);
  if (!reach.team) return forbidden("The team's KPIs are for Chiefs, CS Managers and admins");
  const month = monthOf(body?.month);
  if (!reach.emails.size) return json({ month, mentors: [] });
  return fromRoot(() => callRoot(`/scores?${new URLSearchParams({ month, emails: [...reach.emails].join(",") })}`));
}

/** POST /api/functions/getMentorKpis { email, month } — one mentor within reach. */
export async function getMentorKpis(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const email = str(body?.email, 200).toLowerCase();
  const reach = await reachOf(user);
  if (!reach.emails.has(email)) return forbidden("That mentor isn't yours to see");
  return fromRoot(() => callRoot(`/mentor?${new URLSearchParams({ email, month: monthOf(body?.month) })}`));
}

/**
 * POST /api/functions/requestKpiCorrection { month, email, metric, action: set_value|leave_out, value?, reason, evidence? }
 * — for a frozen month, by the mentor or someone over them; a root admin decides in Root.
 */
export async function requestKpiCorrection(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const email = str(body?.email, 200).toLowerCase();
  const reach = await reachOf(user);
  if (!reach.emails.has(email)) return forbidden("That mentor isn't yours to ask for");
  const month = str(body?.month, 7);
  if (!MONTH.test(month)) return error("Which month?", 400);
  const action = str(body?.action, 20);
  if (action !== "set_value" && action !== "leave_out") return error("The right value, or leave it out", 400);
  const value = action === "set_value" ? Number(body?.value) : null;
  if (action === "set_value" && (!Number.isFinite(value) || (value as number) < 0)) return error("Give the right value (0 or more)", 400);
  const reason = str(body?.reason, 500);
  if (!reason) return error("Say why it's wrong", 400);
  const me: any = await col("users").findOne({ _id: toObjectId(user.id) as any }, { projection: { full_name: 1, email: 1 } });
  return fromRoot(() => callRoot("/corrections", {
    method: "POST",
    body: {
      month, email, metric: str(body?.metric, 60), action, value, reason, evidence: str(body?.evidence, 2000),
      raisedBy: { email: str(me?.email ?? user.email).toLowerCase(), name: str(me?.full_name ?? user.full_name ?? "") },
    },
  }));
}
