import { col } from "../db";
import { json, error } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";

/**
 * POST /api/functions/creditCommission
 * Body: { transaction_id }
 *
 * On approval of a BONUS (or DEPOSIT) transaction, reads the INITIATOR's assigned
 * commission plan and walks up the Up Head chain, writing one commission_credits
 * row per level of that method:
 *   Level 1 = the initiator, Level 2 = their Up Head, Level 3 = the next up, …
 * Each method has its OWN level list, so e.g. Deposit can pay only Level 1 while
 * Bonus pays 3 levels. Idempotent.
 */
export async function creditCommission(req: Request, _user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => null);
  const txId: string | undefined = body?.transaction_id;
  if (!txId) return error("transaction_id required", 400);
  if (!toObjectId(txId)) return error("Invalid transaction_id", 400);
  const result = await creditCommissionFor(txId);
  if (!result) return error("Transaction not found", 404);
  return json(result);
}

/**
 * The same, called by the server itself — a deposit approved in Delta finance
 * is credited when the decision arrives (finance/funding.ts), with nobody's
 * browser involved. Null when there is no such transaction.
 */
export async function creditCommissionFor(txId: string): Promise<Record<string, unknown> | null> {
  const oid = toObjectId(txId);
  if (!oid) return null;

  const tx: any = await col("funding_transactions").findOne({ _id: oid });
  if (!tx) return null;
  if (!["BONUS", "DEPOSIT", "WITHDRAWAL"].includes(tx.type) || tx.status !== "APPROVED") {
    return { ok: true, skipped: true, reason: "Not an approved bonus/deposit/withdrawal" };
  }

  // A sales-close bonus credit (raised with the student's MT5 from a call log, studentFollowups.ts): credited in MT5,
  // earning nobody commission (the user, 2026-10-04).
  if (tx.bonus_credit) return { ok: true, skipped: true, reason: "A bonus credit only — no commission" };

  // Idempotency: never double-credit the same transaction.
  const already = await col("commission_credits").countDocuments({ transaction_id: txId });
  if (already > 0) return { ok: true, skipped: true, reason: "Already credited", count: already };

  // Which method? Bonus type comes from the tag.
  let methodKey: "bonus_with" | "bonus_without" | "deposit" = "deposit";
  let bonusType: string | null = null;
  const tagName: string | null = Array.isArray(tx.tags) && tx.tags.length ? tx.tags[0] : null;
  if (tx.type === "BONUS") {
    bonusType = "with";
    if (tagName) {
      const tag: any = await col("transaction_tags").findOne({ name: tagName });
      if (tag?.bonus_type) bonusType = tag.bonus_type;
    }
    methodKey = bonusType === "without" ? "bonus_without" : "bonus_with";
  }
  // A WITHDRAWAL deducts from deposit commission at the same deposit % (negative).
  const sign = tx.type === "WITHDRAWAL" ? -1 : 1;

  // The plan is the INITIATOR's assigned plan.
  const startId: string | null = tx.initiating_mentor_id || tx.primary_mentor_id || null;
  const startOid = startId ? toObjectId(startId) : null;
  const initiator: any = startOid ? await col("users").findOne({ _id: startOid }, { projection: { password_hash: 0 } }) : null;
  if (!initiator) return { ok: true, skipped: true, reason: "No initiating staff on transaction" };
  if (!initiator.commission_plan_id) {
    return { ok: true, skipped: true, reason: "Initiator has no commission plan assigned" };
  }
  const planOid = toObjectId(initiator.commission_plan_id);
  const plan: any = planOid ? await col("commission_plans").findOne({ _id: planOid, active: { $ne: false } }) : null;
  if (!plan) return { ok: true, skipped: true, reason: "Assigned plan not found or inactive" };

  // Resolve this method's levels (new per-method arrays; fall back to the legacy
  // single `levels` array with three % columns).
  const legacyPct = `${methodKey}_pct`; // e.g. bonus_with_pct
  let levels: any[] = Array.isArray(plan[`${methodKey}_levels`]) ? plan[`${methodKey}_levels`] : [];
  if (!levels.length && Array.isArray(plan.levels)) {
    levels = plan.levels.map((l: any, i: number) => ({ level: i + 1, percentage: l[legacyPct] ?? 0 }));
  }
  if (!levels.length) {
    return { ok: true, skipped: true, reason: `Plan has no levels configured for ${methodKey}` };
  }

  // Who holds each level. A plan whose positions are all named by role (CS, CS Manager, Junior, Senior, Chief) pays
  // each level to the person of that role above the initiator — a team without a Junior pays that level to nobody,
  // and a Chief straight above a CS gets the Chief's % (the user, 2026-10-08). A CS Manager over every team
  // (lib/scope isAllTeamsCsManager) holds a CS's CS Manager level when their own line has none. Level 1 is always
  // the initiator. A plan with any other position names keeps the old rule: Level 2 = their Up Head, and so on.
  const line: any[] = [initiator];
  const seen = new Set<string>([initiator._id.toString()]);
  let curId: string | null = initiator.up_head_id || null;
  while (curId && !seen.has(curId) && line.length < 20) {
    seen.add(curId);
    const cur = toObjectId(curId);
    const u: any = cur ? await col("users").findOne({ _id: cur }, { projection: { password_hash: 0 } }) : null;
    if (!u) break;
    line.push(u);
    curId = u.up_head_id || null;
  }
  const roles = levels.map((l: any) => roleOfPosition(l?.label));
  const byRole = levels.length > 1 && roles.slice(1).every(Boolean);
  let chain: any[];
  if (byRole) {
    const above = line.slice(1);
    if (!above.some((u) => u.app_role === "cs_manager")) {
      const overAll: any = await col("users").findOne({ app_role: "cs_manager", all_teams_cs_manager: true, status: { $ne: "inactive" } }, { projection: { password_hash: 0 } });
      if (overAll && !seen.has(overAll._id.toString())) above.unshift(overAll);
    }
    const taken = new Set<string>();
    chain = roles.map((role: string | null, i: number) => {
      if (i === 0) return initiator;
      const u = above.find((x) => x.app_role === role && !taken.has(x._id.toString()));
      if (u) taken.add(u._id.toString());
      return u ?? null;
    });
  } else {
    chain = line.slice(0, levels.length);
  }

  const amount = tx.amount_usd || 0;

  // Per-student $25k net-deposit cap for DEPOSIT commission (matches the old
  // MAX_CAP). We credit this transaction on the DELTA of the student's CAPPED
  // net deposit — i.e. how much clamp(net, 0, 25k) moves because of it. Summed
  // across all of a student's deposits/withdrawals this telescopes to exactly
  // min(totalNetDeposit, 25k) floored at 0, so deposits past $25k earn nothing
  // and a later withdrawal correctly claws back only what was actually earned.
  // BONUS is unaffected — the cap is deposit-only.
  const DEPOSIT_CAP = 25_000;
  let commissionBase = sign * amount; // bonus / default: full amount, no cap
  if (methodKey === "deposit" && tx.student_id) {
    const others = await col("funding_transactions")
      .find({ student_id: tx.student_id, status: "APPROVED", type: { $in: ["DEPOSIT", "WITHDRAWAL"] }, _id: { $ne: oid } })
      .toArray();
    let priorNet = 0;
    for (const o of others as any[]) priorNet += (o.type === "DEPOSIT" ? 1 : -1) * (o.amount_usd || 0);
    const delta = (tx.type === "DEPOSIT" ? 1 : -1) * amount;
    const clamp = (v: number) => Math.max(0, Math.min(v, DEPOSIT_CAP));
    commissionBase = clamp(priorNet + delta) - clamp(priorNet);
  }

  const studentOid = tx.student_id ? toObjectId(tx.student_id) : null;
  const student: any = studentOid ? await col("students").findOne({ _id: studentOid }, { projection: { email: 1 } }) : null;
  const studentEmail = student?.email || null;
  const txnId = tx.transaction_id || null; // the human transaction id set at approval
  const now = new Date().toISOString();
  // The pool "group" anchor is the top-most person in the chain (typically the
  // Chief). Pool-flagged deposit positions accrue to this group's shared pool
  // instead of paying the individual per transaction; it's split at closing.
  const topOfChain = (byRole ? line.find((u) => u.app_role === "chief_mentor") ?? line[line.length - 1] : chain[chain.length - 1]) || null;
  const credits: any[] = [];
  for (let i = 0; i < levels.length; i++) {
    const recipient = chain[i];
    if (!recipient) continue; // no one at this level in the chain
    const pct = levels[i]?.percentage || 0;
    // Any method's position can be flagged Pool: its % accrues to a shared pool
    // (anchored on the top of the chain) instead of paying the individual, and is
    // split among pool members at closing (bonus monthly, deposit quarterly).
    const isPool = !!levels[i]?.pool;
    const base: any = {
      transaction_id: txId,
      transaction_type: tx.type,
      plan_id: plan._id.toString(),
      plan_name: plan.name,
      method: methodKey,
      bonus_type: bonusType,
      tag: tagName,
      level: i + 1,
      position: levels[i]?.label || null,
      percentage: pct,
      base_amount: commissionBase,   // capped commissionable base (deposit); full amount for bonus
      full_amount: amount,           // the raw transaction amount, for reference
      commission_usd: commissionBase * (pct / 100),
      student_id: tx.student_id,
      student_name: tx.student_name,
      student_email: studentEmail,
      txn_id: txnId,
      initiator_id: startId,
      initiator_name: tx.initiating_mentor_name || tx.primary_mentor_name,
      requested_at: tx.requested_at,
      created_date: now,
      updated_date: now,
    };
    if (isPool) {
      // Shared pool accrual — not paid to the individual until distributed at
      // closing. We keep who HELD the position (recipient_id) so the pool's
      // members are known, but is_pool excludes it from individual reports.
      credits.push({
        ...base,
        is_pool: true,
        pool_group_id: (topOfChain || recipient)._id.toString(),
        // Named after the top-of-chain (the Chief) so closing pages read e.g.
        // "Henry SEN/JUN POOL" — the shared Junior+Senior pool under that Chief.
        pool_group_name: `${(topOfChain || recipient).full_name} SEN/JUN POOL`,
        recipient_id: recipient._id.toString(),
        recipient_name: recipient.full_name,
        status: "pooled",
      });
    } else {
      credits.push({
        ...base,
        is_pool: false,
        recipient_id: recipient._id.toString(),
        recipient_name: recipient.full_name,
        status: "accrued",
      });
    }
  }

  if (credits.length) await col("commission_credits").insertMany(credits as any[]);
  return {
    ok: true,
    credited: credits.length,
    plan: plan.name,
    method: methodKey,
    breakdown: credits.map((c) => ({ level: c.level, recipient: c.recipient_name, pct: c.percentage, amount: c.commission_usd })),
  };
}

/** The role a plan position is named for — "CS Manager" → cs_manager, "Junior" → junior_mentor … — or null. */
export function roleOfPosition(label: unknown): string | null {
  const l = String(label ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (!l) return null;
  if (/^cs manager$|^cs mgr$|^customer success manager$/.test(l)) return "cs_manager";
  if (/^cs$|^cs staff$|^customer success$/.test(l)) return "cs";
  if (/sub ?junior/.test(l)) return "subjunior_mentor";
  if (/junior/.test(l)) return "junior_mentor";
  if (/senior/.test(l)) return "senior_mentor";
  if (/chief/.test(l)) return "chief_mentor";
  return null;
}
