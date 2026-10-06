import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { isMentorRole } from "../lib/roles";
import { visibleMentorIds, studentsOf, isStudentOf } from "../students/followups";
import { seesClosedOnly } from "../students/closedBy";
import { recordHistory } from "../students/history";
import { callLms, lmsConfigured, LmsError } from "../lib/lms";

/* ────────────────────────────────────────────────────────────────────────────
   LMS enrolment requests (the user, 2026-10-06): the LMS admin's Requests page —
   somebody signs up and waits to be let in — here too. A CS sees and decides
   their own students' (their leaders their people's), matched by email, as the
   Support Tickets page finds tickets; the Super Admin every Forex applicant's,
   in the portal or not. Approving lets them in on Forex, rejecting turns them
   away with the reason — the LMS's POST /service/enrolment-requests…
   (lms services/portalEnrolmentRequests.service.ts), recorded there under the
   deciding person's own LMS account, else the shared support one with their
   name. Not the Sales role's. The LMS deploys first.

   The same people can open a student's own LMS as the student sees it,
   read-only (viewStudentInLms) — from this page and from the student's page.
──────────────────────────────────────────────────────────────────────────── */

const LMS_BATCH = 500;
const LMS_AT_ONCE = 4;
const LMS_PAGE = 100;
const PAGE = 50;
const STATUSES = new Set(["pending", "approved", "rejected", "all"]);
const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
export const who = (u: AuthUser) => u.full_name || u.email || "somebody";
const emailOf = (v: unknown) => {
  const e = String(v ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : "";
};
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whose requests somebody sees: every Forex applicant's (the Super Admin), their own students' (CSs and their leaders), or none. */
async function reachOf(user: AuthUser): Promise<"all" | "own" | null> {
  if (user.app_role === "super_admin") return "all";
  if (isMentorRole(user.app_role) && !(await seesClosedOnly(user))) return "own";
  return null;
}

/**
 * Their students, on the server whatever the role: a CS their own (Common ones too), a Chief Mentor or CS Manager
 * everyone under them — the follow-ups' rule (students/followups.ts). Not the general data scope, which leaves a
 * built-in mentor role's students to the browser to narrow.
 */
async function theirStudents(user: AuthUser): Promise<Record<string, any>> {
  const ids = await visibleMentorIds(user);
  return ids ? studentsOf(ids) : {};
}

const STUDENT_FIELDS = { full_name: 1, student_code: 1, email: 1, primary_mentor_name: 1, team_name: 1, primary_mentor_id: 1, common_cs: 1 };
/** A request's student here, as the page links them: who they are, whose they are — and whether they're the asker's own (their CS, or Common with them). */
const studentCard = (s: any, user?: AuthUser) =>
  s ? {
    id: String(s._id), name: str(s.full_name), code: str(s.student_code, 40), cs: str(s.primary_mentor_name), team: str(s.team_name),
    yours: !!user && isStudentOf(s, new Set([user.id])),
  } : null;

/** The students in `scope` with an email, one an address. */
async function studentsByEmail(scope: Record<string, any> | null): Promise<Map<string, any>> {
  const rows = (await col("students")
    .find(scope ? { $and: [scope, { email: { $regex: "@" } }] } : { email: { $regex: "@" } }, { projection: STUDENT_FIELDS })
    .toArray()) as any[];
  const byEmail = new Map<string, any>();
  for (const s of rows) {
    const e = emailOf(s.email);
    if (e && !byEmail.has(e)) byEmail.set(e, s);
  }
  return byEmail;
}

/** Students here with these addresses, whatever case they were saved in. */
async function studentsWithEmails(emails: string[]): Promise<Map<string, any>> {
  if (!emails.length) return new Map();
  const rows = (await col("students")
    .find({ $expr: { $in: [{ $toLower: { $trim: { input: { $ifNull: ["$email", ""] } } } }, emails] } }, { projection: STUDENT_FIELDS })
    .toArray()) as any[];
  return new Map(rows.map((s) => [emailOf(s.email), s]));
}

type LmsPage = { requests: any[]; total: number; page: number; perPage: number };
const ask = (body: Record<string, unknown>) =>
  callLms<LmsPage>("/enrolment-requests", { method: "POST", body, verb: "share the enrolment requests" });

/** Every request of these students — the LMS takes 500 addresses at a time, and answers 100 a page. */
async function requestsOf(emails: string[], status: string): Promise<any[]> {
  const batches: string[][] = [];
  for (let i = 0; i < emails.length; i += LMS_BATCH) batches.push(emails.slice(i, i + LMS_BATCH));
  const all = async (list: string[]) => {
    const out: any[] = [];
    for (let page = 1; ; page++) {
      const r = await ask({ status, emails: list, page, perPage: LMS_PAGE });
      out.push(...(r?.requests ?? []));
      if (!r?.requests?.length || out.length >= Number(r.total ?? 0)) return out;
    }
  };
  const found: any[] = [];
  for (let i = 0; i < batches.length; i += LMS_AT_ONCE) {
    for (const part of await Promise.all(batches.slice(i, i + LMS_AT_ONCE).map(all))) found.push(...part);
  }
  return found;
}

/** A failed ask, as the page says it — an LMS without these routes yet says so. */
function lmsTrouble(err: unknown) {
  const message = err instanceof LmsError ? err.message : "The LMS could not be asked";
  return /not found|no route|cannot post/i.test(message) ? "The LMS doesn't share enrolment requests yet — it needs its update" : message;
}

/**
 * POST /api/functions/getLmsEnrolmentRequests { status = "pending", page = 1 }
 * The enrolment requests in the Delta LMS the user may decide — the Super Admin every Forex applicant's,
 * a CS their students' — newest first, 50 a page, each with its student here when there is one.
 * → { configured, available, message?, reach, requests, total, page, perPage }
 */
export async function getLmsEnrolmentRequests(req: Request, user: AuthUser): Promise<Response> {
  const reach = await reachOf(user);
  if (!reach) return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const status = STATUSES.has(String(body?.status)) ? String(body.status) : "pending";
  const page = Math.max(1, Math.floor(Number(body?.page) || 1));
  const empty = { reach, requests: [], total: 0, page, perPage: PAGE };
  if (!lmsConfigured()) return json({ configured: false, available: false, ...empty });
  try {
    if (reach === "all") {
      const r = await ask({ status, page, perPage: PAGE });
      const requests = r?.requests ?? [];
      const here = await studentsWithEmails(requests.map((q) => emailOf(q.email)).filter(Boolean));
      return json({
        configured: true, available: true, reach, page, perPage: PAGE, total: Number(r?.total ?? 0),
        requests: requests.map((q) => ({ ...q, student: studentCard(here.get(emailOf(q.email)), user) })),
      });
    }
    const byEmail = await studentsByEmail(await theirStudents(user));
    const found = (await requestsOf([...byEmail.keys()], status))
      .sort((a, b) => String(b.appliedAt ?? "").localeCompare(String(a.appliedAt ?? "")));
    return json({
      configured: true, available: true, reach, page, perPage: PAGE, total: found.length,
      requests: found.slice((page - 1) * PAGE, page * PAGE).map((q) => ({ ...q, student: studentCard(byEmail.get(emailOf(q.email)), user) })),
    });
  } catch (err) {
    return json({ configured: true, available: false, message: lmsTrouble(err), ...empty });
  }
}

/* The sidebar's number: the LMS is asked at most once a minute for each person — once for the Super Admin —
   and afresh after a decision here. */
const COUNT_MS = 60_000;
const pendingCounts = new Map<string, { at: number; count: Promise<number> }>();

/**
 * POST /api/functions/getLmsEnrolmentRequestCount
 * How many of the page's requests wait for a decision — for the sidebar. → { pending } (null: the LMS can't say)
 */
export async function getLmsEnrolmentRequestCount(_req: Request, user: AuthUser): Promise<Response> {
  const reach = await reachOf(user);
  if (!reach) return forbidden();
  if (!lmsConfigured()) return json({ pending: null });
  const key = reach === "all" ? "*" : user.id;
  let kept = pendingCounts.get(key);
  if (!kept || Date.now() - kept.at > COUNT_MS) {
    const count = reach === "all"
      ? ask({ status: "pending", page: 1, perPage: 1 }).then((r) => Number(r?.total ?? 0))
      : theirStudents(user).then(studentsByEmail).then(async (byEmail) => {
          const emails = [...byEmail.keys()];
          let total = 0;
          for (let i = 0; i < emails.length; i += LMS_BATCH) {
            total += Number((await ask({ status: "pending", emails: emails.slice(i, i + LMS_BATCH), page: 1, perPage: 1 }))?.total ?? 0);
          }
          return total;
        });
    const entry = { at: Date.now(), count };
    pendingCounts.set(key, entry);
    // A failed ask isn't kept: the next one tries again.
    count.catch(() => { if (pendingCounts.get(key) === entry) pendingCounts.delete(key); });
    kept = entry;
  }
  try {
    return json({ pending: await kept.count });
  } catch {
    return json({ pending: null });
  }
}

/** The request an action is for, if the user may decide it: theirs to see here, or anyone's for the Super Admin. */
async function requestFor(body: any, user: AuthUser): Promise<{ userId: string; email: string; student: any } | Response> {
  const reach = await reachOf(user);
  if (!reach) return forbidden();
  const userId = str(body?.userId, 40);
  if (!/^[a-f\d]{24}$/i.test(userId)) return error("userId is required", 400);
  const email = emailOf(body?.email);
  if (!email) return error("email is required", 400);
  if (!lmsConfigured()) return error("The LMS isn't linked to this server (LMS_API_URL, LMS_SERVICE_SECRET)", 503);
  const scope = reach === "all" ? null : await theirStudents(user);
  const match = { email: { $regex: `^\\s*${escapeRe(email)}\\s*$`, $options: "i" } };
  const student: any = await col("students").findOne(scope ? { $and: [scope, match] } : match, { projection: STUDENT_FIELDS });
  // A CS decides only their own students' requests.
  if (reach === "own" && !student) return forbidden();
  return { userId, email, student };
}

/** The LMS's refusal, passed on in its own words (finance doesn't know them, not waiting any more, no account to act from). */
export const lmsRefusal = (err: unknown) =>
  err instanceof LmsError ? error(err.message.replace(/^The LMS would not [^:]+: /, ""), err.status === 502 ? 502 : 409) : error("The LMS could not be asked", 502);

/** POST /api/functions/getLmsEnrolmentRequest { userId, email } — one request, with the whole application. → { request, student } */
export async function getLmsEnrolmentRequest(req: Request, user: AuthUser): Promise<Response> {
  const found = await requestFor(await req.json().catch(() => ({})), user);
  if (found instanceof Response) return found;
  try {
    const { request } = await callLms<{ request: any }>(`/enrolment-requests/${found.userId}`, {
      method: "POST", body: { email: found.email }, verb: "share the request",
    });
    return json({ request, student: studentCard(found.student, user) });
  } catch (err) {
    return lmsRefusal(err);
  }
}

/**
 * POST /api/functions/getLmsEnrolmentDocument { userId, email, field: "passport" | "idDoc" }
 * A 5-minute link to their passport or ID scan, as the LMS admin opens one; the LMS notes who asked. → { url, expiresIn }
 */
export async function getLmsEnrolmentDocument(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const found = await requestFor(body, user);
  if (found instanceof Response) return found;
  const field = body?.field === "idDoc" ? "idDoc" : body?.field === "passport" ? "passport" : "";
  if (!field) return error("field must be passport or idDoc", 400);
  try {
    return json(await callLms<{ url: string; expiresIn: number | null }>(`/enrolment-requests/${found.userId}/document`, {
      method: "POST", body: { email: found.email, field, byName: who(user), byEmail: user.email }, verb: "open the document",
    }));
  } catch (err) {
    return lmsRefusal(err);
  }
}

/**
 * POST /api/functions/approveLmsEnrolmentRequest { userId, email, courses? }
 * Let them in on Forex in the LMS, as its admin's approve does — they're told by email and WhatsApp — and with
 * `courses` ([{ courseId, locked }]) put them on those Forex courses at once, the modules picked locked (the LMS checks
 * every one first: one it can't give approves nobody). Noted in their history here.
 * → { request, from: "own" | "shared", already?, courses: { given, already } | null }
 */
export async function approveLmsEnrolmentRequest(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const found = await requestFor(body, user);
  if (found instanceof Response) return found;
  const courses = Array.isArray(body?.courses) && body.courses.length ? body.courses : undefined;
  let answer: { request: any; from?: string; already?: boolean; courses?: { given: string[]; already: string[] } };
  try {
    answer = await callLms(`/enrolment-requests/${found.userId}/approve`, {
      method: "POST", body: { email: found.email, byName: who(user), byEmail: user.email, ...(courses ? { courses } : {}) }, verb: "approve the request",
    });
  } catch (err) {
    return lmsRefusal(err);
  }
  pendingCounts.clear();   // the sidebar's number changes
  const given = answer.courses?.given ?? [];
  if (found.student && (!answer.already || given.length)) {
    const on = given.length ? ` — on ${given.join(", ")}` : "";
    await recordHistory([{
      student_id: String(found.student._id),
      at: new Date().toISOString(),
      type: "lms_enrolment",
      text: answer.already ? `Put on LMS course${given.length > 1 ? "s" : ""}: ${given.join(", ")}` : `Approved their LMS enrolment request — in on Forex${on}`,
      by_id: user.id,
      by_name: who(user),
      to: { status: "approved", from: answer.from ?? "", ...(given.length ? { courses: given } : {}) },
    }]);
  }
  // An LMS without course access yet approves and ignores the courses: said, not dropped quietly.
  return json({ request: answer.request, from: answer.from ?? "", already: !!answer.already, courses: answer.courses ?? null, coursesSkipped: !!courses && !answer.courses });
}

/**
 * POST /api/functions/rejectLmsEnrolmentRequest { userId, email, reason }
 * Turn a waiting request away in the LMS with the reason, as its admin's reject does — they're emailed it. Noted
 * in their history here. → { request, from }
 */
export async function rejectLmsEnrolmentRequest(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const found = await requestFor(body, user);
  if (found instanceof Response) return found;
  const reason = String(body?.reason ?? "").trim();
  if (reason.length < 5 || reason.length > 1000) return error("Give a reason of 5 to 1000 characters — the student is told it", 400);
  let answer: { request: any; from?: string };
  try {
    answer = await callLms(`/enrolment-requests/${found.userId}/reject`, {
      method: "POST", body: { email: found.email, reason, byName: who(user), byEmail: user.email }, verb: "reject the request",
    });
  } catch (err) {
    return lmsRefusal(err);
  }
  pendingCounts.clear();
  if (found.student) {
    await recordHistory([{
      student_id: String(found.student._id),
      at: new Date().toISOString(),
      type: "lms_enrolment",
      text: `Rejected their LMS enrolment request: ${reason.length > 140 ? `${reason.slice(0, 140)}…` : reason}`,
      by_id: user.id,
      by_name: who(user),
      to: { status: "rejected", from: answer.from ?? "" },
    }]);
  }
  return json({ request: answer.request, from: answer.from ?? "" });
}

/**
 * POST /api/functions/viewStudentInLms { studentId } | { email }
 * The student's own LMS as they see it, READ-ONLY, in a new tab (the user, 2026-10-06) — the LMS admin's "view as
 * student", started from here: a link good once, for 60 seconds, into a 30-minute session the LMS's admins see on
 * their Impersonation sessions screen and can end, from the person's own LMS account, else the shared support one
 * with their address on it (lms services/portalStudentView.service.ts). Only the student's own CS — both, for a
 * Common student — not their leaders; the Super Admin anyone's, by the LMS address too for a request from somebody
 * who isn't in the portal. → { url, expiresIn, sessionExpiresAt, from: "own" | "shared" }
 */
export async function viewStudentInLms(req: Request, user: AuthUser): Promise<Response> {
  // The student's own CS only — Common ones too — not their leaders; the Super Admin anyone's (the user, 2026-10-06).
  const found = await lmsStudentFor(await req.json().catch(() => ({})), user, { ownOnly: true });
  if (found instanceof Response) return found;
  if (!lmsConfigured()) return error(NOT_LINKED, 503);
  try {
    return json(await callLms<{ url: string; expiresIn: number; sessionExpiresAt: string; from: string }>("/students/view", {
      method: "POST", body: { email: found.email, ...byOf(user) }, verb: "open the student's account",
    }));
  } catch (err) {
    if (lmsLacksRoute(err)) return error("The LMS can't open a student's account from here yet — it needs its update", 409);
    return lmsRefusal(err);
  }
}

export const NOT_LINKED = "The LMS isn't linked to this server (LMS_API_URL, LMS_SERVICE_SECRET)";

/** An LMS without a route yet answers "Route POST … not found": it needs its update. */
export const lmsLacksRoute = (err: unknown) => err instanceof LmsError && /route \S+ \S+ not found|cannot post/i.test(err.message);

/** Whoever is really doing it — the Super Admin, when they use "View as" here — is who the LMS's banner and trail name. */
export function byOf(user: AuthUser): { byName: string; byEmail: string } {
  const person = ((user as any)._impersonatedBy as { email?: string; full_name?: string } | undefined) ?? user;
  return { byName: person.full_name || person.email || "somebody", byEmail: person.email ?? "" };
}

/**
 * The LMS student a call is about, if the user may act for them — by their record here ({ studentId }) or by the
 * LMS address ({ email }, for a request from somebody who isn't here): the Super Admin anyone, a CS (and their
 * leaders) only their own students, as on the requests page. → { email, student: their record here, or null }
 */
export async function lmsStudentFor(body: any, user: AuthUser, opts: { ownOnly?: boolean } = {}): Promise<{ email: string; student: any | null } | Response> {
  const reach = await reachOf(user);
  if (!reach) return forbidden();
  // ownOnly: the student's own CS (or a CS they're Common with), never a leader for their people's.
  const scope = reach === "all" ? null : opts.ownOnly ? studentsOf([user.id]) : await theirStudents(user);
  const within = (match: Record<string, any>) => (scope ? { $and: [scope, match] } : match);
  if (body?.studentId) {
    const oid = toObjectId(String(body.studentId));
    if (!oid) return error("studentId is not valid", 400);
    const student: any = await col("students").findOne(within({ _id: oid }), { projection: STUDENT_FIELDS });
    if (!student) return scope ? forbidden() : notFound();
    const email = emailOf(student.email);
    if (!email) return error("This student has no email here to find their LMS account by", 400);
    return { email, student };
  }
  const email = emailOf(body?.email);
  if (!email) return error("studentId or email is required", 400);
  const match = { email: { $regex: `^\\s*${escapeRe(email)}\\s*$`, $options: "i" } };
  const student: any = await col("students").findOne(within(match), { projection: STUDENT_FIELDS });
  if (scope && !student) return forbidden();
  return { email, student: student ?? null };
}
