/**
 * Single source of truth for role TIERS on the backend.
 *
 * Mirrors frontend/src/components/utils/roles.js. Roles created at runtime via
 * Role Management (e.g. "chief_mentor") are not part of the built-in Role union
 * the registry policies are written in terms of. The rule: any role that is not
 * a known built-in is treated as STAFF / mentor tier — it can use the app like a
 * mentor (own students / funding / commissions), while admin-only capabilities
 * stay restricted to built-in admin roles. Row-level visibility is further
 * narrowed by the role's data_scope (see scope.ts).
 */

export const BUILTIN_ADMIN_ROLES = [
  "super_admin", "admin", "broker_admin", "academic_head",
  "academic_admin", "admin_supervisor", "finance_admin",
] as const;

export const BUILTIN_MENTOR_ROLES = [
  "junior_mentor", "senior_mentor", "subjunior_mentor", "assistance",
] as const;

export const BUILTIN_ROLES = [
  ...BUILTIN_ADMIN_ROLES, ...BUILTIN_MENTOR_ROLES, "draw_admin",
] as const;

export function isBuiltinRole(role: string): boolean {
  return (BUILTIN_ROLES as readonly string[]).includes(role);
}

export function isAdminRole(role: string): boolean {
  return (BUILTIN_ADMIN_ROLES as readonly string[]).includes(role);
}

/** A role created via Role Management (not one of the built-ins). */
export function isCustomRole(role: string): boolean {
  return !!role && !isBuiltinRole(role);
}

/** Built-in mentor roles PLUS any custom role — the "staff" tier. */
export function isMentorRole(role: string): boolean {
  return (BUILTIN_MENTOR_ROLES as readonly string[]).includes(role) || isCustomRole(role);
}
