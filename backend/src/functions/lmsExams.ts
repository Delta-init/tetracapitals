import { json, error } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { callLms, lmsConfigured } from "../lib/lms";
import { loadTeams } from "../students/teams";
import { lmsStudentFor, lmsRefusal, lmsLacksRoute } from "./lmsEnrolmentRequests";

/* ────────────────────────────────────────────────────────────────────────────
   LMS exams here (the user, 2026-10-10) — read from the LMS
   (services/portalExams.service.ts there), nothing kept here.

   The Exams page: the published exams of one academy, each with its plain
   address to copy. Whose academy: a Dubai team's people see Dubai's, a
   Bangalore team's Bangalore's (the team's location); someone on no team (the
   Super Admin, admins) picks either.

   A student's exams (their page): where they stand in each — not started, in
   progress, submitted, suspended, graded with marks — and a link made for
   them that signs them in and opens the exam (24 hours, 3 sign-ins). For
   whoever may act for the student in the LMS (lmsStudentFor, as LMS Requests).
──────────────────────────────────────────────────────────────────────────── */

const NOT_YET = "The LMS can't share its exams yet — it needs its update";
const ACADEMIES = ["dubai", "bangalore"] as const;

/** The academy this person's exams come from: their team's, or null when they are on none (they may pick). */
async function academyOf(user: AuthUser): Promise<"dubai" | "bangalore" | null> {
  const team = (await loadTeams()).teamOf(user.id);
  return team ? team.location : null;
}

/** POST /api/functions/getLmsExams { academy? } → { configured, academy, fixed, exams } */
export async function getLmsExams(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  if (!lmsConfigured()) return json({ configured: false, exams: [] });
  const own = await academyOf(user);
  const academy = own ?? ((ACADEMIES as readonly string[]).includes(body?.academy) ? body.academy : "dubai");
  try {
    const data = await callLms<{ exams: any[] }>("/exams", { query: { academy }, verb: "share its exams" });
    return json({ configured: true, academy, fixed: !!own, exams: data.exams ?? [] });
  } catch (err) {
    return lmsLacksRoute(err) ? error(NOT_YET, 409) : lmsRefusal(err);
  }
}

/** POST /api/functions/getStudentLmsExams { studentId } → { configured, account, exams } */
export async function getStudentLmsExams(req: Request, user: AuthUser): Promise<Response> {
  const found = await lmsStudentFor(await req.json().catch(() => ({})), user);
  if (found instanceof Response) return found;
  if (!lmsConfigured()) return json({ configured: false, exams: [] });
  try {
    const data = await callLms<{ account: boolean; exams: any[] }>("/exams/student", { query: { email: found.email }, verb: "share their exams" });
    return json({ configured: true, account: data.account, exams: data.exams ?? [] });
  } catch (err) {
    return lmsLacksRoute(err) ? error(NOT_YET, 409) : lmsRefusal(err);
  }
}
