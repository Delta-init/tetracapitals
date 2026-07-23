import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { serialize, toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";

/**
 * POST /api/functions/masterEditTransaction
 * Body: { id: string, patch: { ...editable fields } }
 *
 * Super-admin-only universal editor for any FundingTransaction. Lets the
 * top-tier admin correct ANY field — including back-dating, restoring a
 * REJECTED transaction, reassigning to a different student / mentor, and
 * clearing the transaction_id.
 *
 * Side effects on dependent UI (Dashboard, Reports, MentorPerformance,
 * QuarterClosing, DailyPayouts, MyFundingRequests, etc.) are automatic —
 * those pages compute live from FundingTransaction documents.
 *
 * Already-released daily ManualCommissionAdjustment rows are NOT touched;
 * the admin is expected to delete those separately if a back-date or
 * amount change makes the old release wrong.
 *
 * Every edit writes a `master_edit_transaction` Log row with full before
 * + after snapshots for audit.
 */

const STR_FIELDS = [
  "transaction_id", "payment_method", "mt5_login", "notes",
  "student_id", "student_name", "student_code",
  "initiating_mentor_id", "initiating_mentor_name",
  "primary_mentor_id", "primary_mentor_name",
  "senior_mentor_id", "senior_mentor_name",
  "rejection_reason", "approved_by_id", "approved_by_name",
  "user_id", "screenshot_url",
];
const DATE_FIELDS = ["requested_at", "approved_at"];
const NUMBER_FIELDS = ["amount_usd", "upline_commission_percentage"];
const ENUMS: Record<string, string[]> = {
  type:   ["DEPOSIT", "WITHDRAWAL", "BONUS"],
  status: ["PENDING", "APPROVED", "REJECTED"],
};

/**
 * Whitelist + coerce an incoming patch object. Shared by the single and bulk
 * editors so both accept exactly the same fields with the same validation.
 * Returns the cleaned patch, or an error string if any field is invalid.
 */
function coercePatch(rawPatch: Record<string, unknown>): { patch: Record<string, unknown>; error?: string } {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawPatch)) {
    if (v === undefined) continue;
    if (ENUMS[k]) {
      if (v !== null && !ENUMS[k].includes(String(v))) return { patch, error: `Invalid value for ${k}` };
      patch[k] = v;
    } else if (NUMBER_FIELDS.includes(k)) {
      const n = Number(v);
      if (!Number.isFinite(n)) return { patch, error: `Invalid number for ${k}` };
      patch[k] = n;
    } else if (DATE_FIELDS.includes(k)) {
      if (v === null || v === "") patch[k] = null;
      else if (typeof v === "string" && !Number.isNaN(Date.parse(v))) patch[k] = v;
      else return { patch, error: `Invalid date for ${k}` };
    } else if (k === "tags") {
      if (v === null) patch.tags = [];
      else if (Array.isArray(v)) patch.tags = v.filter((t) => typeof t === "string" && t);
      else return { patch, error: "tags must be an array" };
    } else if (STR_FIELDS.includes(k)) {
      patch[k] = v === null ? null : String(v);
    }
    // Any other field is silently dropped (whitelist).
  }
  return { patch };
}

export async function masterEditTransaction(req: Request, caller: AuthUser): Promise<Response> {
  if (caller.app_role !== "super_admin") return forbidden("Only super_admin can use the master editor");

  const body: any = await req.json().catch(() => null);
  if (!body || !body.id || !body.patch || typeof body.patch !== "object") {
    return error("id and patch are required", 400);
  }
  const oid = toObjectId(body.id);
  if (!oid) return error("Invalid id", 400);

  const before = await col("funding_transactions").findOne({ _id: oid });
  if (!before) return notFound("Transaction not found");

  // Whitelist and coerce fields from the incoming patch.
  const { patch, error: patchError } = coercePatch(body.patch);
  if (patchError) return error(patchError, 400);
  if (Object.keys(patch).length === 0) {
    return error("Nothing to update — patch was empty after whitelisting", 400);
  }

  const now = new Date().toISOString();
  patch.updated_date = now;
  patch.last_edited_by_id = caller.id;
  patch.last_edited_by_name = caller.full_name;
  patch.last_edited_at = now;

  await col("funding_transactions").updateOne({ _id: oid }, { $set: patch });
  const after = await col("funding_transactions").findOne({ _id: oid });

  // Log a structured before/after snapshot of only the changed fields so the
  // audit row stays readable.
  const changedFields: Record<string, { before: unknown; after: unknown }> = {};
  for (const k of Object.keys(patch)) {
    if (k === "updated_date" || k === "last_edited_at") continue;
    const b = (before as any)[k];
    const a = (after as any)[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      changedFields[k] = { before: b ?? null, after: a ?? null };
    }
  }
  await col("logs").insertOne({
    timestamp: now,
    user_id: caller.id, user_email: caller.email, user_name: caller.full_name, user_role: caller.app_role,
    action_type: "master_edit_transaction",
    entity_type: "FundingTransaction",
    entity_id: body.id,
    details: JSON.stringify({
      student: (after as any)?.student_name,
      student_code: (after as any)?.student_code,
      changes: changedFields,
    }),
    success: true,
    created_date: now,
  } as any);

  return json({ ok: true, transaction: serialize(after), changed: Object.keys(changedFields) });
}

/**
 * POST /api/functions/masterDeleteTransaction
 * Body: { id }
 *
 * Hard-deletes a FundingTransaction. Super-admin only. Writes a
 * `master_delete_transaction` Log row containing the full doc so the
 * record is recoverable from audit if needed.
 */
export async function masterDeleteTransaction(req: Request, caller: AuthUser): Promise<Response> {
  if (caller.app_role !== "super_admin") return forbidden("Only super_admin can use the master editor");
  const body: any = await req.json().catch(() => null);
  if (!body?.id) return error("id required", 400);
  const oid = toObjectId(body.id);
  if (!oid) return error("Invalid id", 400);

  const doc = await col("funding_transactions").findOne({ _id: oid });
  if (!doc) return notFound("Transaction not found");

  await col("funding_transactions").deleteOne({ _id: oid });

  const now = new Date().toISOString();
  await col("logs").insertOne({
    timestamp: now,
    user_id: caller.id, user_email: caller.email, user_name: caller.full_name, user_role: caller.app_role,
    action_type: "master_delete_transaction",
    entity_type: "FundingTransaction",
    entity_id: body.id,
    details: JSON.stringify({
      student: (doc as any).student_name,
      amount: (doc as any).amount_usd,
      type: (doc as any).type,
      snapshot: serialize(doc),
    }),
    success: true,
    created_date: now,
  } as any);

  return json({ ok: true });
}

/**
 * POST /api/functions/masterBulkEditTransactions
 * Body: { ids: string[], patch: { ...editable fields } }
 *
 * Super-admin-only. Applies the SAME patch to many transactions at once — e.g.
 * set `requested_at` on 50 selected rows in one shot instead of one by one.
 * Writes a single `master_bulk_edit_transaction` audit Log row.
 */
export async function masterBulkEditTransactions(req: Request, caller: AuthUser): Promise<Response> {
  if (caller.app_role !== "super_admin") return forbidden("Only super_admin can use the master editor");

  const body: any = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
  if (!ids.length || !body?.patch || typeof body.patch !== "object") {
    return error("ids (non-empty array) and patch are required", 400);
  }
  const { patch, error: patchError } = coercePatch(body.patch);
  if (patchError) return error(patchError, 400);
  if (Object.keys(patch).length === 0) return error("Nothing to update — patch was empty after whitelisting", 400);

  const oids = ids.map((id) => toObjectId(id)).filter((o): o is NonNullable<typeof o> => !!o);
  if (!oids.length) return error("No valid ids", 400);

  const now = new Date().toISOString();
  patch.updated_date = now;
  patch.last_edited_by_id = caller.id;
  patch.last_edited_by_name = caller.full_name;
  patch.last_edited_at = now;

  const res = await col("funding_transactions").updateMany({ _id: { $in: oids } }, { $set: patch });

  const { updated_date, last_edited_by_id, last_edited_by_name, last_edited_at, ...changed } = patch;
  await col("logs").insertOne({
    timestamp: now,
    user_id: caller.id, user_email: caller.email, user_name: caller.full_name, user_role: caller.app_role,
    action_type: "master_bulk_edit_transaction",
    entity_type: "FundingTransaction",
    entity_id: null,
    details: JSON.stringify({ count: res.modifiedCount, ids, changes: changed }),
    success: true,
    created_date: now,
  } as any);

  return json({ ok: true, matched: res.matchedCount, modified: res.modifiedCount });
}
