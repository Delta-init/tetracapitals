import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { userCanReadDoc } from "../entities/crud";
import { callLms, lmsConfigured, LmsError } from "../lib/lms";

/**
 * POST /api/functions/getStudentLmsCourses { studentId }
 * The LMS courses the student is on, fresh from the Delta LMS by their email,
 * across both academies (the LMS's POST /service/enrolments): each course, its
 * academy and programme, how they were put on it, how much of it the fee has
 * opened, its modules (each by name, open or locked), their progress, and
 * whether they finished it (with the certificate) or dropped it. For whoever may see the student. The Students table shows the
 * same list as the hourly LMS check last kept it (students/lmsEnrolment.ts).
 * → { configured, available, message?, has_account, courses }
 */
export async function getStudentLmsCourses(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(String(body?.studentId ?? ""));
  if (!oid) return error("studentId is required", 400);
  const student: any = await col("students").findOne({ _id: oid });
  if (!student) return notFound();
  if (!(await userCanReadDoc(user, "Student", student))) return forbidden();

  if (!lmsConfigured()) return json({ configured: false, available: false, courses: [] });
  const email = String(student.email ?? "").trim().toLowerCase();
  if (!email.includes("@")) return json({ configured: true, available: true, message: "No email on this student to look them up in the LMS", courses: [] });

  try {
    // detail: each module by name, open or locked — one student, so the LMS allows it (an older LMS ignores it).
    const data = await callLms<{ students: any[] }>("/enrolments", { method: "POST", body: { emails: [email], detail: true }, verb: "share the courses" });
    const s = (data?.students ?? []).find((x) => String(x.email ?? "").toLowerCase() === email);
    return json({ configured: true, available: true, has_account: !!s?.exists, courses: Array.isArray(s?.courses) ? s.courses : [] });
  } catch (err) {
    const message = err instanceof LmsError ? err.message : "The LMS could not be asked";
    // An LMS without /enrolments yet answers "not found".
    const notYet = /not found|no route|cannot post/i.test(message);
    return json({ configured: true, available: false, message: notYet ? "The LMS doesn't share courses yet — it needs its update" : message, courses: [] });
  }
}
