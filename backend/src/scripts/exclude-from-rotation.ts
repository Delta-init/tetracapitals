/**
 * CS people left out of the rotation (the user, 2026-10-09): CS 1- MH and CS2 - EX get no new students from now on
 * (users.no_auto_assign — students/teams.ts leaves them out of the turns; Personnel → "No new students" switches it),
 * and the students the rotation gave them from sales — arrived from finance with an invoice, given to them first, and
 * still theirs — are shared out to the other CS people of the SAME team, in that team's turn. Students added to them
 * by hand, and anything not from sales, stay where they are.
 *
 *   cd backend
 *   bun src/scripts/exclude-from-rotation.ts [--names="CS 1- MH,CS2 - EX"]            dry run: who and what would move
 *   bun src/scripts/exclude-from-rotation.ts [--names=…] --apply                         does it; an undo file first
 *   bun src/scripts/exclude-from-rotation.ts --undo=<undo file> [--apply]                puts the students and the switch back
 *
 * Uses the API's database (MONGO_URI / MONGO_DB, from this folder's .env). Running it again changes nothing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EJSON } from "bson";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import type { AuthUser } from "../auth/middleware";
import { loadTeams } from "../students/teams";
import { takeNext, csTurn } from "../students/intake";
import { prepareStudentUpdate, recordHistory } from "../students/history";
import { notifyStudentsGiven } from "../lib/notify";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const now = new Date().toISOString();
const BY = { id: "system", email: "", full_name: "Rotation change", app_role: "super_admin" } as AuthUser;
const STUDENT_FIELDS = { full_name: 1, student_code: 1, primary_mentor_id: 1, primary_mentor_name: 1, team_id: 1, team_name: 1, assigned_at: 1, assignment_status: 1, first_assignee_id: 1, finance_invoice_id: 1, sales_crm: 1 };

async function run(names: string[]) {
  console.log(`${host}/${config.mongoDb}`);
  const csAll = (await col("users").find({ app_role: "cs" }, { projection: { full_name: 1, email: 1, status: 1, no_auto_assign: 1 } }).toArray()) as any[];
  const named = (u: any, n: string) => [u.full_name, u.email].some((v) => String(v ?? "").trim().toLowerCase() === n);
  const unknown = names.filter((n) => !csAll.some((u) => named(u, n)));
  if (unknown.length) return console.log(`No CS account named: ${unknown.join(", ")} — nothing done.`);
  const out = csAll.filter((u) => names.some((n) => named(u, n)));
  const outIds = new Set(out.map((u) => String(u._id)));
  for (const u of out) console.log(`${u.full_name} <${u.email}>: ${u.no_auto_assign ? "already out of the rotation" : "will get no new students"}`);

  const students = (await col("students").find({
    primary_mentor_id: { $in: [...outIds] },
    first_assignee_id: { $in: [...outIds] },
    finance_invoice_id: { $nin: [null, ""] },
  }, { projection: STUDENT_FIELDS }).toArray()) as any[];
  // Only those they still hold since the rotation gave them (first_assignee = them, never moved away and back by hand).
  const toMove = students.filter((s) => String(s.first_assignee_id) === String(s.primary_mentor_id));

  // Where each goes: the other CS of the same team, in turn (the dry run counts the turn here; --apply takes the real one).
  const index = await loadTeams();
  const others = (teamId: string) => index.teams.find((t) => t.id === teamId)?.cs.filter((c) => !outIds.has(c.id)) ?? [];
  const plan: { s: any; teamId: string; teamName: string; options: number }[] = [];
  const stay: string[] = [];
  for (const s of toMove) {
    const team = index.teamOf(s.primary_mentor_id);
    if (!team || !others(team.id).length) { stay.push(`${s.full_name} (${s.student_code ?? "?"}) — ${team ? `team ${team.name} has no other CS` : "not on a team"}`); continue; }
    plan.push({ s, teamId: team.id, teamName: team.name, options: others(team.id).length });
  }
  console.log(`\nFrom sales, given to them by the rotation and still theirs: ${toMove.length} — ${plan.length} to share out in their team, ${stay.length} staying.`);
  const byTeam = new Map<string, number>();
  for (const p of plan) byTeam.set(p.teamName, (byTeam.get(p.teamName) ?? 0) + 1);
  for (const [t, n] of byTeam) console.log(`   team ${t}: ${n} students over ${others(index.teams.find((x) => x.name === t)!.id).map((c) => c.name).join(", ")}`);
  if (stay.length) console.log(`Staying:\n   ${stay.join("\n   ")}`);
  if (!apply) return console.log("\nDry run — add --apply to do it.");

  const undoFile = join(homedir(), `exclude-from-rotation-undo-${now.replace(/[:.]/g, "-")}.json`);
  writeFileSync(undoFile, EJSON.stringify({ users: out.map((u) => ({ _id: u._id, no_auto_assign: u.no_auto_assign ?? null })), students: plan.map((p) => p.s) }, { relaxed: false }));
  console.log(`\nUndo file: ${undoFile}`);
  await col("users").updateMany({ _id: { $in: out.map((u) => u._id) } }, { $set: { no_auto_assign: true, updated_date: now } });

  const fresh = await loadTeams();   // now without them
  let moved = 0;
  const given: any[] = [];
  for (const p of plan) {
    const team = fresh.teams.find((t) => t.id === p.teamId);
    if (!team?.cs.length) continue;
    const cs = await takeNext(csTurn(team.id), team.cs, (m) => ({ last_cs_id: m.id, last_cs_name: m.name, team_id: team.id }));
    if (!cs) continue;
    const existing: any = await col("students").findOne({ _id: p.s._id });
    if (!existing || String(existing.primary_mentor_id) !== String(p.s.primary_mentor_id)) continue;   // changed meanwhile
    const data: Record<string, any> = { primary_mentor_id: cs.id, primary_mentor_name: cs.name, assignment_status: "assigned", updated_date: now };
    const history = await prepareStudentUpdate(existing, data, BY);
    for (const h of history) { h.text = `${existing.primary_mentor_name} takes no new students — ${h.text}`; (h as any).via = "rotation_change"; }
    const res = await col("students").updateOne({ _id: existing._id, primary_mentor_id: p.s.primary_mentor_id }, { $set: data });
    if (res.modifiedCount !== 1) continue;
    await recordHistory(history);
    given.push({ ...existing, ...data });
    moved++;
  }
  await notifyStudentsGiven(given);
  console.log(`Done: ${out.length} CS out of the rotation, ${moved} students shared out.`);
}

async function undo(file: string) {
  const { users, students } = EJSON.parse(readFileSync(file, "utf8")) as { users: any[]; students: any[] };
  console.log(`${host}/${config.mongoDb} — puts back ${students.length} students and the rotation switch of ${users.length} CS`);
  if (!apply) return console.log("Dry run — add --apply to do it.");
  for (const u of users) await col("users").updateOne({ _id: u._id }, u.no_auto_assign == null ? { $unset: { no_auto_assign: "" } } : { $set: { no_auto_assign: u.no_auto_assign } });
  let back = 0;
  for (const s of students) {
    const { _id, ...was } = s;
    const r = await col("students").updateOne({ _id }, { $set: { primary_mentor_id: was.primary_mentor_id, primary_mentor_name: was.primary_mentor_name, team_id: was.team_id ?? "", team_name: was.team_name ?? "", assigned_at: was.assigned_at ?? "", assignment_status: was.assignment_status ?? "assigned", updated_date: new Date().toISOString() } });
    back += r.modifiedCount;
  }
  console.log(`Done: ${back} students back.`);
}

await connectDb();
try {
  const u = option("undo");
  const names = (option("names") ?? "CS 1- MH,CS2 - EX").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  await (u ? undo(u) : run(names));
} finally {
  await closeDb();
}
