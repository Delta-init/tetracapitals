import { col } from "../db";
import { json, forbidden } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { progressOf } from "../courses/upgradeCalc";

/* ────────────────────────────────────────────────────────────────────────────
   Course upgradation — a CS's and CS Manager's commission summary on Funding
   Activities (the user, 2026-10-13), in place of the deposit and bonus
   summaries, for a date range (Dubai days):
     Collected          approved course payments (a Bonus request with a course
                        — "Direct from CS portal", by the AED received) and
                        approved course-upgrade payments; never a sales-close
                        bonus; plus what is still waiting approval.
     Commission earned  the bonus commission credited to them in the range.
     Still to collect   today's balance on their students' course plans (the
                        latest payment per student and course) and open
                        upgrades — and what their plan % would pay on it.
   A CS: the requests they raised (upgrades: their students'); a CS Manager:
   every CS's — they are paid on all of them (the user: "your way").
──────────────────────────────────────────────────────────────────────────── */

const AED_PER_USD = 3.67;
const round = (n: number) => Math.round(n * 100) / 100;
const iso = (v: unknown) => { const d = new Date(String(v ?? "")); return v && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };
const SEE_ALL = ["cs_manager", "super_admin", "admin"];

/** What their plan pays them on a bonus: a CS level 1, a CS Manager the "CS Manager" level (else level 2). */
async function myRate(user: AuthUser): Promise<{ pct: number; plan: string }> {
  const u: any = await col("users").findOne({ _id: toObjectId(user.id) as any }, { projection: { commission_plan_id: 1 } });
  const planOid = toObjectId(String(u?.commission_plan_id ?? ""));
  const plan: any = planOid ? await col("commission_plans").findOne({ _id: planOid }) : null;
  const levels: any[] = Array.isArray(plan?.bonus_with_levels) ? plan.bonus_with_levels : [];
  const level = user.app_role === "cs_manager"
    ? levels.find((l) => /cs\s*manager/i.test(String(l.label ?? ""))) ?? levels[1]
    : levels[0];
  return { pct: Number(level?.percentage) || 0, plan: String(plan?.name ?? "") };
}

/**
 * POST /api/functions/getCourseCommissionSummary { from?, to? } (ISO; `to` not included — the page sends Dubai days)
 * → { collected: { aed, usd, course_payments_aed, upgrades_aed, count, pending_aed, pending_count },
 *     commission: { usd, aed, count }, to_collect: { aed, usd, students, commission_usd }, rate: { pct, plan }, scope }
 */
export async function getCourseCommissionSummary(req: Request, user: AuthUser): Promise<Response> {
  if (!["cs", ...SEE_ALL].includes(user.app_role)) return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const from = iso(body?.from), to = iso(body?.to);
  const range = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
  const ranged = Object.keys(range).length > 0;
  const all = SEE_ALL.includes(user.app_role);
  const mine = all ? {} : { $or: [{ initiating_mentor_id: user.id }, { requested_by_id: user.id }] };
  const COURSE = { type: "BONUS", bonus_credit: { $in: [null, ""] }, "course_payment.product": { $exists: true } };

  // Collected: course payments approved in the range, by the AED received.
  const approved = (await col("funding_transactions").find({ ...COURSE, ...mine, status: "APPROVED", ...(ranged ? { approved_at: range } : {}) },
    { projection: { course_payment: 1, amount_aed: 1 } }).toArray()) as any[];
  const aedOf = (t: any) => Number(t.course_payment?.paid_today_aed) || Number(t.amount_aed) || 0;
  const coursePaymentsAed = approved.reduce((s, t) => s + aedOf(t), 0);
  const pending = (await col("funding_transactions").find({ ...COURSE, ...mine, status: "PENDING", ...(ranged ? { requested_at: range } : {}) },
    { projection: { course_payment: 1, amount_aed: 1 } }).toArray()) as any[];

  // …and upgrade payments approved in the range — a CS's students' (recorded by them, or theirs).
  const myStudents = all ? null : ((await col("students").find({ $or: [{ primary_mentor_id: user.id }, { "common_cs.id": user.id }] }, { projection: { _id: 1 } }).toArray()) as any[]).map((s) => String(s._id));
  const upScope = all ? {} : { $or: [{ recorded_by: user.id }, { student_id: { $in: myStudents ?? [] } }] };
  const ups = (await col("course_payments").find({ ...upScope, status: "approved", ...(ranged ? { decided_at: range } : {}) },
    { projection: { amount_aed: 1, approved_amount_aed: 1 } }).toArray()) as any[];
  const upgradesAed = ups.reduce((s, p) => s + (Number(p.approved_amount_aed ?? p.amount_aed) || 0), 0);

  // Commission earned: their bonus commission credited in the range.
  const credits = (await col("commission_credits").find({ recipient_id: user.id, method: { $in: ["bonus_with", "bonus_without"] }, ...(ranged ? { requested_at: range } : {}) },
    { projection: { commission_usd: 1 } }).toArray()) as any[];
  const commissionUsd = credits.reduce((s, c) => s + (Number(c.commission_usd) || 0), 0);

  // Still to collect, today: the latest approved course payment per student and course, and open upgrades.
  const latest = new Map<string, any>();
  for (const t of (await col("funding_transactions").find({ ...COURSE, ...mine, status: "APPROVED" },
    { projection: { student_id: 1, course_payment: 1, approved_at: 1, requested_at: 1 } }).sort({ approved_at: 1, requested_at: 1 }).toArray()) as any[]) {
    latest.set(`${t.student_id}|${t.course_payment?.product}`, t);
  }
  let toCollect = 0;
  const owing = new Set<string>();
  for (const t of latest.values()) {
    const bal = Number(t.course_payment?.balance_aed) || 0;
    if (bal > 0) { toCollect += bal; owing.add(String(t.student_id)); }
  }
  const openUps = (await col("course_upgrades").find({ status: "open", ...(all ? {} : { student_id: { $in: myStudents ?? [] } }) }).toArray()) as any[];
  for (const u of openUps) {
    const paid = ((await col("course_payments").find({ upgrade_id: String(u._id), status: "approved" }, { projection: { amount_aed: 1, approved_amount_aed: 1 } }).toArray()) as any[])
      .map((p) => Number(p.approved_amount_aed ?? p.amount_aed) || 0);
    try {
      const bal = progressOf(u.quote, paid).balanceAed;
      if (bal > 0) { toCollect += bal; owing.add(String(u.student_id)); }
    } catch { /* an upgrade without a quote: nothing to count */ }
  }
  const rate = await myRate(user);
  const toCollectUsd = toCollect / AED_PER_USD;

  const collectedAed = coursePaymentsAed + upgradesAed;
  return json({
    scope: all ? "all" : "own",
    collected: {
      aed: round(collectedAed), usd: round(collectedAed / AED_PER_USD), course_payments_aed: round(coursePaymentsAed), upgrades_aed: round(upgradesAed),
      count: approved.length + ups.length, pending_aed: round(pending.reduce((s, t) => s + aedOf(t), 0)), pending_count: pending.length,
    },
    commission: { usd: round(commissionUsd), aed: round(commissionUsd * AED_PER_USD), count: credits.length },
    to_collect: { aed: round(toCollect), usd: round(toCollectUsd), students: owing.size, commission_usd: round((toCollectUsd * rate.pct) / 100) },
    rate,
  });
}
