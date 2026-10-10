import { col } from "../db";
import { teamLocationOf, type Location } from "../lib/location";
import { isMentorRole } from "../lib/roles";

/* ────────────────────────────────────────────────────────────────────────────
   Teams, as the Teams page shows them — for the round of new students, and
   for the team a student is stored against.

   Keep in step with frontend/src/pages/Teams.jsx and teamRootId in
   frontend/src/components/utils/teams.js.

   A team is an Up-Head chain of staff rooted at its top person: climbing stops
   at a Chief Mentor, at a missing parent, or at a parent who isn't staff, so a
   team never runs into the admins. Somebody alone at the top is a team only if
   the team was named (created empty on purpose) — anyone else alone, a Chief
   Mentor included, is unassigned.
──────────────────────────────────────────────────────────────────────────── */

export interface Member {
  id: string;
  name: string;
  role: string;
  /** Account creation time, then id: the order a team's CS people take turns in. */
  key: string;
}

export interface Team {
  /** The leader's id — the team's id. */
  id: string;
  /** The team's name, or its leader's when it has none. */
  name: string;
  leaderName: string;
  /** The leader's account creation time, then id: the order teams take turns in. */
  key: string;
  /** False when the leader's account was switched off from the portal. */
  active: boolean;
  /** Dubai or Bangalore — the leader's `team_location` (lib/location.ts); unset is Dubai. */
  location: Location;
  /** Its CS people not switched off and taking new students (not `no_auto_assign`), in the order their accounts were created. */
  cs: Member[];
}

const keyOf = (u: any) => `${u.created_date ?? ""}|${String(u._id)}`;
const byKey = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const nameOf = (u: any, fallback: string) => String(u?.full_name || u?.email || fallback);

export interface TeamIndex {
  /** Every team, in the order they take turns. */
  teams: Team[];
  /** The team somebody is on, or null for admins and people on their own. */
  teamOf: (userId: unknown) => Team | null;
  /** Everybody, by id — for names and roles. */
  userById: Map<string, any>;
}

export async function loadTeams(): Promise<TeamIndex> {
  const users = (await col("users")
    .find({}, { projection: { full_name: 1, email: 1, app_role: 1, up_head_id: 1, team_name: 1, status: 1, created_date: 1, all_teams_cs_manager: 1, no_auto_assign: 1, team_location: 1 } })
    .toArray()) as any[];
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const isStaff = (u: any) => isMentorRole(String(u?.app_role ?? ""));

  const rootOf = (user: any): string => {
    let cur = user;
    const seen = new Set<string>();
    while (cur && cur.app_role !== "chief_mentor" && cur.up_head_id && !seen.has(String(cur._id))) {
      seen.add(String(cur._id));
      const parent = userById.get(String(cur.up_head_id));
      if (!parent || !isStaff(parent)) break;
      cur = parent;
    }
    return String(cur._id);
  };

  const membersOf = new Map<string, any[]>();
  for (const u of users) {
    if (!isStaff(u)) continue;
    const root = rootOf(u);
    membersOf.set(root, [...(membersOf.get(root) ?? []), u]);
  }

  const teams: Team[] = [];
  const teamByRoot = new Map<string, Team>();
  for (const [id, members] of membersOf) {
    const leader = userById.get(id);
    if (!leader) continue;
    if (members.length === 1 && !leader.team_name) continue;
    const leaderName = nameOf(leader, "Team leader");
    const team: Team = {
      id,
      name: String(leader.team_name || leaderName),
      leaderName,
      key: keyOf(leader),
      active: leader.status !== "inactive",
      location: teamLocationOf(leader),
      cs: members
        // `no_auto_assign` (Personnel → "No new students"): left out of the turns new and moved students go by (the user, 2026-10-09).
        .filter((m) => m.app_role === "cs" && m.status !== "inactive" && m.no_auto_assign !== true)
        .map((m) => ({ id: String(m._id), name: nameOf(m, "CS"), role: "cs", key: keyOf(m) }))
        .sort(byKey),
    };
    teams.push(team);
    teamByRoot.set(id, team);
  }
  teams.sort(byKey);

  const teamOf = (userId: unknown): Team | null => {
    if (!userId) return null;
    const u = userById.get(String(userId));
    if (!u || !isStaff(u)) return null;
    return teamByRoot.get(rootOf(u)) ?? null;
  };

  return { teams, teamOf, userById };
}
