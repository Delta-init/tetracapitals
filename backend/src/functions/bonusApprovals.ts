import { col } from "../db";
import { json, forbidden } from "../lib/response";
import { serialize, toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { BONUS_APPROVERS, BONUS_APPROVERS_MESSAGE, withFinance, financeFundingConfigured } from "../finance/funding";

/**
 * POST /api/functions/getBonusApprovals
 * → { now, month_start, counts: { pending, approved, rejected, with_finance }, pending, approved, rejected }
 *
 * The MT5 Bonus Approvals page (the user, 2026-10-04): every MT5 bonus waiting for a broker admin or a Super Admin —
 * the bonus promised at a sales close, which a student's onboarding waits on (students/bonusVerification.ts), and
 * every other bonus request once Delta finance approved its payment (finance/funding.ts) — with this month's approved
 * and rejected ones (UAE time). The ones finance still has are only counted: nobody here may decide them yet.
 *
 * Each row is the funding request as the Funding Requests page has it — so its approval box works unchanged — with
 * `source` (sales_close / request), its course, and the student's CS and whether their welcome went.
 *
 * Broker admins and Super Admins only: the people who decide a bonus.
 */
function uaeMonthStart(now = Date.now()): string {
  const uae = new Date(now + 4 * 3_600_000);
  return new Date(Date.UTC(uae.getUTCFullYear(), uae.getUTCMonth(), 1) - 4 * 3_600_000).toISOString();
}

/** Pending bonuses a broker admin may decide now — the filter the sidebar's count uses too. */
export function decidableBonusFilter(): Record<string, any> {
  return {
    type: "BONUS",
    status: "PENDING",
    "finance_approval.state": { $nin: financeFundingConfigured() ? ["sent", "queued"] : ["sent"] },
  };
}

export async function getBonusApprovals(_req: Request, user: AuthUser): Promise<Response> {
  if (!BONUS_APPROVERS.includes(user.app_role)) return forbidden(BONUS_APPROVERS_MESSAGE);
  const monthStart = uaeMonthStart();
  const bonuses = (await col("funding_transactions")
    .find({
      type: "BONUS",
      $or: [{ status: "PENDING" }, { status: { $in: ["APPROVED", "REJECTED"] }, approved_at: { $gte: monthStart } }],
    })
    .limit(3000)
    .toArray()) as any[];

  const studentIds = [...new Set(bonuses.map((t) => String(t.student_id ?? "")))].map(toObjectId).filter(Boolean);
  const students = (await col("students")
    .find({ _id: { $in: studentIds as any[] } }, {
      projection: { full_name: 1, student_code: 1, primary_mentor_name: 1, team_name: 1, onboarded: 1, onboarded_at: 1, lms_course: 1 },
    })
    .toArray()) as any[];
  const studentOf = new Map(students.map((s) => [String(s._id), s]));

  const row = (t: any) => {
    const s = studentOf.get(String(t.student_id ?? ""));
    return {
      ...serialize(t),
      source: t.bonus_credit === "sales_close" ? "sales_close" : t.bonus_credit === "course_upgrade" ? "course_upgrade" : "request",
      course: String(t.sales_close?.course || t.course_upgrade?.course || (Array.isArray(t.tags) ? t.tags[0] ?? "" : "") || s?.lms_course || ""),
      student: s
        ? {
            id: String(s._id), full_name: String(s.full_name ?? ""), student_code: String(s.student_code ?? ""),
            cs: String(s.primary_mentor_name ?? ""), team: String(s.team_name ?? ""),
            onboarded: s.onboarded === true, onboarded_at: s.onboarded_at ?? null,
          }
        : null,
    };
  };
  const at = (t: any) => String(t.requested_at ?? t.created_date ?? "");
  const pending = bonuses.filter((t) => t.status === "PENDING" && !withFinance(t)).sort((a, b) => at(a).localeCompare(at(b)));
  const decided = (status: string) =>
    bonuses.filter((t) => t.status === status).sort((a, b) => String(b.approved_at ?? "").localeCompare(String(a.approved_at ?? "")));
  const approved = decided("APPROVED");
  const rejected = decided("REJECTED");

  return json({
    now: new Date().toISOString(),
    month_start: monthStart,
    counts: {
      pending: pending.length,
      approved: approved.length,
      rejected: rejected.length,
      with_finance: bonuses.filter((t) => t.status === "PENDING" && withFinance(t)).length,
    },
    pending: pending.map(row),
    approved: approved.map(row),
    rejected: rejected.map(row),
  });
}
