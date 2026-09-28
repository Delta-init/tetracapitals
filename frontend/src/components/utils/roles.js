// Single source of truth for role tiers across the frontend.
//
// The app was originally written for a fixed set of built-in roles, with those
// names hardcoded into every access-control check. Roles created at runtime via
// Role Management (e.g. "chief_mentor") aren't in those lists, so they fell
// through every gate and got no access.
//
// The rule here mirrors the BACKEND authorization (see backend/src/entities/
// crud.ts): any role that isn't a known built-in is treated as STAFF / mentor
// tier — it can use the app the way a mentor does (own students, own funding,
// raise tickets), while admin-only capabilities stay restricted to built-in
// admin roles. Row-level visibility is further narrowed by the role's
// data_scope on the backend.

export const BUILTIN_ADMIN_ROLES = [
  'super_admin', 'admin', 'broker_admin', 'academic_head',
  'academic_admin', 'admin_supervisor', 'finance_admin',
];

export const BUILTIN_MENTOR_ROLES = [
  'junior_mentor', 'senior_mentor', 'subjunior_mentor', 'assistance',
];

// Every role name the codebase historically knew about.
export const BUILTIN_ROLES = [...BUILTIN_ADMIN_ROLES, ...BUILTIN_MENTOR_ROLES, 'draw_admin'];

export const isBuiltinRole = (role) => BUILTIN_ROLES.includes(role);

export const isAdminRole = (role) => BUILTIN_ADMIN_ROLES.includes(role);

// A custom role (not built-in) is treated as mentor/staff tier, alongside the
// built-in mentor roles. This is what lets Role-Management roles work.
export const isCustomRole = (role) => !!role && !isBuiltinRole(role);

export const isMentorRole = (role) =>
  BUILTIN_MENTOR_ROLES.includes(role) || isCustomRole(role);

// Alias reading more naturally at some call sites.
export const isStaffTier = isMentorRole;
