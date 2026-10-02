import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { userCanReadDoc } from "../entities/crud";
import { callLms, lmsConfigured, LmsError } from "../lib/lms";

/**
 * POST /api/functions/getStudentLmsSupport { studentId }
 * The student's Help & Support tickets, with the conversation, and their class
 * assignments, with how each was reviewed — in the Delta LMS, by their email,
 * across both academies (the LMS's POST /service/support-tickets and
 * /service/class-assignments). For whoever may see the student. Read-only:
 * tickets are answered and assignments reviewed on the LMS; their CS hears of
 * each as it happens (students/lmsActivity.ts).
 * → { configured, available, message?, has_account, tickets, assignments }
 */
export async function getStudentLmsSupport(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(String(body?.studentId ?? ""));
  if (!oid) return error("studentId is required", 400);
  const student: any = await col("students").findOne({ _id: oid });
  if (!student) return notFound();
  if (!(await userCanReadDoc(user, "Student", student))) return forbidden();

  if (!lmsConfigured()) return json({ configured: false, available: false, tickets: [], assignments: [] });
  const email = String(student.email ?? "").trim().toLowerCase();
  if (!email.includes("@")) return json({ configured: true, available: true, message: "No email on this student to look them up in the LMS", tickets: [], assignments: [] });

  try {
    const [t, a] = await Promise.all([
      callLms<{ exists: boolean; tickets: any[] }>("/support-tickets", { method: "POST", body: { email }, verb: "share the tickets" }),
      callLms<{ exists: boolean; assignments: any[] }>("/class-assignments", { method: "POST", body: { email }, verb: "share the assignments" }),
    ]);
    return json({
      configured: true,
      available: true,
      has_account: !!(t?.exists || a?.exists),
      tickets: Array.isArray(t?.tickets) ? t.tickets : [],
      assignments: Array.isArray(a?.assignments) ? a.assignments : [],
    });
  } catch (err) {
    const message = err instanceof LmsError ? err.message : "The LMS could not be asked";
    // An LMS without these routes yet answers "not found".
    const notYet = /not found|no route|cannot post/i.test(message);
    return json({
      configured: true,
      available: false,
      message: notYet ? "The LMS doesn't share tickets and assignments yet — it needs its update" : message,
      tickets: [],
      assignments: [],
    });
  }
}
