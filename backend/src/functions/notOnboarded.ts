import { col } from "../db";
import { json } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { visibleMentorIds, studentsOf } from "../students/followups";
import { theirStudents } from "../students/closedBy";
import { salesCrmOf } from "../students/salesCrm";
import { notOnboardedFilter, WAIT_HOURS, NOT_ONBOARDED_SINCE } from "../students/onboardingAlerts";
import { bonusChecksFor, verificationOf, verifiedAt, type BonusCheck } from "../students/bonusVerification";

/**
 * POST /api/functions/getNotOnboarded
 * → { now, wait_hours, rows: [{ id, full_name, student_code, phone, email, course, primary_mentor_id, primary_mentor_name,
 *      common_cs, team_name, created_date, onboarded, from, closed_by: [{ email, name, crm }], sales_crm,
 *      alert: { at, told: [{ id, name }], reason? } | null }] }
 *
 * The Not onboarded page: students who haven't been onboarded yet, whatever they came from (`from`: finance, lms,
 * sheet, added — students/onboardingAlerts.ts),
 * and (`verifying`) those welcomed whose sales-close MT5 bonus a broker admin hasn't approved yet — pending, or rejected
 * and waiting to be submitted again — and (`approved`) the ones whose bonus was approved this month, UAE time
 * (students/bonusVerification.ts). Each row carries `verification` and its `bonuses`.
 * the longest waiting first — a CS their own (Common ones too), a Chief Mentor or CS Manager everyone under them,
 * admin roles everyone, the Sales role the ones they closed, as the follow-ups. `alert`: when their leaders and the
 * Super Admins were told, 6 hours on.
 */
const SHEETS = new Set(["cs_sheet", "cs_tracker", "students_sheet", "data_sheet"]);
/** Where a student came from: finance (a sales close), an LMS sign-up, a sheet import, or added in the portal. */
const fromOf = (s: any): "finance" | "lms" | "sheet" | "added" =>
  s.finance_invoice_id ? "finance" : s.source === "delta_lms" || s.lms_user_id ? "lms" : SHEETS.has(String(s.source ?? "")) ? "sheet" : "added";

const PROJECTION = {
  full_name: 1, student_code: 1, phone: 1, email: 1, lms_course: 1, primary_mentor_id: 1, primary_mentor_name: 1,
  common_cs: 1, team_name: 1, created_date: 1, onboarded: 1, onboarding_alert: 1, closed_by: 1, sales_crm: 1,
  source: 1, finance_invoice_id: 1, lms_user_id: 1, onboarding_call: 1, onboarding_call_attempts: 1,
  course_fees: 1, onboarded_at: 1, onboarded_by_name: 1,
};

/** The first moment of this month, UAE time (UTC+4, no daylight saving). */
function uaeMonthStart(now = Date.now()): string {
  const uae = new Date(now + 4 * 3_600_000);
  return new Date(Date.UTC(uae.getUTCFullYear(), uae.getUTCMonth(), 1) - 4 * 3_600_000).toISOString();
}

export async function getNotOnboarded(_req: Request, user: AuthUser): Promise<Response> {
  const visible = await visibleMentorIds(user);
  const mine = visible ? await theirStudents(user, studentsOf(visible)) : null;
  const scoped = (f: Record<string, any>) => (mine ? { $and: [f, mine] } : f);
  const students = (await col("students")
    .find(scoped(notOnboardedFilter()), { projection: PROJECTION })
    .sort({ created_date: 1, _id: 1 })
    .limit(2000)
    .toArray()) as any[];
  // Welcomed, with a bonus promised at the close: onboarded only once a broker admin approves it.
  const welcomed = (await col("students")
    .find(scoped({
      onboarded: true,
      status: { $ne: "INACTIVE" },
      created_date: { $type: "string", $gte: NOT_ONBOARDED_SINCE },
      course_fees: { $elemMatch: { bonus_given: true } },
    }), { projection: PROJECTION })
    .sort({ created_date: 1, _id: 1 })
    .limit(2000)
    .toArray()) as any[];
  const checks = await bonusChecksFor([...students, ...welcomed]);
  const monthStart = uaeMonthStart();
  const verifying: any[] = [];
  const approved: any[] = [];
  for (const s of welcomed) {
    const c = checks.get(String(s._id)) ?? [];
    const v = verificationOf(c);
    if (v === "pending" || v === "rejected") verifying.push(s);
    else if (v === "approved" && verifiedAt(c) >= monthStart) approved.push(s);
  }
  const rowOf = (s: any) => {
    const c: BonusCheck[] = checks.get(String(s._id)) ?? [];
    return {
      ...baseRow(s),
      verification: verificationOf(c),
      bonuses: c,
      verified_at: verificationOf(c) === "approved" ? verifiedAt(c) : null,
      onboarded_at: s.onboarded_at ?? null,
      onboarded_by_name: String(s.onboarded_by_name ?? ""),
    };
  };
  return json({
    now: new Date().toISOString(),
    wait_hours: WAIT_HOURS,
    rows: students.map(rowOf),
    verifying: verifying.map(rowOf),
    approved: approved.map(rowOf).sort((a, b) => String(b.verified_at).localeCompare(String(a.verified_at))),
  });
}

function baseRow(s: any) {
  return {
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
  };
}
