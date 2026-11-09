import { col } from "../db";
import { json, forbidden } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { isMentorRole } from "../lib/roles";
import { visibleMentorIds } from "../students/followups";
import { csManagerReach } from "../lib/userLocation";

/* ────────────────────────────────────────────────────────────────────────────
   Course upgradation — a CS's and CS Manager's commission summary on Funding
   Activities (the user, 2026-10-13), in place of the deposit and bonus
   summaries, for a date range (Dubai days):
     Collected          approved course payments (a Bonus request with a course
                        — "Direct from CS portal", by the AED received); never a
                        sales-close bonus or a course upgrade (hidden, the user
                        2026-10-13); plus what is still waiting approval.
     Commission earned  the bonus commission credited to them in the range.
     Still to collect   today's balance on their students' course plans (the
                        latest payment per student and course) — and what their
                        plan % would pay on it.
   A CS: the requests they raised; a CS Manager:
   every CS's — they are paid on all of them (the user: "your way").
   Mentors too (the user, 2026-10-14), above their deposit and bonus
   commission: those they raised or for their students; a Chief Mentor their
   team's.
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
    : user.app_role === "chief_mentor"
      ? levels.find((l) => /chief/i.test(String(l.label ?? ""))) ?? levels[0]
      : levels[0];
  return { pct: Number(level?.percentage) || 0, plan: String(plan?.name ?? "") };
}

/**
 * POST /api/functions/getCourseCommissionSummary { from?, to? } (ISO; `to` not included — the page sends Dubai days)
 * → { collected: { aed, usd, course_payments_aed, count, pending_aed, pending_count },
 *     commission: { usd, aed, count }, to_collect: { aed, usd, students, commission_usd }, rate: { pct, plan }, scope,
 *     members?: [{ id, name, role, collected_aed, count, pending_aed, pending_count, to_collect_aed, to_collect_students, payments }] }
 *   (members: a mentor's or Chief's team, each person's share of the same figures)
 */
export async function getCourseCommissionSummary(req: Request, user: AuthUser): Promise<Response> {
  if (!SEE_ALL.includes(user.app_role) && !isMentorRole(user.app_role)) return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const from = iso(body?.from), to = iso(body?.to);
  const range = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
  const ranged = Object.keys(range).length > 0;
  // A CS Manager: every CS in their own location (2026-10-14) — not the other location's.
  const reach = await csManagerReach(user);
  const all = !reach && SEE_ALL.includes(user.app_role);
  // A mentor (not a CS): theirs and their students' — a Chief Mentor their whole team's.
  const ids = reach ? reach.ids : all || user.app_role === "cs" ? [user.id] : [...((await visibleMentorIds(user)) ?? new Set([user.id]))];
  const mine = all ? {} : user.app_role === "cs"
    ? { $or: [{ initiating_mentor_id: user.id }, { requested_by_id: user.id }] }
    : { $or: [{ initiating_mentor_id: { $in: ids } }, { requested_by_id: { $in: ids } }, { primary_mentor_id: { $in: ids } }] };
  const COURSE = { type: "BONUS", bonus_credit: { $in: [null, ""] }, "course_payment.product": { $exists: true } };

  // Collected: course payments approved in the range, by the AED received.
  const approved = (await col("funding_transactions").find({ ...COURSE, ...mine, status: "APPROVED", ...(ranged ? { approved_at: range } : {}) },
    { projection: { course_payment: 1, amount_aed: 1, student_id: 1, student_name: 1, requested_by_id: 1, initiating_mentor_id: 1, primary_mentor_id: 1, approved_at: 1, requested_at: 1 } }).toArray()) as any[];
  const aedOf = (t: any) => Number(t.course_payment?.paid_today_aed) || Number(t.amount_aed) || 0;
  const coursePaymentsAed = approved.reduce((s, t) => s + aedOf(t), 0);
  const pending = (await col("funding_transactions").find({ ...COURSE, ...mine, status: "PENDING", ...(ranged ? { requested_at: range } : {}) },
    { projection: { course_payment: 1, amount_aed: 1, student_id: 1, student_name: 1, requested_by_id: 1, initiating_mentor_id: 1, primary_mentor_id: 1, requested_at: 1 } }).toArray()) as any[];

  // Upgrades are left out of this summary (the user, 2026-10-13: "hide it") — course payments only.

  // Commission earned: their bonus commission credited in the range.
  const credits = (await col("commission_credits").find({ recipient_id: user.id, method: { $in: ["bonus_with", "bonus_without"] }, ...(ranged ? { requested_at: range } : {}) },
    { projection: { commission_usd: 1 } }).toArray()) as any[];
  const commissionUsd = credits.reduce((s, c) => s + (Number(c.commission_usd) || 0), 0);

  // Still to collect, today: the latest approved course payment per student and course.
  const latest = new Map<string, any>();
  for (const t of (await col("funding_transactions").find({ ...COURSE, ...mine, status: "APPROVED" },
    { projection: { student_id: 1, course_payment: 1, approved_at: 1, requested_at: 1, requested_by_id: 1, initiating_mentor_id: 1, primary_mentor_id: 1 } }).sort({ approved_at: 1, requested_at: 1 }).toArray()) as any[]) {
    latest.set(`${t.student_id}|${t.course_payment?.product}`, t);
  }
  let toCollect = 0;
  const owing = new Set<string>();
  for (const t of latest.values()) {
    const bal = Number(t.course_payment?.balance_aed) || 0;
    if (bal > 0) { toCollect += bal; owing.add(String(t.student_id)); }
  }
  const rate = await myRate(user);
  const toCollectUsd = toCollect / AED_PER_USD;

  // A team (a mentor's or Chief's, 2026-11-09): the same figures for each person on it — a payment counts for whoever
  // raised it, else the student's CS (the first of them on the team).
  let members: any[] | undefined;
  if (!all && !reach && ids.length > 1) {
    const team = new Set(ids);
    const whoOf = (t: any) => [t.requested_by_id, t.initiating_mentor_id, t.primary_mentor_id].map((x) => String(x ?? "")).find((x) => team.has(x)) ?? "";
    const by = new Map<string, any>();
    const row = (id: string) => {
      if (!by.has(id)) by.set(id, { id, collected_aed: 0, count: 0, pending_aed: 0, pending_count: 0, to_collect_aed: 0, owing: new Set<string>(), payments: [] as any[] });
      return by.get(id);
    };
    for (const t of approved) {
      const m = row(whoOf(t)); m.collected_aed += aedOf(t); m.count++;
      m.payments.push({ id: String(t._id), student_id: t.student_id, student_name: t.student_name ?? "", product: t.course_payment?.product ?? "", aed: round(aedOf(t)), at: iso(t.approved_at) ?? iso(t.requested_at), status: "APPROVED" });
    }
    for (const t of pending) {
      const m = row(whoOf(t)); m.pending_aed += aedOf(t); m.pending_count++;
      m.payments.push({ id: String(t._id), student_id: t.student_id, student_name: t.student_name ?? "", product: t.course_payment?.product ?? "", aed: round(aedOf(t)), at: iso(t.requested_at), status: "PENDING" });
    }
    for (const t of latest.values()) {
      const bal = Number(t.course_payment?.balance_aed) || 0;
      if (bal > 0) { const m = row(whoOf(t)); m.to_collect_aed += bal; m.owing.add(String(t.student_id)); }
    }
    const people = (await col("users").find({ _id: { $in: ids.map((i) => toObjectId(i)).filter(Boolean) as any[] } }, { projection: { full_name: 1, email: 1, app_role: 1 } }).toArray()) as any[];
    // "" = a payment for nobody on the team (none, as `mine` filters).
    for (const id of ids) row(id);
    members = [...by.values()].filter((m) => m.id).map((m) => {
      const u = people.find((p) => String(p._id) === m.id);
      return {
        id: m.id, name: u?.full_name || u?.email || "—", role: u?.app_role ?? "",
        collected_aed: round(m.collected_aed), count: m.count, pending_aed: round(m.pending_aed), pending_count: m.pending_count,
        to_collect_aed: round(m.to_collect_aed), to_collect_students: m.owing.size,
        payments: m.payments.sort((a: any, b: any) => String(b.at ?? "").localeCompare(String(a.at ?? ""))),
      };
    // Every CS on the team, those with nothing too; a mentor / manager only with something of their own.
    }).filter((m) => m.role === "cs" || m.collected_aed || m.pending_aed || m.to_collect_aed).sort((a, b) => b.collected_aed - a.collected_aed || b.pending_aed - a.pending_aed || b.to_collect_aed - a.to_collect_aed || a.name.localeCompare(b.name));
  }

  const collectedAed = coursePaymentsAed;
  return json({
    ...(members ? { members } : {}),
    scope: all ? "all" : ids.length > 1 ? "team" : "own",
    collected: {
      aed: round(collectedAed), usd: round(collectedAed / AED_PER_USD), course_payments_aed: round(coursePaymentsAed),
      count: approved.length, pending_aed: round(pending.reduce((s, t) => s + aedOf(t), 0)), pending_count: pending.length,
    },
    commission: { usd: round(commissionUsd), aed: round(commissionUsd * AED_PER_USD), count: credits.length },
    to_collect: { aed: round(toCollect), usd: round(toCollectUsd), students: owing.size, commission_usd: round((toCollectUsd * rate.pct) / 100) },
    rate,
  });
}
