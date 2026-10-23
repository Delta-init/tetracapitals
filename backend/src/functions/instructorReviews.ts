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

/** POST /api/functions/getInstructorReviews { scope?: "team" | "all" } → { rows, scope, teamSize } */
export async function getInstructorReviews(req: Request, user: AuthUser): Promise<Response> {
  if (!mayView(user)) return forbidden();
  const body: any = await req.json().catch(() => ({}));
  if (!lmsConfigured()) return error("The LMS isn't linked to this server", 503);
  const team = await teamEmails(user);
  const scope = !team || body?.scope === "all" ? "all" : "team";
  try {
    const all = ((await callLms("/instructor-reviews", { verb: "share its instructor reviews" })) as any[]) ?? [];
    const rows = scope === "all" ? all : all.filter((r) => team!.has(String(r.email ?? "").trim().toLowerCase()));
    return json({ scope, team: !!team, rows: rows.map((r, i) => ({ ...r, rank: i + 1 })) });
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
    const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
    const range = { ...(day(body?.from) ? { from: day(body.from) } : {}), ...(day(body?.to) ? { to: day(body.to) } : {}) };
    return json(await callLms(`/instructor-reviews/${id}`, { query: { page: String(Math.max(1, Number(body?.page) || 1)), per_page: "50", ...range }, verb: "share the reviews" }));
  } catch (err) {
    return error(lmsTrouble(err), 502);
  }
}
