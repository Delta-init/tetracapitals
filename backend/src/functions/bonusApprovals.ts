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
 *
 * MT5 Approvals (the user, 2026-10-12): deposits and withdrawals waiting for a broker admin or a Super Admin are here
 * too — each row says its `type` (DEPOSIT / WITHDRAWAL / BONUS) — so everything that goes into MT5 is decided in one
 * place; the Funding Requests page still decides them as well. `counts.by_type` per type and tab.
 */
function uaeMonthStart(now = Date.now()): string {
  const uae = new Date(now + 4 * 3_600_000);
  return new Date(Date.UTC(uae.getUTCFullYear(), uae.getUTCMonth(), 1) - 4 * 3_600_000).toISOString();
}

const MT5_TYPES = ["DEPOSIT", "WITHDRAWAL", "BONUS"];

/** Pending deposits, withdrawals and bonuses a broker admin may decide now — the MT5 Approvals sidebar count. */
export function decidableMt5Filter(): Record<string, any> {
  return {
    type: { $in: MT5_TYPES },
    status: "PENDING",
    "finance_approval.state": { $nin: financeFundingConfigured() ? ["sent", "queued"] : ["sent"] },
    // Sent back to the CS for correction (fundingCorrections.ts): theirs until corrected.
    "returned.at": { $exists: false },
  };
}

/** Pending bonuses a broker admin may decide now (the Root portal's pending list counts these). */
export function decidableBonusFilter(): Record<string, any> {
  return {
    type: "BONUS",
    status: "PENDING",
    "finance_approval.state": { $nin: financeFundingConfigured() ? ["sent", "queued"] : ["sent"] },
  };
}

export async function getBonusApprovals(req: Request, user: AuthUser): Promise<Response> {
  if (!BONUS_APPROVERS.includes(user.app_role)) return forbidden(BONUS_APPROVERS_MESSAGE);
  // The approved and rejected ones: this month (UAE), or from the date range picked (YYYY-MM-DD, UAE days — 2026-10-12).
  const body: any = await req.json().catch(() => ({}));
  const day = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : "");
  const from = day(body?.from), to = day(body?.to);
  const monthStart = from ? new Date(Date.parse(`${from}T00:00:00+04:00`)).toISOString() : uaeMonthStart();
  const decidedUntil = to ? new Date(Date.parse(`${to}T00:00:00+04:00`) + 86_400_000).toISOString() : null;
  const bonuses = (await col("funding_transactions")
    .find({
      type: { $in: MT5_TYPES },
      $or: [{ status: "PENDING" }, { status: { $in: ["APPROVED", "REJECTED"] }, approved_at: { $gte: monthStart, ...(decidedUntil ? { $lt: decidedUntil } : {}) } }],
    })
    .limit(3000)
    .toArray()) as any[];

  const studentIds = [...new Set(bonuses.map((t) => String(t.student_id ?? "")))].map(toObjectId).filter(Boolean);
  const students = (await col("students")
    .find({ _id: { $in: studentIds as any[] } }, {
      projection: {
        full_name: 1, student_code: 1, email: 1, primary_mentor_name: 1, team_name: 1, onboarded: 1, onboarded_at: 1, lms_course: 1,
        student_level: 1, lms_courses: 1, closed_by: 1, course_fees: 1, finance_invoice_number: 1,
      },
    })
    .toArray()) as any[];
  const studentOf = new Map(students.map((s) => [String(s._id), s]));

  const row = (t: any) => {
    const s = studentOf.get(String(t.student_id ?? ""));
    return {
      ...serialize(t),
      source: t.type !== "BONUS" ? "request" : t.bonus_credit === "sales_close" ? "sales_close" : t.bonus_credit === "course_upgrade" ? "course_upgrade" : "request",
      course: String(t.sales_close?.course || t.course_upgrade?.course || (Array.isArray(t.tags) ? t.tags[0] ?? "" : "") || s?.lms_course || ""),
      student: s
        ? {
            id: String(s._id), full_name: String(s.full_name ?? ""), student_code: String(s.student_code ?? ""), email: String(s.email ?? ""),
            cs: String(s.primary_mentor_name ?? ""), team: String(s.team_name ?? ""),
            onboarded: s.onboarded === true, onboarded_at: s.onboarded_at ?? null,
            level: String(s.student_level ?? ""),
            // What the MT5 Approvals table shows beside the request (the user, 2026-10-12): the LMS courses they are on
            // now (kept hourly from the LMS, students/lmsEnrolment.ts), finance's invoices, and who closed the sale.
            lms_courses: (Array.isArray(s.lms_courses) ? s.lms_courses : []).map((c: any) => ({ title: String(c.title ?? ""), status: String(c.status ?? ""), progress: Number(c.progress) || 0 })),
            invoices: (Array.isArray(s.course_fees) ? s.course_fees : []).map((f: any) => ({
              invoice_number: String(f.invoice_number ?? ""), course: String(f.course ?? ""), currency: String(f.currency ?? ""),
              fee: (Number(f.fee_minor) || 0) / 100, paid: (Number(f.paid_minor) || 0) / 100, balance: (Number(f.balance_minor) || 0) / 100,
              // Finance's receipt for that invoice — the one a sales-close bonus has (it has none of its own).
              receipt_url: /^https?:\/\//i.test(String(f.receipt_url ?? "")) ? String(f.receipt_url) : "", receipt_name: String(f.receipt_name ?? ""),
            })),
            finance_invoice_number: String(s.finance_invoice_number ?? ""),
            closed_by: (Array.isArray(s.closed_by) ? s.closed_by : []).map((c: any) => ({ name: String(c.name ?? c.email ?? ""), crm: String(c.crm ?? "") })),
          }
        : null,
    };
  };
  const at = (t: any) => String(t.requested_at ?? t.created_date ?? "");
  // Corrected ones first — they were waiting already; those sent back to the CS are listed apart.
  const waitAt = (t: any) => String(t.corrected?.at ? "0" + t.corrected.at : "1" + at(t));
  const pending = bonuses.filter((t) => t.status === "PENDING" && !withFinance(t) && !t.returned?.at).sort((a, b) => waitAt(a).localeCompare(waitAt(b)));
  const returned = bonuses.filter((t) => t.status === "PENDING" && t.returned?.at).sort((a, b) => String(b.returned.at).localeCompare(String(a.returned.at)));
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
      returned: returned.length,
      // Each type's pending / approved / rejected, for the Type filter.
      by_type: Object.fromEntries(MT5_TYPES.map((ty) => [ty, {
        pending: pending.filter((t) => t.type === ty).length,
        approved: approved.filter((t) => t.type === ty).length,
        rejected: rejected.filter((t) => t.type === ty).length,
        returned: returned.filter((t) => t.type === ty).length,
      }])),
    },
    pending: pending.map(row),
    approved: approved.map(row),
    rejected: rejected.map(row),
    returned: returned.map(row),
  });
}
