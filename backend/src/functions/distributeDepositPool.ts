import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { inStop, stopWindows } from "../finance/commissionStops";

/**
 * POST /api/functions/distributeDepositPool
 * Body: { pool_group_id, period, method? }
 *   period = 'YYYY-Qn' (deposit, quarterly) or 'YYYY-MM' (bonus, monthly)
 *   method = 'deposit' (default) | 'bonus_with' | 'bonus_without'
 *
 * Splits a commission POOL (e.g. the Junior+Senior 2% that accrued over the
 * period) among its members — each paid their OWN share, what their position's %
 * put into it (the user, 2026-11-07: "B, by own share"; it was equal before). Members are the
 * people who held the pooled positions during the period. Marks the pooled
 * accruals as distributed so they can't be paid twice. Admin only.
 * What was written to the pool for a member while Delta finance had their commission counting stopped (2026-11-13)
 * is paid to nobody, the stop resumed since or not; the rest of theirs is their share: see splitPool.
 * (Named "deposit" for backward compat, but works for bonus pools too.)
 */
const ALLOWED = new Set(["super_admin", "admin", "broker_admin", "finance_admin"]);

// Accepts a quarter ('YYYY-Qn') or a month ('YYYY-MM') and returns its [start,end).
export function poolPeriodRange(period: string): { start: Date; end: Date; kind: "quarter" | "month" } | null {
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (q) {
    const y = +q[1];
    const sm = (+q[2] - 1) * 3;
    return { start: new Date(y, sm, 1), end: new Date(y, sm + 3, 1), kind: "quarter" };
  }
  const mo = /^(\d{4})-(\d{2})$/.exec(period);
  if (mo) {
    const y = +mo[1];
    const m = +mo[2] - 1;
    if (m < 0 || m > 11) return null;
    return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1), kind: "month" };
  }
  return null;
}

/** What a split gave: the pool, how many shared it, each one's own share (share_each: the average, for older readers). */
export type PoolSplit = {
  group_id: string; method: string; pool_total: number; members: number; share_each: number; distributed: number; breakdown: Array<{ member: string; member_id: string; share: number }>;
  /** Members with the part of the pool written for each while their commission counting was stopped — paid to nobody (2026-11-13)… */
  stopped?: Array<{ member: string; member_id: string; share: number }>;
  /** …and, when nothing else was left in it, why the pool was not split. */
  reason?: string;
};

/**
 * One pool split: a group's pooled accruals of one method in the period, each person who held a pooled position in it
 * paid their own accruals (their %, not an equal part — 2026-11-07) as their own credit (dated inside the period); the accruals marked
 * distributed, so nothing is split twice. Shared by the Distribute button here and Delta finance's Split (2026-11-07).
 * Nothing pooled: distributed 0. A period still running: refused (`open`).
 * Counting stopped by Delta finance (2026-11-13, finance/commissionStops.ts — "stop counting from now"): an accrual
 * written while its holder was stopped — that stop still open, or resumed since — is paid to nobody: marked
 * distributed with the rest, and `stopped_no_share`. Their accruals from outside a stop are their share, paid like
 * anyone's; everyone else's share is as it would have been. Nothing in the pool but accruals written during a stop: it
 * is left as it is — distributed 0, with the reason.
 * `only` — one member's own share and nothing else: their accruals from outside a stop marked distributed and paid to
 * them as their credit, those written during one marked `stopped_no_share` (they stay in the pool until it is split),
 * every other accrual left pooled for the split to come. For Delta finance approving someone whose counting is stopped
 * (finance/csCommission.ts), so also while the period still runs; what it took is not in the pool any more, so the
 * later split cannot pay it again.
 */
export async function splitPool(groupId: string, method: string, period: string, by: { id: string; name: string }, only?: string): Promise<PoolSplit | { error: string; status: number }> {
  const range = poolPeriodRange(period);
  if (!range) return { error: "Invalid period (expected YYYY-Qn or YYYY-MM)", status: 400 };
  const closingWord = range.kind === "quarter" ? "quarter" : "month";
  if (Date.now() < range.end.getTime() && !only) return { error: `This ${closingWord} is still open — distribute after it ends.`, status: 400 };

  // Pooled accruals for this group + method, in the period, not yet distributed.
  const all = await col("commission_credits")
    .find({ method, is_pool: true, pool_group_id: groupId, status: "pooled" })
    .toArray();
  const pooled = (all as any[]).filter((c) => {
    const d = new Date(c.requested_at || c.created_date);
    return !isNaN(d.getTime()) && d >= range.start && d < range.end;
  });
  const empty: PoolSplit = { group_id: groupId, method, pool_total: 0, members: 0, share_each: 0, distributed: 0, breakdown: [] };
  if (!pooled.length) return empty;

  const total = pooled.reduce((s, c) => s + (c.commission_usd || 0), 0);

  // Members = distinct people who held a pooled position in the period, each with what their own accruals come to —
  // less those written while their counting was stopped (now, or at any time before): those are nobody's.
  const stops = await stopWindows([...new Set(pooled.map((c) => String(c.recipient_id ?? "")).filter(Boolean))]);
  const memberMap = new Map<string, string>();
  const ownOf = new Map<string, number>(), lostOf = new Map<string, number>();
  for (const c of pooled) {
    if (!c.recipient_id) continue;
    memberMap.set(c.recipient_id, c.recipient_name || "—");
    const into = inStop(c, stops) ? lostOf : ownOf;
    into.set(c.recipient_id, (into.get(c.recipient_id) ?? 0) + (c.commission_usd || 0));
  }
  const members = [...memberMap.entries()];
  if (!members.length) return { error: "No pool members found on the accruals", status: 400 };
  // Paid: everyone with something of their own in it — or, asked for one member's share alone, that member.
  const paid = members.filter(([id]) => ownOf.has(id) && (!only || id === only));
  const lost = pooled.filter((c) => c.recipient_id && inStop(c, stops) && (!only || String(c.recipient_id) === only));
  const leftOut = only ? [] : members.filter(([id]) => lostOf.has(id)).map(([id, name]) => ({ member: name, member_id: id, share: lostOf.get(id) ?? 0 }));
  if (!paid.length) {
    return only ? empty : { ...empty, pool_total: total, stopped: leftOut, reason: "All that is left in this pool was added while its members' commission counting was stopped — left unsplit." };
  }

  // Claimed first (2026-11-07): the accruals marked distributed in one step, so two splits at once pay once.
  const ids = (only ? pooled.filter((c) => String(c.recipient_id) === only && !inStop(c, stops)) : pooled).map((c) => c._id).filter(Boolean);
  const now = new Date().toISOString();
  const claimed = await col("commission_credits").updateMany(
    { _id: { $in: ids }, status: "pooled" },
    { $set: { status: "distributed", distributed_at: now, distributed_by_id: by.id, distributed_by_name: by.name } },
  );
  if (claimed.modifiedCount !== ids.length) {
    // Someone else split some of them at the same moment: put back what this one took, and leave it to theirs.
    await col("commission_credits").updateMany(
      { _id: { $in: ids }, status: "distributed", distributed_at: now, distributed_by_id: by.id },
      { $set: { status: "pooled" }, $unset: { distributed_at: "", distributed_by_id: "", distributed_by_name: "" } },
    );
    return { error: "This pool is being split already — look again in a moment.", status: 409 };
  }

  const share = paid.reduce((s, [id]) => s + (ownOf.get(id) ?? 0), 0) / paid.length; // the average of what is paid
  // Date the payout inside the quarter so it shows in that quarter's Deposit report.
  const payoutDate = new Date(range.end.getTime() - 24 * 3600 * 1000).toISOString();
  const groupName = pooled[0].pool_group_name || "";

  const txnType = method === "deposit" ? "DEPOSIT" : "BONUS";
  const bonusType = method === "bonus_with" ? "with" : method === "bonus_without" ? "without" : null;
  const payouts = paid.map(([id, name]) => ({
    transaction_type: txnType,
    method,
    bonus_type: bonusType,
    is_pool: false,
    from_pool: true,
    pool_group_id: groupId,
    pool_group_name: groupName,
    pool_period: period,
    recipient_id: id,
    recipient_name: name,
    percentage: null,
    base_amount: null,
    commission_usd: ownOf.get(id) ?? 0,
    student_name: `Pool payout (${period})`,
    initiator_name: groupName,
    status: "accrued",
    requested_at: payoutDate,
    created_date: now,
    updated_date: now,
    distributed_by_id: by.id,
    distributed_by_name: by.name,
  }));
  try {
    await col("commission_credits").insertMany(payouts as any[]);
  } catch (err) {
    // No shares written: the accruals go back to the pool, to be split again.
    await col("commission_credits").updateMany(
      { _id: { $in: ids }, status: "distributed", distributed_at: now, distributed_by_id: by.id },
      { $set: { status: "pooled" }, $unset: { distributed_at: "", distributed_by_id: "", distributed_by_name: "" } },
    );
    throw err;
  }
  // Why these accruals pay nobody: written while their holder's counting was stopped.
  if (lost.length) await col("commission_credits").updateMany({ _id: { $in: lost.map((c) => c._id) } }, { $set: { stopped_no_share: true } });

  return {
    group_id: groupId,
    method,
    pool_total: total,
    members: paid.length,
    share_each: share,
    distributed: payouts.length,
    breakdown: paid.map(([id, name]) => ({ member: name, member_id: id, share: ownOf.get(id) ?? 0 })),
    ...(leftOut.length ? { stopped: leftOut } : {}),
  };
}

export async function distributeDepositPool(req: Request, user: AuthUser): Promise<Response> {
  if (!ALLOWED.has(user.app_role)) return forbidden("Not allowed to distribute the pool");
  const body: any = await req.json().catch(() => null);
  const groupId = body?.pool_group_id;
  const period = body?.period;
  const method: string = body?.method || "deposit";
  if (!groupId || !period) return error("pool_group_id and period are required", 400);
  if (!["deposit", "bonus_with", "bonus_without"].includes(method)) return error("Invalid method", 400);
  const done = await splitPool(String(groupId), method, String(period), { id: user.id, name: user.full_name ?? "" });
  if ("error" in done) return error(done.error, done.status);
  if (!done.distributed) return json({ ok: true, distributed: 0, reason: done.reason ?? "Nothing pooled for this group/period." });
  return json({
    ok: true,
    pool_total: done.pool_total,
    members: done.members,
    share_each: done.share_each,
    distributed: done.distributed,
    breakdown: done.breakdown,
  });
}
