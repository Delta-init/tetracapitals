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

// Order people inside a team for pickers: CS first (they take students), then up the chain.
const PICK_ORDER = ['cs', 'cs_manager', 'junior_mentor', 'subjunior_mentor', 'senior_mentor', 'chief_mentor'];
const pickRank = (role) => { const i = PICK_ORDER.indexOf(role); return i === -1 ? PICK_ORDER.length : i; };

/**
 * The teams as the Teams page shows them: [{ id, name, leader, members }],
 * members sorted CS first. A lone person is a team only when it was named
 * (created empty on purpose), matching Teams.jsx and the backend intake.
 */
export function listTeams(users = []) {
  const byId = {};
  for (const u of users) byId[u.id] = u;
  const grouped = {};
  for (const u of users) {
    if (!isMentorRole(u.app_role) || u.status === 'inactive') continue;
    const rid = teamRootId(u, byId);
    (grouped[rid] = grouped[rid] || []).push(u);
  }
  return Object.entries(grouped)
    .map(([rid, members]) => ({ id: rid, leader: byId[rid], members }))
    .filter(t => t.leader && (t.members.length > 1 || t.leader.team_name))
    .map(t => ({
      ...t,
      name: t.leader.team_name || t.leader.full_name || '—',
      members: [...t.members].sort((a, b) =>
        (pickRank(a.app_role) - pickRank(b.app_role)) || String(a.full_name || '').localeCompare(String(b.full_name || ''))),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The team a user is on (or null). */
export function teamOfUser(userId, teams) {
  return teams.find(t => t.members.some(m => m.id === userId)) || null;
}
