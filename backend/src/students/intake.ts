import { timingSafeEqual } from "node:crypto";
import { col } from "../db";
import { json } from "../lib/response";
import { nextStudentCode } from "../lib/studentCode";
import { loadTeams, type Member, type Team } from "./teams";
import { recordHistory } from "./history";

/* ────────────────────────────────────────────────────────────────────────────
   New Delta students arriving from another system — what the finance and LMS
   intakes (finance/students.ts, lms/students.ts) share.

   Two rounds, one inside the other. The teams take turns — team 1, 2, 3, 4,
   then team 1 again — one round for every intake together; and each team's CS
   people take turns within their team, so it runs team 1 CS1, team 2 CS1,
   team 3 CS1, team 4 CS1, team 1 CS2, … The CS person is the student's primary
   mentor, so commission climbs from them: CS → CS Manager → Junior → Senior →
   Chief. Teams are the ones the Teams page shows (students/teams.ts); they
   take turns in the order their leaders' accounts were created, and a team's
   CS people in the order theirs were.

   A team whose leader was switched off, or that has no CS person who is not
   switched off, sits the round out and rejoins it in its place once it has
   one. With no such team at all the student waits in Delta Open Students
   rather than being lost.

   The team is stored on the student, with who received them first, and both
   go into the student's history (students/history.ts).

   Answers use the same envelope as the LMS's finance routes ({ success, data }
   / { success: false, error: { code, message } }): the callers read the
   reason for a refusal from error.message.
──────────────────────────────────────────────────────────────────────────── */

export const ok = (data: unknown) => json({ success: true, data });
export const refuse = (status: number, code: string, message: string) =>
  json({ success: false, error: { code, message } }, { status });

/** Constant-time comparison; an unset secret never matches. */
export function secretMatches(presented: string | null, expected: string): boolean {
  if (!presented || !expected) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const text = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* One round for every intake. The record keeps the name it was given when
   finance was the only intake, so the round carries on where it is. */
const TURN = "finance_student_team_turn";
/* Each team's own round of its CS people, one record per team. */
export const csTurn = (teamId: string) => `team_cs_turn:${teamId}`;

type Keyed = { key: string };

/**
 * The next in a round: the first after the one that took the last turn,
 * remembered by its place in the order rather than by a count, so somebody
 * added or sitting out neither skips a turn nor gives one two in a row.
 * Compare-and-set, so two students arriving at once cannot take the same turn.
 */
export async function takeNext<T extends Keyed>(recordId: string, inTurn: T[], extra: (next: T) => Record<string, unknown>): Promise<T | null> {
  const counters = col<{ _id: string; last_key?: string }>("counters");
  const state = await counters.findOne({ _id: recordId });
  const last = state?.last_key ?? "";
  const next = inTurn.find((t) => t.key > last) ?? inTurn[0]!;
  const set = { last_key: next.key, ...extra(next), updated_date: new Date().toISOString() };
  try {
    const res = state
      ? await counters.updateOne({ _id: recordId, last_key: last }, { $set: set })
      : await counters.updateOne({ _id: recordId }, { $setOnInsert: set }, { upsert: true });
    if (state ? res.modifiedCount === 1 : res.upsertedCount === 1) return next;
  } catch (err) {
    // Two first-ever students racing to create the turn record: one wins, the other goes round again.
    if ((err as { code?: number }).code !== 11000) throw err;
  }
  return null;
}

/** Whose turn it is: the next team that can take a student, then that team's next CS person. */
async function takeTurn(): Promise<{ team: Team; cs: Member } | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { teams } = await loadTeams();
    const open = teams.filter((t) => t.active && t.cs.length > 0);
    if (!open.length) return null;
    const team = await takeNext(TURN, open, (t) => ({ last_team_id: t.id, last_team_name: t.name }));
    if (!team) continue;
    for (let tries = 0; tries < 5; tries++) {
      const cs = await takeNext(csTurn(team.id), team.cs, (m) => ({ last_cs_id: m.id, last_cs_name: m.name, team_id: team.id }));
      if (cs) return { team, cs };
    }
  }
  throw new Error("Could not take a team's turn — try again");
}

/** Why a student was not made: sent before by the same system ("invoice" / "lms"), or already here by email. */
export type Existing = "invoice" | "lms" | "email" | null;

/**
 * `created` is whether this call made the student. `existing` says why not:
 * "invoice" / "lms" — the same system sent this student before, so they are
 * still its own; "email" — somebody with that address was already here, and
 * was left alone.
 */
export function answer(student: any, created: boolean, existing: Existing, detail: string) {
  return {
    created,
    existing,
    studentId: String(student._id),
    studentCode: String(student.student_code ?? ""),
    assignment: student.assignment_status === "open_pool" ? "open_pool" : "assigned",
    mentorName: String(student.primary_mentor_name ?? ""),
    /** The team this call gave them to; empty when it gave them to nobody. */
    teamName: created ? String(student.team_name ?? "") : "",
    detail,
  };
}

/**
 * Already here by email: a mentor added them, or they came in another way.
 * Left exactly as they are — their mentor, level and notes are not ours to change.
 */
export async function studentWithEmail(email: string) {
  return col("students").findOne({ email: { $regex: `^${escapeRegex(email)}$`, $options: "i" } });
}

/**
 * Makes the student, the way the Students page does, and gives them to the
 * next team's next CS person. `trace` is kept on the record for tracing back
 * to where they came from (the pages ignore it); `arrived` is the first line
 * of their history; `unique` is the field that makes a second delivery of the
 * same student the same student.
 */
export async function createStudent(input: {
  name: string;
  email: string;
  phone: string;
  country: string;
  notes: string;
  trace: Record<string, unknown>;
  arrived: string;
  createdBy: string;
  createdByName: string;
  unique: { field: string; value: string; existing: Exclude<Existing, "email" | null>; detail: string };
}) {
  const students = col("students");
  const turn = await takeTurn();
  const team = turn?.team ?? null;
  const cs = turn?.cs ?? null;
  const now = new Date().toISOString();
  const doc = {
    student_code: await nextStudentCode(),
    full_name: input.name,
    email: input.email,
    phone: input.phone,
    country: input.country,
    notes: input.notes,
    primary_mentor_id: cs?.id ?? "",
    primary_mentor_name: cs?.name ?? "",
    senior_mentor_id: "",
    senior_mentor_name: "",
    assignment_status: cs ? "assigned" : "open_pool",
    status: "ACTIVE",
    student_level: "LEVEL_1",
    // The team they are with now — kept right when their mentor changes (students/history.ts).
    team_id: team?.id ?? "",
    team_name: team?.name ?? "",
    // Who received them first; never changes once set.
    first_assignee_id: cs?.id ?? "",
    first_assignee_name: cs?.name ?? "",
    first_assignee_role: cs ? "cs" : "",
    first_assigned_at: cs ? now : "",
    // When they were given to their current mentor — the inactivity rule's clock.
    assigned_at: cs ? now : "",
    ...input.trace,
    auto_assigned_team_id: team?.id ?? "",
    auto_assigned_team_name: team?.name ?? "",
    created_by: input.createdBy,
    created_by_name: input.createdByName,
    created_date: now,
    updated_date: now,
  };

  let insertedId;
  try {
    insertedId = (await students.insertOne(doc as any)).insertedId;
  } catch (err) {
    // Two deliveries of one student at the same moment: the unique index lets one through.
    if ((err as { code?: number }).code === 11000) {
      const winner = await students.findOne({ [input.unique.field]: input.unique.value });
      if (winner) return answer(winner, false, input.unique.existing, input.unique.detail);
    }
    throw err;
  }

  const where = team && cs
    ? `${cs.name} (CS) of team ${team.name}`
    : "Delta Open Students — no team has a CS person to give them to";
  const base = { student_id: String(insertedId), at: now, by_id: null, by_name: input.createdByName };
  await recordHistory([
    { ...base, type: "arrived", text: input.arrived },
    team && cs
      ? { ...base, type: "assigned", text: `Given to ${where}, in turn`, to: { id: cs.id, name: cs.name, role: "cs", team: team.name } }
      : { ...base, type: "pool_changed", text: `Put in ${where}`, to: "open_pool" },
  ]);

  try {
    // The same activity log the Students page writes to when somebody adds a student.
    await col("logs").insertOne({
      timestamp: now,
      user_id: null,
      user_email: "",
      user_name: input.createdByName,
      user_role: "system",
      action_type: "create_student",
      entity_type: "Student",
      entity_id: String(insertedId),
      details: JSON.stringify({ message: `Created student from Delta LMS: ${input.name} → ${where}` }),
      old_value: null,
      new_value: JSON.stringify(doc),
      ip_address: null,
      success: true,
      created_date: now,
      updated_date: now,
    } as any);
  } catch (err) {
    // The student is what matters; a missing log line must not undo them.
    console.error("[student intake] could not write the activity log", err);
  }

  return answer({ _id: insertedId, ...doc }, true, null, `Created ${doc.student_code} for ${where}`);
}
