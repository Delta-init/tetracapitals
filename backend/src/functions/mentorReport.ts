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

/** The portal's mentors this person may see — everyone with a mentor role for an admin (or for the Root portal: null). */
async function mentorsFor(user: AuthUser | null): Promise<any[]> {
  const roles = { app_role: { $in: [...BUILTIN_MENTOR_ROLES] }, status: { $ne: "inactive" } };
  const projection = { full_name: 1, email: 1, app_role: 1 };
  if (!user || isAdmin(user)) return (await col("users").find(roles, { projection }).toArray()) as any[];
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
  return json(await mentorReport(user, body.from, body.to));
}

/** The dates are YYYY-MM-DD, in order — what the report needs; a reason when they aren't. */
export const mentorReportDates = (from: unknown, to: unknown): string | null =>
  !isDay(from) || !isDay(to) || to < from ? "Pick the dates" : null;

/**
 * The report itself, for a person here (their reach) or for the Root portal's Reports → Mentors (null: every mentor,
 * as a Super Admin sees it — 2026-10-24).
 */
export async function mentorReport(user: AuthUser | null, from: string, to: string) {
  const everyone = !user || isAdmin(user);
  const body = { from, to };
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
  let lmsAnswer: any = null;
  let lms: { available: boolean; message?: string } = { available: true };
  if (!lmsConfigured()) lms = { available: false, message: "The LMS isn't linked to this server" };
  else {
    try {
      // An admin: everyone the LMS has (instructors who aren't in the portal too); anyone else: their team by address.
      const query: Record<string, string> = { from: body.from, to: body.to };
      if (!everyone) query.emails = [...byEmail.keys()].filter(Boolean).join(",");
      lmsAnswer = !everyone && !query.emails ? null : ((await callLms("/mentor-report", { query, verb: "share the mentors' report" })) as any);
      lmsRows = lmsAnswer?.mentors ?? [];
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

  // Different students who booked and who came — the team's, each once (LMS, 2026-10-27; absent from an older LMS).
  const students = lmsRows.length || everyone ? (lmsAnswer?.students ?? null) : { booked: 0, attended: 0 };
  return { from: body.from, to: body.to, everyone, mentors, lms, students };
}

/* ── What is behind each number (the user, 2026-10-27: "each count we can break down … which ones") ──────────────── */

const LMS_KINDS = ["classes", "cancelled_classes", "bookings", "cancelled_bookings", "attended", "missed", "students", "meetings", "cancelled_meetings", "programs"];
export const DETAIL_KINDS = [...LMS_KINDS, "commission"];

/**
 * The rows behind one number of the report — for everyone it covers, one mentor (`mentorId`: their portal id or LMS
 * id), or one Program (`programId`): classes, cancelled classes, bookings (all / cancelled / attended / missed), the
 * students, meetings (all / cancelled), the Programs, or the commission credits. The same reach as the report: a
 * chief their own team. Null user: the Root portal, every mentor. A reason (string) for bad input.
 */
export async function mentorReportDetail(user: AuthUser | null, q: Record<string, unknown>): Promise<string | { kind: string; total: number; rows: any[]; lms?: { available: boolean; message?: string } }> {
  const kind = String(q.kind ?? "");
  if (!DETAIL_KINDS.includes(kind)) return `kind is one of ${DETAIL_KINDS.join(", ")}`;
  const why = mentorReportDates(q.from, q.to);
  if (why) return why;
  const from = String(q.from), to = String(q.to);
  for (const k of ["mentorId", "programId"]) if (q[k] && !/^[a-f\d]{24}$/i.test(String(q[k]))) return `Invalid ${k}`;
  const everyone = !user || isAdmin(user);
  const portal = await mentorsFor(user);
  // One mentor: by their portal id or their LMS id; outside this person's reach, nobody.
  let one: { portalId: string; lmsId: string; email: string } | null = null;
  if (q.mentorId) {
    const id = String(q.mentorId);
    const u = portal.find((x) => String(x._id) === id);
    // Not a portal id: an LMS id — for a chief, the LMS still keeps it to the team's addresses.
    one = u ? { portalId: id, lmsId: "", email: String(u.email ?? "").toLowerCase() } : { portalId: "", lmsId: id, email: "" };
  }

  if (kind === "commission") {
    const ids = one ? (one.portalId ? [one.portalId] : []) : portal.map((u) => String(u._id));
    const range = { $gte: dubaiStart(from), $lt: nextDay(to) };
    const credits = ids.length
      ? ((await col("commission_credits").find(
          { recipient_id: { $in: ids }, $or: [{ requested_at: range }, { requested_at: { $in: [null, ""] }, created_date: range }] },
          { projection: { recipient_id: 1, recipient_name: 1, commission_usd: 1, method: 1, is_pool: 1, status: 1, transaction_id: 1, requested_at: 1, created_date: 1, level: 1 } },
        ).sort({ requested_at: -1, created_date: -1 }).limit(3000).toArray()) as any[])
      : [];
    const txIds = [...new Set(credits.map((c) => String(c.transaction_id ?? "")).filter((t) => /^[a-f\d]{24}$/i.test(t)))];
    const txs = new Map(((await col("funding_transactions").find({ _id: { $in: txIds.map(toObjectId).filter(Boolean) as any[] } }, { projection: { student_name: 1, student_code: 1, type: 1, amount_usd: 1 } }).toArray()) as any[])
      .map((t) => [String(t._id), t]));
    const nameOf = new Map(portal.map((u) => [String(u._id), u.full_name ?? u.email ?? ""]));
    return {
      kind, total: credits.length,
      rows: credits.map((c) => {
        const t = txs.get(String(c.transaction_id ?? ""));
        return {
          id: String(c._id), mentor: nameOf.get(String(c.recipient_id)) || c.recipient_name || "", usd: round(Number(c.commission_usd) || 0),
          method: String(c.method ?? ""), pool: c.is_pool === true, status: String(c.status ?? ""), level: c.level ?? null,
          at: c.requested_at || c.created_date || null, student: t?.student_name ?? "", studentCode: t?.student_code ?? "",
          request: t?.type ?? "", requestUsd: Number(t?.amount_usd) || 0,
        };
      }),
    };
  }

  if (!lmsConfigured()) return { kind, total: 0, rows: [], lms: { available: false, message: "The LMS isn't linked to this server" } };
  const query: Record<string, string> = { kind, from, to };
  if (!everyone) {
    query.emails = portal.map((u) => String(u.email ?? "").trim().toLowerCase()).filter(Boolean).join(",");
    if (!query.emails) return { kind, total: 0, rows: [] };
  }
  if (one) {
    if (one.lmsId) query.instructorId = one.lmsId;
    else if (one.email) query.emails = one.email;
    else return { kind, total: 0, rows: [] };
  }
  if (q.programId) query.programId = String(q.programId);
  try {
    const r = (await callLms("/mentor-report/details", { query, verb: "share the report's details" })) as any;
    return { kind, total: Number(r?.total) || 0, rows: Array.isArray(r?.rows) ? r.rows : [] };
  } catch (err) {
    return {
      kind, total: 0, rows: [],
      lms: { available: false, message: err instanceof LmsError && /route \S+ \S+ not found|cannot get|not found/i.test(err.message) ? "These details need the LMS update" : err instanceof Error ? err.message : "The LMS did not answer" },
    };
  }
}

/** POST /api/functions/getMentorReportDetails { kind, from, to, mentorId?, programId? } → { kind, total, rows, lms? } */
export async function getMentorReportDetails(req: Request, user: AuthUser): Promise<Response> {
  if (!mayView(user)) return forbidden();
  const r = await mentorReportDetail(user, ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>);
  return typeof r === "string" ? error(r, 400) : json(r);
}
