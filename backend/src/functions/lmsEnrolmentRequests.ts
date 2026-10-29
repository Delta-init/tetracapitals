import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { isMentorRole } from "../lib/roles";
import { visibleMentorIds, studentsOf, isStudentOf } from "../students/followups";
import { seesClosedOnly } from "../students/closedBy";
import { recordHistory, prepareStudentUpdate } from "../students/history";
import { callLms, lmsConfigured, LmsError } from "../lib/lms";
import { ObjectId } from "mongodb";
import { notifyStudentsGiven } from "../lib/notify";
import { nextStudentCode } from "../lib/studentCode";
import { locationOf } from "../lib/location";
import { lmsEnrolledFields } from "../students/lmsEnrolment";
import { mayTransfer } from "./studentTransfer";
import { csManagerReach } from "../lib/userLocation";
import { TEAM_WIDE_MENTORS } from "../lib/scope";
import { isCsLike } from "../lib/roles";
import { status as waStatus, sendText, intlNumbers, WhatsAppError } from "../whatsapp/service";

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

   CS Managers see every Forex applicant too, and decide them (the user,
   2026-10-12) — and they and the Super Admin assign one who isn't anybody's
   yet: not in the portal (the student is made from the LMS details, given to
   the CS picked) or in Delta Open Students (given to them) —
   assignLmsApplicant.

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

/** Whose requests somebody sees: every Forex applicant's (the Super Admin, a CS Manager), their own students' (CSs and their leaders), or none. */
async function reachOf(user: AuthUser): Promise<"all" | "own" | null> {
  if (user.app_role === "super_admin" || user.app_role === "cs_manager") return "all";
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

const STUDENT_FIELDS = { full_name: 1, student_code: 1, email: 1, phone: 1, primary_mentor_name: 1, team_name: 1, primary_mentor_id: 1, common_cs: 1, assignment_status: 1 };
/** Nobody's yet: no CS, or in Delta Open Students. */
const unassigned = (s: any) => !String(s?.primary_mentor_id ?? "") || s?.assignment_status === "open_pool";
/** A request's student here, as the page links them: who they are, whose they are — and whether they're the asker's own (their CS, or Common with them). */
const studentCard = (s: any, user?: AuthUser) =>
  s ? {
    id: String(s._id), name: str(s.full_name), code: str(s.student_code, 40), cs: str(s.primary_mentor_name), team: str(s.team_name),
    yours: !!user && isStudentOf(s, new Set([user.id])), unassigned: unassigned(s),
  } : null;

/** A CS Manager's own location's CSs (2026-10-14); null for anyone else — whose students are theirs to see here. */
const managerIds = async (user: AuthUser): Promise<Set<string> | null> => {
  const reach = await csManagerReach(user);
  return reach ? new Set(reach.ids) : null;
};
/** A linked student in the other location — a CS Manager doesn't see their request. Unlinked applicants show. */
const otherLocation = (ids: Set<string> | null, s: any) =>
  !!ids && !!s && !!s.primary_mentor_id && !ids.has(String(s.primary_mentor_id)) && !(s.common_cs ?? []).some((c: any) => ids.has(String(c?.id ?? "")));

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

type LmsPage = { requests: any[]; total: number; page: number; perPage: number; programs?: string[] };
const ask = (body: Record<string, unknown>) =>
  callLms<LmsPage>("/enrolment-requests", { method: "POST", body, verb: "share the enrolment requests" });

/** The page's filters the LMS applies (the user, 2026-10-12): applied from/to, academy, programme, search. */
type Filters = { from?: string; to?: string; academy?: string; program?: string; q?: string };
const HERE = new Set(["all", "not_here", "no_cs", "with_cs"]);
/** At most this many requests looked through for the "Here" filter, which only the portal can answer. */
const HERE_MAX = 2000;
const isoOr = (v: unknown) => { const d = new Date(String(v ?? "")); return v && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined; };
function filtersOf(body: any): Filters {
  const academy = String(body?.academy ?? "").toLowerCase();
  return {
    from: isoOr(body?.from), to: isoOr(body?.to),
    academy: academy === "dubai" || academy === "bangalore" ? academy : undefined,
    program: str(body?.program, 120) || undefined,
    q: str(body?.q, 120) || undefined,
  };
}
/** Whether a request's student here is what the "Here" filter asks for. */
const hereMatches = (here: string, student: any) =>
  here === "all" || (here === "not_here" ? !student : here === "no_cs" ? !!student && unassigned(student) : !!student && !unassigned(student));

/** Every request of these students — the LMS takes 500 addresses at a time, and answers 100 a page. */
async function requestsOf(emails: string[], status: string, filters: Filters = {}, programs?: Set<string>): Promise<any[]> {
  const batches: string[][] = [];
  for (let i = 0; i < emails.length; i += LMS_BATCH) batches.push(emails.slice(i, i + LMS_BATCH));
  const all = async (list: string[]) => {
    const out: any[] = [];
    for (let page = 1; ; page++) {
      const r = await ask({ ...filters, status, emails: list, page, perPage: LMS_PAGE });
      for (const p of r?.programs ?? []) programs?.add(String(p));
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
 * POST /api/functions/getLmsEnrolmentRequests { status = "pending", page = 1, from?, to?, academy?, program?, q?, here? }
 * The enrolment requests in the Delta LMS the user may decide — the Super Admin and CS Managers every Forex
 * applicant's, a CS their students' — newest first, 50 a page, each with its student here when there is one.
 * Filters (the user, 2026-10-12): applied from/to, academy (dubai | bangalore), programme and search (name, email,
 * phone — an STU code is looked up here and asked for by its email) go to the LMS; "here" — not in the portal, no CS
 * yet, with a CS — only the portal knows, so for it the matching requests are looked through here (at most 2,000).
 * → { configured, available, message?, reach, canAssign, requests, total, page, perPage, programs, capped? }
 */
export async function getLmsEnrolmentRequests(req: Request, user: AuthUser): Promise<Response> {
  const reach = await reachOf(user);
  if (!reach) return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const status = STATUSES.has(String(body?.status)) ? String(body.status) : "pending";
  const page = Math.max(1, Math.floor(Number(body?.page) || 1));
  const here = HERE.has(String(body?.here)) ? String(body.here) : "all";
  const filters = filtersOf(body);
  // canAssign: may give one who is nobody's yet to a CS (assignLmsApplicant).
  const empty = { reach, canAssign: mayTransfer(user), requests: [], total: 0, page, perPage: PAGE, programs: [] as string[] };
  if (!lmsConfigured()) return json({ configured: false, available: false, ...empty });
  try {
    // An STU code: that student's requests, by their email — the LMS doesn't know the code.
    let onlyEmail: string | null = null;
    if (filters.q && /^stu-\d+$/i.test(filters.q)) {
      const s: any = await col("students").findOne({ student_code: filters.q.toUpperCase() }, { projection: { email: 1 } });
      onlyEmail = emailOf(s?.email);
      delete filters.q;
      if (!onlyEmail) return json({ configured: true, available: true, ...empty });
    }
    const programs = new Set<string>();
    let found: any[];
    let total: number | null = null;
    let capped = false;
    if (reach === "all") {
      if (here === "all") {
        const r = await ask({ ...filters, status, page, perPage: PAGE, ...(onlyEmail ? { emails: [onlyEmail] } : {}) });
        for (const p of r?.programs ?? []) programs.add(String(p));
        const mgr = await managerIds(user);
        const raw = r?.requests ?? [];
        const byEmail = await studentsWithEmails(raw.map((q) => emailOf(q.email)).filter(Boolean));
        const requests = raw.filter((q) => !otherLocation(mgr, byEmail.get(emailOf(q.email))));
        return json({
          configured: true, available: true, reach, canAssign: empty.canAssign, page, perPage: PAGE, total: Number(r?.total ?? 0), programs: [...programs],
          requests: requests.map((q) => ({ ...q, student: studentCard(byEmail.get(emailOf(q.email)), user) })),
        });
      }
      // "Here": every matching request, then the portal's side of it.
      found = [];
      for (let p = 1; found.length < HERE_MAX; p++) {
        const r = await ask({ ...filters, status, page: p, perPage: LMS_PAGE, ...(onlyEmail ? { emails: [onlyEmail] } : {}) });
        for (const x of r?.programs ?? []) programs.add(String(x));
        found.push(...(r?.requests ?? []));
        total = Number(r?.total ?? 0);
        if (!r?.requests?.length || found.length >= total) break;
      }
      capped = (total ?? 0) > found.length;
    } else {
      const mine = await studentsByEmail(await theirStudents(user));
      const emails = onlyEmail ? (mine.has(onlyEmail) ? [onlyEmail] : []) : [...mine.keys()];
      found = await requestsOf(emails, status, filters, programs);
    }
    const byEmail = await studentsWithEmails([...new Set(found.map((q) => emailOf(q.email)).filter(Boolean))]);
    const mgr = await managerIds(user);
    const rows = found
      .map((q) => ({ q, s: byEmail.get(emailOf(q.email)) ?? null }))
      .filter(({ s }) => hereMatches(here, s) && !otherLocation(mgr, s))
      .sort((a, b) => String(b.q.appliedAt ?? "").localeCompare(String(a.q.appliedAt ?? "")));
    return json({
      configured: true, available: true, reach, canAssign: empty.canAssign, page, perPage: PAGE, total: rows.length,
      programs: [...programs].sort((a, b) => a.localeCompare(b)), ...(capped ? { capped: true } : {}),
      requests: rows.slice((page - 1) * PAGE, page * PAGE).map(({ q, s }) => ({ ...q, student: studentCard(s, user) })),
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
  // A CS decides only their own students' requests; a CS Manager only their own location's (2026-10-14).
  if (reach === "own" && !student) return forbidden();
  if (otherLocation(await managerIds(user), student)) return forbidden();
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
/** "Act as student" — read & write (the user, 2026-10-09): the student's own CS, their CS Manager, a Super Admin; every
 *  mentor role too — their own students, a Chief Mentor their team's (the user, 2026-10-14). */
const actsAsStudent = (role: string) => role === "super_admin" || isMentorRole(role);

export async function viewStudentInLms(req: Request, user: AuthUser): Promise<Response> {
  // The student's own CS — Common ones too — and the Super Admin anyone's (the user, 2026-10-06); their team's leaders
  // too — a Chief Mentor or CS Manager, for the students of the CSs under them (2026-10-08).
  // { mode: "write" } — "Act as student", read & write (2026-10-09): the student's own CS (Common ones too), the CS
  // Manager over them, a Super Admin; mentors too, a Chief Mentor for their team (2026-10-14). The LMS lets it change things except the student's security,
  // payments and ID documents, and records every change as the person (its auth.middleware.ts denyImpersonatedWrite).
  const body: any = await req.json().catch(() => ({}));
  const write = body?.mode === "write";
  if (write && !actsAsStudent(user.app_role)) return error("Act as student is for the student's own CS or mentor, their leaders and Super Admins", 403);
  const leads = user.app_role === "chief_mentor" || user.app_role === "cs_manager" || TEAM_WIDE_MENTORS.has(user.app_role);
  const found = await lmsStudentFor(body, user, { ownOnly: !leads });
  if (found instanceof Response) return found;
  if (!lmsConfigured()) return error(NOT_LINKED, 503);
  try {
    const answer = await callLms<{ url: string; expiresIn: number; sessionExpiresAt: string; from: string; mode?: string }>("/students/view", {
      method: "POST", body: { email: found.email, ...byOf(user), mode: write ? "write" : "read" }, verb: "open the student's account",
    });
    if (write) await logActAsStudent(user, found);
    // An LMS without read & write yet answers without `mode`: that session is read-only.
    return json({ ...answer, mode: answer?.mode === "write" ? "write" : "read" });
  } catch (err) {
    if (lmsLacksRoute(err)) return error("The LMS can't open a student's account from here yet — it needs its update", 409);
    return lmsRefusal(err);
  }
}

/**
 * POST /api/functions/createStudentLoginLink { studentId } → { url, expiresAt } (the user, 2026-10-29): the LMS's
 * one-time login link — one tap signs the student into their account with no password, once, within 24 hours (a new
 * one cancels the last unused one). For whoever may Act as them; the LMS records it as the person (user.loginLink).
 */
export async function createStudentLoginLink(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  if (!actsAsStudent(user.app_role)) return error("Login links are for the student's own CS or mentor, their leaders and Super Admins", 403);
  const leads = user.app_role === "chief_mentor" || user.app_role === "cs_manager" || TEAM_WIDE_MENTORS.has(user.app_role);
  const found = await lmsStudentFor(body, user, { ownOnly: !leads });
  if (found instanceof Response) return found;
  if (!lmsConfigured()) return error(NOT_LINKED, 503);
  try {
    const answer = await callLms<{ url: string; expiresAt: string }>("/students/login-link", {
      method: "POST", body: { email: found.email, ...byOf(user) }, verb: "make the student's login link",
    });
    await logPortalAction(user, found, "lms_login_link", `${byOf(user).byName} made a login link for ${found.student?.full_name || found.email}`);
    return json({ url: answer.url, expiresAt: answer.expiresAt });
  } catch (err) {
    if (lmsLacksRoute(err)) return error("The LMS can't make login links from here yet — it needs its update", 409);
    return lmsRefusal(err);
  }
}

/**
 * POST /api/functions/createClassJoinLink { classId, bookingId, email } → { joinUrl, expiresAt, meetingUrl, class, student,
 * studentId } (the user, 2026-10-29: the class card's "Send join link"): a booked student's one-tap join link for that
 * class — signs them in once and joins them — lasting until the class's join window closes. For whoever may Act as
 * them; the LMS records who made it (liveClass.joinLink).
 */
export async function createClassJoinLink(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const classId = str(body?.classId, 100), bookingId = str(body?.bookingId, 100);
  if (!classId || !bookingId) return error("classId and bookingId are required", 400);
  if (!actsAsStudent(user.app_role)) return error("Join links are for the student's own CS or mentor, their leaders and Super Admins", 403);
  const leads = user.app_role === "chief_mentor" || user.app_role === "cs_manager" || TEAM_WIDE_MENTORS.has(user.app_role);
  const found = await lmsStudentFor({ email: body?.email }, user, { ownOnly: !leads });
  if (found instanceof Response) return found;
  if (!lmsConfigured()) return error(NOT_LINKED, 503);
  try {
    const answer = await callLms<any>(`/classes/${encodeURIComponent(classId)}/join-link`, {
      method: "POST", body: { bookingId, ...byOf(user) }, verb: "make the student's join link",
    });
    // The seat must be the student asked about — never a link for somebody else's seat under their name.
    if (String(answer?.student?.email ?? "").toLowerCase() !== found.email) return forbidden("That seat is somebody else's");
    await logPortalAction(user, found, "lms_class_join_link", `${byOf(user).byName} made a join link for ${found.student?.full_name || found.email} (${answer?.class?.title || "a class"})`);
    const sender = found.student ? await joinLinkSenderOf(found.student) : null;
    return json({
      ...answer, studentId: found.student ? String(found.student._id) : null,
      sender: sender ? { name: sender.name, connected: sender.connected } : null,
      can_send: !!sender?.connected && intlNumbers(found.student?.phone).length > 0,
    });
  } catch (err) {
    if (lmsLacksRoute(err)) return error("The LMS can't make join links from here yet — it needs its update", 409);
    return lmsRefusal(err);
  }
}

/** The student's own CS, whose WhatsApp a join link goes from, and whether it is linked. */
async function joinLinkSenderOf(student: any): Promise<{ id: string; name: string; connected: boolean } | null> {
  const oid = toObjectId(String(student?.primary_mentor_id ?? ""));
  const cs: any = oid ? await col("users").findOne({ _id: oid, status: { $ne: "inactive" } }, { projection: { full_name: 1, email: 1, app_role: 1 } }) : null;
  if (!cs || !isCsLike(cs.app_role)) return null;
  return { id: String(cs._id), name: cs.full_name || cs.email || "Their CS", connected: waStatus(String(cs._id)).status === "connected" };
}

/** One of our LMS join links (/j/<code>) — the only thing sent from a CS's WhatsApp by somebody else here. */
const JOIN_LINK = /https?:\/\/\S+\/j\/[A-Za-z0-9_-]{16,}/;

/**
 * POST /api/functions/sendClassJoinLink { studentId, text } → { sent_from } (the user, 2026-10-29): the join-link
 * message, from the student's own CS's linked WhatsApp to the student — whoever may make the link presses Send; the
 * chat records who did. Only a message carrying one of our join links.
 */
export async function sendClassJoinLink(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const text = String(body?.text ?? "").trim().slice(0, 2000);
  if (!JOIN_LINK.test(text)) return error("Only a message with the student's join link is sent from here", 400);
  if (!actsAsStudent(user.app_role)) return error("Join links are for the student's own CS or mentor, their leaders and Super Admins", 403);
  const leads = user.app_role === "chief_mentor" || user.app_role === "cs_manager" || TEAM_WIDE_MENTORS.has(user.app_role);
  const found = await lmsStudentFor({ studentId: body?.studentId }, user, { ownOnly: !leads });
  if (found instanceof Response) return found;
  if (!found.student) return notFound("No such student");
  const sender = await joinLinkSenderOf(found.student);
  if (!sender) return error("This student has no CS to send it from", 409);
  if (!sender.connected) return error(`${sender.name}'s WhatsApp isn't linked in the portal — copy the message and send it`, 409);
  const to = intlNumbers(found.student.phone)[0];
  if (!to) return error("There's no phone number on the student's record", 400);
  const person = byOf(user);
  try {
    await sendText({ id: sender.id, name: sender.name }, to, text, { id: user.id, name: person.byName });
  } catch (err) {
    return error(err instanceof WhatsAppError ? err.message : err instanceof Error ? err.message : "WhatsApp did not answer", err instanceof WhatsAppError ? err.status : 502);
  }
  await logPortalAction(user, found, "lms_class_join_link_sent", `${person.byName} sent ${found.student.full_name || found.email} their join link from ${sender.name}'s WhatsApp`);
  return json({ sent_from: sender.name });
}

/** The portal's activity log for an LMS action on a student (the LMS records its own as well). */
async function logPortalAction(user: AuthUser, found: { email: string; student: any | null }, action: string, message: string) {
  const now = new Date().toISOString();
  try {
    await col("logs").insertOne({
      timestamp: now, user_id: user.id, user_email: user.email, user_name: user.full_name, user_role: user.app_role,
      action_type: action, entity_type: "Student", entity_id: found.student ? String(found.student._id) : null,
      details: JSON.stringify({ message, email: found.email, by: byOf(user) }),
      old_value: null, new_value: null, ip_address: null, success: true, created_date: now, updated_date: now,
    } as any);
  } catch (err) {
    console.error(`[${action}] could not write the activity log`, err);
  }
}

/** The portal's activity log: who acted as which student in the LMS (the LMS records each change itself). */
async function logActAsStudent(user: AuthUser, found: { email: string; student: any | null }) {
  const now = new Date().toISOString();
  const person = byOf(user);
  try {
    await col("logs").insertOne({
      timestamp: now, user_id: user.id, user_email: user.email, user_name: user.full_name, user_role: user.app_role,
      action_type: "lms_act_as_student", entity_type: "Student", entity_id: found.student ? String(found.student._id) : null,
      details: JSON.stringify({ message: `${person.byName} opened ${found.student?.full_name || found.email}'s LMS read & write`, email: found.email, by: person }),
      old_value: null, new_value: null, ip_address: null, success: true, created_date: now, updated_date: now,
    } as any);
  } catch (err) {
    console.error("[act as student] could not write the activity log", err);
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

/**
 * POST /api/functions/assignLmsApplicant { userId, email, toId } (the user, 2026-10-12) — a Super Admin, an Admin or a
 * CS Manager gives an LMS applicant who is nobody's yet to a CS (anyone on a team, as Transfer does):
 *   - not in the portal: the student is made from the LMS's details (name, phone, country, academy), with the picked
 *     person as their CS from the start;
 *   - here but in Delta Open Students / with no CS: given to them.
 * Somebody's already: refused — Transfer on the student's page moves them. → { ok, created, student }
 */
export async function assignLmsApplicant(req: Request, user: AuthUser): Promise<Response> {
  if (!mayTransfer(user)) return forbidden("Only a Super Admin, an Admin or a CS Manager assigns LMS applicants");
  const body: any = await req.json().catch(() => ({}));
  const found = await requestFor(body, user);
  if (found instanceof Response) return found;
  const tid = toObjectId(String(body?.toId ?? ""));
  if (!tid) return error("Pick the CS to give them to", 400);
  const to: any = await col("users").findOne({ _id: tid }, { projection: { full_name: 1, app_role: 1, status: 1, team_location: 1 } });
  if (!to || !isMentorRole(to.app_role)) return error("Pick someone on a team", 400);
  if (to.status === "inactive") return error(`${to.full_name || "That person"} is switched off — pick someone else`, 400);
  const mgr = await managerIds(user);
  if (mgr && !mgr.has(String(to._id))) return error("A CS Manager gives applicants to their own location's CSs", 403);
  const now = new Date().toISOString();
  const data: Record<string, any> = { primary_mentor_id: String(to._id), primary_mentor_name: to.full_name ?? "", assignment_status: "assigned", updated_date: now };

  if (found.student) {
    const student: any = await col("students").findOne({ _id: found.student._id });
    if (!student) return notFound();
    if (!unassigned(student)) return error(`Already with ${student.primary_mentor_name || "a CS"} — Transfer on the student's page moves them`, 409);
    const history = await prepareStudentUpdate(student, data, user);
    const res = await col("students").updateOne({ _id: student._id, primary_mentor_id: student.primary_mentor_id ?? "" } as any, { $set: data });
    if (!res.modifiedCount) return error("Somebody changed this student meanwhile — open the page again", 409);
    await recordHistory(history);
    const doc = await col("students").findOne({ _id: student._id }, { projection: STUDENT_FIELDS });
    if (doc) void notifyStudentsGiven([doc], user.id);
    pendingCounts.clear();
    return json({ ok: true, created: false, student: studentCard(doc, user) });
  }

  let request: any;
  try {
    request = (await callLms<{ request: any }>(`/enrolment-requests/${found.userId}`, { method: "POST", body: { email: found.email }, verb: "share the request" })).request;
  } catch (err) {
    return lmsRefusal(err);
  }
  // Their LMS account may be here already under another address.
  const sameAccount: any = await col("students").findOne({ lms_user_id: found.userId }, { projection: STUDENT_FIELDS });
  if (sameAccount) return error(`This LMS account is already ${sameAccount.student_code} ${sameAccount.full_name} (${sameAccount.email || "no email"}) — ${unassigned(sameAccount) ? "assign them from the Students page" : `with ${sameAccount.primary_mentor_name}`}`, 409);

  const academy = str(request?.academy, 80);
  const programs = (Array.isArray(request?.programs) ? request.programs : []).map((p: unknown) => str(p, 80)).filter(Boolean).join(", ");
  const doc: any = {
    _id: new ObjectId(),
    student_code: await nextStudentCode(),
    full_name: str(request?.name) || found.email,
    email: found.email,
    phone: str(request?.phone, 40),
    country: str(request?.country, 80),
    notes: `From Delta LMS${programs ? ` — ${programs}` : ""}${academy ? ` (${academy})` : ""}`,
    primary_mentor_id: "", primary_mentor_name: "", senior_mentor_id: "", senior_mentor_name: "",
    assignment_status: "open_pool",
    status: "ACTIVE",
    student_level: "LEVEL_1",
    location: locationOf(to.team_location),
    team_id: "", team_name: "",
    first_assignee_id: "", first_assignee_name: "", first_assignee_role: "", first_assigned_at: "", assigned_at: "",
    source: "delta_lms",
    lms_user_id: found.userId,
    lms_course: programs,
    lms_academy: academy,
    ...lmsEnrolledFields(),
    created_by: user.id,
    created_by_name: who(user),
    created_date: now,
    updated_date: now,
  };
  // As if given from Delta Open Students: the team, first assignee and "assigned" history, the way Transfer fills them.
  const history = await prepareStudentUpdate(doc, data, user);
  Object.assign(doc, data);
  try {
    await col("students").insertOne(doc);
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return error("This applicant was just added — open the page again", 409);
    throw err;
  }
  await recordHistory([
    { student_id: String(doc._id), at: now, type: "arrived", by_id: user.id, by_name: who(user),
      text: `Added from the LMS Requests page by ${who(user)}${programs ? ` — ${programs}` : ""}${academy ? ` (${academy})` : ""}` } as any,
    ...history,
  ]);
  try {
    await col("logs").insertOne({
      timestamp: now, user_id: user.id, user_email: user.email ?? "", user_name: who(user), user_role: user.app_role,
      action_type: "create_student", entity_type: "Student", entity_id: String(doc._id),
      details: JSON.stringify({ message: `Created student from the LMS Requests page: ${doc.full_name} → ${doc.primary_mentor_name}` }),
      old_value: null, new_value: JSON.stringify(doc), ip_address: null, success: true, created_date: now, updated_date: now,
    } as any);
  } catch (err) {
    console.error("[lms requests] could not write the activity log", err);
  }
  void notifyStudentsGiven([doc], user.id);
  pendingCounts.clear();
  return json({ ok: true, created: true, student: studentCard(doc, user) });
}
