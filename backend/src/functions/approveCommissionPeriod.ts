import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import type { AuthUser } from "../auth/middleware";

/**
 * POST /api/functions/approveCommissionPeriod
 * Body: { kind: 'bonus'|'deposit', period: string, recipient_id, recipient_name?, action: 'approve'|'reject' }
 *   period is 'YYYY-MM' for bonus (monthly) or 'YYYY-Qn' for deposit (quarterly).
 *
 * Per-staff, per-period approval chain that mirrors Quarter Closing:
 *   pending_broker_approval -> pending_academic_approval -> pending_finance_approval -> released
 * Broker approves at the first stage, Academic at the second, Finance at the last
 * (super_admin/admin may act at any stage). Finance approval also marks that
 * staff's commission credits for the period as released (paid). Idempotent-ish:
 * a released or rejected record is not advanced further.
 */

const CHAIN = {
  pending_broker_approval: { level: "broker_admin", role: "broker_admin", next: "pending_academic_approval" },
  pending_academic_approval: { level: "academic_head", role: "academic_head", next: "pending_finance_approval" },
  pending_finance_approval: { level: "finance_admin", role: "finance_admin", next: "released" },
} as const;

const SUPER = ["super_admin", "admin"];
const METHODS: Record<string, string[]> = {
  bonus: ["bonus_with", "bonus_without"],
  deposit: ["deposit"],
};

function periodRange(kind: string, period: string): { start: Date; end: Date } | null {
  if (kind === "bonus") {
    const m = /^(\d{4})-(\d{2})$/.exec(period);
    if (!m) return null;
    const y = +m[1];
    const mo = +m[2] - 1;
    return { start: new Date(y, mo, 1), end: new Date(y, mo + 1, 1) };
  }
  if (kind === "deposit") {
    const m = /^(\d{4})-Q([1-4])$/.exec(period);
    if (!m) return null;
    const y = +m[1];
    const sm = (+m[2] - 1) * 3;
    return { start: new Date(y, sm, 1), end: new Date(y, sm + 3, 1) };
  }
  return null;
}

export async function approveCommissionPeriod(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => null);
  const kind = body?.kind;
  const period = body?.period;
  const recipientId = body?.recipient_id;
  const action = body?.action;

  if (!["bonus", "deposit"].includes(kind)) return error("kind must be 'bonus' or 'deposit'", 400);
  if (!period || !recipientId) return error("period and recipient_id are required", 400);
  if (!["approve", "reject"].includes(action)) return error("action must be 'approve' or 'reject'", 400);

  const range = periodRange(kind, period);
  if (!range) return error("Invalid period format", 400);

  // The chain can only run once the period has ended.
  if (Date.now() < range.end.getTime()) {
    return error("This period is still open — approvals start after it ends.", 400);
  }

  const coll = col("commission_period_approvals");
  const now = new Date().toISOString();

  let record: any = await coll.findOne({ kind, period, recipient_id: recipientId });
  if (!record) {
    const doc: any = {
      kind,
      period,
      recipient_id: recipientId,
      recipient_name: body?.recipient_name || "",
      overall_status: "pending_broker_approval",
      broker_admin_approval_status: "pending",
      academic_head_approval_status: "pending",
      finance_admin_approval_status: "pending",
      created_date: now,
      updated_date: now,
    };
    const ins = await coll.insertOne(doc);
    record = { ...doc, _id: ins.insertedId };
  }

  if (record.overall_status === "released") return error("Already released.", 400);
  if (record.overall_status === "rejected") return error("This period was rejected.", 400);

  const stage = CHAIN[record.overall_status as keyof typeof CHAIN];
  if (!stage) return error("Unexpected approval status.", 400);

  const allowed = user.app_role === stage.role || SUPER.includes(user.app_role);
  if (!allowed) return forbidden(`Waiting for ${stage.level.replace("_", " ")} approval.`);

  const set: any = {
    updated_date: now,
    [`${stage.level}_approved_by_id`]: user.id,
    [`${stage.level}_approved_by_name`]: user.full_name,
    [`${stage.level}_approved_at`]: now,
  };

  if (action === "reject") {
    set[`${stage.level}_approval_status`] = "rejected";
    set.overall_status = "rejected";
    await coll.updateOne({ _id: record._id }, { $set: set });
    return json({ ok: true, overall_status: "rejected" });
  }

  set[`${stage.level}_approval_status`] = "approved";
  set.overall_status = stage.next;

  let released = 0;
  if (stage.next === "released") {
    set.released_at = now;
    set.released_by_id = user.id;
    set.released_by_name = user.full_name;

    const methods = METHODS[kind];
    const credits = await col("commission_credits")
      .find({ recipient_id: recipientId, method: { $in: methods } })
      .toArray();
    const ids = (credits as any[])
      .filter((c) => {
        const d = new Date(c.requested_at || c.created_date);
        return !isNaN(d.getTime()) && d >= range.start && d < range.end && c.status !== "released";
      })
      .map((c) => c._id);
    if (ids.length) {
      const r = await col("commission_credits").updateMany(
        { _id: { $in: ids } },
        { $set: { status: "released", released_at: now, released_by_id: user.id, released_by_name: user.full_name } },
      );
      released = r.modifiedCount;
    }
  }

  await coll.updateOne({ _id: record._id }, { $set: set });
  return json({ ok: true, overall_status: set.overall_status, released });
}
