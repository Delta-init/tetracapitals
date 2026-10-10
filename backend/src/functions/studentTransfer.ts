import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { prepareStudentUpdate, recordHistory } from "../students/history";
import { notifyStudentsGiven } from "../lib/notify";
import { isMentorRole } from "../lib/roles";

/* ────────────────────────────────────────────────────────────────────────────
   Transfer (the Students page's "Transfer N"): a student moved to someone on a
   team — by a Super Admin or an Admin, as before, and by every CS Manager (the
   user, 2026-10-10): any student, into any team, no approval. Only the
   primary mentor is written; the team follows from them, the move is in the
   student's history and the new person is told, as with any change of CS.
──────────────────────────────────────────────────────────────────────────── */

export const mayTransfer = (user: AuthUser) => ["super_admin", "admin", "cs_manager"].includes(user.app_role);

/**
 * POST /api/functions/getTransferPeople — who students can be moved to, for the Transfer window: the staff with
 * just what the teams are built from (name, role, Up Head, team name and location, status). Nothing else about them.
 */
export async function getTransferPeople(_req: Request, user: AuthUser): Promise<Response> {
  if (!mayTransfer(user)) return forbidden();
  const docs = (await col("users")
    .find({}, { projection: { full_name: 1, email: 1, app_role: 1, up_head_id: 1, team_name: 1, team_location: 1, status: 1, all_teams_cs_manager: 1 } })
    .toArray()) as any[];
  return json({
    users: docs
      .filter((u) => isMentorRole(u.app_role))
      .map((u) => ({
        id: String(u._id), full_name: u.full_name ?? "", email: u.email ?? "", app_role: u.app_role, up_head_id: u.up_head_id ?? "",
        team_name: u.team_name ?? "", team_location: u.team_location ?? "", status: u.status ?? "", all_teams_cs_manager: u.all_teams_cs_manager === true,
      })),
  });
}

/**
 * POST /api/functions/transferStudent { studentId, toId } — one student to one person (the window calls it for each).
 * The person must be active staff; a student already with them is left as is.
 */
export async function transferStudent(req: Request, user: AuthUser): Promise<Response> {
  if (!mayTransfer(user)) return forbidden("Only a Super Admin, an Admin or a CS Manager can transfer students");
  const body: any = await req.json().catch(() => ({}));
  const sid = toObjectId(String(body?.studentId ?? ""));
  const tid = toObjectId(String(body?.toId ?? ""));
  if (!sid || !tid) return error("studentId and toId are required", 400);
  const student: any = await col("students").findOne({ _id: sid });
  if (!student) return notFound();
  const to: any = await col("users").findOne({ _id: tid }, { projection: { full_name: 1, app_role: 1, status: 1 } });
  if (!to || !isMentorRole(to.app_role)) return error("Pick someone on a team", 400);
  if (to.status === "inactive") return error(`${to.full_name || "That person"} is switched off — pick someone else`, 400);
  if (String(student.primary_mentor_id ?? "") === String(to._id)) return json({ unchanged: true });

  const data: Record<string, any> = {
    primary_mentor_id: String(to._id),
    primary_mentor_name: to.full_name ?? "",
    assignment_status: "assigned",
    updated_date: new Date().toISOString(),
  };
  const history = await prepareStudentUpdate(student, data, user);
  await col("students").updateOne({ _id: sid }, { $set: data });
  await recordHistory(history);
  const doc = await col("students").findOne({ _id: sid });
  if (doc) void notifyStudentsGiven([doc], user.id);
  return json({ ok: true, primary_mentor_id: data.primary_mentor_id, primary_mentor_name: data.primary_mentor_name, team_name: data.team_name ?? "" });
}
