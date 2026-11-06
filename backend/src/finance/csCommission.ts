import { col } from "../db";
import { config } from "../config";
import { ok, refuse, secretMatches, text } from "../students/intake";
import { toObjectId } from "../lib/id";
import { locationOfUser, teamIndex } from "../lib/userLocation";
import { METHODS, periodRange, releaseCredits } from "../functions/approveCommissionPeriod";

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
     POST /api/v1/integrations/finance/cs-commission/approve   { kind, period, recipient_id, by, force?, reason? }
       → { already, total_usd, credit_ids, location, email, name } — released here (already: it was)
       force + reason (the user, 2026-11-06: "record payment for this commission" while it waits here): a Delta
       finance manager pays it before the broker admin and academic head — released as finance's, the reason on it
       (finance_override), and taking it back puts it where it was.
     POST /api/v1/integrations/finance/cs-commission/unapprove { kind, period, recipient_id, by }
       → back with finance, its credits unreleased — only one finance released
──────────────────────────────────────────────────────────────────────────── */

/** Who finance's approvals are recorded as here: not a user of this portal. */
const FINANCE_ID = "delta-finance";

const guard = (req: Request): Response | null => {
  if (!config.financeS2sSecret) return refuse(503, "INTEGRATION_DISABLED", "The Delta finance link is not configured on this server");
  if (!secretMatches(req.headers.get("x-finance-secret"), config.financeS2sSecret)) return refuse(401, "UNAUTHORISED", "Bad secret");
  return null;
};

type Asked = { kind: string; period: string; range: { start: Date; end: Date }; recipientId: string; by: string; force: boolean; reason: string };
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
  return { kind, period, range, recipientId, by: text(body.by, 120) || "Delta finance", force: body.force === true, reason: text(body.reason, 300) };
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
  const [credits, approvals, idx] = await Promise.all([
    creditsOf(a.kind, a.range),
    col("commission_period_approvals").find({ kind: a.kind, period: a.period }).toArray() as Promise<any[]>,
    teamIndex(),
  ]);
  const approvalOf = new Map(approvals.map((r) => [String(r.recipient_id), r]));
  const byPerson = new Map<string, any[]>();
  for (const c of credits) byPerson.set(String(c.recipient_id), [...(byPerson.get(String(c.recipient_id)) ?? []), c]);
  const people = [];
  for (const [id, mine] of byPerson) {
    const who = await person(id, idx);
    people.push({
      recipient_id: id,
      name: who.name || String(mine[0]?.recipient_name ?? ""),
      email: who.email,
      location: who.location,
      total_usd: cents(mine.reduce((t, c) => t + (Number(c.commission_usd) || 0), 0)),
      credits: mine
        .sort((x, y) => String(x.requested_at || x.created_date).localeCompare(String(y.requested_at || y.created_date)))
        .map((c) => ({
          id: String(c._id), date: String(c.requested_at || c.created_date || ""), student: String(c.student_name ?? ""),
          method: String(c.method), level: Number(c.level) || 0, position: String(c.position ?? ""), percentage: Number(c.percentage) || 0,
          base_usd: cents(Number(c.base_amount) || 0), amount_usd: cents(Number(c.commission_usd) || 0), status: String(c.status ?? ""),
          txn_id: String(c.txn_id ?? ""), initiator: String(c.initiator_name ?? ""),
        })),
      approval: approvalView(approvalOf.get(id)),
    });
  }
  people.sort((x, y) => y.total_usd - x.total_usd);
  return ok({ kind: a.kind, period: a.period, ended: Date.now() >= a.range.end.getTime(), people });
}

export async function handleFinanceCsCommissionApprove(req: Request): Promise<Response> {
  const refused = guard(req);
  if (refused) return refused;
  const a = await asked(req, true);
  if (a instanceof Response) return a;
  if (Date.now() < a.range.end.getTime()) return refuse(409, "PERIOD_OPEN", "This period is still open — approvals start after it ends.");
  const coll = col("commission_period_approvals");
  let record: any = await coll.findOne({ kind: a.kind, period: a.period, recipient_id: a.recipientId });
  const mine = await creditsOf(a.kind, a.range, a.recipientId);
  const who = await person(a.recipientId, await teamIndex());
  const answer = (already: boolean, override = false) => ok({
    already, total_usd: cents(mine.reduce((t, c) => t + (Number(c.commission_usd) || 0), 0)), credit_ids: mine.map((c) => String(c._id)),
    name: who.name || String(mine[0]?.recipient_name ?? ""), email: who.email, location: who.location,
    /** Released by Delta finance before the broker admin and academic head (2026-11-06). */
    finance_override: override,
  });
  // Released already — by a Super Admin here, or an earlier approval whose answer finance never got: finance pays it.
  if (record?.overall_status === "released") return answer(true, record.finance_override === true);
  if (!mine.length) return refuse(409, "NOTHING_TO_APPROVE", "No commission for this person in the period.");
  if (record?.overall_status === "rejected") return refuse(409, "REJECTED", "This period was rejected here.");
  const now = new Date().toISOString();
  const ready = record?.overall_status === "pending_finance_approval";
  if (!ready) {
    const at = record?.overall_status === "pending_academic_approval" ? "the academic head" : "the broker admin";
    if (!a.force) return refuse(409, "NOT_READY", `Waiting for ${at} in the CS Portal.`);
    // Paid by Delta finance before them (2026-11-06): only with a reason, which goes on the release.
    if (!a.reason) return refuse(400, "VALIDATION_ERROR", `Say why it is paid before ${at} has approved it.`);
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
