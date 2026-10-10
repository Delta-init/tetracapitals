/* ────────────────────────────────────────────────────────────────────────────
   Where a team works and where a student belongs — Dubai or Bangalore (the
   user, 2026-10-10). A team's location is its leader's `team_location` (set
   on the Teams page); none set is Dubai, as every team was before. A new
   student is Bangalore when sold by the Banglore CRM (finance's crm
   "banglore") or arriving from the LMS's Bangalore academy; else Dubai. New
   students go only to teams of their location, and the inactivity rule moves
   students only between teams of the same location (students/intake.ts,
   students/inactivity.ts).

   The academy picked at the close (the user, 2026-10-10): every sales CRM
   asks "Academy: Dubai / Bangalore" and finance passes it on as `academy`
   ("dubai" | "bangalore") — that is this location, and when finance says it,
   it wins over the CRM. An older finance says nothing: the CRM decides, as
   before. Stored on the student as `location`.
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

/**
 * A new student's location: the academy finance says was picked at the close (or the LMS academy they came from)
 * when there is one — it wins; with none, the CRM that sold them (the Banglore CRM's are Bangalore).
 */
export const studentLocationOf = (input: { salesCrm?: unknown; academy?: unknown }): Location =>
  String(input.academy ?? "").trim() ? locationOf(input.academy) : locationOf(input.salesCrm);

/**
 * Where a student is now, as the Students list's Location filter counts them (functions/studentsList.ts): their
 * team's location when they are on a team, else the location they arrived for.
 */
export const currentLocationOf = (student: any, teamLocation: (teamId: string) => Location | undefined): Location =>
  (student?.team_id ? teamLocation(String(student.team_id)) : undefined) ?? locationOf(student?.location);
