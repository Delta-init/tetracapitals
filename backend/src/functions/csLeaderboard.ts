import { col } from "../db";
import { json, forbidden } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { loadTeams } from "../students/teams";
import { seesClosedOnly } from "../students/closedBy";

/* ────────────────────────────────────────────────────────────────────────────
   The leaderboard (the user, 2026-10-13): CSs only — no mentors — ranked by
   the course payments they collected (approved, by the AED the student paid;
   never a sales close) in the period, with how many and the commission they
   earned; filtered by team; and the teams ranked the same way, their CSs
   added up. Everyone who sees the page sees it all.
──────────────────────────────────────────────────────────────────────────── */

const AED_PER_USD = 3.67;
const round = (n: number) => Math.round(n * 100) / 100;
const iso = (v: unknown) => { const d = new Date(String(v ?? "")); return v && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };

/**
 * POST /api/functions/getCsLeaderboard { from?, to? } (ISO; `to` not included)
 * → { cs: [{ id, name, team_id, team, location, collected_aed, payments, commission_aed, rank }], teams: [{ id, team, location, collected_aed, payments, commission_aed, cs_count, rank }] }
 */
export async function getCsLeaderboard(req: Request, user: AuthUser): Promise<Response> {
  if (await seesClosedOnly(user)) return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const from = iso(body?.from), to = iso(body?.to);
  const range = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
  const ranged = Object.keys(range).length > 0;

  const index = await loadTeams();
  const people = (await col("users").find({ app_role: "cs", status: { $ne: "inactive" } }, { projection: { full_name: 1 } }).toArray()) as any[];
  const row = new Map(people.map((u) => {
    const team = index.teamOf(String(u._id));
    return [String(u._id), { id: String(u._id), name: String(u.full_name ?? "").trim(), team_id: team?.id ?? "", team: team?.name ?? "No team", location: team?.location ?? "dubai", collected_aed: 0, payments: 0, commission_aed: 0 }];
  }));

  // Approved course payments, by whoever raised them (the CS the request counts as).
  const txs = (await col("funding_transactions").find({
    type: "BONUS", status: "APPROVED", bonus_credit: { $in: [null, ""] }, "course_payment.product": { $exists: true }, ...(ranged ? { approved_at: range } : {}),
  }, { projection: { initiating_mentor_id: 1, requested_by_id: 1, course_payment: 1, amount_aed: 1 } }).toArray()) as any[];
  for (const t of txs) {
    const r = row.get(String(t.initiating_mentor_id || t.requested_by_id || ""));
    if (!r) continue;
    r.collected_aed += Number(t.course_payment?.paid_today_aed) || Number(t.amount_aed) || 0;
    r.payments += 1;
  }
  // Their bonus commission credited in the period.
  const credits = (await col("commission_credits").find({
    recipient_id: { $in: [...row.keys()] }, method: { $in: ["bonus_with", "bonus_without"] }, ...(ranged ? { requested_at: range } : {}),
  }, { projection: { recipient_id: 1, commission_usd: 1 } }).toArray()) as any[];
  for (const c of credits) { const r = row.get(String(c.recipient_id)); if (r) r.commission_aed += (Number(c.commission_usd) || 0) * AED_PER_USD; }

  const rank = <T extends { collected_aed: number; payments: number }>(list: T[]) =>
    list.sort((a, b) => b.collected_aed - a.collected_aed || b.payments - a.payments).map((x, i) => ({ ...x, rank: i + 1 }));
  const cs = rank([...row.values()].map((r) => ({ ...r, collected_aed: round(r.collected_aed), commission_aed: round(r.commission_aed) })));

  const teams = new Map<string, any>();
  for (const r of cs) {
    const k = r.team_id || "-";
    const t = teams.get(k) ?? { id: r.team_id, team: r.team, location: r.location, collected_aed: 0, payments: 0, commission_aed: 0, cs_count: 0 };
    t.collected_aed += r.collected_aed; t.payments += r.payments; t.commission_aed += r.commission_aed; t.cs_count += 1;
    teams.set(k, t);
  }
  return json({ cs, teams: rank([...teams.values()].map((t) => ({ ...t, collected_aed: round(t.collected_aed), commission_aed: round(t.commission_aed) }))) });
}
