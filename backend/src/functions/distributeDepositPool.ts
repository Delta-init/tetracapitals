import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { stoppedNow } from "../finance/commissionStops";

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
 * A member whose commission counting Delta finance has stopped (2026-11-13) gets no share: see splitPool.
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
  /** Members left out because their commission counting is stopped, with what each would have had (2026-11-13)… */
  stopped?: Array<{ member: string; member_id: string; share: number }>;
  /** …and, when that left nobody to pay, why the pool was not split. */
  reason?: string;
};

/**
 * One pool split: a group's pooled accruals of one method in the period, each person who held a pooled position in it
 * paid their own accruals (their %, not an equal part — 2026-11-07) as their own credit (dated inside the period); the accruals marked
 * distributed, so nothing is split twice. Shared by the Distribute button here and Delta finance's Split (2026-11-07).
 * Nothing pooled: distributed 0. A period still running: refused (`open`).
 * Counting stopped by Delta finance (2026-11-13, finance/commissionStops.ts): a member stopped at the moment of the
 * split gets no share — the others are paid their own shares as before, and the stopped member's accruals, marked
 * distributed with the rest (and `stopped_no_share`), are paid to nobody. Every member stopped: the pool is left as it
 * is — distributed 0, with the reason — to be split once someone is counted again.
 */
export async function splitPool(groupId: string, method: string, period: string, by: { id: string; name: string }): Promise<PoolSplit | { error: string; status: number }> {
  const range = poolPeriodRange(period);
  if (!range) return { error: "Invalid period (expected YYYY-Qn or YYYY-MM)", status: 400 };
  const closingWord = range.kind === "quarter" ? "quarter" : "month";
  if (Date.now() < range.end.getTime()) return { error: `This ${closingWord} is still open — distribute after it ends.`, status: 400 };

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

  // Members = distinct people who held a pooled position in the period, each with what their own accruals come to.
  const memberMap = new Map<string, string>();
  const ownOf = new Map<string, number>();
  for (const c of pooled) {
    if (!c.recipient_id) continue;
    memberMap.set(c.recipient_id, c.recipient_name || "—");
    ownOf.set(c.recipient_id, (ownOf.get(c.recipient_id) ?? 0) + (c.commission_usd || 0));
  }
  const members = [...memberMap.entries()];
  if (!members.length) return { error: "No pool members found on the accruals", status: 400 };
  const stopped = await stoppedNow(members.map(([id]) => id));
  const paid = members.filter(([id]) => !stopped.has(id));
  const leftOut = members.filter(([id]) => stopped.has(id)).map(([id, name]) => ({ member: name, member_id: id, share: ownOf.get(id) ?? 0 }));
  if (!paid.length) return { ...empty, pool_total: total, stopped: leftOut, reason: "Everyone in this pool has their commission counting stopped — left unsplit." };

  // Claimed first (2026-11-07): the accruals marked distributed in one step, so two splits at once pay once.
  const ids = pooled.map((c) => c._id).filter(Boolean);
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
  // Why these accruals paid nobody: their holder's counting was stopped.
  if (leftOut.length) await col("commission_credits").updateMany({ _id: { $in: ids }, recipient_id: { $in: leftOut.map((m) => m.member_id) } }, { $set: { stopped_no_share: true } });

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
