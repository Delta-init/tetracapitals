import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { userCanReadDoc, userCanListEntity } from "../entities/crud";
import { buildScopeFilter } from "../lib/scope";
import { recordHistory } from "../students/history";
import { callLms, lmsConfigured, LmsError } from "../lib/lms";

/* The LMS answers for at most this many addresses at a time; a few asks at once. */
const LMS_BATCH = 500;
const LMS_AT_ONCE = 4;
const ANSWER_MAX = 4000;
const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const who = (u: AuthUser) => u.full_name || u.email || "somebody";
const emailOf = (s: any) => {
  const e = String(s?.email ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : "";
};
/** Every number in the phone field: some hold two or three, split as the sheets wrote them. */
const phonesOf = (v: unknown) =>
  [...new Set(String(v ?? "").replace(/\.0$/, "").split(/[\n\r/,;|]+| - /).map((x) => x.trim().replace(/^'+/, "")).filter((x) => x.replace(/\D/g, "").length >= 6))];

/**
 * POST /api/functions/getStudentLmsSupport { studentId }
 * The student's Help & Support tickets, with the conversation, and their class
 * assignments, with how each was reviewed — in the Delta LMS, by their email,
 * across both academies (the LMS's POST /service/support-tickets and
 * /service/class-assignments). For whoever may see the student. Read-only:
 * tickets are answered and assignments reviewed on the LMS; their CS hears of
 * each as it happens (students/lmsActivity.ts).
 * → { configured, available, message?, has_account, tickets, assignments }
 */
export async function getStudentLmsSupport(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(String(body?.studentId ?? ""));
  if (!oid) return error("studentId is required", 400);
  const student: any = await col("students").findOne({ _id: oid });
  if (!student) return notFound();
  if (!(await userCanReadDoc(user, "Student", student))) return forbidden();

  if (!lmsConfigured()) return json({ configured: false, available: false, tickets: [], assignments: [] });
  const email = String(student.email ?? "").trim().toLowerCase();
  if (!email.includes("@")) return json({ configured: true, available: true, message: "No email on this student to look them up in the LMS", tickets: [], assignments: [] });

  try {
    const [t, a] = await Promise.all([
      callLms<{ exists: boolean; tickets: any[] }>("/support-tickets", { method: "POST", body: { email }, verb: "share the tickets" }),
      callLms<{ exists: boolean; assignments: any[] }>("/class-assignments", { method: "POST", body: { email }, verb: "share the assignments" }),
    ]);
    return json({
      configured: true,
      available: true,
      has_account: !!(t?.exists || a?.exists),
      tickets: Array.isArray(t?.tickets) ? t.tickets : [],
      assignments: Array.isArray(a?.assignments) ? a.assignments : [],
    });
  } catch (err) {
    const message = err instanceof LmsError ? err.message : "The LMS could not be asked";
    // An LMS without these routes yet answers "not found".
    const notYet = /not found|no route|cannot post/i.test(message);
    return json({
      configured: true,
      available: false,
      message: notYet ? "The LMS doesn't share tickets and assignments yet — it needs its update" : message,
      tickets: [],
      assignments: [],
    });
  }
}

/** A student as the Support tickets page shows one: who they are, how to reach them, whose they are. */
function studentCard(s: any, lms: any) {
  return {
    id: String(s._id),
    name: String(s.full_name ?? "").trim(),
    code: String(s.student_code ?? ""),
    email: emailOf(s),
    phones: phonesOf(s.phone),
    country: String(s.country ?? ""),
    cs: String(s.primary_mentor_name ?? ""),
    team: String(s.team_name ?? ""),
    enrolment: s.enrolment_status === "closed" || s.enrolment_status === "old" ? s.enrolment_status : "open",
    // What they gave on their LMS registration form to be reached by.
    lms: lms ? { name: str(lms.name), phone: str(lms.phone, 60), emergencyContact: str(lms.emergencyContact, 120), city: str(lms.city, 80) } : null,
  };
}

/** A failed ask, as the page says it — an LMS without the many-students ask yet says so. */
function lmsTrouble(err: unknown) {
  const message = err instanceof LmsError ? err.message : "The LMS could not be asked";
  const notYet = /not found|no route|cannot post|email must be one address/i.test(message);
  return notYet ? "The LMS doesn't share tickets this way yet — it needs its update" : message;
}

/**
 * POST /api/functions/getLmsSupportTickets
 * Every Help & Support ticket in the Delta LMS from the students the user may see — their own (Common ones
 * too), their team's, everyone's for admins — newest activity first, each with its student: who they are,
 * every number in their phone field, and what they gave the LMS to be reached by. For the Support tickets page.
 * → { configured, available, message?, tickets: [{ …ticket, student }] }
 */
export async function getLmsSupportTickets(_req: Request, user: AuthUser): Promise<Response> {
  if (!userCanListEntity(user, "Student")) return forbidden();
  if (!lmsConfigured()) return json({ configured: false, available: false, tickets: [] });

  const scope = await buildScopeFilter(user, "Student");
  const students = (await col("students")
    .find(scope ? { $and: [scope, { email: { $regex: "@" } }] } : { email: { $regex: "@" } }, {
      projection: { full_name: 1, student_code: 1, email: 1, phone: 1, country: 1, primary_mentor_name: 1, team_name: 1, enrolment_status: 1 },
    })
    .toArray()) as any[];
  // One record an address: the LMS knows a person by it, and so do their tickets.
  const byEmail = new Map<string, any>();
  for (const s of students) {
    const e = emailOf(s);
    if (e && !byEmail.has(e)) byEmail.set(e, s);
  }
  const emails = [...byEmail.keys()];

  try {
    const batches: string[][] = [];
    for (let i = 0; i < emails.length; i += LMS_BATCH) batches.push(emails.slice(i, i + LMS_BATCH));
    const answers: any[] = [];
    for (let i = 0; i < batches.length; i += LMS_AT_ONCE) {
      answers.push(...(await Promise.all(batches.slice(i, i + LMS_AT_ONCE).map((list) =>
        callLms<{ students: any[]; tickets: any[] }>("/support-tickets", { method: "POST", body: { emails: list }, verb: "share the tickets" })))));
    }
    const contact = new Map<string, any>();
    const tickets: any[] = [];
    for (const a of answers) {
      for (const s of a?.students ?? []) contact.set(String(s.email ?? "").toLowerCase(), s);
      tickets.push(...(a?.tickets ?? []));
    }
    tickets.sort((x, y) => String(y.lastMessageAt ?? "").localeCompare(String(x.lastMessageAt ?? "")));
    return json({
      configured: true,
      available: true,
      tickets: tickets
        .filter((t) => byEmail.has(String(t.email ?? "").toLowerCase()))
        .map((t) => {
          const e = String(t.email).toLowerCase();
          return { ...t, student: studentCard(byEmail.get(e), contact.get(e)) };
        }),
    });
  } catch (err) {
    return json({ configured: true, available: false, message: lmsTrouble(err), tickets: [] });
  }
}

/** The student a ticket action is for, if the user may see them and the LMS can know them. */
async function ticketStudent(body: any, user: AuthUser): Promise<{ student: any; email: string; ticketId: string } | Response> {
  const oid = toObjectId(String(body?.studentId ?? ""));
  if (!oid) return error("studentId is required", 400);
  const ticketId = str(body?.ticketId, 40);
  if (!/^[a-f\d]{24}$/i.test(ticketId)) return error("ticketId is required", 400);
  const student: any = await col("students").findOne({ _id: oid });
  if (!student) return notFound();
  if (!(await userCanReadDoc(user, "Student", student))) return forbidden();
  if (!lmsConfigured()) return error("The LMS isn't linked to this server (LMS_API_URL, LMS_SERVICE_SECRET)", 503);
  const email = emailOf(student);
  if (!email) return error("This student has no email, so the LMS can't be asked about their tickets", 400);
  return { student, email, ticketId };
}

/** The LMS's refusal, passed on in its own words (a closed ticket, a ticket that isn't theirs, no support account). */
const lmsRefusal = (err: unknown) =>
  err instanceof LmsError ? error(err.message.replace(/^The LMS would not [^:]+: /, ""), err.status === 502 ? 502 : 409) : error("The LMS could not be asked", 502);

/**
 * POST /api/functions/answerLmsTicket { studentId, ticketId, body }
 * An answer on the student's ticket in the Delta LMS: from the LMS's shared support account, signed with
 * the user's name. The ticket then waits on the student, and the LMS tells them. For whoever may see the
 * student. Noted in the student's history. → { ticket }
 */
export async function answerLmsTicket(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const found = await ticketStudent(body, user);
  if (found instanceof Response) return found;
  const text = String(body?.body ?? "").trim();
  if (!text) return error("Write an answer first", 400);
  if (text.length > ANSWER_MAX) return error(`An answer can be at most ${ANSWER_MAX} characters`, 400);
  let ticket: any;
  try {
    ({ ticket } = await callLms<{ ticket: any }>(`/support-tickets/${found.ticketId}/reply`, {
      method: "POST",
      body: { email: found.email, body: text, byName: who(user), byEmail: user.email },
      verb: "take the answer",
    }));
  } catch (err) {
    return lmsRefusal(err);
  }
  await recordHistory([{
    student_id: String(found.student._id),
    at: new Date().toISOString(),
    type: "lms_ticket",
    text: `Answered the LMS ticket “${str(ticket?.subject, 120) || "a ticket"}”: ${text.length > 140 ? `${text.slice(0, 140)}…` : text}`,
    by_id: user.id,
    by_name: who(user),
    to: { ticket_id: found.ticketId, status: ticket?.status ?? "" },
  }]);
  return json({ ticket });
}

/**
 * POST /api/functions/resolveLmsTicket { studentId, ticketId }
 * Mark the student's LMS ticket resolved, as the help desk does (the student isn't messaged). For whoever
 * may see the student. Noted in the student's history. → { ticket }
 */
export async function resolveLmsTicket(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const found = await ticketStudent(body, user);
  if (found instanceof Response) return found;
  let ticket: any;
  try {
    ({ ticket } = await callLms<{ ticket: any }>(`/support-tickets/${found.ticketId}/resolve`, {
      method: "POST",
      body: { email: found.email, byName: who(user), byEmail: user.email },
      verb: "resolve the ticket",
    }));
  } catch (err) {
    return lmsRefusal(err);
  }
  await recordHistory([{
    student_id: String(found.student._id),
    at: new Date().toISOString(),
    type: "lms_ticket",
    text: `Marked the LMS ticket “${str(ticket?.subject, 120) || "a ticket"}” resolved`,
    by_id: user.id,
    by_name: who(user),
    to: { ticket_id: found.ticketId, status: ticket?.status ?? "" },
  }]);
  return json({ ticket });
}
