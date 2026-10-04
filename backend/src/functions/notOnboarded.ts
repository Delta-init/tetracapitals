import { col } from "../db";
import { json } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { visibleMentorIds, studentsOf } from "../students/followups";
import { theirStudents } from "../students/closedBy";
import { salesCrmOf } from "../students/salesCrm";
import { notOnboardedFilter, WAIT_HOURS } from "../students/onboardingAlerts";

/**
 * POST /api/functions/getNotOnboarded
 * → { now, wait_hours, rows: [{ id, full_name, student_code, phone, email, course, primary_mentor_id, primary_mentor_name,
 *      common_cs, team_name, created_date, onboarded, from, closed_by: [{ email, name, crm }], sales_crm,
 *      alert: { at, told: [{ id, name }], reason? } | null }] }
 *
 * The Not onboarded page: students who haven't been onboarded yet, whatever they came from (`from`: finance, lms,
 * sheet, added — students/onboardingAlerts.ts),
 * the longest waiting first — a CS their own (Common ones too), a Chief Mentor or CS Manager everyone under them,
 * admin roles everyone, the Sales role the ones they closed, as the follow-ups. `alert`: when their leaders and the
 * Super Admins were told, 6 hours on.
 */
const SHEETS = new Set(["cs_sheet", "cs_tracker", "students_sheet", "data_sheet"]);
/** Where a student came from: finance (a sales close), an LMS sign-up, a sheet import, or added in the portal. */
const fromOf = (s: any): "finance" | "lms" | "sheet" | "added" =>
  s.finance_invoice_id ? "finance" : s.source === "delta_lms" || s.lms_user_id ? "lms" : SHEETS.has(String(s.source ?? "")) ? "sheet" : "added";

export async function getNotOnboarded(_req: Request, user: AuthUser): Promise<Response> {
  const visible = await visibleMentorIds(user);
  const filter = visible ? { $and: [notOnboardedFilter(), await theirStudents(user, studentsOf(visible))] } : notOnboardedFilter();
  const students = (await col("students")
    .find(filter, {
      projection: {
        full_name: 1, student_code: 1, phone: 1, email: 1, lms_course: 1, primary_mentor_id: 1, primary_mentor_name: 1,
        common_cs: 1, team_name: 1, created_date: 1, onboarded: 1, onboarding_alert: 1, closed_by: 1, sales_crm: 1,
        source: 1, finance_invoice_id: 1, lms_user_id: 1, onboarding_call: 1, onboarding_call_attempts: 1,
      },
    })
    .sort({ created_date: 1, _id: 1 })
    .limit(2000)
    .toArray()) as any[];
  return json({
    now: new Date().toISOString(),
    wait_hours: WAIT_HOURS,
    rows: students.map((s) => ({
      id: String(s._id),
      full_name: String(s.full_name ?? ""),
      student_code: String(s.student_code ?? ""),
      phone: String(s.phone ?? "").replace(/^[\s'`"]+/, "").trim(),
      email: String(s.email ?? ""),
      course: String(s.lms_course ?? ""),
      primary_mentor_id: String(s.primary_mentor_id ?? ""),
      primary_mentor_name: String(s.primary_mentor_name ?? ""),
      common_cs: Array.isArray(s.common_cs) ? s.common_cs : [],
      team_name: String(s.team_name ?? ""),
      created_date: s.created_date,
      onboarded: s.onboarded === true,
      from: fromOf(s),
      // The onboarding call from this page: connected or not, when, and how many tries didn't (studentFollowups.ts).
      call: s.onboarding_call
        ? { connected: s.onboarding_call.connected === true, at: s.onboarding_call.at ?? null, attempts: Number(s.onboarding_call_attempts) || 0 }
        : null,
      // Who closed them (students/closedBy.ts), and the sales CRM they came through — one of finance's from before
      // finance said which came through Delta's (students/salesCrm.ts); anyone else's only when it is known.
      closed_by: Array.isArray(s.closed_by) ? s.closed_by : [],
      sales_crm: salesCrmOf(s.sales_crm) || (s.finance_invoice_id ? "delta" : ""),
      alert: s.onboarding_alert?.status === "done"
        ? { at: s.onboarding_alert.at, told: s.onboarding_alert.told ?? [], ...(s.onboarding_alert.reason ? { reason: s.onboarding_alert.reason } : {}) }
        : null,
    })),
  });
}
