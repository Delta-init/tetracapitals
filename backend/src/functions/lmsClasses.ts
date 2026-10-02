import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { userCanReadDoc } from "../entities/crud";
import { callLms, lmsConfigured, LmsError } from "../lib/lms";

/**
 * POST /api/functions/getStudentClasses { studentId }
 * The student's live classes in the Delta LMS — booked, attended, missed,
 * cancelled — by their email, across both academies (the LMS's
 * POST /service/class-attendance). For whoever may see the student.
 * → { configured, available, message?, counts, classes }
 */
export async function getStudentClasses(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(String(body?.studentId ?? ""));
  if (!oid) return error("studentId is required", 400);
  const student: any = await col("students").findOne({ _id: oid });
  if (!student) return notFound();
  if (!(await userCanReadDoc(user, "Student", student))) return forbidden();

  const empty = { attended: 0, missed: 0, upcoming: 0, booked: 0, cancelled: 0, lastAttendedAt: "" };
  if (!lmsConfigured()) return json({ configured: false, available: false, counts: empty, classes: [] });
  const email = String(student.email ?? "").trim().toLowerCase();
  if (!email.includes("@")) return json({ configured: true, available: true, message: "No email on this student to look them up in the LMS", counts: empty, classes: [] });

  try {
    const data = await callLms<{ students: any[] }>("/class-attendance", { method: "POST", body: { emails: [email], detail: true }, verb: "share the classes" });
    const s = (data?.students ?? []).find((x) => String(x.email ?? "").toLowerCase() === email);
    return json({
      configured: true,
      available: true,
      has_account: !!s?.exists,
      counts: s ? { attended: s.attended, missed: s.missed, upcoming: s.upcoming, booked: s.booked, cancelled: s.cancelled, lastAttendedAt: s.lastAttendedAt } : empty,
      classes: Array.isArray(s?.classes) ? s.classes : [],
    });
  } catch (err) {
    const message = err instanceof LmsError ? err.message : "The LMS could not be asked";
    // An LMS that doesn't know /class-attendance yet answers "not found".
    const notYet = /not found|no route|cannot post/i.test(message);
    return json({ configured: true, available: false, message: notYet ? "The LMS doesn't share classes yet — it needs its update" : message, counts: empty, classes: [] });
  }
}
