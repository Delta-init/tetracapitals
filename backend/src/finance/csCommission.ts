import { col } from "../db";
import { config } from "../config";
import { ok, refuse, secretMatches, text } from "../students/intake";
import { toObjectId } from "../lib/id";
import { locationOfUser, teamIndex } from "../lib/userLocation";
import { METHODS, periodRange, releaseCredits } from "../functions/approveCommissionPeriod";
import { splitPool } from "../functions/distributeDepositPool";
import { adjustmentRows, adjustmentView, afterStop, stopOf, stoppedNow, type Stop } from "./commissionStops";

/* ────────────────────────────────────────────────────────────────────────────
   The CS commission Delta finance pays (the user, 2026-11-03: "CS commission in finance, beside the CRM
   commission"). Each staff member's commission credits for a period — bonus monthly (YYYY-MM), deposit quarterly
   (YYYY-Qn), counted as Bonus Closing and the deposit approvals count them: credits of that kind dated in the period,
   the Senior/Junior pool's accruals left out — with how far their approval has got here.

   The Finance step is finance's now: Broker and Academic head approve here as before, then finance's CS commission
   page approves, which releases the credits here exactly as the Finance step did (releaseCredits). A Super Admin may
   still act on it here; finance then approves one already released, to pay it.

   With finance's own secret (`x-finance-secret`):
     POST /api/v1/integrations/finance/cs-commission           { kind, period }
       → { kind, period, ended, people: [{ recipient_id, name, email, location, total_usd, credits, approval }] }
       each credit names the funding request it came from (funding_id), for finance to find its invoice
     POST /api/v1/integrations/finance/cs-commission/approve   { kind, period, recipient_id, by, force?, reason? }
       → { already, total_usd, credit_ids, location, email, name } — released here (already: it was)
       force + reason (the user, 2026-11-06: "record payment for this commission" while it waits here): a Delta
       finance manager pays it before the broker admin and academic head — released as finance's, the reason on it
       (finance_override), and taking it back puts it where it was.
     POST /api/v1/integrations/finance/cs-commission/unapprove { kind, period, recipient_id, by }
       → back with finance, its credits unreleased — only one finance released
     POST /api/v1/integrations/finance/cs-commission/split-pool { kind, period, pool_group_id?, method?, recipient_id?, by }
       → { split: [{ group_id, method, pool_total, members, share_each, shares }] } — the period's Senior/Junior pools split as
       the Distribute button splits them: one group, the groups someone is in, or all; only once the period has ended

   The Senior/Junior pools (the user, 2026-11-07: "why are the junior and senior mentors not visible here"): a plan
   position flagged Pool pays a shared pool under the Chief, paid out to its members only when someone presses
   Distribute — each their own accruals (2026-11-07, "B, by own share"; equal before) — until then the Juniors and Seniors had no credits of their own, so finance never saw them. The list now
   gives each member their share of each pool not split yet (pool_usd, pool) and the pools (pools); approving someone
   splits the pools they are in first, so what is released is theirs.

   Counting stopped, and additions / deductions (the user, 2026-11-13 — finance/commissionStops.ts):
     POST …/cs-commission/stop               { recipient_id, by, reason }  → { stopped: { at, by, reason } } (already: true when it was)
     POST …/cs-commission/resume             { recipient_id, by }          → { resumed } — false when they were not stopped
     POST …/cs-commission/adjustments/add    { kind, period, recipient_id, type, amount_minor, currency, reason, by } → { adjustment }
     POST …/cs-commission/adjustments/remove { id, by }                    → { removed: true }
   Someone stopped is credited nothing more until resumed, and finance may approve their period while it still runs
   (anyone else's only once it has ended). The list gives each person `stopped` and their `adjustments` for the period —
   someone with only an adjustment is listed too — and so does the approval's answer. Once a period is released its
   adjustments are fixed (LOCKED) until the approval is taken back.
   Of a Senior/Junior pool a stopped member keeps what their position put in before the stop ("stop counting from
   now"): the list shows that as their share; approving them pays it out of the pool on its own, as their credit, and
   releases it with the rest — everyone else's part stays pooled, to be split as ever; a split pays it like anyone's.
   Only what was written to the pool for them from the stop on goes to nobody. Taking the approval back treats that
   pool share as any credit the approval released — accrued again, theirs to be approved again; it is not put back
   into the pool, as a pool split by an approval never was.
──────────────────────────────────────────────────────────────────────────── */

/** Who finance's approvals are recorded as here: not a user of this portal. */
const FINANCE_ID = "delta-finance";

const guard = (req: Request): Response | null => {
  if (!config.financeS2sSecret) return refuse(503, "INTEGRATION_DISABLED", "The Delta finance link is not configured on this server");
  if (!secretMatches(req.headers.get("x-finance-secret"), config.financeS2sSecret)) return refuse(401, "UNAUTHORISED", "Bad secret");
  return null;
};

type Asked = { kind: string; period: string; range: { start: Date; end: Date }; recipientId: string; poolGroupId: string; method: string; by: string; force: boolean; reason: string; body: Record<string, unknown> };
async function asked(req: Request, needRecipient: boolean): Promise<Asked | Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return refuse(400, "VALIDATION_ERROR", "Body must be a JSON object");
  const kind = text(body.kind, 10);
  if (kind !== "bonus" && kind !== "deposit") return refuse(400, "VALIDATION_ERROR", "kind is bonus or deposit");
  const period = text(body.period, 10);
  const range = periodRange(kind, period);
  if (!range) return refuse(400, "VALIDATION_ERROR", kind === "bonus" ? "period is YYYY-MM" : "period is YYYY-Qn");
  const recipientId = text(body.recipient_id, 64);
  if (needRecipient && !recipientId) return refuse(400, "VALIDATION_ERROR", "recipient_id is required");
  return {
    kind, period, range, recipientId, poolGroupId: text(body.pool_group_id, 64), method: text(body.method, 20), by: text(body.by, 120) || "Delta finance", force: body.force === true,
    reason: text(body.reason, 300), body,
  };
}
/** The body of a call that names no period (2026-11-13): a stop, a resume, an adjustment taken off. */
async function bodyOf(req: Request): Promise<Record<string, unknown> | Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return refuse(400, "VALIDATION_ERROR", "Body must be a JSON object");
  return body;
}

const inRange = (c: any, range: { start: Date; end: Date }) => {
  const d = new Date(c.requested_at || c.created_date);
  return !isNaN(d.getTime()) && d >= range.start && d < range.end;
};
const cents = (n: number) => Math.round(n * 100) / 100;

/** The period's individual credits (no pool accruals), for everyone or one person. */
async function creditsOf(kind: string, range: { start: Date; end: Date }, recipientId?: string) {
  const rows = (await col("commission_credits")
    .find({ method: { $in: METHODS[kind] }, is_pool: { $ne: true }, ...(recipientId ? { recipient_id: recipientId } : {}) })
    .toArray()) as any[];
  return rows.filter((c) => c.recipient_id && inRange(c, range));
}

/** A Senior/Junior pool of the period not split yet: one group (the Chief's) and method, its members and accruals. */
type Pool = { group_id: string; group_name: string; method: string; total_usd: number; members: Map<string, string>; accruals: any[] };

/** The period's pools still to be split (accruals "pooled" — a split marks them distributed), as Distribute would split them. */
async function poolsOf(kind: string, range: { start: Date; end: Date }): Promise<Pool[]> {
  const rows = (await col("commission_credits").find({ method: { $in: METHODS[kind] }, is_pool: true, status: "pooled" }).toArray()) as any[];
  const groups = new Map<string, Pool>();
  for (const c of rows) {
    const gid = String(c.pool_group_id ?? "");
    if (!gid || !inRange(c, range)) continue;
    const key = `${gid}|${c.method}`;
    const g: Pool = groups.get(key) ?? { group_id: gid, group_name: String(c.pool_group_name ?? ""), method: String(c.method), total_usd: 0, members: new Map<string, string>(), accruals: [] as any[] };
    g.total_usd += Number(c.commission_usd) || 0;
    if (c.recipient_id) g.members.set(String(c.recipient_id), String(c.recipient_name ?? ""));
    g.accruals.push(c);
    groups.set(key, g);
  }
  return [...groups.values()].filter((g) => g.members.size > 0);
}
/** A member's share of a pool: their own accruals in it — their position's % (the user, 2026-11-07: "B, by own share") —
 *  for someone whose counting is stopped, those from before the stop (2026-11-13): the rest of theirs is nobody's. */
const shareOf = (g: Pool, memberId: string, stops: Map<string, Stop>) =>
  g.accruals.filter((c) => String(c.recipient_id) === memberId && !afterStop(c, stops)).reduce((t, c) => t + (Number(c.commission_usd) || 0), 0);

/** Split the pools given, as Delta finance; the first refusal stops it. `only`: just that member's own share of each (2026-11-13). */
async function splitAll(pools: Pool[], period: string, by: string, only?: string) {
  const done = [];
  for (const g of pools) {
    const r = await splitPool(g.group_id, g.method, period, { id: FINANCE_ID, name: `${by} (Delta finance)` }, only);
    if ("error" in r) return r;
    // Nothing in it but what was added after its members were stopped (2026-11-13): left as it is — not one of those split.
    if (!r.distributed) continue;
    done.push({ group_id: r.group_id, method: r.method, pool_total: cents(r.pool_total), members: r.members, share_each: cents(r.share_each),
      shares: r.breakdown.map((b) => ({ id: b.member_id, name: b.member, share_usd: cents(b.share) })),
      // Members whose counting is stopped, with the part written for each from their stop on — paid to nobody (2026-11-13).
      stopped: (r.stopped ?? []).map((b) => ({ id: b.member_id, name: b.member, share_usd: cents(b.share) })) });
  }
  return done;
}

const stageOf = (a: any, level: string) => ({
  status: String(a?.[`${level}_approval_status`] ?? "pending"),
  by: String(a?.[`${level}_approved_by_name`] ?? ""),
  at: a?.[`${level}_approved_at`] ? String(a[`${level}_approved_at`]) : null,
});
const approvalView = (a: any) => ({
  overall_status: String(a?.overall_status ?? "pending_broker_approval"),
  broker: stageOf(a, "broker_admin"),
  academic: stageOf(a, "academic_head"),
  finance: stageOf(a, "finance_admin"),
  released_at: a?.released_at ? String(a.released_at) : null,
  released_by: String(a?.released_by_name ?? ""),
  /** Released by Delta finance (and so its to take back), not by a Super Admin here. */
  by_finance: a?.released_by_id === FINANCE_ID,
  /** Released by Delta finance before the broker admin and academic head had approved it (2026-11-06), and why. */
  finance_override: a?.finance_override === true,
  override_reason: String(a?.finance_override_reason ?? ""),
});

async function person(id: string, idx: Awaited<ReturnType<typeof teamIndex>>) {
  const u = idx.userById.get(id) ?? (toObjectId(id) ? await col("users").findOne({ _id: toObjectId(id) as any }, { projection: { full_name: 1, email: 1 } }) : null);
  return { name: String(u?.full_name ?? ""), email: String(u?.email ?? "").trim().toLowerCase(), location: await locationOfUser(id, idx) };
}

export async function handleFinanceCsCommission(req: Request): Promise<Response> {
  const refused = guard(req);
  if (refused) return refused;
  const a = await asked(req, false);
  if (a instanceof Response) return a;
  const [credits, approvals, idx, pools, stops, adjustments] = await Promise.all([
    creditsOf(a.kind, a.range),
    col("commission_period_approvals").find({ kind: a.kind, period: a.period }).toArray() as Promise<any[]>,
    teamIndex(),
    poolsOf(a.kind, a.range),
    stoppedNow(),
    adjustmentRows({ kind: a.kind, period: a.period }),
  ]);
  const approvalOf = new Map(approvals.map((r) => [String(r.recipient_id), r]));
  const byPerson = new Map<string, any[]>();
  for (const c of credits) byPerson.set(String(c.recipient_id), [...(byPerson.get(String(c.recipient_id)) ?? []), c]);
  // A pool's members with nothing of their own yet are listed too — with their share of it.
  for (const g of pools) for (const id of g.members.keys()) if (!byPerson.has(id)) byPerson.set(id, []);
  // …and so is someone with only an addition or deduction for the period (2026-11-13).
  const adjustmentsOf = new Map<string, any[]>();
  for (const r of adjustments) {
    const id = String(r.recipient_id ?? "");
    adjustmentsOf.set(id, [...(adjustmentsOf.get(id) ?? []), r]);
    if (id && !byPerson.has(id)) byPerson.set(id, []);
  }
  // A member whose counting is stopped: their share is what their position put in before the stop (2026-11-13).
  const share = (g: Pool, memberId: string) => shareOf(g, memberId, stops);
  const poolCredit = (c: any) => ({
    id: String(c._id), date: String(c.requested_at || c.created_date || ""), student: String(c.student_name ?? ""),
    method: String(c.method), level: Number(c.level) || 0, position: String(c.position ?? ""), percentage: Number(c.percentage) || 0,
    base_usd: cents(Number(c.base_amount) || 0), amount_usd: cents(Number(c.commission_usd) || 0), held_by: String(c.recipient_name ?? ""),
    txn_id: String(c.txn_id ?? ""), initiator: String(c.initiator_name ?? ""), funding_id: String(c.transaction_id ?? ""),
  });
  const people = [];
  for (const [id, mine] of byPerson) {
    const who = await person(id, idx);
    const theirPools = pools.filter((g) => g.members.has(id));
    people.push({
      recipient_id: id,
      name: who.name || String(mine[0]?.recipient_name ?? theirPools[0]?.members.get(id) ?? ""),
      email: who.email,
      location: who.location,
      total_usd: cents(mine.reduce((t, c) => t + (Number(c.commission_usd) || 0), 0)),
      // Their share of each pool not split yet — what Distribute would pay them now (2026-11-07).
      pool_usd: cents(theirPools.reduce((t, g) => t + share(g, id), 0)),
      pool: theirPools.map((g) => ({
        group_id: g.group_id, group_name: g.group_name, method: g.method, total_usd: cents(g.total_usd),
        members: [...g.members].map(([mid, name]) => ({ id: mid, name, share_usd: cents(share(g, mid)) })), share_usd: cents(share(g, id)),
        credits: g.accruals.sort((x, y) => String(x.requested_at || x.created_date).localeCompare(String(y.requested_at || y.created_date))).map(poolCredit),
      })),
      credits: mine
        .sort((x, y) => String(x.requested_at || x.created_date).localeCompare(String(y.requested_at || y.created_date)))
        .map((c) => ({
          id: String(c._id), date: String(c.requested_at || c.created_date || ""), student: String(c.student_name ?? ""),
          method: String(c.method), level: Number(c.level) || 0, position: String(c.position ?? ""), percentage: Number(c.percentage) || 0,
          base_usd: cents(Number(c.base_amount) || 0), amount_usd: cents(Number(c.commission_usd) || 0), status: String(c.status ?? ""),
          txn_id: String(c.txn_id ?? ""), initiator: String(c.initiator_name ?? ""),
          // The funding request it came from (2026-11-07) — finance finds the bonus or deposit, and its invoice, by it.
          funding_id: String(c.transaction_id ?? ""),
          // A share of a split Senior/Junior pool, not a credit on one bonus or deposit (2026-11-07).
          from_pool: c.from_pool === true,
        })),
      approval: approvalView(approvalOf.get(id)),
      // Their counting stopped by finance — when, by whom, why — or null; and what finance added or deducted for this
      // period (2026-11-13).
      stopped: stops.get(id) ?? null,
      adjustments: (adjustmentsOf.get(id) ?? []).map(adjustmentView),
    });
  }
  people.sort((x, y) => y.total_usd + y.pool_usd - (x.total_usd + x.pool_usd));
  const pools_out = [];
  for (const g of pools) {
    pools_out.push({
      group_id: g.group_id, group_name: g.group_name, method: g.method, total_usd: cents(g.total_usd), share_usd: cents(g.total_usd / g.members.size),
      members: await Promise.all([...g.members].map(async ([mid, name]) => ({ id: mid, name: (await person(mid, idx)).name || name, location: await locationOfUser(mid, idx), share_usd: cents(share(g, mid)) }))),
    });
  }
  return ok({ kind: a.kind, period: a.period, ended: Date.now() >= a.range.end.getTime(), people, pools: pools_out });
}

export async function handleFinanceCsCommissionApprove(req: Request): Promise<Response> {
  const refused = guard(req);
  if (refused) return refused;
  const a = await asked(req, true);
  if (a instanceof Response) return a;
  // A period still running (2026-11-13): only for someone whose counting finance has stopped — nothing more is coming
  // for them, so what they have can be approved and paid now. Anyone else's waits for the period to end, as before.
  const stopped = await stopOf(a.recipientId);
  if (Date.now() < a.range.end.getTime() && !stopped) return refuse(409, "PERIOD_OPEN", "This period is still running — stop counting their commission first");
  const coll = col("commission_period_approvals");
  let record: any = await coll.findOne({ kind: a.kind, period: a.period, recipient_id: a.recipientId });
  let mine = await creditsOf(a.kind, a.range, a.recipientId);
  // The Senior/Junior pools they are in, not split yet (2026-11-07): split once this approval goes ahead. Someone
  // stopped (2026-11-13): only their own share comes out of each — what their position put in before the stop — and
  // the rest stays pooled for the others; a pool holding nothing of theirs from before the stop is left alone.
  const stops = new Map<string, Stop>(stopped ? [[a.recipientId, stopped]] : []);
  const theirPools = (await poolsOf(a.kind, a.range)).filter((g) => g.members.has(a.recipientId)
    && (!stopped || g.accruals.some((c) => String(c.recipient_id) === a.recipientId && !afterStop(c, stops))));
  const who = await person(a.recipientId, await teamIndex());
  const adjustments = (await adjustmentRows({ kind: a.kind, period: a.period, recipient_id: a.recipientId })).map(adjustmentView);
  const answer = (already: boolean, override = false) => ok({
    already, total_usd: cents(mine.reduce((t, c) => t + (Number(c.commission_usd) || 0), 0)), credit_ids: mine.map((c) => String(c._id)),
    name: who.name || String(mine[0]?.recipient_name ?? ""), email: who.email, location: who.location,
    /** Released by Delta finance before the broker admin and academic head (2026-11-06). */
    finance_override: override,
    /** What finance added or deducted for this period, and their stop if their counting is stopped (2026-11-13). */
    adjustments, stopped,
  });
  // Released already — by a Super Admin here, or an earlier approval whose answer finance never got: finance pays it.
  if (record?.overall_status === "released") return answer(true, record.finance_override === true);
  if (!mine.length && !theirPools.length) return refuse(409, "NOTHING_TO_APPROVE", "No commission for this person in the period.");
  if (record?.overall_status === "rejected") return refuse(409, "REJECTED", "This period was rejected here.");
  const now = new Date().toISOString();
  const ready = record?.overall_status === "pending_finance_approval";
  if (!ready) {
    const at = record?.overall_status === "pending_academic_approval" ? "the academic head" : "the broker admin";
    if (!a.force) return refuse(409, "NOT_READY", `Waiting for ${at} in the CS Portal.`);
    // Paid by Delta finance before them (2026-11-06): only with a reason, which goes on the release.
    if (!a.reason) return refuse(400, "VALIDATION_ERROR", `Say why it is paid before ${at} has approved it.`);
  }
  if (theirPools.length) {
    const split = await splitAll(theirPools, a.period, a.by, stopped ? a.recipientId : undefined);
    if (!Array.isArray(split)) return refuse(409, "POOL_NOT_SPLIT", split.error);
    mine = await creditsOf(a.kind, a.range, a.recipientId);
    if (!mine.length) return refuse(409, "NOTHING_TO_APPROVE", "No commission for this person in the period.");
  }
  if (!record) {
    const doc: any = {
      kind: a.kind, period: a.period, recipient_id: a.recipientId, recipient_name: who.name || String(mine[0]?.recipient_name ?? ""),
      overall_status: "pending_broker_approval", broker_admin_approval_status: "pending", academic_head_approval_status: "pending",
      finance_admin_approval_status: "pending", created_date: now, updated_date: now,
    };
    record = { ...doc, _id: (await coll.insertOne(doc)).insertedId };
  }
  const by = `${a.by} (Delta finance)`;
  const releasedBy = ready ? by : `${by} — before the CS Portal's approvals: ${a.reason}`.slice(0, 300);
  // Claimed in one step: two approvals arriving together, one wins.
  const won = await coll.updateOne(
    { _id: record._id, overall_status: record.overall_status },
    { $set: {
      overall_status: "released", finance_admin_approval_status: "approved", finance_admin_approved_by_id: FINANCE_ID,
      finance_admin_approved_by_name: by, finance_admin_approved_at: now, released_at: now, released_by_id: FINANCE_ID, released_by_name: releasedBy, updated_date: now,
      ...(ready ? {} : { finance_override: true, finance_override_reason: a.reason, finance_override_from: record.overall_status }),
    } },
  );
  if (!won.modifiedCount) return answer(true);
  await releaseCredits(a.kind, a.range, a.recipientId, { id: FINANCE_ID, name: releasedBy }, now);
  return answer(false, !ready);
}

/** The period's Senior/Junior pools split, as Distribute splits them (2026-11-07) — one group, someone's, or all. */
export async function handleFinanceCsCommissionSplitPool(req: Request): Promise<Response> {
  const refused = guard(req);
  if (refused) return refused;
  const a = await asked(req, false);
  if (a instanceof Response) return a;
  if (Date.now() < a.range.end.getTime()) return refuse(409, "PERIOD_OPEN", "This period is still running — its pools are split once it ends.");
  const pools = (await poolsOf(a.kind, a.range))
    .filter((g) => (!a.poolGroupId || g.group_id === a.poolGroupId) && (!a.method || g.method === a.method) && (!a.recipientId || g.members.has(a.recipientId)));
  if (!pools.length) return ok({ split: [] });
  const split = await splitAll(pools, a.period, a.by);
  if (!Array.isArray(split)) return refuse(409, "POOL_NOT_SPLIT", split.error);
  return ok({ split });
}

export async function handleFinanceCsCommissionUnapprove(req: Request): Promise<Response> {
  const refused = guard(req);
  if (refused) return refused;
  const a = await asked(req, true);
  if (a instanceof Response) return a;
  const coll = col("commission_period_approvals");
  const record: any = await coll.findOne({ kind: a.kind, period: a.period, recipient_id: a.recipientId });
  if (record?.overall_status === "pending_finance_approval") return ok({ undone: false, overall_status: record.overall_status });
  if (record?.overall_status !== "released" || record.released_by_id !== FINANCE_ID) {
    return refuse(409, "NOT_FINANCES", "Released in the CS Portal, not by Delta finance — undo it there.");
  }
  const now = new Date().toISOString();
  const releasedAt = record.released_at;
  // Released before the broker admin and academic head: back to where it waited for them.
  const backTo = record.finance_override ? String(record.finance_override_from || "pending_broker_approval") : "pending_finance_approval";
  await coll.updateOne({ _id: record._id }, {
    $set: { overall_status: backTo, finance_admin_approval_status: "pending", updated_date: now },
    $unset: {
      finance_admin_approved_by_id: "", finance_admin_approved_by_name: "", finance_admin_approved_at: "", released_at: "", released_by_id: "", released_by_name: "",
      finance_override: "", finance_override_reason: "", finance_override_from: "",
    },
  });
  // Only the credits that approval released go back to accrued.
  const back = await col("commission_credits").updateMany(
    { recipient_id: a.recipientId, method: { $in: METHODS[a.kind] }, is_pool: { $ne: true }, status: "released", released_by_id: FINANCE_ID, released_at: releasedAt },
    { $set: { status: "accrued", updated_date: now }, $unset: { released_at: "", released_by_id: "", released_by_name: "" } },
  );
  return ok({ undone: true, overall_status: backTo, credits: back.modifiedCount });
}

/* ── Counting stopped, and additions / deductions (the user, 2026-11-13 — finance/commissionStops.ts) ── */

const MAX_ADJUSTMENT_MINOR = 100_000_000;
const byOf = (body: Record<string, unknown>) => text(body.by, 120) || "Delta finance";
/** Someone finance can name: a user here, or — removed since — whoever commission credits are still in the name of. */
async function known(id: string): Promise<boolean> {
  const oid = toObjectId(id);
  if (oid && (await col("users").findOne({ _id: oid as any }, { projection: { _id: 1 } }))) return true;
  return !!(await col("commission_credits").findOne({ recipient_id: id }, { projection: { _id: 1 } }));
}
/** Released already: its additions and deductions are what was paid — changed only once the approval is taken back. */
const locked = async (kind: string, period: string, recipientId: string) =>
  (await col("commission_period_approvals").findOne({ kind, period, recipient_id: recipientId }, { projection: { overall_status: 1 } }))?.overall_status === "released";
const LOCKED = () => refuse(409, "LOCKED", "approved already — take the approval back first");

/** Finance stops counting someone's commission from now, saying why — until it resumes it. */
export async function handleFinanceCsCommissionStop(req: Request): Promise<Response> {
  const refused = guard(req);
  if (refused) return refused;
  const body = await bodyOf(req);
  if (body instanceof Response) return body;
  const recipientId = text(body.recipient_id, 64), reason = text(body.reason, 300), by = byOf(body);
  if (!recipientId) return refuse(400, "VALIDATION_ERROR", "recipient_id is required");
  if (reason.length < 3) return refuse(400, "VALIDATION_ERROR", "Say why their commission is stopped (at least 3 characters).");
  if (!(await known(recipientId))) return refuse(404, "NOT_FOUND", "Nobody with this id in the CS Portal.");
  // Stopped already: the stop that holds, nothing new written.
  const current = await stopOf(recipientId);
  if (current) return ok({ stopped: current, already: true });
  const now = new Date().toISOString();
  await col("commission_stops").insertOne({ recipient_id: recipientId, stopped_at: now, stopped_by: by, reason, resumed_at: null, resumed_by: "" });
  return ok({ stopped: { at: now, by, reason } });
}

/** …and counts it again from now. What was not credited meanwhile stays not credited. */
export async function handleFinanceCsCommissionResume(req: Request): Promise<Response> {
  const refused = guard(req);
  if (refused) return refused;
  const body = await bodyOf(req);
  if (body instanceof Response) return body;
  const recipientId = text(body.recipient_id, 64);
  if (!recipientId) return refuse(400, "VALIDATION_ERROR", "recipient_id is required");
  const r = await col("commission_stops").updateMany({ recipient_id: recipientId, resumed_at: null }, { $set: { resumed_at: new Date().toISOString(), resumed_by: byOf(body) } });
  return ok({ resumed: r.modifiedCount > 0 });
}

/** An amount finance adds to, or deducts from, someone's bonus month or deposit quarter — before it is approved. */
export async function handleFinanceCsCommissionAdjustmentAdd(req: Request): Promise<Response> {
  const refused = guard(req);
  if (refused) return refused;
  const a = await asked(req, true);
  if (a instanceof Response) return a;
  const type = text(a.body.type, 20), currency = text(a.body.currency, 5), amount = a.body.amount_minor;
  if (type !== "addition" && type !== "deduction") return refuse(400, "VALIDATION_ERROR", "type is addition or deduction");
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1 || amount > MAX_ADJUSTMENT_MINOR) {
    return refuse(400, "VALIDATION_ERROR", "amount_minor is a whole number of minor units, from 1 to 100,000,000");
  }
  if (currency !== "AED" && currency !== "INR") return refuse(400, "VALIDATION_ERROR", "currency is AED or INR");
  if (a.reason.length < 3) return refuse(400, "VALIDATION_ERROR", "Say what it is for (at least 3 characters).");
  if (!(await known(a.recipientId))) return refuse(404, "NOT_FOUND", "Nobody with this id in the CS Portal.");
  if (await locked(a.kind, a.period, a.recipientId)) return LOCKED();
  const doc = {
    kind: a.kind, period: a.period, recipient_id: a.recipientId, type, amount_minor: amount, currency, reason: a.reason, by: a.by,
    at: new Date().toISOString(), removed_at: null, removed_by: "",
  };
  const _id = (await col("commission_adjustments").insertOne(doc)).insertedId;
  return ok({ adjustment: { ...adjustmentView({ ...doc, _id }), kind: a.kind, period: a.period, recipient_id: a.recipientId } });
}

/** …taken off again: kept, marked removed, no longer listed. */
export async function handleFinanceCsCommissionAdjustmentRemove(req: Request): Promise<Response> {
  const refused = guard(req);
  if (refused) return refused;
  const body = await bodyOf(req);
  if (body instanceof Response) return body;
  const oid = toObjectId(text(body.id, 64));
  const coll = col("commission_adjustments");
  const row: any = oid ? await coll.findOne({ _id: oid as any, removed_at: null }) : null;
  if (!row) return refuse(404, "NOT_FOUND", "No such addition or deduction.");
  if (await locked(String(row.kind), String(row.period), String(row.recipient_id))) return LOCKED();
  await coll.updateOne({ _id: row._id }, { $set: { removed_at: new Date().toISOString(), removed_by: byOf(body) } });
  return ok({ removed: true });
}
