import { col } from "../db";
import { json, error } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { locationOfUser } from "../lib/userLocation";
import { stoppedNow } from "../finance/commissionStops";

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
 * Someone whose commission counting Delta finance has stopped (2026-11-13) is credited nothing: see creditCommissionFor.
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

/** How long a claim to credit a transaction holds before another run may take it (creditCommissionFor). */
const CLAIM_MS = 10 * 60_000;

/**
 * The same, called by the server itself — a deposit approved in Delta finance
 * is credited when the decision arrives (finance/funding.ts), with nobody's
 * browser involved. Null when there is no such transaction.
 */
export async function creditCommissionFor(txId: string, opts: { preview?: boolean } = {}): Promise<Record<string, unknown> | null> {
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
  // A preview (scripts/backfill-commission-by-role.ts) works the credits out without writing them.
  const already = opts.preview ? 0 : await col("commission_credits").countDocuments({ transaction_id: txId });
  if (already > 0) return { ok: true, skipped: true, reason: "Already credited", count: already };
  // Credited already, while everyone it pays had their commission counting stopped (2026-11-13, below): nothing was
  // written then, and nothing is on a later run — what a stop leaves out is not made up once it is lifted.
  if (!opts.preview && Array.isArray(tx.commission_stopped) && tx.commission_stopped.length) return { ok: true, skipped: true, reason: "Already credited — commission counting was stopped", count: 0 };
  // Claimed first (2026-10-23): two approvals arriving together each counted none and both credited. A claim older
  // than CLAIM_MS with nothing credited (a run that died) may be taken again.
  if (!opts.preview) {
    const claimedAt = new Date().toISOString();
    const claim = await col("funding_transactions").updateOne(
      { _id: oid, $or: [{ commission_claimed_at: { $exists: false } }, { commission_claimed_at: { $lt: new Date(Date.now() - CLAIM_MS).toISOString() } }] } as any,
      { $set: { commission_claimed_at: claimedAt } },
    );
    if (claim.modifiedCount !== 1) return { ok: true, skipped: true, reason: "Being credited already" };
    const meanwhile = await col("commission_credits").countDocuments({ transaction_id: txId });
    if (meanwhile > 0) return { ok: true, skipped: true, reason: "Already credited", count: meanwhile };
  }

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
  // each level by the TEAM the initiator is on — everyone under the same Chief, as the Teams page shows it (the user,
  // 2026-10-08): the Chief's % to the Chief, the Junior and Senior levels to the team's Junior and Senior Mentors
  // (shared equally when there are several), the CS Manager level to the team's CS Manager or else the one over every
  // team (lib/scope isAllTeamsCsManager). A role nobody holds pays nobody. Level 1 is always the initiator.
  // A plan with any other position names keeps the old rule: Level 2 = their Up Head, and so on.
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
  const teamChief: any = byRole ? line.find((u) => u.app_role === "chief_mentor") ?? null : null;
  let chain: any[][];
  if (byRole) {
    const staff = (await col("users").find({ status: { $ne: "inactive" } }, { projection: { password_hash: 0 } }).toArray()) as any[];
    const byId = new Map(staff.map((u) => [u._id.toString(), u]));
    const chiefOf = (u: any): string | null => {
      let c = u; const been = new Set<string>();
      while (c && !been.has(c._id.toString())) {
        if (c.app_role === "chief_mentor") return c._id.toString();
        been.add(c._id.toString());
        c = c.up_head_id ? byId.get(String(c.up_head_id)) : null;
      }
      return null;
    };
    const me = initiator._id.toString();
    const team = teamChief ? staff.filter((u) => u._id.toString() !== me && !u.all_teams_cs_manager && chiefOf(u) === teamChief._id.toString()) : line.slice(1);
    // The CS Manager over every team: only for their own location's CSs (the user, 2026-10-14 — Doney Dubai's, not Bangalore's).
    let overAll = staff.find((u) => u.app_role === "cs_manager" && u.all_teams_cs_manager === true);
    if (overAll && (await locationOfUser(overAll._id.toString())) !== (await locationOfUser(me))) overAll = undefined;
    chain = roles.map((role: string | null, i: number) => {
      if (i === 0) return [initiator];
      if (role === "chief_mentor") return teamChief ? [teamChief] : [];
      const held = team.filter((u) => u.app_role === role);
      if (!held.length && role === "cs_manager" && overAll && overAll._id.toString() !== me) return [overAll];
      return held;
    });
  } else {
    chain = line.slice(0, levels.length).map((u) => [u]);
  }

  // A bonus on a plan paid by role (the user, 2026-11-09): the Junior / Senior levels no longer go to the pool — the
  // mentor who first held a meeting with the student, before this payment, gets their % (the levels' sum, 2%; or the
  // plan's meeting_mentor_pct) as their own commission, on every payment, partial ones too. Nobody met the student:
  // no mentor is paid. A Chief's own meeting adds nothing to their Chief %. CS, CS Manager and Chief: as before.
  let meeting: { mentor: any; outcome: any; pct: number } | null = null;
  if (byRole && tx.type === "BONUS") {
    const mentorLevels = roles.map((r: string | null, i: number) => (r && MEETING_MENTOR_ROLES.has(r) ? i : -1)).filter((i: number) => i >= 0);
    if (mentorLevels.length) {
      const set = plan.meeting_mentor_pct;
      const pct = set !== null && set !== undefined && set !== "" && Number.isFinite(Number(set))
        ? Number(set) : mentorLevels.reduce((sum: number, i: number) => sum + (Number(levels[i]?.percentage) || 0), 0);
      for (const i of mentorLevels) chain[i] = [];
      // Who held it, as the request says (required since 2026-11-09): the mentor picked, or None — nobody. A request
      // from before that names nobody: the Mentor Calendar's meetings.
      const found = tx.meeting_mentor_none === true ? null
        : tx.meeting_mentor_id ? await meetingMentorPicked(String(tx.meeting_mentor_id))
        : tx.student_id ? await meetingMentorFor(String(tx.student_id), String(tx.requested_at || tx.approved_at || new Date().toISOString())) : null;
      if (found && pct > 0) meeting = { ...found, pct };
    }
  }

  // A course payment (a Bonus request with a course): on the AED the student paid, at 3.67 — not a USD the CS typed
  // or converted (the user, 2026-10-13: "2% of the AED"). Everything else: its USD amount.
  const paidAed = tx.type === "BONUS" ? Number(tx.course_payment?.paid_today_aed) || 0 : 0;
  const amount = paidAed > 0 ? Math.round((paidAed / 3.67) * 100) / 100 : tx.amount_usd || 0;

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
  const topOfChain = (byRole ? teamChief ?? line[line.length - 1] : chain[chain.length - 1]?.[0]) || null;
  const credits: any[] = [];
  for (let i = 0; i < levels.length; i++) {
    const holders = chain[i] ?? [];   // nobody at this level: it pays nobody
    for (const recipient of holders) {
    // Several holders (two Senior Mentors on the team) share the level's % equally.
    const pct = (levels[i]?.percentage || 0) / holders.length;
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
  }

  if (meeting) {
    const m = meeting.mentor;
    credits.push({
      transaction_id: txId, transaction_type: tx.type, plan_id: plan._id.toString(), plan_name: plan.name, method: methodKey,
      bonus_type: bonusType, tag: tagName, level: levels.length + 1, position: "Meeting mentor", percentage: meeting.pct,
      base_amount: commissionBase, full_amount: amount, commission_usd: commissionBase * (meeting.pct / 100),
      student_id: tx.student_id, student_name: tx.student_name, student_email: studentEmail, txn_id: txnId,
      initiator_id: startId, initiator_name: tx.initiating_mentor_name || tx.primary_mentor_name, requested_at: tx.requested_at,
      created_date: now, updated_date: now, is_pool: false, recipient_id: m._id.toString(), recipient_name: m.full_name, status: "accrued",
      meeting_source: meeting.outcome ? "meetings" : "request",
      meeting_outcome_id: meeting.outcome ? String(meeting.outcome._id) : null, meeting_at: meeting.outcome?.meeting?.starts_at ?? null,
    });
  }

  // Counting stopped by Delta finance (2026-11-13, finance/commissionStops.ts): whoever is stopped at this moment gets
  // no credit — not as the initiator, not as someone's up-line, not as the meeting mentor. Their amount goes to nobody:
  // everyone else's credit is what it would have been anyway. A pool's accrual stays, so the pool accrues as before —
  // its split pays nobody what was written for a member while they were stopped (functions/distributeDepositPool.ts).
  const stopped = await stoppedNow([...new Set(credits.map((c) => String(c.recipient_id)))]);
  const skipped = credits.filter((c) => !c.is_pool && stopped.has(String(c.recipient_id)));
  const kept = skipped.length ? credits.filter((c) => !skipped.includes(c)) : credits;
  const notCredited = skipped.map((c) => ({ recipient_id: c.recipient_id, recipient_name: c.recipient_name, level: c.level, position: c.position, commission_usd: c.commission_usd }));

  if (opts.preview) return { ok: true, preview: true, credits: kept, stopped: notCredited };
  if (kept.length) await col("commission_credits").insertMany(kept as any[]);
  // Who was left out, and what they would have had, kept on the request — there is no credit to say so.
  if (notCredited.length) await col("funding_transactions").updateOne({ _id: oid }, { $set: { commission_stopped: notCredited } });
  return {
    ok: true,
    credited: kept.length,
    plan: plan.name,
    method: methodKey,
    breakdown: kept.map((c) => ({ level: c.level, recipient: c.recipient_name, pct: c.percentage, amount: c.commission_usd })),
    ...(notCredited.length ? { stopped: notCredited } : {}),
  };
}

const MEETING_MENTOR_ROLES = new Set(["junior_mentor", "senior_mentor", "subjunior_mentor"]);

/** The mentor the request names as having held the meeting — when they are a Junior, Senior or Sub-junior Mentor. */
export async function meetingMentorPicked(userId: string): Promise<{ mentor: any; outcome: null } | null> {
  const oid = toObjectId(userId);
  const u: any = oid ? await col("users").findOne({ _id: oid }, { projection: { full_name: 1, app_role: 1 } }) : null;
  return u && MEETING_MENTOR_ROLES.has(String(u.app_role)) ? { mentor: u, outcome: null } : null;
}

/**
 * The mentor who first held a meeting with this student before `before` — a meeting whose outcome the mentor filled in
 * (meeting_outcomes, from the Mentor Calendar), held by a Junior, Senior or Sub-junior Mentor (a Chief's own meeting
 * pays them nothing more). Null when there is none.
 */
export async function meetingMentorFor(studentId: string, before: string): Promise<{ mentor: any; outcome: any } | null> {
  const meetings = (await col("meeting_outcomes").find({ student_ids: studentId, "meeting.starts_at": { $lt: before } },
    { projection: { meeting: 1, mentor: 1 } }).sort({ "meeting.starts_at": 1 }).toArray()) as any[];
  for (const o of meetings) {
    const email = String(o.mentor?.email ?? "").trim().toLowerCase();
    if (!email) continue;
    const u: any = await col("users").findOne({ email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } }, { projection: { full_name: 1, app_role: 1 } });
    if (u && MEETING_MENTOR_ROLES.has(String(u.app_role))) return { mentor: u, outcome: o };
  }
  return null;
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

/**
 * A transaction approved and then turned back (crud.ts, 2026-10-23): its credits nobody has been paid yet (accrued, or
 * pooled) are removed, the rest — released or paid — kept and marked tx_reversed_at; its claim is cleared, so approving
 * it again credits it again. → how many were removed and kept.
 */
export async function reverseCommissionFor(txId: string, byName = ""): Promise<{ removed: number; kept: number }> {
  const now = new Date().toISOString();
  const removed = await col("commission_credits").deleteMany({ transaction_id: txId, status: { $in: ["accrued", "pooled"] } });
  const kept = await col("commission_credits").updateMany({ transaction_id: txId }, { $set: { tx_reversed_at: now, tx_reversed_by: byName } });
  const oid = toObjectId(txId);
  if (oid) await col("funding_transactions").updateOne({ _id: oid }, { $unset: { commission_claimed_at: "", commission_stopped: "" } });
  if (removed.deletedCount || kept.modifiedCount) console.log(`[commission] ${txId} turned back: ${removed.deletedCount} credit(s) removed, ${kept.modifiedCount} kept (paid or released)`);
  return { removed: removed.deletedCount, kept: kept.modifiedCount };
}
