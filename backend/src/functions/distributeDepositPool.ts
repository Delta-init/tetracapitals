import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";

/**
 * POST /api/functions/distributeDepositPool
 * Body: { pool_group_id, period, method? }
 *   period = 'YYYY-Qn' (deposit, quarterly) or 'YYYY-MM' (bonus, monthly)
 *   method = 'deposit' (default) | 'bonus_with' | 'bonus_without'
 *
 * Splits a commission POOL (e.g. the Junior+Senior 2% that accrued over the
 * period) EQUALLY among its members and pays each their share. Members are the
 * people who held the pooled positions during the period. Marks the pooled
 * accruals as distributed so they can't be paid twice. Admin only.
 * (Named "deposit" for backward compat, but works for bonus pools too.)
 */
const ALLOWED = new Set(["super_admin", "admin", "broker_admin", "finance_admin"]);

// Accepts a quarter ('YYYY-Qn') or a month ('YYYY-MM') and returns its [start,end).
function periodRange(period: string): { start: Date; end: Date; kind: "quarter" | "month" } | null {
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

export async function distributeDepositPool(req: Request, user: AuthUser): Promise<Response> {
  if (!ALLOWED.has(user.app_role)) return forbidden("Not allowed to distribute the pool");
  const body: any = await req.json().catch(() => null);
  const groupId = body?.pool_group_id;
  const period = body?.period;
  const method: string = body?.method || "deposit";
  if (!groupId || !period) return error("pool_group_id and period are required", 400);
  if (!["deposit", "bonus_with", "bonus_without"].includes(method)) return error("Invalid method", 400);
  const range = periodRange(period);
  if (!range) return error("Invalid period (expected YYYY-Qn or YYYY-MM)", 400);
  const closingWord = range.kind === "quarter" ? "quarter" : "month";
  if (Date.now() < range.end.getTime()) return error(`This ${closingWord} is still open — distribute after it ends.`, 400);

  // Pooled accruals for this group + method, in the period, not yet distributed.
  const all = await col("commission_credits")
    .find({ method, is_pool: true, pool_group_id: groupId, status: "pooled" })
    .toArray();
  const pooled = (all as any[]).filter((c) => {
    const d = new Date(c.requested_at || c.created_date);
    return !isNaN(d.getTime()) && d >= range.start && d < range.end;
  });
  if (!pooled.length) return json({ ok: true, distributed: 0, reason: "Nothing pooled for this group/period." });

  const total = pooled.reduce((s, c) => s + (c.commission_usd || 0), 0);

  // Members = distinct people who held a pooled position in the quarter.
  const memberMap = new Map<string, string>();
  for (const c of pooled) if (c.recipient_id) memberMap.set(c.recipient_id, c.recipient_name || "—");
  const members = [...memberMap.entries()];
  if (!members.length) return error("No pool members found on the accruals", 400);

  const share = total / members.length;
  const now = new Date().toISOString();
  // Date the payout inside the quarter so it shows in that quarter's Deposit report.
  const payoutDate = new Date(range.end.getTime() - 24 * 3600 * 1000).toISOString();
  const groupName = pooled[0].pool_group_name || "";

  const txnType = method === "deposit" ? "DEPOSIT" : "BONUS";
  const bonusType = method === "bonus_with" ? "with" : method === "bonus_without" ? "without" : null;
  const payouts = members.map(([id, name]) => ({
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
    commission_usd: share,
    student_name: `Pool payout (${period})`,
    initiator_name: groupName,
    status: "accrued",
    requested_at: payoutDate,
    created_date: now,
    updated_date: now,
    distributed_by_id: user.id,
    distributed_by_name: user.full_name,
  }));
  await col("commission_credits").insertMany(payouts as any[]);

  // Mark the accruals distributed.
  const ids = pooled.map((c) => c._id).filter(Boolean);
  await col("commission_credits").updateMany(
    { _id: { $in: ids } },
    { $set: { status: "distributed", distributed_at: now, distributed_by_id: user.id, distributed_by_name: user.full_name } },
  );

  return json({
    ok: true,
    pool_total: total,
    members: members.length,
    share_each: share,
    distributed: payouts.length,
    breakdown: members.map(([, name]) => ({ member: name, share })),
  });
}
