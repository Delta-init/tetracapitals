import { col } from "../db";
import type { AuthUser } from "../auth/middleware";
import { loadTeams, type TeamIndex } from "./teams";

/* ────────────────────────────────────────────────────────────────────────────
   A student's history, one line per thing that happened to them.

   Written by the server wherever a student is made or changed — the finance
   and LMS intakes, and every create and update through the entity API, which
   is what the Students page, transfer approvals, open-pool pick-ups and admin
   edits all go through — so no screen can change a student without it being
   recorded. Read back by getStudentHistory for the student's page.

   Also where the student's stored team is kept right: it is set when they are
   given to somebody and worked out again whenever their mentor changes.
──────────────────────────────────────────────────────────────────────────── */

export type HistoryType =
  | "arrived"
  | "created"
  | "assigned"
  | "mentor_changed"
  | "senior_mentor_changed"
  | "level_changed"
  | "status_changed"
  | "pool_changed"
  | "enrolment_changed";

export interface HistoryEntry {
  student_id: string;
  at: string;
  type: HistoryType;
  text: string;
  by_id: string | null;
  by_name: string;
  from?: unknown;
  to?: unknown;
  /** What made the change, when it wasn't a plain edit: "reassign" (Team page) or "inactivity" (the 90-day rule). */
  via?: string;
}

export async function recordHistory(entries: HistoryEntry[]): Promise<void> {
  if (!entries.length) return;
  try {
    await col("student_history").insertMany(entries as any[]);
  } catch (err) {
    // The change itself is what matters; a lost history line must not undo it.
    console.error("[student history] could not record", err);
  }
}

const ROLE_LABELS: Record<string, string> = {
  cs: "CS", cs_manager: "CS Manager", junior_mentor: "Junior Mentor", senior_mentor: "Senior Mentor",
  chief_mentor: "Chief Mentor", subjunior_mentor: "Sub Junior Mentor", assistance: "Assistance",
  motivational_reserve: "Motivational Reserve",
};
export const roleLabel = (role: unknown) =>
  ROLE_LABELS[String(role ?? "")] ?? String(role ?? "").split("_").filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");

/** "Aisha (CS) of team Falcons" — who somebody is, as the history says it. */
export function describePerson(index: TeamIndex, id: unknown, fallbackName: unknown): string {
  const u = id ? index.userById.get(String(id)) : null;
  const name = String(fallbackName || u?.full_name || u?.email || "somebody");
  const role = u?.app_role ? ` (${roleLabel(u.app_role)})` : "";
  const team = index.teamOf(id);
  return `${name}${role}${team ? ` of team ${team.name}` : ""}`;
}

// `assigned_at` is when they were given to their current mentor — the clock the
// inactivity rule (inactivity.ts) counts from. Never set by a client.
const SERVER_OWNED = ["team_id", "team_name", "first_assignee_id", "first_assignee_name", "first_assignee_role", "first_assigned_at", "assigned_at"];

/**
 * Before a student is made in Tetra Commission itself (the Students page, or
 * an import): the team they are stored against and who received them first,
 * both from the mentor they are made with. Nobody yet — they wait in Delta Open
 * Students — and both are set when somebody first takes them.
 */
export async function stampNewStudents(items: Record<string, any>[], index?: TeamIndex): Promise<TeamIndex> {
  const teams = index ?? (await loadTeams());
  for (const s of items) {
    for (const f of SERVER_OWNED) delete s[f];
    const mentorId = s.primary_mentor_id ? String(s.primary_mentor_id) : "";
    const team = mentorId ? teams.teamOf(mentorId) : null;
    s.team_id = team?.id ?? "";
    s.team_name = team?.name ?? "";
    if (mentorId) {
      const u = teams.userById.get(mentorId);
      s.first_assignee_id = mentorId;
      s.first_assignee_name = String(s.primary_mentor_name || u?.full_name || "");
      s.first_assignee_role = String(u?.app_role ?? "");
      s.first_assigned_at = s.created_date ?? new Date().toISOString();
      s.assigned_at = s.first_assigned_at;
    }
  }
  return teams;
}

/** After students are made in Tetra Commission itself: "added by", and who they were given to. */
export async function recordCreated(docs: any[], user: AuthUser, how: "created" | "imported", index: TeamIndex): Promise<void> {
  const entries: HistoryEntry[] = [];
  const who = user.full_name || user.email || "somebody";
  for (const d of docs) {
    const at = String(d.created_date ?? new Date().toISOString());
    const base = { student_id: String(d._id), at, by_id: user.id, by_name: who };
    entries.push({ ...base, type: "created", text: how === "imported" ? `Imported by ${who}` : `Added by ${who}` });
    if (d.primary_mentor_id) {
      entries.push({
        ...base, type: "assigned",
        text: `Given to ${describePerson(index, d.primary_mentor_id, d.primary_mentor_name)}`,
        to: { id: String(d.primary_mentor_id), name: d.primary_mentor_name, team: d.team_name || null },
      });
    }
  }
  await recordHistory(entries);
}

const same = (a: unknown, b: unknown) => String(a ?? "") === String(b ?? "");

/**
 * Before an update is saved: keeps the server's own fields right and returns
 * the history lines to record once it is.
 *
 * - who received them first never changes once set; the first time a student
 *   is given to somebody (taken from Delta Open Students, say) it is set;
 * - the stored team is worked out again whenever the mentor changes, and
 *   filled in for a student who has a mentor but no team yet.
 */
export async function prepareStudentUpdate(existing: any, data: Record<string, any>, user: AuthUser): Promise<HistoryEntry[]> {
  for (const f of SERVER_OWNED) delete data[f];
  const changed = (f: string) => f in data && !same(data[f], existing[f]);
  const now = String(data.updated_date ?? new Date().toISOString());
  const base = { student_id: String(existing._id), at: now, by_id: user.id, by_name: user.full_name || user.email || "somebody" };
  const entries: HistoryEntry[] = [];

  const mentorChanged = changed("primary_mentor_id");
  if (mentorChanged || (existing.primary_mentor_id && !existing.team_id) || changed("senior_mentor_id")) {
    const index = await loadTeams();
    const mentorId = String((mentorChanged ? data.primary_mentor_id : existing.primary_mentor_id) ?? "");
    const team = mentorId ? index.teamOf(mentorId) : null;
    if (mentorChanged || !existing.team_id) {
      data.team_id = team?.id ?? "";
      data.team_name = team?.name ?? "";
    }

    if (mentorChanged) {
      data.assigned_at = mentorId ? now : "";
      const toName = data.primary_mentor_name ?? index.userById.get(mentorId)?.full_name ?? "";
      if (mentorId && !existing.first_assignee_id) {
        const u = index.userById.get(mentorId);
        data.first_assignee_id = mentorId;
        data.first_assignee_name = String(toName || "");
        data.first_assignee_role = String(u?.app_role ?? "");
        data.first_assigned_at = now;
        entries.push({
          ...base, type: "assigned",
          text: `Given to ${describePerson(index, mentorId, toName)}${existing.assignment_status === "open_pool" ? ", from Delta Open Students" : ""}`,
          to: { id: mentorId, name: toName, team: team?.name ?? null },
        });
      } else {
        const fromTeam = existing.team_name || index.teamOf(existing.primary_mentor_id)?.name || "";
        const toTeam = team?.name ?? "";
        entries.push({
          ...base, type: "mentor_changed",
          text: `CS changed from ${existing.primary_mentor_name || "nobody"} to ${mentorId ? describePerson(index, mentorId, toName) : "nobody"}` +
            (fromTeam !== toTeam ? ` — team ${fromTeam || "none"} → ${toTeam || "none"}` : ""),
          from: { id: existing.primary_mentor_id ?? "", name: existing.primary_mentor_name ?? "", team: fromTeam || null },
          to: { id: mentorId, name: toName, team: toTeam || null },
        });
      }
    }

    if (changed("senior_mentor_id")) {
      const toName = data.senior_mentor_name ?? index.userById.get(String(data.senior_mentor_id ?? ""))?.full_name ?? "";
      entries.push({
        ...base, type: "senior_mentor_changed",
        text: `Senior mentor changed from ${existing.senior_mentor_name || "nobody"} to ${toName || "nobody"}`,
        from: { id: existing.senior_mentor_id ?? "", name: existing.senior_mentor_name ?? "" },
        to: { id: String(data.senior_mentor_id ?? ""), name: toName },
      });
    }
  }

  if (changed("student_level")) {
    const label = (l: unknown) => (String(l) === "LEVEL_2" ? "Level 2" : String(l) === "LEVEL_1" ? "Level 1" : String(l || "none"));
    entries.push({ ...base, type: "level_changed", text: `Level changed from ${label(existing.student_level)} to ${label(data.student_level)}`, from: existing.student_level ?? null, to: data.student_level ?? null });
  }
  if (changed("status")) {
    entries.push({ ...base, type: "status_changed", text: `Status changed from ${existing.status || "none"} to ${data.status || "none"}`, from: existing.status ?? null, to: data.status ?? null });
  }
  if (changed("assignment_status") && data.assignment_status === "open_pool") {
    entries.push({ ...base, type: "pool_changed", text: "Moved to Delta Open Students", from: existing.assignment_status ?? null, to: "open_pool" });
  }
  return entries;
}
