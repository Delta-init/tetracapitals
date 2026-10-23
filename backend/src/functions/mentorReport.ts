import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { isAdmin, visibleMentorIds } from "../students/followups";
import { csManagerReach } from "../lib/userLocation";
import { BUILTIN_MENTOR_ROLES } from "../lib/roles";
import { callLms, lmsConfigured, LmsError } from "../lib/lms";

/* ────────────────────────────────────────────────────────────────────────────
   The mentors' report (the user, 2026-10-23) — the Team area: each mentor,
   day by day, from the LMS (LMS /service/mentor-report): classes held and
   cancelled, students' bookings and how many cancelled, attended, missed,
   their 1:1 meetings, the reviews students left that day — and from here the
   commission credited to them (pool shares included). A chief mentor sees
   their own team (senior / junior mentors too; a CS Manager their location's),
   Super Admins and admins everyone. Matched to the LMS by address.
──────────────────────────────────────────────────────────────────────────── */

const SEES = new Set(["chief_mentor", "cs_manager", "senior_mentor", "junior_mentor", "subjunior_mentor"]);
const mayView = (u: AuthUser) => isAdmin(u) || SEES.has(u.app_role);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const dubaiStart = (day: string) => new Date(`${day}T00:00:00+04:00`).toISOString();
const nextDay = (day: string) => new Date(new Date(`${day}T00:00:00+04:00`).getTime() + 86_400_000).toISOString();
const dubaiDay = (iso: string) => new Date(new Date(iso).getTime() + 4 * 3600_000).toISOString().slice(0, 10);
const round = (n: number) => Math.round(n * 100) / 100;

/** The portal's mentors this person may see — everyone with a mentor role for an admin. */
async function mentorsFor(user: AuthUser): Promise<any[]> {
  const roles = { app_role: { $in: [...BUILTIN_MENTOR_ROLES] }, status: { $ne: "inactive" } };
  const projection = { full_name: 1, email: 1, app_role: 1 };
  if (isAdmin(user)) return (await col("users").find(roles, { projection }).toArray()) as any[];
  const reach = await csManagerReach(user);
  const ids = reach ? reach.ids : [...((await visibleMentorIds(user)) ?? new Set([user.id]))];
  return (await col("users").find({ _id: { $in: ids.map(toObjectId).filter(Boolean) as any[] }, ...roles }, { projection }).toArray()) as any[];
}

/**
 * POST /api/functions/getMentorReport { from, to } (days, Dubai; at most three months)
 * → { from, to, mentors: [{ id, name, email, role, total: {…, commission_usd}, days: [{ day, …, commission_usd }] }], lms: { available, message? } }
 */
export async function getMentorReport(req: Request, user: AuthUser): Promise<Response> {
  if (!mayView(user)) return forbidden();
  const body: any = await req.json().catch(() => ({}));
  if (!isDay(body?.from) || !isDay(body?.to) || body.to < body.from) return error("Pick the dates", 400);

  const portal = await mentorsFor(user);
  const byEmail = new Map(portal.map((u) => [String(u.email ?? "").trim().toLowerCase(), u]));

  // The commission credited to each of them in the dates — their own credits and their pool shares.
  const ids = portal.map((u) => String(u._id));
  const range = { $gte: dubaiStart(body.from), $lt: nextDay(body.to) };
  const credits = ids.length
    ? ((await col("commission_credits").find(
        { recipient_id: { $in: ids }, $or: [{ requested_at: range }, { requested_at: { $in: [null, ""] }, created_date: range }] },
        { projection: { recipient_id: 1, commission_usd: 1, requested_at: 1, created_date: 1 } },
      ).toArray()) as any[])
    : [];
  const commission = new Map<string, Map<string, number>>();
  for (const c of credits) {
    const id = String(c.recipient_id), day = dubaiDay(String(c.requested_at || c.created_date));
    const days = commission.get(id) ?? new Map<string, number>();
    days.set(day, (days.get(day) ?? 0) + (Number(c.commission_usd) || 0));
    commission.set(id, days);
  }

  let lmsRows: any[] = [];
  let lms: { available: boolean; message?: string } = { available: true };
  if (!lmsConfigured()) lms = { available: false, message: "The LMS isn't linked to this server" };
  else {
    try {
      // An admin: everyone the LMS has (instructors who aren't in the portal too); anyone else: their team by address.
      const query: Record<string, string> = { from: body.from, to: body.to };
      if (!isAdmin(user)) query.emails = [...byEmail.keys()].filter(Boolean).join(",");
      lmsRows = !isAdmin(user) && !query.emails ? [] : ((await callLms("/mentor-report", { query, verb: "share the mentors' report" })) as any)?.mentors ?? [];
    } catch (err) {
      lms = { available: false, message: err instanceof LmsError && /route \S+ \S+ not found|cannot get/i.test(err.message) ? "The mentors' report needs the LMS update" : err instanceof Error ? err.message : "The LMS did not answer" };
    }
  }

  const blank = { classes: 0, held: 0, classesCancelled: 0, bookings: 0, bookingsCancelled: 0, attended: 0, missed: 0, meetings: 0, meetingsCancelled: 0, reviews: 0, lowRatings: 0, avgRating: null as number | null };
  const rows = new Map<string, any>();
  for (const u of portal) {
    rows.set(String(u.email ?? "").trim().toLowerCase() || String(u._id), { id: String(u._id), name: u.full_name ?? u.email, email: u.email ?? "", role: u.app_role, in_lms: false, total: { ...blank }, days: [] });
  }
  for (const m of lmsRows) {
    const key = String(m.email ?? "").toLowerCase();
    const row = rows.get(key) ?? { id: "", name: m.name, email: m.email, role: "", in_lms: true, total: { ...blank }, days: [] };
    Object.assign(row, { in_lms: true, lms_id: String(m.instructorId ?? ""), total: { ...blank, ...m.total }, days: (m.days ?? []).map((d: any) => ({ ...blank, ...d })) });
    rows.set(key, row);
  }
  const mentors = [...rows.values()].map((r) => {
    const paid = r.id ? commission.get(r.id) : undefined;
    const days = new Map<string, any>(r.days.map((d: any) => [d.day, { ...d, commission_usd: 0 }]));
    for (const [day, usd] of paid ?? []) days.set(day, { ...(days.get(day) ?? { day, ...blank }), commission_usd: round(usd) });
    const total = round([...(paid?.values() ?? [])].reduce((s, n) => s + n, 0));
    return { ...r, total: { ...r.total, commission_usd: total }, days: [...days.values()].sort((a, b) => b.day.localeCompare(a.day)) };
  }).sort((a, b) => b.total.held - a.total.held || b.total.bookings - a.total.bookings || b.total.commission_usd - a.total.commission_usd || String(a.name).localeCompare(String(b.name)));

  return json({ from: body.from, to: body.to, everyone: isAdmin(user), mentors, lms });
}
