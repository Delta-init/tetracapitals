import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { isMentorRole } from "../lib/roles";
import { visibleMentorIds, studentsOf } from "../students/followups";
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
──────────────────────────────────────────────────────────────────────────── */

const LMS_BATCH = 500;
const LMS_AT_ONCE = 4;
const LMS_PAGE = 100;
const PAGE = 50;
const STATUSES = new Set(["pending", "approved", "rejected", "all"]);
const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const who = (u: AuthUser) => u.full_name || u.email || "somebody";
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

const STUDENT_FIELDS = { full_name: 1, student_code: 1, email: 1, primary_mentor_name: 1, team_name: 1 };
/** A request's student here, as the page links them: who they are, whose they are. */
const studentCard = (s: any) =>
  s ? { id: String(s._id), name: str(s.full_name), code: str(s.student_code, 40), cs: str(s.primary_mentor_name), team: str(s.team_name) } : null;

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
        requests: requests.map((q) => ({ ...q, student: studentCard(here.get(emailOf(q.email))) })),
      });
    }
    const byEmail = await studentsByEmail(await theirStudents(user));
    const found = (await requestsOf([...byEmail.keys()], status))
      .sort((a, b) => String(b.appliedAt ?? "").localeCompare(String(a.appliedAt ?? "")));
    return json({
      configured: true, available: true, reach, page, perPage: PAGE, total: found.length,
      requests: found.slice((page - 1) * PAGE, page * PAGE).map((q) => ({ ...q, student: studentCard(byEmail.get(emailOf(q.email))) })),
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
const lmsRefusal = (err: unknown) =>
  err instanceof LmsError ? error(err.message.replace(/^The LMS would not [^:]+: /, ""), err.status === 502 ? 502 : 409) : error("The LMS could not be asked", 502);

/** POST /api/functions/getLmsEnrolmentRequest { userId, email } — one request, with the whole application. → { request, student } */
export async function getLmsEnrolmentRequest(req: Request, user: AuthUser): Promise<Response> {
  const found = await requestFor(await req.json().catch(() => ({})), user);
  if (found instanceof Response) return found;
  try {
    const { request } = await callLms<{ request: any }>(`/enrolment-requests/${found.userId}`, {
      method: "POST", body: { email: found.email }, verb: "share the request",
    });
    return json({ request, student: studentCard(found.student) });
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
 * POST /api/functions/approveLmsEnrolmentRequest { userId, email }
 * Let them in on Forex in the LMS, as its admin's approve does — they're told by email and WhatsApp. Noted in
 * their history here. → { request, from: "own" | "shared", already? }
 */
export async function approveLmsEnrolmentRequest(req: Request, user: AuthUser): Promise<Response> {
  const found = await requestFor(await req.json().catch(() => ({})), user);
  if (found instanceof Response) return found;
  let answer: { request: any; from?: string; already?: boolean };
  try {
    answer = await callLms(`/enrolment-requests/${found.userId}/approve`, {
      method: "POST", body: { email: found.email, byName: who(user), byEmail: user.email }, verb: "approve the request",
    });
  } catch (err) {
    return lmsRefusal(err);
  }
  pendingCounts.clear();   // the sidebar's number changes
  if (found.student && !answer.already) {
    await recordHistory([{
      student_id: String(found.student._id),
      at: new Date().toISOString(),
      type: "lms_enrolment",
      text: "Approved their LMS enrolment request — in on Forex",
      by_id: user.id,
      by_name: who(user),
      to: { status: "approved", from: answer.from ?? "" },
    }]);
  }
  return json({ request: answer.request, from: answer.from ?? "", already: !!answer.already });
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
