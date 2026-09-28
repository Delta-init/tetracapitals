import { col } from "../db";
import type { AuthUser } from "../auth/middleware";

/**
 * Row-level data-scope enforcement for custom/mentor roles.
 *
 * Each role (from the `commission_roles` collection) carries a `data_scope`:
 *   - "all"      → sees every record (admins). No filtering.
 *   - "own"      → only records they own (are the mentor for / created).
 *   - "downline" → their own records plus everyone below them in the Up-Head tree.
 *
 * Only entities listed in SCOPE_FIELDS are row-scoped; every other entity is
 * governed solely by the registry's coarse read policy. The fields listed are
 * OR-matched: a record is "owned" if ANY of them holds one of the allowed ids.
 */
const SCOPE_FIELDS: Record<string, string[]> = {
  Student: ["primary_mentor_id", "senior_mentor_id", "created_by"],
  FundingTransaction: [
    "primary_mentor_id",
    "senior_mentor_id",
    "initiating_mentor_id",
    "requested_by_id",
    "created_by",
  ],
  MentorTarget: ["mentor_id"],
  // Activity logs: a staff sees only their own; a chief sees their downline.
  ActivityLog: ["staff_id"],
};

export type DataScope = "all" | "own" | "downline";

/**
 * Resolve the effective data scope for a user from their role definition.
 * Defaults to "all" (no restriction) when the role has no explicit scope, so
 * built-in admins and any unconfigured role keep full visibility.
 */
export async function getDataScope(user: AuthUser): Promise<DataScope> {
  const role = await col("commission_roles").findOne({ role_key: user.app_role });
  const scope = (role as any)?.data_scope;
  return scope === "own" || scope === "downline" ? scope : "all";
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
  const fields = SCOPE_FIELDS[entityName];
  if (!fields) return null;
  const scope = await getDataScope(user);
  if (scope === "all") return null;
  const ids = scope === "downline" ? await getDownlineIds(user.id) : [user.id];
  return { $or: fields.map((f) => ({ [f]: { $in: ids } })) };
}

/** True if a single already-loaded doc satisfies the given scope filter. */
export function docMatchesScope(doc: any, scopeFilter: Record<string, any> | null): boolean {
  if (!scopeFilter) return true;
  const conds: any[] = scopeFilter.$or || [];
  return conds.some((cond) => {
    const [field, pred] = Object.entries(cond)[0] as [string, any];
    return Array.isArray(pred?.$in) && pred.$in.includes(doc[field]);
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
