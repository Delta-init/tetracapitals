import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { callLms, LmsError } from "../lib/lms";
import { visibleMentorIds, studentsOf, isStudentOf } from "../students/followups";

/* ────────────────────────────────────────────────────────────────────────────
   Programs (the user, 2026-10-09) — a live class in the LMS repeating weekly or
   monthly until an end date, for the students picked for it only. The LMS is
   the record (its services/program.service.ts, /service/programs); this passes
   through and decides who may:

   - make one: a CS, a CS Manager, a Chief Mentor, a Super Admin;
   - pick students: their own (a CS) or their team's (a Chief / CS Manager)
     by default, and any other CS's student one by one by searching; a Super
     Admin anyone. A student needs an email the LMS knows;
   - see one: who made it, and anyone with one of their (team's) students on
     it; a Super Admin every one;
   - change or stop one: who made it, or a Super Admin.
   Who made it is always the signed-in person — never taken from the request.
──────────────────────────────────────────────────────────────────────────── */

const MAKERS = new Set(["cs", "cs_manager", "chief_mentor", "super_admin"]);
const str = (v: unknown, max = 2000) => String(v ?? "").trim().slice(0, max);
const isSuper = (u: AuthUser) => u.app_role === "super_admin";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function lms(run: () => Promise<unknown>): Promise<Response> {
  try {
    return json(await run());
  } catch (err) {
    if (err instanceof LmsError) return error(err.message, err.status);
    throw err;
  }
}

/** The portal students with these emails: who their CS is, and whether they are this person's (team's). */
async function studentsByEmail(emails: string[], mine: Set<string> | null) {
  const rows = emails.length
    ? ((await col("students").find({ email: { $in: emails.map((e) => new RegExp(`^${esc(e)}$`, "i")) } }, { projection: { full_name: 1, email: 1, student_code: 1, primary_mentor_id: 1, primary_mentor_name: 1, common_cs: 1 } }).toArray()) as any[])
    : [];
  const out = new Map<string, any>();
  for (const s of rows) {
    out.set(String(s.email).toLowerCase(), {
      studentId: String(s._id), code: s.student_code ?? "", csName: s.primary_mentor_name ?? "",
      yours: mine === null || isStudentOf(s, mine),
    });
  }
  return out;
}

/** A program as the LMS sends it, with what this person may do and whose each student is. */
async function decorate(programs: any[], user: AuthUser, mine: Set<string> | null) {
  const emails = [...new Set(programs.flatMap((p) => (p.students ?? []).map((s: any) => String(s.email ?? "").toLowerCase())).filter(Boolean))];
  const ours = await studentsByEmail(emails, mine);
  const me = String(user.email ?? "").toLowerCase();
  return programs.map((p) => ({
    ...p,
    canManage: isSuper(user) || (p.source === "portal" && String(p.createdByEmail ?? "").toLowerCase() === me),
    students: (p.students ?? []).map((s: any) => ({ ...s, ...(ours.get(String(s.email ?? "").toLowerCase()) ?? { yours: false, csName: "", code: "" }) })),
  }));
}

async function loadOne(id: string, user: AuthUser) {
  if (!/^[a-f0-9]{24}$/i.test(id)) throw new LmsError("No such program", 404);
  const p: any = await callLms(`/programs/${id}`, { verb: "find the program" });
  const mine = await visibleMentorIds(user);
  const [one] = await decorate([p], user, mine);
  return { program: one, mine };
}

/** POST /api/functions/listPrograms → { programs, canCreate } */
export async function listPrograms(_req: Request, user: AuthUser): Promise<Response> {
  return lms(async () => {
    const all: any[] = (await callLms("/programs", { verb: "list its programs" })) as any[];
    const mine = await visibleMentorIds(user);
    const me = String(user.email ?? "").toLowerCase();
    const decorated = await decorate(all, user, mine);
    const programs = mine === null ? decorated : decorated.filter((p) => String(p.createdByEmail ?? "").toLowerCase() === me || p.students.some((s: any) => s.yours));
    return { programs, canCreate: MAKERS.has(user.app_role) };
  });
}

/**
 * POST /api/functions/searchProgramStudents { q, everyone? } → students with an email: this person's (team's) by
 * default, anyone's with `everyone` — to add another CS's student one by one.
 */
export async function searchProgramStudents(req: Request, user: AuthUser): Promise<Response> {
  if (!MAKERS.has(user.app_role)) return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const q = str(body?.q, 80);
  const mine = await visibleMentorIds(user);
  const and: Record<string, unknown>[] = [{ email: { $nin: [null, ""] } }];
  if (q.length >= 2) and.push({ $or: [{ full_name: new RegExp(esc(q), "i") }, { email: new RegExp(esc(q), "i") }, { student_code: new RegExp(`^${esc(q)}`, "i") }] });
  else if (body?.everyone) return json({ students: [] });
  if (!body?.everyone && mine !== null) and.push(studentsOf(mine));
  const rows = (await col("students").find({ $and: and }, { projection: { full_name: 1, email: 1, student_code: 1, primary_mentor_id: 1, primary_mentor_name: 1, common_cs: 1 } }).sort({ full_name: 1 }).limit(body?.everyone ? 20 : 300).toArray()) as any[];
  return json({
    students: rows.map((s) => ({ id: String(s._id), name: s.full_name ?? "", email: String(s.email).toLowerCase(), code: s.student_code ?? "", csName: s.primary_mentor_name ?? "", yours: mine === null || isStudentOf(s, mine) })),
  });
}

const scheduleOf = (b: any) => ({
  ...(b.repeat !== undefined ? { repeat: b.repeat === "monthly" ? "monthly" : "weekly" } : {}),
  ...(b.weekdays !== undefined ? { weekdays: (Array.isArray(b.weekdays) ? b.weekdays : []).map(Number).filter((d: number) => d >= 0 && d <= 6) } : {}),
  ...(b.monthDay !== undefined ? { monthDay: b.monthDay === null || b.monthDay === "" ? null : Number(b.monthDay) } : {}),
  ...(b.startDate !== undefined ? { startDate: str(b.startDate, 10) } : {}),
  ...(b.endDate !== undefined ? { endDate: str(b.endDate, 10) } : {}),
  ...(b.time !== undefined ? { time: str(b.time, 5) } : {}),
  ...(b.durationMins !== undefined ? { durationMins: Number(b.durationMins) } : {}),
  ...(b.title !== undefined ? { title: str(b.title, 200) } : {}),
  ...(b.description !== undefined ? { description: str(b.description) } : {}),
  ...(b.isOnline !== undefined ? { isOnline: b.isOnline !== false } : {}),
  ...(b.location !== undefined ? { location: str(b.location, 200) } : {}),
});
const emailsOf = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map((e) => str(e, 200).toLowerCase()).filter((e) => e.includes("@")))];

/** POST /api/functions/createProgram { title, mentorEmail, repeat, weekdays|monthDay, startDate, endDate, time, durationMins, isOnline, location, studentEmails } */
export async function createProgram(req: Request, user: AuthUser): Promise<Response> {
  if (!MAKERS.has(user.app_role)) return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const students = emailsOf(body?.studentEmails);
  if (!students.length) return error("Add at least one student", 400);
  const mentorEmail = str(body?.mentorEmail, 200).toLowerCase();
  if (!mentorEmail) return error("Pick the mentor who takes it", 400);
  return lms(async () => {
    const made: any = await callLms("/programs", {
      method: "POST", verb: "make the program",
      body: { ...scheduleOf(body), mentorEmail, students, actorEmail: user.email, actorName: user.full_name || user.email },
    });
    const [one] = await decorate([made], user, await visibleMentorIds(user));
    return { ...one, missing: made?.missing ?? [] };
  });
}

/** POST /api/functions/changeProgramStudents { id, addEmails?, removeEmails? } — who made it, or a Super Admin. */
export async function changeProgramStudents(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  return lms(async () => {
    const { program } = await loadOne(str(body?.id, 40), user);
    if (!program.canManage) throw new LmsError("Only who made this program, or a Super Admin, can change it", 403);
    const changed: any = await callLms(`/programs/${program.id}/students`, { method: "POST", verb: "change the students", body: { add: emailsOf(body?.addEmails), remove: emailsOf(body?.removeEmails) } });
    const [one] = await decorate([changed], user, await visibleMentorIds(user));
    return { ...one, missing: changed?.missing ?? [] };
  });
}

/** POST /api/functions/rescheduleProgram { id, …schedule } — the classes still to come are made again. */
export async function rescheduleProgram(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  return lms(async () => {
    const { program } = await loadOne(str(body?.id, 40), user);
    if (!program.canManage) throw new LmsError("Only who made this program, or a Super Admin, can change it", 403);
    const changed: any = await callLms(`/programs/${program.id}`, { method: "PATCH", verb: "change the program", body: scheduleOf(body) });
    const [one] = await decorate([changed], user, await visibleMentorIds(user));
    return one;
  });
}

/** POST /api/functions/stopProgram { id } — the classes still to come are cancelled. */
export async function stopProgram(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  return lms(async () => {
    const { program } = await loadOne(str(body?.id, 40), user);
    if (!program.canManage) throw new LmsError("Only who made this program, or a Super Admin, can stop it", 403);
    const stopped: any = await callLms(`/programs/${program.id}/stop`, { method: "POST", verb: "stop the program" });
    const [one] = await decorate([stopped], user, await visibleMentorIds(user));
    return one;
  });
}
