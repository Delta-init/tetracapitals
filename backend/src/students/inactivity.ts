import { col } from "../db";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { loadTeams, type Team, type TeamIndex } from "./teams";
import { takeNext, csTurn } from "./intake";
import { prepareStudentUpdate, recordHistory } from "./history";

/* ────────────────────────────────────────────────────────────────────────────
   The inactivity rule: a student held by a CS who has had no APPROVED DEPOSIT
   for `days` (90) days is moved to the next team's CS, in turn.

   - Only students given out since the rule existed: they carry `assigned_at`
     (set by history.ts / intake.ts whenever a student is given to somebody).
     Older students have none and are never touched.
   - Only students whose current mentor is a CS, and who are ACTIVE.
   - The clock is the later of `assigned_at` and their last approved deposit,
     so a transfer (manual or by this rule) starts a fresh `days`.
   - Where they go: the next team in this rule's own turn, skipping the team
     they are on now, then that team's next CS (the same CS rotation new
     students use). No other team with CS → left where they are, reported.
   - Off until a Super Admin switches it on; runs once a day when on.
──────────────────────────────────────────────────────────────────────────── */

const SETTINGS_ID = "inactivity_transfer";
const TEAM_TURN = "inactivity_team_turn";
const DAY_MS = 86_400_000;

export interface InactivitySettings {
  enabled: boolean;
  days: number;
  last_run_at?: string;
  last_run_moved?: number;
  last_run_left?: number;
  updated_by_name?: string;
  updated_date?: string;
}

export async function getSettings(): Promise<InactivitySettings> {
  const doc: any = await col("app_settings").findOne({ _id: SETTINGS_ID } as any);
  return { enabled: !!doc?.enabled, days: Number(doc?.days) > 0 ? Number(doc.days) : 90, ...(doc ? {
    last_run_at: doc.last_run_at, last_run_moved: doc.last_run_moved, last_run_left: doc.last_run_left,
    updated_by_name: doc.updated_by_name, updated_date: doc.updated_date,
  } : {}) };
}

export async function saveSettings(patch: Partial<InactivitySettings>): Promise<InactivitySettings> {
  await col("app_settings").updateOne({ _id: SETTINGS_ID } as any, { $set: patch }, { upsert: true });
  return getSettings();
}

export interface DueStudent {
  id: string;
  name: string;
  code: string;
  mentorId: string;
  mentorName: string;
  teamId: string;
  teamName: string;
  since: string;          // later of assigned_at and last approved deposit
  lastDeposit: string | null;
  idleDays: number;
}

/** Students the rule watches, and which of them are due now. */
export async function findDue(days: number, index?: TeamIndex): Promise<{ watched: number; due: DueStudent[]; index: TeamIndex }> {
  const teams = index ?? (await loadTeams());
  const now = Date.now();
  const cutoff = new Date(now - days * DAY_MS).toISOString();
  const csIds = [...teams.userById.values()].filter((u: any) => u.app_role === "cs").map((u: any) => String(u._id));
  const students = (await col("students")
    .find(
      { status: "ACTIVE", assigned_at: { $nin: [null, ""] }, primary_mentor_id: { $in: csIds } },
      { projection: { full_name: 1, student_code: 1, primary_mentor_id: 1, primary_mentor_name: 1, assigned_at: 1, team_id: 1, team_name: 1 } },
    )
    .toArray()) as any[];

  // Last approved deposit per student (approved_at, else when it was requested).
  const lastDeposit = new Map<string, string>();
  if (students.length) {
    const txs = await col("funding_transactions")
      .find(
        { student_id: { $in: students.map((s) => String(s._id)) }, type: "DEPOSIT", status: "APPROVED" },
        { projection: { student_id: 1, approved_at: 1, requested_at: 1, created_date: 1 } },
      )
      .toArray();
    for (const t of txs as any[]) {
      const at = String(t.approved_at || t.requested_at || t.created_date || "");
      if (at && at > (lastDeposit.get(String(t.student_id)) ?? "")) lastDeposit.set(String(t.student_id), at);
    }
  }

  const due: DueStudent[] = [];
  for (const s of students) {
    const last = lastDeposit.get(String(s._id)) ?? null;
    const since = last && last > s.assigned_at ? last : String(s.assigned_at);
    if (since >= cutoff) continue;
    const team = teams.teamOf(s.primary_mentor_id);
    due.push({
      id: String(s._id), name: String(s.full_name ?? ""), code: String(s.student_code ?? ""),
      mentorId: String(s.primary_mentor_id), mentorName: String(s.primary_mentor_name ?? ""),
      teamId: team?.id ?? String(s.team_id ?? ""), teamName: team?.name ?? String(s.team_name ?? ""),
      since, lastDeposit: last, idleDays: Math.floor((now - Date.parse(since)) / DAY_MS),
    });
  }
  due.sort((a, b) => (a.since < b.since ? -1 : 1));
  return { watched: students.length, due, index: teams };
}

/** The next team (not `fromTeamId`) and that team's next CS. */
async function nextTeamCs(teams: Team[], fromTeamId: string) {
  const open = teams.filter((t) => t.active && t.cs.length > 0 && t.id !== fromTeamId);
  if (!open.length) return null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const team = await takeNext(TEAM_TURN, open, (t) => ({ last_team_id: t.id, last_team_name: t.name }));
    if (!team) continue;
    for (let tries = 0; tries < 5; tries++) {
      const cs = await takeNext(csTurn(team.id), team.cs, (m) => ({ last_cs_id: m.id, last_cs_name: m.name, team_id: team.id }));
      if (cs) return { team, cs };
    }
  }
  return null;
}

const SYSTEM: AuthUser = { id: "system", email: "", full_name: "Inactivity rule", app_role: "super_admin" } as AuthUser;

/**
 * Move every due student. `by` is who asked (a Super Admin's "Run now"), or
 * the daily worker. Returns what happened.
 */
export async function runInactivity(by: AuthUser = SYSTEM): Promise<{ moved: number; left: { student: string; reason: string }[] }> {
  const settings = await getSettings();
  const { due, index } = await findDue(settings.days);
  const now = new Date().toISOString();
  let moved = 0;
  const left: { student: string; reason: string }[] = [];

  for (const d of due) {
    const target = await nextTeamCs(index.teams, d.teamId);
    if (!target) { left.push({ student: d.name, reason: "no other team with CS" }); continue; }
    const existing: any = await col("students").findOne({ _id: toObjectId(d.id) as any });
    if (!existing || String(existing.primary_mentor_id) !== d.mentorId) continue; // changed meanwhile
    const data: Record<string, any> = {
      primary_mentor_id: target.cs.id,
      primary_mentor_name: target.cs.name,
      assignment_status: "assigned",
      updated_date: now,
    };
    const history = await prepareStudentUpdate(existing, data, by);
    const reason = `No approved deposit in ${settings.days} days`;
    for (const h of history) { h.text = `${reason} — ${h.text}`; h.via = "inactivity"; }
    // Only if still with the same mentor: a second run or a manual move in between wins.
    const res = await col("students").updateOne({ _id: existing._id, primary_mentor_id: d.mentorId }, { $set: data });
    if (res.modifiedCount !== 1) continue;
    await recordHistory(history);
    moved++;

    const link = `/StudentDetail?id=${d.id}`;
    const note = (user_id: string, title: string, message: string) => ({
      user_id, title, message, type: "student_moved_inactivity", read: false, link, created_date: now, updated_date: now,
    });
    await col("notifications").insertMany([
      note(d.mentorId, `${d.name} moved to ${target.team.name}`, `${reason}, so ${d.name} was given to ${target.cs.name} (${target.team.name}).`),
      note(target.cs.id, `New student: ${d.name}`, `${d.name} was moved to you from ${d.teamName || "another team"} — ${reason.toLowerCase()} with their previous mentor.`),
    ] as any[]);
    await col("logs").insertOne({
      timestamp: now,
      user_id: by.id, user_email: by.email, user_name: by.full_name, user_role: by.app_role,
      action_type: "inactivity_transfer",
      entity_type: "Student",
      entity_id: d.id,
      details: JSON.stringify({
        student: d.name, reason, idle_days: d.idleDays,
        from: { id: d.mentorId, name: d.mentorName, team: d.teamName },
        to: { id: target.cs.id, name: target.cs.name, team: target.team.name },
      }),
      success: true,
    } as any);
  }

  await saveSettings({ last_run_at: now, last_run_moved: moved, last_run_left: left.length });
  return { moved, left };
}

const TICK_MS = 60 * 60 * 1000; // look hourly; run at most once a day

/** Daily worker: does nothing while the rule is switched off. */
export function startInactivityWorker(): void {
  const tick = async () => {
    try {
      const s = await getSettings();
      if (!s.enabled) return;
      if (s.last_run_at && Date.now() - Date.parse(s.last_run_at) < DAY_MS - 5 * 60 * 1000) return;
      const r = await runInactivity();
      console.log(`[inactivity] moved ${r.moved} student(s)${r.left.length ? `, ${r.left.length} left (no other team with CS)` : ""}`);
    } catch (err) {
      console.error("[inactivity] run failed", err);
    }
  };
  setTimeout(() => void tick(), 60_000);
  setInterval(() => void tick(), TICK_MS);
}
