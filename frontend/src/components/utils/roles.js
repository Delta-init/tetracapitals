// Single source of truth for role tiers across the frontend.
//
// The app was originally written for a fixed set of built-in roles, with those
// names hardcoded into every access-control check. Roles created at runtime via
// Role Management (e.g. "cs_manager") aren't in those lists, so they fell
// through every gate and got no access.
//
// The rule here mirrors the BACKEND authorization (see backend/src/entities/
// crud.ts): any role that isn't a known built-in is treated as STAFF / mentor
// tier — it can use the app the way a mentor does (own students, own funding,
// raise tickets), while admin-only capabilities stay restricted to built-in
// admin roles. Row-level visibility is further narrowed by the role's
// data_scope (see getScope below and backend/src/lib/scope.ts).

export const BUILTIN_ADMIN_ROLES = [
  'super_admin', 'admin', 'broker_admin', 'academic_head',
  'academic_admin', 'admin_supervisor', 'finance_admin',
];

export const BUILTIN_MENTOR_ROLES = [
  'chief_mentor', 'junior_mentor', 'senior_mentor', 'subjunior_mentor', 'assistance',
];

// Every role name the codebase historically knew about.
export const BUILTIN_ROLES = [...BUILTIN_ADMIN_ROLES, ...BUILTIN_MENTOR_ROLES, 'draw_admin'];

// Display names for the built-in roles, in the order Role Management lists them.
export const BUILTIN_ROLE_NAMES = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  broker_admin: 'Broker Admin',
  academic_head: 'Academic Head',
  academic_admin: 'Academic Admin',
  admin_supervisor: 'Admin Supervisor',
  finance_admin: 'Finance Admin',
  chief_mentor: 'Chief Mentor',
  senior_mentor: 'Senior Mentor',
  junior_mentor: 'Junior Mentor',
  subjunior_mentor: 'Sub Junior Mentor',
  assistance: 'Assistance',
  draw_admin: 'Draw Admin',
};

export const isBuiltinRole = (role) => BUILTIN_ROLES.includes(role);

export const isAdminRole = (role) => BUILTIN_ADMIN_ROLES.includes(role);

// A custom role (not built-in) is treated as mentor/staff tier, alongside the
// built-in mentor roles. This is what lets Role-Management roles work.
export const isCustomRole = (role) => !!role && !isBuiltinRole(role);

export const isMentorRole = (role) =>
  BUILTIN_MENTOR_ROLES.includes(role) || isCustomRole(role);

// Alias reading more naturally at some call sites.
export const isStaffTier = isMentorRole;

// Chief Mentor has everything a Senior Mentor has (plus leading a team), so
// capability checks that used to say "senior_mentor" use this instead.
export const SENIOR_TIER_ROLES = ['chief_mentor', 'senior_mentor'];
export const isSeniorTier = (role) => SENIOR_TIER_ROLES.includes(role);

// ── Visibility (data scope) ────────────────────────────────────────────────
// "own" = their own records, "downline" = their team (everyone under them via
// Up Head), "all" = the whole system, "closed" = the students they closed in a
// sales CRM, to read (the Sales role — custom roles only; see readsClosedOnly).
// Mirrors backend/src/lib/scope.ts.
export const SCOPE_LABELS = { own: 'Own students', downline: 'Team students', all: 'Full system', closed: 'Students they closed' };

export const DEFAULT_SCOPES = {
  chief_mentor: 'downline',
  senior_mentor: 'own',
  junior_mentor: 'own',
};

/**
 * The visibility that applies to `user`: the backend sends `data_scope` on
 * /api/auth/me (Role Management setting or built-in default). Returns null for
 * roles with no setting, meaning "keep the legacy per-role rules".
 */
export const getScope = (user) => {
  if (!user) return null;
  if (isAdminRole(user.app_role)) return 'all';
  const s = user.data_scope;
  if (s === 'own' || s === 'downline' || s === 'all') return s;
  return DEFAULT_SCOPES[user.app_role] ?? null;
};

/**
 * The Sales role: the students they closed in a sales CRM, to read — the server sends no others and takes no
 * changes from them (backend/src/students/closedBy.ts). Kept out of getScope: the pages that follow it are not theirs.
 */
export const readsClosedOnly = (user) => !!user && isCustomRole(user.app_role) && user.data_scope === 'closed';

/** Ids of `userId` and everyone below them in the Up Head tree. */
export const downlineIds = (userId, users = []) => {
  const childrenOf = {};
  for (const u of users) {
    if (u.up_head_id) (childrenOf[u.up_head_id] = childrenOf[u.up_head_id] || []).push(u.id);
  }
  const out = new Set([userId]);
  const queue = [userId];
  while (queue.length) {
    for (const c of childrenOf[queue.shift()] || []) {
      if (!out.has(c)) { out.add(c); queue.push(c); }
    }
  }
  return out;
};
