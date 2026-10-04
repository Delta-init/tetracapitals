import { col } from "../db";
import type { AuthUser } from "../auth/middleware";
import { isAdminRole, isCustomRole } from "./roles";

/**
 * Row-level data-scope enforcement.
 *
 * Each role carries a `data_scope` (set in Role Management, stored on the
 * `commission_roles` doc with that role_key; built-in mentor roles fall back to
 * DEFAULT_SCOPES below):
 *   - "all"      → sees every record. No filtering.
 *   - "own"      → only records they own (are the mentor for / created).
 *   - "downline" → their own records plus everyone below them in the Up-Head
 *                  tree (their team). Shown as "Team" in the UI.
 *   - "closed"   → the Sales role's: the students they closed in a sales CRM,
 *                  to read (custom roles only — closedScope below).
 *
 * Two groups of entities are row-scoped:
 *   - COMMISSION_FIELDS: commission money. Scoped for every non-admin role, so
 *     a mentor can't pull other people's commission from the API.
 *   - OWN_FIELDS: students / funding / targets / activity. Scoped on the
 *     backend for custom roles only. Built-in mentor roles are filtered in the
 *     UI (by the same scope) because some mentor flows need the wider list,
 *     e.g. the new-student duplicate check and co-managed students.
 * The fields listed are OR-matched: a record is in scope if ANY of them holds
 * one of the allowed ids. A dotted field reaches into a list ("common_cs.id":
 * the CSs a student is Common with — on two CSs' own sheets, both have them).
 */
const OWN_FIELDS: Record<string, string[]> = {
  Student: ["primary_mentor_id", "created_by", "common_cs.id"],
  FundingTransaction: ["primary_mentor_id", "initiating_mentor_id", "requested_by_id", "created_by"],
  MentorTarget: ["mentor_id"],
  // Activity logs: a staff sees only their own; a chief sees their downline.
  ActivityLog: ["staff_id"],
};
// Team views also match the "senior mentor" link on students / funding.
const DOWNLINE_EXTRA_FIELDS: Record<string, string[]> = {
  Student: ["senior_mentor_id"],
  FundingTransaction: ["senior_mentor_id"],
};
const COMMISSION_FIELDS: Record<string, string[]> = {
  CommissionCredit: ["recipient_id"],
  CommissionLedger: ["mentor_id"],
  Commission: ["mentor_id"],
  ManualCommissionAdjustment: ["mentor_id"],
  PayoutTransaction: ["mentor_id"],
};

/**
 * "closed" is the Sales role's (custom roles only): the students they closed in a sales CRM (students.closed_by —
 * see students/closedBy.ts) with those students' deposits and MT5 accounts, the lists every page needs, their own
 * notifications and commission — and nothing else of anyone's, whatever the entity (closedScope below).
 */
export type DataScope = "all" | "own" | "downline" | "closed";

/** Visibility for built-in mentor roles that have no Role Management setting. */
export const DEFAULT_SCOPES: Record<string, DataScope> = {
  chief_mentor: "downline",
  senior_mentor: "own",
  junior_mentor: "own",
};

const isScope = (v: unknown): v is DataScope => v === "all" || v === "own" || v === "downline" || v === "closed";

/**
 * The scope configured for a role (Role Management setting, else the built-in
 * default), or null when the role has none — callers treat null as "all" on
 * the backend and as "use the legacy per-role rules" in the UI. Admins are
 * always "all".
 */
export async function getConfiguredScope(user: AuthUser): Promise<DataScope | null> {
  if (isAdminRole(user.app_role)) return "all";
  const role = await col("commission_roles").findOne({ role_key: user.app_role });
  const scope = (role as any)?.data_scope;
  // "closed" holds for custom roles only: a built-in mentor role's students are not scoped on the backend.
  if (isScope(scope) && (scope !== "closed" || isCustomRole(user.app_role))) return scope;
  return DEFAULT_SCOPES[user.app_role] ?? null;
}

/** Effective scope for backend filtering: unconfigured roles see everything. */
export async function getDataScope(user: AuthUser): Promise<DataScope> {
  return (await getConfiguredScope(user)) ?? "all";
}

/**
 * All user ids at or below `userId` in the Up-Head hierarchy (inclusive).
 * up_head_id points from a user to their manager, so we invert it into a
 * children map and BFS downward.
 */
export async function getDownlineIds(userId: string): Promise<string[]> {
  const users = await col("users")
    .find({}, { projection: { _id: 1, up_head_id: 1 } })
    .toArray();
  const childrenOf: Record<string, string[]> = {};
  for (const u of users as any[]) {
    const parent = u.up_head_id ? String(u.up_head_id) : null;
    if (parent) (childrenOf[parent] ||= []).push(String(u._id));
  }
  const result = new Set<string>([userId]);
  const queue = [userId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const child of childrenOf[cur] || []) {
      if (!result.has(child)) {
        result.add(child);
        queue.push(child);
      }
    }
  }
  return [...result];
}

/**
 * Build a Mongo filter fragment restricting an entity query to what `user` may
 * see, or null when no restriction applies (scope "all", or entity not scoped).
 */
export async function buildScopeFilter(
  user: AuthUser,
  entityName: string,
): Promise<Record<string, any> | null> {
  const commission = COMMISSION_FIELDS[entityName];
  const general = OWN_FIELDS[entityName];
  const custom = isCustomRole(user.app_role);
  if (!commission && !custom) return null;
  const scope = await getDataScope(user);
  // The Sales role: every entity, not just the scoped ones. Their own commission records fall through to "own".
  if (scope === "closed" && !commission) return closedScope(user, entityName);
  if (!commission && !general) return null;
  if (scope === "all") return null;
  const ids = scope === "downline" ? await getDownlineIds(user.id) : [user.id];
  const fields = commission
    ? commission
    : [...general, ...(scope === "downline" ? DOWNLINE_EXTRA_FIELDS[entityName] || [] : [])];
  return { $or: fields.map((f) => ({ [f]: { $in: ids } })) };
}

/* The Sales role ("closed"): what each entity shows them — anything not named here shows nothing. */
// Lists every page needs: the role's pages (the sidebar), the student tags and the products.
const CLOSED_OPEN = new Set(["CommissionRole", "StudentTag", "TransactionTag"]);
// A student's own records, by the field naming the student: their deposits and MT5 accounts.
const CLOSED_BY_STUDENT: Record<string, string> = { FundingTransaction: "student_id", MT5Account: "student_id" };

async function closedScope(user: AuthUser, entityName: string): Promise<Record<string, any> | null> {
  const none = { $or: [{ _id: { $in: [] } }] };
  if (CLOSED_OPEN.has(entityName)) return null;
  if (entityName === "Notification") return { $or: [{ user_id: { $in: [user.id] } }] };
  const me = String(user.email ?? "").trim().toLowerCase();
  if (!me) return none;
  if (entityName === "Student") return { $or: [{ "closed_by.email": { $in: [me] } }] };
  const field = CLOSED_BY_STUDENT[entityName];
  if (!field) return none;
  const ids = (await col("students").find({ "closed_by.email": me }, { projection: { _id: 1 } }).toArray()).map((s) => String(s._id));
  return { $or: [{ [field]: { $in: ids } }] };
}

/** The values at a field, through lists as Mongo does: "common_cs.id" → each entry's id. */
function valuesAt(doc: any, field: string): unknown[] {
  let vals: any[] = [doc];
  for (const key of field.split(".")) vals = vals.flatMap((v) => (Array.isArray(v) ? v : [v])).map((v) => v?.[key]);
  return vals.flatMap((v) => (Array.isArray(v) ? v : [v]));
}

/** True if a single already-loaded doc satisfies the given scope filter. */
export function docMatchesScope(doc: any, scopeFilter: Record<string, any> | null): boolean {
  if (!scopeFilter) return true;
  const conds: any[] = scopeFilter.$or || [];
  return conds.some((cond) => {
    const [field, pred] = Object.entries(cond)[0] as [string, any];
    return Array.isArray(pred?.$in) && valuesAt(doc, field).some((v) => pred.$in.includes(v));
  });
}

/** Merge a scope filter into an existing query with AND semantics. */
export function applyScope(
  base: Record<string, any>,
  scopeFilter: Record<string, any> | null,
): Record<string, any> {
  if (!scopeFilter) return base;
  if (!base || Object.keys(base).length === 0) return scopeFilter;
  return { $and: [base, scopeFilter] };
}
