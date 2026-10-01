import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { visibleMentorIds } from "../students/followups";
import { recordHistory } from "../students/history";

/**
 * Enrolment: "open", or "closed" — the student has enrolled. Unset is open.
 * Changed by the student's CS, the people above them (CS Manager, Chief —
 * whoever sees that CS's students, as on Follow-ups) and admin roles; each
 * change is noted in the student's history with who and when.
 *
 * POST /api/functions/setEnrolment { studentId, status: "open" | "closed" }
 */
export async function setEnrolment(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(String(body?.studentId ?? ""));
  if (!oid) return error("studentId is required", 400);
  const status = body?.status === "closed" || body?.status === "open" ? body.status : null;
  if (!status) return error('status is "open" or "closed"', 400);

  const s: any = await col("students").findOne({ _id: oid });
  if (!s) return notFound();
  const visible = await visibleMentorIds(user);
  if (visible && !visible.has(String(s.primary_mentor_id ?? ""))) {
    return forbidden("Only this student's CS, the people above them and admins can change their enrolment");
  }

  const from = s.enrolment_status === "closed" ? "closed" : "open";
  if (from === status) return json({ enrolment_status: status, unchanged: true });
  const now = new Date().toISOString();
  const who = user.full_name || user.email || "somebody";
  const set = { enrolment_status: status, enrolment_updated_at: now, enrolment_updated_by_id: user.id, enrolment_updated_by_name: who, updated_date: now };
  await col("students").updateOne({ _id: oid }, { $set: set });
  await recordHistory([{
    student_id: String(oid), at: now, type: "enrolment_changed",
    text: status === "closed" ? "Enrolment closed — enrolled" : "Enrolment reopened",
    by_id: user.id, by_name: who, from, to: status,
  }]);
  return json(set);
}
