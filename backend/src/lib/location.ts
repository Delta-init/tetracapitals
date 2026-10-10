/* ────────────────────────────────────────────────────────────────────────────
   Where a team works and where a student belongs — Dubai or Bangalore (the
   user, 2026-10-10). A team's location is its leader's `team_location` (set
   on the Teams page); none set is Dubai, as every team was before. A new
   student is Bangalore when sold by the Banglore CRM (finance's crm
   "banglore") or arriving from the LMS's Bangalore academy; else Dubai. New
   students go only to teams of their location, and the inactivity rule moves
   students only between teams of the same location (students/intake.ts,
   students/inactivity.ts).
──────────────────────────────────────────────────────────────────────────── */

export const LOCATIONS = ["dubai", "bangalore"] as const;
export type Location = (typeof LOCATIONS)[number];
export const LOCATION_LABELS: Record<Location, string> = { dubai: "Dubai", bangalore: "Bangalore" };

/** "bangalore" / "banglore" / "Bangalore Academy" → bangalore; anything else (or nothing) → dubai. */
export function locationOf(raw: unknown): Location {
  return /bangal|banglo|bengal/i.test(String(raw ?? "")) ? "bangalore" : "dubai";
}

/** A team's location, from its leader's account. */
export const teamLocationOf = (leader: any): Location => locationOf(leader?.team_location);

/** A new student's location: the CRM that sold them, or the LMS academy they came from. */
export const studentLocationOf = (input: { salesCrm?: unknown; academy?: unknown }): Location =>
  locationOf(input.salesCrm) === "bangalore" || locationOf(input.academy) === "bangalore" ? "bangalore" : "dubai";
