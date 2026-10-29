import { json, error, forbidden, notFound } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { callLms, lmsConfigured, LmsError } from "../lib/lms";
import { col } from "../db";
import { toObjectId } from "../lib/id";
import { userCanReadDoc } from "../entities/crud";
import { OUTCOMES, outcomeSummary, syncMeetingOutcomes } from "../students/meetingOutcomes";
import { isAdmin, studentsOf, visibleMentorIds } from "../students/followups";

/* ────────────────────────────────────────────────────────────────────────────
   The meeting-outcome pop-up (students/meetingOutcomes.ts): the signed-in
   mentor's meetings waiting for one (the LMS knows them by this person's
   email — nobody else has any), the form's lists, filling one, and a
   student's outcomes for their page.
──────────────────────────────────────────────────────────────────────────── */

const str = (v: unknown, max = 2000) => String(v ?? "").trim().slice(0, max);

/** POST /api/functions/getPendingMeetingOutcomes → { meetings } — never an error: a pop-up must not break a page. */
export async function getPendingMeetingOutcomes(_req: Request, user: AuthUser): Promise<Response> {
  if (!lmsConfigured() || !user.email) return json({ meetings: [] });
  try {
    const data = await callLms<{ meetings: unknown[] }>("/meeting-outcomes/pending", { query: { mentorEmail: user.email }, verb: "list the meetings waiting" });
    return json({ meetings: data.meetings ?? [] });
  } catch (err) {
    return json({ meetings: [], unavailable: String((err as Error)?.message ?? err) });
  }
}

/** POST /api/functions/getMeetingOutcomeOptions → { stages, followUpKinds, paymentModes, notInterestedReasons, courses, mentors } */
export async function getMeetingOutcomeOptions(_req: Request, _user: AuthUser): Promise<Response> {
  try {
    return json(await callLms("/meeting-outcomes/options", { verb: "share the form's lists" }));
  } catch (err) {
    if (err instanceof LmsError) return error(err.message, err.status);
    throw err;
  }
}

/**
 * POST /api/functions/saveMeetingOutcome { meetingId, stage, concern, remark, profile {…}, courseId?, paymentDate?, paymentMode?, followUpKind?,
 *   followUpDate?, withMentorEmail?, moduleId?, reason? } — as the signed-in mentor (the LMS checks it is theirs). Then
 * it is put on the student at once.
 */
export async function saveMeetingOutcome(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const meetingId = str(body?.meetingId, 100);
  if (!meetingId) return error("meetingId is required", 400);
  const fields: Record<string, string> = {};
  for (const k of ["stage", "concern", "remark", "courseId", "paymentDate", "paymentMode", "followUpKind", "followUpDate", "withMentorEmail", "moduleId", "reason"]) {
    if (body?.[k] !== undefined) fields[k] = str(body[k], k === "remark" ? 2000 : 200);
  }
  try {
    // The second step, about the client — the LMS checks every field of it.
    const profile = body?.profile && typeof body.profile === "object" && !Array.isArray(body.profile) ? body.profile : undefined;
    const saved = await callLms(`/mentor-meetings/${encodeURIComponent(meetingId)}/outcome`, { method: "POST", body: { ...fields, profile, mentorEmail: user.email }, verb: "save the outcome" });
    void syncMeetingOutcomes().catch(() => {});
    return json(saved);
  } catch (err) {
    // The LMS says why (filled already, not over yet, missing a field) — a 409 here, so the page can tell.
    if (err instanceof LmsError) return error(err.message, err.status);
    throw err;
  }
}

/** POST /api/functions/getStudentMeetingOutcomes { studentId } → { outcomes } newest first, for whoever may see the student. */
export async function getStudentMeetingOutcomes(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(str(body?.studentId, 40));
  if (!oid) return error("studentId is required", 400);
  const s: any = await col("students").findOne({ _id: oid });
  if (!s) return notFound("No such student");
  if (!(await userCanReadDoc(user, "Student", s))) return forbidden();
  const rows = (await col(OUTCOMES).find({ student_ids: String(s._id) }).sort({ filled_at: -1 }).limit(100).toArray()) as any[];
  return json({
    outcomes: rows.map((r) => ({
      id: String(r._id), meeting: r.meeting, mentor: r.mentor, outcome: r.outcome, stage: r.stage, filled_at: r.filled_at,
      reminder: (r.reminders ?? []).find((x: any) => x.student_id === String(s._id)) ?? null,
    })),
  });
}

/* ── The meetings themselves (2026-10-28): the student's Meetings tab, Meetings done, the Meetings report ── */

type LmsMeeting = {
  id: string; title: string; category: string; startsAt: string; endsAt: string; durationMins: number; inPerson: boolean; location: string;
  attendees: { name: string; email: string }[]; bookedByEmail: string; mentor: { name: string; email: string };
  status: "upcoming" | "waiting" | "done" | "cancelled"; cancelledAt: string | null; outcome: any;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const emailOf = (v: unknown) => String(v ?? "").trim().toLowerCase();

/** A meeting's follow-up reminders, kept here when its outcome landed (students/meetingOutcomes.ts), by student. */
async function remindersOf(ids: string[]): Promise<Map<string, Map<string, any>>> {
  const docs = ids.length ? ((await col(OUTCOMES).find({ _id: { $in: ids } } as any, { projection: { reminders: 1 } }).toArray()) as any[]) : [];
  return new Map(docs.map((d) => [String(d._id), new Map((d.reminders ?? []).map((r: any) => [String(r.student_id), r]))]));
}

export interface MeetingRow {
  id: string; meeting_id: string; starts_at: string; ends_at: string; title: string; category: string; status: LmsMeeting["status"];
  mentor: { name: string; email: string }; booked_by: string; attendee: string;
  student: { id: string; name: string; code: string; cs: string; cs_id: string; team: string; team_id: string } | null;
  stage: string; summary: string; outcome: any; reminder: { date: string; created: boolean } | null;
}

const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A student record holding this address — alone or among others, any letter case. */
export const addressRe = (e: string) => new RegExp(`(^|[\\s,;<>/])${escRe(e)}($|[\\s,;<>/])`, "i");
/** Every address on a record, in lower case. */
export const addressesIn = (raw: unknown): string[] => (String(raw ?? "").match(/[^\s,;<>/]+@[^\s,;<>/]+\.[^\s,;<>/]+/g) ?? []).map((e) => e.toLowerCase());

/**
 * The meetings in these days, one row per student on each (or one for a meeting with nobody of ours), for whoever may
 * see them: their students' (the follow-ups' reach — their own, Common ones, a leader's team; everyone for an admin),
 * and any meeting they held as its mentor.
 */
export async function meetingRows(user: AuthUser, from: string, to: string): Promise<MeetingRow[]> {
  const data = await callLms<{ meetings: LmsMeeting[] }>("/meeting-outcomes/meetings", { query: { from, to }, verb: "list the meetings" });
  const meetings = data.meetings ?? [];
  const emails = [...new Set(meetings.flatMap((m) => m.attendees.map((a) => emailOf(a.email))).filter((e) => e.includes("@")))];
  const visible = await visibleMentorIds(user);
  const projection = { full_name: 1, student_code: 1, email: 1, primary_mentor_id: 1, primary_mentor_name: 1, team_id: 1, team_name: 1 };
  // Each address whatever its letter case or spaces, and one of several on a record (2026-10-29: an exact match left
  // some students' meetings off the page).
  const byAddress = { email: { $in: emails.map(addressRe) } };
  const students = emails.length ? ((await col("students").find(byAddress, { projection }).toArray()) as any[]) : [];
  const mine = visible
    ? new Set(((await col("students").find({ $and: [byAddress, studentsOf(visible)] }, { projection: { _id: 1 } }).toArray()) as any[]).map((s) => String(s._id)))
    : null;
  const byEmail = new Map<string, any>();
  for (const s of students) for (const e of addressesIn(s.email)) if (!byEmail.has(e)) byEmail.set(e, s);
  const reminders = await remindersOf(meetings.filter((m) => m.status === "done").map((m) => m.id));
  const me = emailOf(user.email);
  const rows: MeetingRow[] = [];
  for (const m of meetings) {
    const held = emailOf(m.mentor.email) === me && !!me;
    const theirs = m.attendees.map((a) => ({ a, s: byEmail.get(emailOf(a.email)) })).filter((x) => !!x.s);
    const base = {
      meeting_id: m.id, starts_at: m.startsAt, ends_at: m.endsAt, title: m.title, category: m.category, status: m.status,
      mentor: m.mentor, booked_by: m.bookedByEmail, stage: m.outcome?.stage ?? "", summary: m.outcome ? outcomeSummary(m.outcome) : "", outcome: m.outcome,
    };
    if (!theirs.length) {
      // Nobody of ours on it: an admin's, or its mentor's, to see.
      if (!mine || held) rows.push({ ...base, id: m.id, attendee: m.attendees.map((a) => a.name).join(", "), student: null, reminder: null });
      continue;
    }
    for (const { a, s } of theirs) {
      const sid = String(s._id);
      if (mine && !mine.has(sid) && !held) continue;
      const r = reminders.get(m.id)?.get(sid);
      rows.push({
        ...base, id: `${m.id}|${sid}`, attendee: a.name,
        student: { id: sid, name: String(s.full_name ?? "").trim(), code: String(s.student_code ?? ""), cs: String(s.primary_mentor_name ?? ""), cs_id: String(s.primary_mentor_id ?? ""), team: String(s.team_name ?? ""), team_id: String(s.team_id ?? "") },
        reminder: r ? { date: String(r.date ?? ""), created: r.created === true } : null,
      });
    }
  }
  return rows;
}

async function rowsFor(req: Request, user: AuthUser): Promise<{ rows: MeetingRow[]; body: any } | Response> {
  const body: any = await req.json().catch(() => ({}));
  const from = str(body?.from, 10), to = str(body?.to, 10);
  if (!DAY.test(from) || !DAY.test(to) || from > to) return error("Pick the days: from and to", 400);
  if (Date.parse(to) - Date.parse(from) > 400 * 86_400_000) return error("At most about a year at a time", 400);
  if (!lmsConfigured()) return error("The LMS isn't linked on this server", 503);
  try {
    return { rows: await meetingRows(user, from, to), body };
  } catch (err) {
    if (err instanceof LmsError) return error(err.message, err.status);
    throw err;
  }
}

/**
 * POST /api/functions/getMeetingsDone { from, to (YYYY-MM-DD), status?: done | waiting | held (both, the default) |
 *   cancelled | upcoming | all, stage?, mentor? (email), cs? (id), team? (id), search? } → { rows, mentors, cses, teams }
 * — the Meetings done page: newest first; the lists are for its filters.
 */
export async function getMeetingsDone(req: Request, user: AuthUser): Promise<Response> {
  const got = await rowsFor(req, user);
  if (got instanceof Response) return got;
  const { rows, body } = got;
  const status = str(body?.status, 20) || "held";
  const q = str(body?.search, 100).toLowerCase();
  const out = rows.filter((r) =>
    (status === "all" || (status === "held" ? r.status === "done" || r.status === "waiting" : r.status === status))
    && (!body?.stage || body.stage === "all" || (body.stage === "waiting" ? r.status === "waiting" : r.stage === body.stage))
    && (!body?.mentor || body.mentor === "all" || emailOf(r.mentor.email) === emailOf(body.mentor))
    && (!body?.cs || body.cs === "all" || (body.cs === "none" ? !r.student?.cs_id : r.student?.cs_id === body.cs))
    && (!body?.team || body.team === "all" || r.student?.team_id === body.team)
    && (!q || [r.student?.name, r.student?.code, r.attendee, r.title, r.mentor.name, r.student?.cs].some((v) => String(v ?? "").toLowerCase().includes(q))));
  const uniq = <T,>(list: T[], key: (t: T) => string) => [...new Map(list.map((x) => [key(x), x])).values()];
  return json({
    rows: out,
    mentors: uniq(rows.map((r) => r.mentor).filter((m) => m.email), (m) => emailOf(m.email)).sort((a, b) => a.name.localeCompare(b.name)),
    cses: uniq(rows.filter((r) => r.student?.cs_id).map((r) => ({ id: r.student!.cs_id, name: r.student!.cs })), (c) => c.id).sort((a, b) => a.name.localeCompare(b.name)),
    teams: uniq(rows.filter((r) => r.student?.team_id).map((r) => ({ id: r.student!.team_id, name: r.student!.team })), (t) => t.id).sort((a, b) => a.name.localeCompare(b.name)),
  });
}

/** Who reads the Meetings report: admins, the CS Manager and the chief mentor. */
const readsMeetingReport = (user: AuthUser) => isAdmin(user) || user.app_role === "cs_manager" || user.app_role === "chief_mentor";

/**
 * POST /api/functions/getMeetingsReport { from, to } → { totals, stages, mentors, cses, teams } — counts for the days:
 * held (done + waiting), done, waiting, cancelled, upcoming; done ones by stage; per mentor, CS and team. Each number's
 * meetings come from getMeetingsDone with the same filter.
 */
export async function getMeetingsReport(req: Request, user: AuthUser): Promise<Response> {
  if (!readsMeetingReport(user)) return forbidden();
  const got = await rowsFor(req, user);
  if (got instanceof Response) return got;
  const rows = got.rows;
  const blank = () => ({ held: 0, done: 0, waiting: 0, cancelled: 0, interested: 0, not_interested: 0 });
  const add = (t: ReturnType<typeof blank>, r: MeetingRow) => {
    if (r.status === "done" || r.status === "waiting") t.held++;
    if (r.status === "done") t.done++;
    if (r.status === "waiting") t.waiting++;
    if (r.status === "cancelled") t.cancelled++;
    if (r.stage === "interested") t.interested++;
    if (r.stage === "not_interested") t.not_interested++;
  };
  const totals = { ...blank(), upcoming: 0 };
  const stages: Record<string, number> = { interested: 0, follow_up: 0, meeting_with: 0, revision: 0, not_interested: 0 };
  const per = (key: (r: MeetingRow) => { id: string; name: string } | null) => {
    const m = new Map<string, { id: string; name: string } & ReturnType<typeof blank>>();
    for (const r of rows) {
      const k = key(r);
      if (!k) continue;
      if (!m.has(k.id)) m.set(k.id, { ...k, ...blank() });
      add(m.get(k.id)!, r);
    }
    return [...m.values()].sort((a, b) => b.held - a.held || a.name.localeCompare(b.name));
  };
  for (const r of rows) {
    add(totals, r);
    if (r.status === "upcoming") totals.upcoming++;
    if (r.status === "done" && r.stage in stages) stages[r.stage]++;
  }
  return json({
    totals, stages,
    mentors: per((r) => (r.mentor.email ? { id: emailOf(r.mentor.email), name: r.mentor.name || r.mentor.email } : null)),
    cses: per((r) => ({ id: r.student?.cs_id || "none", name: r.student?.cs || "No CS" })),
    teams: per((r) => (r.student?.team_id ? { id: r.student.team_id, name: r.student.team } : null)),
  });
}

/**
 * POST /api/functions/getStudentMeetings { studentId } → { meetings, client_profile } — every meeting booked from here
 * with the student (by their email), newest first, with where it stands, its outcome and the follow-up it set; for
 * whoever may see the student.
 */
export async function getStudentMeetings(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(str(body?.studentId, 40));
  if (!oid) return error("studentId is required", 400);
  const s: any = await col("students").findOne({ _id: oid });
  if (!s) return notFound("No such student");
  if (!(await userCanReadDoc(user, "Student", s))) return forbidden();
  const email = emailOf(s.email);
  if (!email.includes("@") || !lmsConfigured()) return json({ meetings: [], client_profile: s.client_profile ?? null });
  try {
    const data = await callLms<{ meetings: LmsMeeting[] }>("/meeting-outcomes/meetings", { query: { emails: email }, verb: "list the meetings" });
    const reminders = await remindersOf((data.meetings ?? []).filter((m) => m.status === "done").map((m) => m.id));
    return json({
      meetings: (data.meetings ?? []).map((m) => {
        const r = reminders.get(m.id)?.get(String(s._id));
        return { ...m, summary: m.outcome ? outcomeSummary(m.outcome) : "", reminder: r ? { date: String(r.date ?? ""), created: r.created === true } : null };
      }),
      client_profile: s.client_profile ?? null,
    });
  } catch (err) {
    if (err instanceof LmsError) return error(err.message, err.status);
    throw err;
  }
}

