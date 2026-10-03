import { col } from "../db";
import { json, error } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { CLOSED_STAGES, businessToday, visibleMentorIds, studentsOf } from "../students/followups";

/**
 * POST /api/functions/getNavCounts
 * Returns: { new_students, followups_today, followups_overdue, payment_links_pending, payment_links_ready, payment_links_turned_down }
 *
 * The numbers on the sidebar. New students: given to you and not opened yet
 * (students.new_for_id — see notifyStudentsGiven). Follow-ups: what the
 * Follow-ups page's "Due today" tab and the Overdue follow-ups page show you —
 * your own students; Chief Mentor and CS Manager also everyone under them;
 * admin roles everyone. Payment links (paymentLinks.ts): for a Super Admin the
 * requests waiting for them; for a CS the links ready and the turn-downs, of
 * what they asked for, that they haven't seen yet.
 */
export async function getNavCounts(_req: Request, user: AuthUser): Promise<Response> {
  const today = businessToday();
  const visible = await visibleMentorIds(user);
  const open: Record<string, any> = { stage: { $nin: [...CLOSED_STAGES] } };
  if (visible) {
    const ids = (await col("students").find(studentsOf(visible), { projection: { _id: 1 } }).toArray()).map((s) => String(s._id));
    open.student_id = { $in: ids };
  }
  const cs = user.app_role === "cs";
  const unseen = (status: string) => col("payment_link_requests").countDocuments({ requested_by_id: user.id, status, cs_seen_at: { $exists: false } });
  const [newStudents, dueToday, overdue, linksWaiting, linksReady, linksTurnedDown] = await Promise.all([
    col("students").countDocuments({ new_for_id: user.id, primary_mentor_id: user.id }),
    col("student_followups").countDocuments({ ...open, next_followup_date: today }),
    col("student_followups").countDocuments({ ...open, next_followup_date: { $gt: "", $lt: today } }),
    user.app_role === "super_admin" ? col("payment_link_requests").countDocuments({ status: "pending" }) : 0,
    cs ? unseen("approved") : 0,
    cs ? unseen("rejected") : 0,
  ]);
  return json({
    today, new_students: newStudents, followups_today: dueToday, followups_overdue: overdue,
    payment_links_pending: linksWaiting, payment_links_ready: linksReady, payment_links_turned_down: linksTurnedDown,
  });
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
