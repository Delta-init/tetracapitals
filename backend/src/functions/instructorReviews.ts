import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { isAdmin, visibleMentorIds } from "../students/followups";
import { csManagerReach } from "../lib/userLocation";
import { callLms, lmsConfigured, LmsError } from "../lib/lms";

/* ────────────────────────────────────────────────────────────────────────────
   Instructor Reviews (the user, 2026-10-22) — the LMS's: students' ratings
   after each class, ranked (LMS /service/instructor-reviews). Super Admins and
   admins, Chief Mentors, CS Managers and senior / junior mentors. "My team"
   to start — the mentors of their own team (a CS Manager their location's),
   matched to the LMS's instructors by address — and "Everyone" at a switch.
──────────────────────────────────────────────────────────────────────────── */

const SEES = new Set(["chief_mentor", "cs_manager", "senior_mentor", "junior_mentor", "subjunior_mentor"]);
const mayView = (u: AuthUser) => isAdmin(u) || SEES.has(u.app_role);

/** The addresses of this person's team (their location's for a CS Manager), lower case — null for an admin: everyone. */
async function teamEmails(user: AuthUser): Promise<Set<string> | null> {
  if (isAdmin(user)) return null;
  const reach = await csManagerReach(user);
  const ids = reach ? reach.ids : [...((await visibleMentorIds(user)) ?? new Set([user.id]))];
  const users = (await col("users").find({ _id: { $in: ids.map(toObjectId).filter(Boolean) as any[] } }, { projection: { email: 1 } }).toArray()) as any[];
  return new Set(users.map((u) => String(u.email ?? "").trim().toLowerCase()).filter(Boolean));
}

const lmsTrouble = (err: unknown) =>
  err instanceof LmsError && /route \S+ \S+ not found|cannot get/i.test(err.message) ? "Instructor reviews need the LMS update" : err instanceof Error ? err.message : "The LMS did not answer";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PROGRAMS = new Set(["4x-trading", "digital-marketing", "ai", "jura", "cma"]);
/** The page's filters as the LMS reads them (?from&to — Dubai days, to included — &program…). */
function filtersOf(body: any): Record<string, string> {
  const q: Record<string, string> = {};
  if (DAY.test(String(body?.from ?? ""))) q.from = String(body.from);
  if (DAY.test(String(body?.to ?? ""))) q.to = String(body.to);
  if (PROGRAMS.has(String(body?.program ?? ""))) q.program = String(body.program);
  return q;
}

/** POST /api/functions/getInstructorReviews { scope?: "team" | "all", from?, to?, program? } → { rows, scope, team } */
export async function getInstructorReviews(req: Request, user: AuthUser): Promise<Response> {
  if (!mayView(user)) return forbidden();
  const body: any = await req.json().catch(() => ({}));
  if (!lmsConfigured()) return error("The LMS isn't linked to this server", 503);
  const team = await teamEmails(user);
  const scope = !team || body?.scope === "all" ? "all" : "team";
  try {
    const all = ((await callLms("/instructor-reviews", { query: filtersOf(body), verb: "share its instructor reviews" })) as any[]) ?? [];
    const rows = scope === "all" ? all : all.filter((r) => team!.has(String(r.email ?? "").trim().toLowerCase()));
    return json({ scope, team: !!team, rows: rows.map((r, i) => ({ ...r, rank: i + 1 })) });
  } catch (err) {
    return error(lmsTrouble(err), 502);
  }
}

/**
 * POST /api/functions/getInstructorReviewFeed { scope?: "team" | "all", mine?, instructor? (LMS id), rating? (1–5 | "low"),
 *   from?, to?, withComment?, kind? ("mentor_rating" | "class_feedback"), program?, q?, page? } → { reviews, total, page,
 *   perPage, stats, scope, team } — All reviews (the user, 2026-11-10: "full review with filter … they can see their review
 *   and others review also"): every mentor's ("Everyone"), their team's, or their own ("mine"), 25 a page.
 */
export async function getInstructorReviewFeed(req: Request, user: AuthUser): Promise<Response> {
  if (!mayView(user)) return forbidden();
  const body: any = await req.json().catch(() => ({}));
  if (!lmsConfigured()) return error("The LMS isn't linked to this server", 503);
  const team = await teamEmails(user);
  const scope = body?.mine === true ? "mine" : !team || body?.scope === "all" ? "all" : "team";
  const query: Record<string, string> = { ...filtersOf(body), page: String(Math.max(1, Math.floor(Number(body?.page) || 1))), per_page: String(Math.min(100, Math.max(1, Math.floor(Number(body?.perPage) || 25)))) };
  if (/^[a-f\d]{24}$/i.test(String(body?.instructor ?? ""))) query.instructor = String(body.instructor);
  if (/^([1-5]|low)$/.test(String(body?.rating ?? ""))) query.rating = String(body.rating);
  if (body?.withComment === true) query.withComment = "1";
  if (body?.kind === "mentor_rating" || body?.kind === "class_feedback") query.kind = body.kind;
  const q = String(body?.q ?? "").trim().slice(0, 80);
  if (q) query.q = q;
  // Mine: their own address; the team: its mentors' (nobody known → nobody); everyone: no narrowing.
  if (scope === "mine") query.emails = String(user.email ?? "").trim().toLowerCase() || "-";
  else if (scope === "team") query.emails = [...team!].join(",") || "-";
  try {
    const got: any = await callLms("/instructor-reviews/feed", { query, verb: "share the reviews" });
    return json({ ...got, scope, team: !!team });
  } catch (err) {
    return error(lmsTrouble(err), 502);
  }
}

/** POST /api/functions/getInstructorReviewList { instructorId, page?, from?, to? } → { reviews, total, page, perPage } — from/to (days): the Mentor Report's dates (2026-10-23). */
export async function getInstructorReviewList(req: Request, user: AuthUser): Promise<Response> {
  if (!mayView(user)) return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const id = String(body?.instructorId ?? "");
  if (!/^[a-f\d]{24}$/i.test(id)) return error("instructorId is required", 400);
  try {
    return json(await instructorReviewList(id, body?.page, body?.from, body?.to));
  } catch (err) {
    return error(lmsTrouble(err), 502);
  }
}

/** One instructor's reviews from the LMS, 50 a page, in the dates if given — here and for Root's Reports → Mentors (2026-10-24). */
export async function instructorReviewList(id: string, page: unknown, from: unknown, to: unknown) {
  const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  const range = { ...(day(from) ? { from: day(from) } : {}), ...(day(to) ? { to: day(to) } : {}) };
  return callLms(`/instructor-reviews/${id}`, { query: { page: String(Math.max(1, Number(page) || 1)), per_page: "50", ...range }, verb: "share the reviews" });
}

/** Why the LMS couldn't share them, in words — for Root too. */
export const reviewTrouble = (err: unknown) => lmsTrouble(err);
