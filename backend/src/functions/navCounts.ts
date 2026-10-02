import { col } from "../db";
import { json, error } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { CLOSED_STAGES, businessToday, visibleMentorIds, studentsOf } from "../students/followups";

/**
 * POST /api/functions/getNavCounts
 * Returns: { new_students, followups_today, followups_overdue }
 *
 * The numbers on the sidebar. New students: given to you and not opened yet
 * (students.new_for_id — see notifyStudentsGiven). Follow-ups: what the
 * Follow-ups page's "Due today" tab and the Overdue follow-ups page show you —
 * your own students; Chief Mentor and CS Manager also everyone under them;
 * admin roles everyone.
 */
export async function getNavCounts(_req: Request, user: AuthUser): Promise<Response> {
  const today = businessToday();
  const visible = await visibleMentorIds(user);
  const open: Record<string, any> = { stage: { $nin: [...CLOSED_STAGES] } };
  if (visible) {
    const ids = (await col("students").find(studentsOf(visible), { projection: { _id: 1 } }).toArray()).map((s) => String(s._id));
    open.student_id = { $in: ids };
  }
  const [newStudents, dueToday, overdue] = await Promise.all([
    col("students").countDocuments({ new_for_id: user.id, primary_mentor_id: user.id }),
    col("student_followups").countDocuments({ ...open, next_followup_date: today }),
    col("student_followups").countDocuments({ ...open, next_followup_date: { $gt: "", $lt: today } }),
  ]);
  return json({ today, new_students: newStudents, followups_today: dueToday, followups_overdue: overdue });
}

/**
 * POST /api/functions/markStudentSeen
 * Body: { id }
 * The student's page was opened by the person they were given to: no longer
 * new for them (the sidebar stops counting it). Anyone else opening it changes nothing.
 */
export async function markStudentSeen(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(String(body?.id ?? ""));
  if (!oid) return error("id is required", 400);
  const res = await col("students").updateOne({ _id: oid, new_for_id: user.id }, { $unset: { new_for_id: "", new_since: "" } });
  return json({ ok: true, cleared: res.modifiedCount === 1 });
}
