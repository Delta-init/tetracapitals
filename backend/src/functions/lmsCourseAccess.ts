import { json, error } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { recordHistory } from "../students/history";
import { callLms, lmsConfigured } from "../lib/lms";
import { lmsStudentFor, lmsRefusal, lmsLacksRoute, byOf, who, NOT_LINKED } from "./lmsEnrolmentRequests";

/* ────────────────────────────────────────────────────────────────────────────
   LMS course access (the user, 2026-10-06): the LMS admin's Edit Student → Course Access here — put a student on a
   Forex course with the modules picked locked, and open or lock a course's modules one by one. Forex courses only,
   and never taken off a student here (the user's choices); a module the fee locked can be opened too, by a CS as
   well. For whoever decides the student's LMS requests — a CS their own students (leaders their people's), the
   Super Admin anyone's (lmsEnrolmentRequests.ts lmsStudentFor). Done in the LMS from the person's own LMS account,
   else the shared support one with their name (lms services/portalCourseAccess.service.ts), and noted in the
   student's history here. Approving a request can give courses too (approveLmsEnrolmentRequest).
──────────────────────────────────────────────────────────────────────────── */

type Module = { id: string; title: string; locked?: boolean };
type Access = {
  student: { id: string; name: string; email: string; academy: string; approved: boolean; active: boolean };
  courses: { enrolmentId: string; courseId: string; title: string; status: string; how: string; access: string | null; progress: number; enrolledAt: string; modules: Module[] }[];
  offered: { courseId: string; title: string; modules: Module[] }[];
};

const NOT_YET = "The LMS can't change course access from here yet — it needs its update";
const clip = (s: string, max = 400) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * POST /api/functions/getLmsCourseAccess { studentId } | { email }
 * Their Forex courses in the LMS, each module open or locked, and the Forex courses of their academy they could be
 * put on. → { configured, student, courses, offered }
 */
export async function getLmsCourseAccess(req: Request, user: AuthUser): Promise<Response> {
  const found = await lmsStudentFor(await req.json().catch(() => ({})), user);
  if (found instanceof Response) return found;
  if (!lmsConfigured()) return json({ configured: false });
  try {
    const access = await callLms<Access>("/students/course-access", { method: "POST", body: { email: found.email }, verb: "share their courses" });
    return json({ configured: true, ...access });
  } catch (err) {
    return lmsLacksRoute(err) ? error(NOT_YET, 409) : lmsRefusal(err);
  }
}

/** "Market Structure (2 of 3 modules open)", as the LMS now has it. */
function described(title: string, access: Access): string {
  const modules = access.courses.find((c) => c.title === title)?.modules ?? [];
  const locked = modules.filter((m) => m.locked).length;
  if (!modules.length) return title;
  return locked ? `${title} (${modules.length - locked} of ${modules.length} modules open)` : `${title} (all ${modules.length} modules open)`;
}

/**
 * POST /api/functions/giveLmsCourses { studentId | email, courses: [{ courseId, locked: [moduleId] }] }
 * Put them on Forex courses in the LMS, the modules picked locked and the rest open — a course they're on already is
 * left as it is. → { given, already, student, courses, offered }
 */
export async function giveLmsCourses(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const found = await lmsStudentFor(body, user);
  if (found instanceof Response) return found;
  if (!Array.isArray(body?.courses) || !body.courses.length) return error("Pick at least one course", 400);
  if (!lmsConfigured()) return error(NOT_LINKED, 503);
  let answer: Access & { given: string[]; already: string[] };
  try {
    answer = await callLms("/students/course-access/give", {
      method: "POST", body: { email: found.email, courses: body.courses, ...byOf(user) }, verb: "give the courses",
    });
  } catch (err) {
    return lmsLacksRoute(err) ? error(NOT_YET, 409) : lmsRefusal(err);
  }
  if (found.student && answer.given?.length) {
    await recordHistory([{
      student_id: String(found.student._id),
      at: new Date().toISOString(),
      type: "lms_access",
      text: clip(`Put on LMS course${answer.given.length > 1 ? "s" : ""}: ${answer.given.map((t) => described(t, answer)).join(", ")}`),
      by_id: user.id,
      by_name: who(user),
      to: { courses: answer.given },
    }]);
  }
  return json(answer);
}

/**
 * POST /api/functions/setLmsModuleAccess { studentId | email, enrolmentId, locked: [moduleId] }
 * Open or lock one of their Forex courses' modules in the LMS: `locked` is every module that should be locked, the
 * rest are opened. → { changed, course, opened, locked, student, courses, offered }
 */
export async function setLmsModuleAccess(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const found = await lmsStudentFor(body, user);
  if (found instanceof Response) return found;
  const enrolmentId = String(body?.enrolmentId ?? "");
  if (!/^[a-f\d]{24}$/i.test(enrolmentId)) return error("enrolmentId is required", 400);
  if (!Array.isArray(body?.locked)) return error("locked must be the modules to lock — an empty list opens them all", 400);
  if (!lmsConfigured()) return error(NOT_LINKED, 503);
  let answer: Access & { changed: boolean; course: string; opened: string[]; locked: string[] };
  try {
    answer = await callLms(`/students/course-access/${enrolmentId}`, {
      method: "POST", body: { email: found.email, locked: body.locked, ...byOf(user) }, verb: "change the modules",
    });
  } catch (err) {
    return lmsLacksRoute(err) ? error(NOT_YET, 409) : lmsRefusal(err);
  }
  if (found.student && answer.changed) {
    const parts = [
      answer.opened.length ? `opened ${answer.opened.join(", ")}` : "",
      answer.locked.length ? `locked ${answer.locked.join(", ")}` : "",
    ].filter(Boolean);
    await recordHistory([{
      student_id: String(found.student._id),
      at: new Date().toISOString(),
      type: "lms_access",
      text: clip(`LMS course ${answer.course}: ${parts.join("; ")}`),
      by_id: user.id,
      by_name: who(user),
      to: { course: answer.course, opened: answer.opened, locked: answer.locked },
    }]);
  }
  return json(answer);
}
