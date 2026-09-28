import { isMentorRole } from './roles';

// A "team" is the Up Head chain CS -> CS Manager -> Junior -> Senior -> Chief,
// rooted at its top-most staff member (normally the Chief Mentor). Used by the
// Teams page and anywhere that needs "people on my team".

// Climb Up Head to the team's root id. The Chief Mentor is the top of a team, so
// climbing stops there even if the Chief has an Up Head of their own (otherwise
// several Chiefs under one person would merge into a single giant team). Also
// stops at a missing or non-staff parent so a team never crosses into admins.
export function teamRootId(user, byId) {
  let cur = user;
  const seen = new Set();
  while (cur && cur.app_role !== 'chief_mentor' && cur.up_head_id && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = byId[cur.up_head_id];
    if (!parent || !isMentorRole(parent.app_role)) break;
    cur = parent;
  }
  return cur?.id;
}

// Everyone (staff-tier) on the same team as `user`, including `user`.
export function teamMembersOf(user, users) {
  if (!user) return [];
  const byId = {};
  for (const u of users) byId[u.id] = u;
  const me = byId[user.id] || user;
  const root = teamRootId(me, byId);
  return users.filter(u => isMentorRole(u.app_role) && teamRootId(u, byId) === root);
}
