import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { callLms, LmsError } from "../lib/lms";
import { visibleMentorIds, studentsOf, isStudentOf } from "../students/followups";
import { teamIndex, csManagerReach } from "../lib/userLocation";
import { isMentorRole } from "../lib/roles";
import { PROGRAM_NOTICES, sendProgramNotices, recordAnswer } from "../students/programNotices";

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

   A team (the user, 2026-10-14): the program is made for one of the teams the
   maker may pick — a CS their own, a Chief Mentor their team(s), a CS Manager
   their location's, a Super Admin any — and its students list that team's,
   with "Add all" for its enrolled ones. The LMS has no team on a program, so
   the portal keeps it (program_teams: program_id → team).

   Messages (the user, 2026-10-15): the students picked — when it is made and
   any added later — get the program's email and a WhatsApp from their CS, and
   are asked to confirm (students/programNotices.ts). Each student on a program
   shows what was sent and their answer; Resend and Mark confirmed / Can't
   attend for who made it, a Super Admin, or the student's own CS (team).
──────────────────────────────────────────────────────────────────────────── */

const PROGRAM_TEAMS = "program_teams";

/** The teams this person may make a program for: [{ id, name, location }]. */
async function pickableTeams(user: AuthUser): Promise<{ id: string; name: string; location: string }[]> {
  const idx = await teamIndex();
  let allowed: Set<string> | null;
  if (isSuper(user)) allowed = null;
  else {
    const reach = await csManagerReach(user);
    allowed = reach ? new Set(reach.ids) : await visibleMentorIds(user);
  }
  const ids = new Set<string>();
  if (allowed === null) for (const t of idx.teams) ids.add(t.id);
  else for (const id of allowed) { const t = idx.teamOf(id); if (t) ids.add(t.id); }
  return idx.teams.filter((t) => ids.has(t.id)).map((t) => ({ id: t.id, name: t.name, location: t.location })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Everyone on these teams (their staff), to find their students by. */
async function teamStaffIds(teamIds: string[]): Promise<string[]> {
  const idx = await teamIndex();
  const want = new Set(teamIds);
  return [...idx.userById.keys()].filter((id) => want.has(idx.teamOf(id)?.id ?? ""));
}

/**
 * The teams a request names — `teams` (several, or ["all"]: every team they may pick; the user, 2026-10-15) or the
 * older single `team` — each one they may pick, else a refusal.
 */
async function teamsOf(body: any, user: AuthUser): Promise<{ id: string; name: string }[] | Response> {
  const asked = Array.isArray(body?.teams) ? body.teams.map((t: unknown) => str(t, 40)).filter(Boolean) : str(body?.team, 40) ? [str(body.team, 40)] : [];
  if (!asked.length) return [];
  const pickable = await pickableTeams(user);
  if (asked.includes("all")) return pickable.map((t) => ({ id: t.id, name: t.name }));
  const picked = pickable.filter((t) => asked.includes(t.id)).map((t) => ({ id: t.id, name: t.name }));
  if (picked.length !== new Set(asked).size) return forbidden("That team isn't one you can make a program for");
  return picked;
}

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
  const notices = new Map(((await col(PROGRAM_NOTICES).find({ program_id: { $in: programs.map((p) => String(p.id)) } },
    { projection: { program_id: 1, student_email: 1, email: 1, whatsapp: 1, sending: 1, response: 1, responded_via: 1, responded_at: 1 } }).toArray()) as any[])
    .map((n) => [`${n.program_id}|${n.student_email}`, { email: n.email ?? null, whatsapp: n.whatsapp ?? null, sending: !!n.sending, response: n.response ?? null, via: n.responded_via ?? "", at: n.responded_at ?? null }]));
  return programs.map((p) => ({
    ...p,
    canManage: isSuper(user) || (p.source === "portal" && String(p.createdByEmail ?? "").toLowerCase() === me),
    students: (p.students ?? []).map((s: any) => ({ ...s, ...(ours.get(String(s.email ?? "").toLowerCase()) ?? { yours: false, csName: "", code: "" }),
      notice: notices.get(`${p.id}|${String(s.email ?? "").toLowerCase()}`) ?? null })),
  }));
}

async function loadOne(id: string, user: AuthUser) {
  if (!/^[a-f0-9]{24}$/i.test(id)) throw new LmsError("No such program", 404);
  const p: any = await callLms(`/programs/${id}`, { verb: "find the program" });
  const mine = await visibleMentorIds(user);
  const [one] = await decorate([p], user, mine);
  return { program: one, mine };
}

/** POST /api/functions/listPrograms → { programs (each with team), canCreate, teams: the ones this person may pick } */
export async function listPrograms(_req: Request, user: AuthUser): Promise<Response> {
  return lms(async () => {
    const all: any[] = (await callLms("/programs", { verb: "list its programs" })) as any[];
    const mine = await visibleMentorIds(user);
    const me = String(user.email ?? "").toLowerCase();
    const decorated = await decorate(all, user, mine);
    const shown = mine === null ? decorated : decorated.filter((p) => String(p.createdByEmail ?? "").toLowerCase() === me || p.students.some((s: any) => s.yours));
    // Its teams — several since 2026-10-15 (`teams`), one before (`team_id`).
    const teamsOf = new Map(((await col(PROGRAM_TEAMS).find({ program_id: { $in: shown.map((p) => String(p.id)) } }).toArray()) as any[])
      .map((t) => [t.program_id, Array.isArray(t.teams) && t.teams.length ? t.teams : t.team_id ? [{ id: t.team_id, name: t.team_name }] : []]));
    const programs = shown.map((p) => { const ts = teamsOf.get(String(p.id)) ?? []; return { ...p, teams: ts, team: ts[0] ?? null }; });
    return { programs, canCreate: MAKERS.has(user.app_role), teams: MAKERS.has(user.app_role) ? await pickableTeams(user) : [] };
  });
}

/**
 * POST /api/functions/searchProgramStudents { q, everyone?, teams? | team?, enrolledOnly? } → students with an email: this person's (team's) by
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
  const teams = await teamsOf(body, user);
  if (teams instanceof Response) return teams;
  // A whole group at once (the user, 2026-10-15): CSs' students, teams' students, or every student in the portal.
  const csIds = (Array.isArray(body?.cs) ? body.cs : []).map((c: unknown) => str(c, 40)).filter(Boolean);
  const group = body?.all === true || csIds.length > 0;
  if (body?.all === true) {
    // every student in the portal — nothing more to narrow by
  } else if (csIds.length || (!body?.everyone && teams.length)) {
    const staff = new Set<string>(csIds);
    if (teams.length) for (const id of await teamStaffIds(teams.map((t) => t.id))) staff.add(id);
    and.push(studentsOf(staff));
  } else if (!body?.everyone && mine !== null) and.push(studentsOf(mine));
  // "Add all": only those with an LMS account — the others can't join its classes.
  if (body?.enrolledOnly) and.push({ "lms_account.exists": true });
  and.push({ not_student: { $ne: true } });
  const rows = (await col("students").find({ $and: and }, { projection: { full_name: 1, email: 1, student_code: 1, primary_mentor_id: 1, primary_mentor_name: 1, common_cs: 1 } }).sort({ full_name: 1 }).limit(group ? 5000 : body?.everyone ? 20 : 300).toArray()) as any[];
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
  // Its picture (2026-10-15) — an https address from the portal's upload, or "" to take it off.
  ...(b.thumbnailUrl !== undefined ? { thumbnailUrl: str(b.thumbnailUrl, 2048) } : {}),
});
const emailsOf = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map((e) => str(e, 200).toLowerCase()).filter((e) => e.includes("@")))];

/** POST /api/functions/createProgram { title, mentorEmail, teams? (ids, or ["all"]), team? (one, older), repeat, weekdays|monthDay, startDate, endDate, time, durationMins, isOnline, location, studentEmails } */
export async function createProgram(req: Request, user: AuthUser): Promise<Response> {
  if (!MAKERS.has(user.app_role)) return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const students = emailsOf(body?.studentEmails);
  if (!students.length) return error("Add at least one student", 400);
  const mentorEmail = str(body?.mentorEmail, 200).toLowerCase();
  if (!mentorEmail) return error("Pick the mentor who takes it", 400);
  const teams = await teamsOf(body, user);
  if (teams instanceof Response) return teams;
  return lms(async () => {
    const made: any = await callLms("/programs", {
      method: "POST", verb: "make the program",
      // Co-mentors too (2026-10-15) — the LMS takes them as coMentorEmails.
      body: { ...scheduleOf(body), mentorEmail, coMentorEmails: emailsOf(body?.coMentorEmails).filter((e) => e !== mentorEmail), students, actorEmail: user.email, actorName: user.full_name || user.email },
    });
    const [one] = await decorate([made], user, await visibleMentorIds(user));
    if (teams.length && made?.id) {
      await col(PROGRAM_TEAMS).updateOne({ program_id: String(made.id) }, { $set: {
        program_id: String(made.id), teams, team_id: teams[0].id, team_name: teams[0].name,
        set_by_id: user.id, set_by_name: user.full_name || user.email, set_at: new Date().toISOString(),
      } }, { upsert: true });
    }
    const told = await sendProgramNotices(made, undefined, { by: user.full_name || user.email }).catch((err) => { console.error("[programs] messages", err); return 0; });
    return { ...one, teams, team: teams[0] ?? null, missing: made?.missing ?? [], told };
  });
}

/** POST /api/functions/changeProgramStudents { id, addEmails?, removeEmails? } — who made it, or a Super Admin. */
export async function changeProgramStudents(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  return lms(async () => {
    const { program } = await loadOne(str(body?.id, 40), user);
    if (!program.canManage) throw new LmsError("Only who made this program, or a Super Admin, can change it", 403);
    const add = emailsOf(body?.addEmails);
    const changed: any = await callLms(`/programs/${program.id}/students`, { method: "POST", verb: "change the students", body: { add, remove: emailsOf(body?.removeEmails) } });
    const told = add.length ? await sendProgramNotices(changed, add, { by: user.full_name || user.email }).catch(() => 0) : 0;
    const [one] = await decorate([changed], user, await visibleMentorIds(user));
    return { ...one, missing: changed?.missing ?? [], told };
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

/** The program and one student on it, if this person may act on that student's messages. */
async function noticeFor(body: any, user: AuthUser) {
  const { program } = await loadOne(str(body?.id, 40), user);
  const email = str(body?.email, 200).toLowerCase();
  const student = program.students.find((s: any) => String(s.email ?? "").toLowerCase() === email);
  if (!student) throw new LmsError("That student isn't on this program", 404);
  if (!program.canManage && !student.yours) throw new LmsError("Only who made this program, a Super Admin or the student's CS can do that", 403);
  return { program, email };
}

/** POST /api/functions/resendProgramNotice { id, email } — the program's email and WhatsApp to that student again. */
export async function resendProgramNotice(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  return lms(async () => {
    const { program, email } = await noticeFor(body, user);
    if (program.status !== "active") throw new LmsError("This program is stopped", 409);
    const told = await sendProgramNotices(program, [email], { again: true, by: user.full_name || user.email });
    if (!told) throw new LmsError("Program messages are switched off on this server", 409);
    return { ok: true };
  });
}

/** POST /api/functions/setProgramResponse { id, email, response: "confirmed" | "declined" | null } — told by phone; a confirm still sends the confirmation. */
export async function setProgramResponse(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const response = body?.response === "confirmed" || body?.response === "declined" ? body.response : null;
  return lms(async () => {
    const { program, email } = await noticeFor(body, user);
    const key = { program_id: String(program.id), student_email: email };
    let notice: any = await col(PROGRAM_NOTICES).findOne(key);
    if (!notice) {
      // Never sent (made before messages, or switched off): kept now, so the answer has somewhere to live.
      const s: any = await col("students").findOne({ email: new RegExp(`^${esc(email)}$`, "i") }, { projection: { full_name: 1, primary_mentor_id: 1, primary_mentor_name: 1 } });
      notice = { ...key, program_title: program.title, student_id: s ? String(s._id) : "", student_name: s?.full_name ?? "", cs_id: String(s?.primary_mentor_id ?? ""), cs_name: s?.primary_mentor_name ?? "", response: null, created_at: new Date().toISOString() };
      await col(PROGRAM_NOTICES).updateOne(key, { $setOnInsert: notice }, { upsert: true });
    }
    await recordAnswer(notice, response, "by hand", program);
    await col(PROGRAM_NOTICES).updateOne(key, { $set: { answered_by: user.full_name || user.email } });
    return { ok: true, response };
  });
}

/**
 * POST /api/functions/getProgramAudiences → { all, teams: [{ id, name, location, count }], cs: [{ id, name, team, count }] }
 * The groups New program adds students by (the user, 2026-10-15): every student in the portal, each team they may pick,
 * each CS on those teams — with how many of their students have an LMS account (the ones a program can take).
 */
export async function getProgramAudiences(_req: Request, user: AuthUser): Promise<Response> {
  if (!MAKERS.has(user.app_role)) return forbidden();
  const idx = await teamIndex();
  const teams = await pickableTeams(user);
  const enrolled = { email: { $nin: [null, ""] }, "lms_account.exists": true, not_student: { $ne: true } };
  const byCs = new Map<string, number>(((await col("students").aggregate([
    { $match: enrolled }, { $group: { _id: "$primary_mentor_id", n: { $sum: 1 } } },
  ]).toArray()) as any[]).map((r) => [String(r._id ?? ""), r.n]));
  const teamIds = new Set(teams.map((t) => t.id));
  const cs: { id: string; name: string; team: string; count: number }[] = [];
  const teamCount = new Map<string, number>();
  for (const [id, u] of idx.userById) {
    if (!isMentorRole(String(u?.app_role ?? "")) || u?.status === "inactive") continue;
    const t = idx.teamOf(id);
    if (!t || !teamIds.has(t.id)) continue;
    const n = byCs.get(id) ?? 0;
    teamCount.set(t.id, (teamCount.get(t.id) ?? 0) + n);
    if (u.app_role === "cs" || n > 0) cs.push({ id, name: String(u.full_name || u.email || "CS"), team: t.name, count: n });
  }
  return json({
    all: await col("students").countDocuments(enrolled),
    teams: teams.map((t) => ({ ...t, count: teamCount.get(t.id) ?? 0 })),
    cs: cs.sort((a, b) => a.name.localeCompare(b.name)),
  });
}
