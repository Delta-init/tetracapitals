import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { isAdminRole } from "../lib/roles";
import { loadTeams } from "../students/teams";

type Kind = "inactivity" | "transfer" | "in_team" | "intake" | "created" | "imported";
interface Side { id: string; name: string; team: string | null }

const side = (v: any): Side | null =>
  v && typeof v === "object" ? { id: String(v.id ?? ""), name: String(v.name ?? ""), team: v.team ? String(v.team) : null } : null;

/**
 * POST /api/functions/getStudentMoves
 * Body: { from?: ISO, to?: ISO, teamId?: string }
 * Returns: { moves: [{ at, kind, studentId, studentName, studentCode, from, to, by, text, now }], teams }
 *
 * Every time a student changed hands, from the students' history: new
 * students given out (intake from finance / the LMS, added, imported),
 * transfers between people, reassigns inside a team, and the inactivity rule.
 *
 * Admin roles see everything (optionally one team). A Chief Mentor sees only
 * moves into, out of or inside their own team. Read-only.
 */
export async function getStudentMoves(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const index = await loadTeams();
  const isAdmin = isAdminRole(user.app_role);
  const isChief = user.app_role === "chief_mentor";
  if (!isAdmin && !isChief) return forbidden();

  let teamId = String(body?.teamId ?? "");
  if (isChief) {
    if (teamId && teamId !== user.id) return forbidden();
    teamId = user.id; // a Chief's team is theirs
  }
  const team = teamId ? index.teams.find((t) => t.id === teamId) ?? null : null;
  if (teamId && !team) return error("Team not found", 404);

  const now = Date.now();
  const from = body?.from ? String(body.from) : new Date(now - 90 * 86_400_000).toISOString();
  const to = body?.to ? String(body.to) : new Date(now + 60_000).toISOString();

  const entries = (await col("student_history")
    .find({ at: { $gte: from, $lte: to }, type: { $in: ["arrived", "created", "assigned", "mentor_changed"] } })
    .sort({ at: -1 })
    .limit(20_000)
    .toArray()) as any[];

  // How each student first arrived (the entry recorded alongside their first "assigned").
  const origin = new Map<string, Kind>();
  for (const e of entries) {
    const key = `${e.student_id}|${e.at}`;
    if (e.type === "arrived") origin.set(key, "intake");
    else if (e.type === "created") origin.set(key, String(e.text).startsWith("Imported") ? "imported" : "created");
  }

  // Current members of the team (for moves whose stored team name has since changed).
  const memberIds = new Set<string>();
  if (team) for (const u of index.userById.values()) if (index.teamOf(String((u as any)._id))?.id === team.id) memberIds.add(String((u as any)._id));
  const touches = (f: Side | null, t: Side | null) =>
    !team ||
    (f && (f.team === team.name || memberIds.has(f.id))) ||
    (t && (t.team === team.name || memberIds.has(t.id)));

  const moves: any[] = [];
  for (const e of entries) {
    if (e.type !== "assigned" && e.type !== "mentor_changed") continue;
    const f = side(e.from), t = side(e.to);
    if (!touches(f, t)) continue;
    let kind: Kind;
    if (e.via === "inactivity" || String(e.text).startsWith("No approved deposit")) kind = "inactivity";
    else if (e.type === "assigned") kind = origin.get(`${e.student_id}|${e.at}`) ?? "transfer";
    else if (e.via === "reassign" || (f?.team && t?.team && f.team === t.team)) kind = "in_team";
    else kind = "transfer";
    moves.push({ at: e.at, kind, studentId: String(e.student_id), from: f, to: t, by: e.by_name || null, text: String(e.text) });
  }

  // Student names and where they are now.
  const ids = [...new Set(moves.map((m) => m.studentId))].map(toObjectId).filter(Boolean);
  const students = ids.length
    ? ((await col("students")
        .find({ _id: { $in: ids as any[] } }, { projection: { full_name: 1, student_code: 1, primary_mentor_id: 1, primary_mentor_name: 1, team_name: 1 } })
        .toArray()) as any[])
    : [];
  const byId = new Map(students.map((s) => [String(s._id), s]));
  for (const m of moves) {
    const s = byId.get(m.studentId);
    m.studentName = s?.full_name ?? "(removed)";
    m.studentCode = s?.student_code ?? "";
    m.now = s ? { id: String(s.primary_mentor_id ?? ""), name: String(s.primary_mentor_name ?? ""), team: s.team_name || null } : null;
  }

  return json({
    from, to,
    team: team ? { id: team.id, name: team.name } : null,
    teams: index.teams.map((t) => ({ id: t.id, name: t.name })),
    moves,
  });
}
