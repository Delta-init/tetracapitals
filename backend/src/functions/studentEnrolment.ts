import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { visibleMentorIds, isStudentOf } from "../students/followups";
import { recordHistory } from "../students/history";

/**
 * Enrolment: "open"; "closed" — the student has enrolled; or "old" — from a CS's
 * earlier list and not enrolled. Unset is open.
 * Changed by the student's CS (or a CS they are Common with), the people above them (CS Manager, Chief —
 * whoever sees that CS's students, as on Follow-ups) and admin roles; each
 * change is noted in the student's history with who and when.
 *
 * POST /api/functions/setEnrolment { studentId, status: "open" | "closed" | "old" }
 */
export async function setEnrolment(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(String(body?.studentId ?? ""));
  if (!oid) return error("studentId is required", 400);
  const status = ["open", "closed", "old"].includes(body?.status) ? (body.status as string) : null;
  if (!status) return error('status is "open", "closed" or "old"', 400);

  const s: any = await col("students").findOne({ _id: oid });
  if (!s) return notFound();
  const visible = await visibleMentorIds(user);
  if (visible && !isStudentOf(s, visible)) {
    return forbidden("Only this student's CS (or a CS they are Common with), the people above them and admins can change their enrolment");
  }

  const from = s.enrolment_status === "closed" || s.enrolment_status === "old" ? s.enrolment_status : "open";
  if (from === status) return json({ enrolment_status: status, unchanged: true });
  const now = new Date().toISOString();
  const who = user.full_name || user.email || "somebody";
  const set = { enrolment_status: status, enrolment_updated_at: now, enrolment_updated_by_id: user.id, enrolment_updated_by_name: who, updated_date: now };
  await col("students").updateOne({ _id: oid }, { $set: set });
  await recordHistory([{
    student_id: String(oid), at: now, type: "enrolment_changed",
    text: status === "closed" ? "Enrolment closed — enrolled" : status === "old" ? "Enrolment set to Old" : from === "closed" ? "Enrolment reopened" : "Enrolment set to Open",
    by_id: user.id, by_name: who, from, to: status,
  }]);
  return json(set);
}
