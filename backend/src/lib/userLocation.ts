import { loadTeams, type TeamIndex } from "../students/teams";
import { locationOf, type Location } from "./location";
import { isMentorRole } from "./roles";

/* ────────────────────────────────────────────────────────────────────────────
   Dubai and Bangalore kept apart (the user, 2026-10-14): a CS Manager's
   "everyone" is everyone in their own location — Doney Dubai's, ambili B
   Bangalore's — and so are the leaderboard, the reports and the rest.

   Somebody's location is their team's (its leader's `team_location`, unset
   Dubai — students/teams.ts). The CS Manager over every team has no team of
   their own: their own `team_location`, unset Dubai.
──────────────────────────────────────────────────────────────────────────── */

// The teams change rarely and many calls ask: kept for a few seconds.
let cached: { at: number; index: Promise<TeamIndex> } | null = null;
export function teamIndex(): Promise<TeamIndex> {
  if (!cached || Date.now() - cached.at > 15_000) cached = { at: Date.now(), index: loadTeams() };
  return cached.index;
}

const isOverAll = (u: any) => u?.app_role === "cs_manager" && u?.all_teams_cs_manager === true;

/** Dubai or Bangalore: the person's team's, the CS Manager over every team their own (unset Dubai). */
export async function locationOfUser(userId: unknown, index?: TeamIndex): Promise<Location> {
  const idx = index ?? (await teamIndex());
  const u = idx.userById.get(String(userId ?? ""));
  if (isOverAll(u)) return locationOf(u.team_location);
  return idx.teamOf(userId)?.location ?? "dubai";
}

/** Every staff member (CS, CS Manager, mentors) whose location this is. */
export async function staffIdsIn(location: Location, index?: TeamIndex): Promise<string[]> {
  const idx = index ?? (await teamIndex());
  const out: string[] = [];
  for (const [id, u] of idx.userById) {
    if (!isMentorRole(String(u?.app_role ?? ""))) continue;
    if ((await locationOfUser(id, idx)) === location) out.push(id);
  }
  return out;
}

/** A CS Manager's reach — their location and its staff — or null for anyone else. */
export async function csManagerReach(user: { id: string; app_role: string }): Promise<{ location: Location; ids: string[] } | null> {
  if (user.app_role !== "cs_manager") return null;
  const idx = await teamIndex();
  const location = await locationOfUser(user.id, idx);
  return { location, ids: await staffIdsIn(location, idx) };
}

/** A Mongo match for students whose CS (or a CS they're Common with) is one of `ids`. */
export const studentsOfIds = (ids: string[]) => ({ $or: [{ primary_mentor_id: { $in: ids } }, { "common_cs.id": { $in: ids } }] });
/** A Mongo match for funding requests raised for or by one of `ids`. */
export const fundingOfIds = (ids: string[]) => ({ $or: [{ primary_mentor_id: { $in: ids } }, { initiating_mentor_id: { $in: ids } }, { requested_by_id: { $in: ids } }] });
