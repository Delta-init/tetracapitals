import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { loadTeams } from "../students/teams";
import { prepareStudentUpdate, recordHistory } from "../students/history";

const ADMINS = new Set(["super_admin", "admin"]);

/**
 * POST /api/functions/reassignStudents
 * Body: { teamId, studentIds: string[], toCsId?: string, roundRobin?: boolean }
 * Returns: { moved, skipped, results: [{ studentId, to?, skipped? }] }
 *
 * Moves students to another CS inside the SAME team — the Team page's
 * Reassign. Allowed for Super Admin / Admin (any team) and the team's own
 * leader (their team only). Students must already be on the team and the
 * target must be one of its CS, so nobody can move a student out of a team
 * or to someone who isn't a CS here. Only the primary mentor changes; the
 * student's team and history follow through prepareStudentUpdate, the same
 * as any other edit. Everything else about the student stays admin-only.
 */
export async function reassignStudents(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => null);
  const teamId = String(body?.teamId ?? "");
  const ids: string[] = Array.isArray(body?.studentIds) ? body.studentIds.map(String).filter(Boolean) : [];
  if (!teamId || !ids.length) return error("teamId and studentIds are required", 400);
  if (ids.length > 500) return error("At most 500 students at a time", 400);

  const index = await loadTeams();
  const team = index.teams.find((t) => t.id === teamId);
  if (!team) return error("Team not found", 404);

  const isAdmin = ADMINS.has(user.app_role);
  const isLeader = user.id === team.id;
  if (!isAdmin && !isLeader) return forbidden();

  const cs = team.cs;
  let targetFor: (i: number) => (typeof cs)[number];
  if (body?.roundRobin) {
    if (!cs.length) return error("This team has no CS people", 400);
    targetFor = (i) => cs[i % cs.length]!;
  } else {
    const to = cs.find((m) => m.id === String(body?.toCsId ?? ""));
    if (!to) return error("The new mentor must be a CS on this team", 400);
    targetFor = () => to;
  }

  const oids = ids.map(toObjectId);
  if (oids.some((o) => !o)) return error("Bad student id", 400);
  const found = await col("students").find({ _id: { $in: oids as any[] } }).toArray();
  const byId = new Map(found.map((s: any) => [String(s._id), s]));

  // Every student must already be on this team (stored team, or worked out from their mentor).
  const onTeam = (s: any) =>
    String(s.team_id ?? "") === team.id || index.teamOf(s.primary_mentor_id)?.id === team.id;
  const outside = ids.filter((id) => !byId.has(id) || !onTeam(byId.get(id)));
  if (outside.length) return error(`${outside.length} student(s) are not on ${team.name}`, 400);

  const now = new Date().toISOString();
  const results: { studentId: string; to?: string; skipped?: string }[] = [];
  let moved = 0;
  for (let i = 0; i < ids.length; i++) {
    const student: any = byId.get(ids[i]!);
    const to = targetFor(i);
    if (String(student.primary_mentor_id ?? "") === to.id) {
      results.push({ studentId: ids[i]!, skipped: "already with them" });
      continue;
    }
    const data: Record<string, any> = {
      primary_mentor_id: to.id,
      primary_mentor_name: to.name,
      assignment_status: "assigned",
      updated_date: now,
    };
    const history = await prepareStudentUpdate(student, data, user);
    for (const h of history) h.via = "reassign";
    await col("students").updateOne({ _id: student._id }, { $set: data });
    await recordHistory(history);
    await col("logs").insertOne({
      timestamp: now,
      user_id: user.id, user_email: user.email, user_name: user.full_name, user_role: user.app_role,
      action_type: "reassign_student",
      entity_type: "Student",
      entity_id: ids[i],
      details: JSON.stringify({
        student: student.full_name, team: team.name,
        from: { id: student.primary_mentor_id ?? "", name: student.primary_mentor_name ?? "" },
        to: { id: to.id, name: to.name },
      }),
      success: true,
    });
    results.push({ studentId: ids[i]!, to: to.name });
    moved++;
  }
  return json({ moved, skipped: ids.length - moved, results });
}
