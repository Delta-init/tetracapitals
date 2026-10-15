import { col } from "../db";
import { toObjectId } from "../lib/id";
import { currentLocationOf, locationOf, type Location } from "../lib/location";
import { teamIndex } from "../lib/userLocation";
import type { TeamIndex } from "../students/teams";

/* ────────────────────────────────────────────────────────────────────────────
   A Bangalore team's bonus stays with Bangalore (the user, 2026-10-15): its
   payment goes to finance's Bangalore organization, in rupees (finance/
   funding.ts), and only a Bangalore broker admin — or a Super Admin, who
   decides any — is told of it and may approve, reject or send it back here.
   Dubai's bonuses are Dubai's broker admins' the same way.

   A bonus's location is its student's now: their team's (its leader's
   `team_location`), else the location they arrived for (lib/location.ts).
   A broker admin's is their own `team_location` (Personnel → edit), unset
   Dubai.
──────────────────────────────────────────────────────────────────────────── */

const BONUS_DECIDERS = ["broker_admin", "super_admin"];

/** Where each student belongs now, by id. */
export async function studentLocations(studentIds: unknown[], index?: TeamIndex): Promise<Map<string, Location>> {
  const ids = [...new Set(studentIds.map((v) => String(v ?? "")).filter(Boolean))].map(toObjectId).filter(Boolean);
  if (!ids.length) return new Map();
  const idx = index ?? (await teamIndex());
  const teamLocation = (id: string) => idx.teams.find((t) => t.id === id)?.location;
  const students = (await col("students").find({ _id: { $in: ids as any[] } }, { projection: { team_id: 1, location: 1 } }).toArray()) as any[];
  return new Map(students.map((s) => [String(s._id), currentLocationOf(s, teamLocation)]));
}

/** Where a bonus belongs: its student's location now (Dubai when there is no student). */
export async function bonusLocationOf(tx: any, index?: TeamIndex): Promise<Location> {
  const sid = String(tx?.student_id ?? "");
  if (!sid) return "dubai";
  return (await studentLocations([sid], index)).get(sid) ?? "dubai";
}

/** The one location a broker admin decides bonuses for; null for a Super Admin (any). */
export const brokerLocationOf = (user: { app_role?: string; team_location?: unknown } | null | undefined): Location | null =>
  user?.app_role === "broker_admin" ? locationOf(user.team_location) : null;

const LABEL: Record<Location, string> = { dubai: "Dubai", bangalore: "Bangalore" };

/** Why this broker admin may not decide this bonus, or null. Only bonuses; a Super Admin decides any. */
export async function bonusLocationRefusal(tx: any, userId: string, role: string): Promise<string | null> {
  if (tx?.type !== "BONUS" || role !== "broker_admin") return null;
  const me: any = await col("users").findOne({ _id: toObjectId(userId) as any }, { projection: { app_role: 1, team_location: 1 } });
  const mine = brokerLocationOf(me ?? { app_role: role });
  const its = await bonusLocationOf(tx);
  if (!mine || mine === its) return null;
  return `This is a ${LABEL[its]} team's bonus — a ${LABEL[its]} broker admin or a Super Admin decides it`;
}

/** Who is told of a bonus to decide: Super Admins, and the broker admins of its location. */
export async function bonusDeciderIds(location: Location): Promise<string[]> {
  const users = (await col("users")
    .find({ app_role: { $in: BONUS_DECIDERS }, status: { $ne: "inactive" } }, { projection: { _id: 1, app_role: 1, team_location: 1 } })
    .toArray()) as any[];
  return users.filter((u) => u.app_role === "super_admin" || brokerLocationOf(u) === location).map((u) => String(u._id));
}

/** Keeps the rows a broker admin decides: their location's bonuses, and every other request. A Super Admin keeps all. */
export async function forBrokerLocation<T extends { type?: string; student_id?: unknown }>(rows: T[], user: { id: string; app_role: string }): Promise<T[]> {
  if (user.app_role !== "broker_admin") return rows;
  const me: any = await col("users").findOne({ _id: toObjectId(user.id) as any }, { projection: { app_role: 1, team_location: 1 } });
  const mine = brokerLocationOf(me ?? user);
  if (!mine) return rows;
  const where = await studentLocations(rows.filter((r) => r.type === "BONUS").map((r) => r.student_id));
  return rows.filter((r) => r.type !== "BONUS" || (where.get(String(r.student_id ?? "")) ?? "dubai") === mine);
}
