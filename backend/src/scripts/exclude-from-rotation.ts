/**
 * CS people left out of the rotation (the user, 2026-10-09): CS 1- MH and CS2 - EX get no new students from now on
 * (users.no_auto_assign — students/teams.ts leaves them out of the turns; Personnel → "No new students" switches it),
 * and the students the rotation gave them from sales — arrived from finance with an invoice, given to them first, and
 * still theirs — are shared out to the other CS people of the SAME team, in that team's turn. Students added to them
 * by hand, and anything not from sales, stay where they are.
 *
 * --days=N (the user, 2026-10-09): instead, EVERY student who arrived in the last N days and is with them now — from
 * sales, the LMS or added by hand — shared out the same way. The dry run lists them as a table, with where each
 * would go; --report=<file.csv> saves it.
 *
 *   cd backend
 *   bun src/scripts/exclude-from-rotation.ts [--names="CS 1- MH,CS2 - EX"]            dry run: who and what would move
 *   bun src/scripts/exclude-from-rotation.ts --days=3 [--report=moves.csv]              dry run: the last 3 days', as a table
 *   bun src/scripts/exclude-from-rotation.ts [--days=3] [--names=…] --apply              does it; an undo file first
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
import { salesCrmName } from "../students/salesCrm";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const now = new Date().toISOString();
const BY = { id: "system", email: "", full_name: "Rotation change", app_role: "super_admin" } as AuthUser;
const STUDENT_FIELDS = { full_name: 1, student_code: 1, primary_mentor_id: 1, primary_mentor_name: 1, team_id: 1, team_name: 1, assigned_at: 1, assignment_status: 1, first_assignee_id: 1, finance_invoice_id: 1, sales_crm: 1, email: 1, created_date: 1, source: 1 };

const str = (v: unknown, max = 40) => { const t = String(v ?? "").trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t || "—"; };
const when = (d: Date) => Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-GB", { timeZone: "Asia/Dubai", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
/** Where a student came from, as the student page says it. */
const cameFrom = (s: any) => s.finance_invoice_id ? `${salesCrmName(s.sales_crm)} (finance)` : s.source === "delta_lms" ? "Delta LMS" : "Added here";
function printTable(head: string[], rows: string[][]) {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (r: string[]) => `| ${r.map((c, i) => c.padEnd(w[i]!)).join(" | ")} |`;
  console.log(line(head));
  console.log(`|${w.map((n) => "-".repeat(n + 2)).join("|")}|`);
  for (const r of rows) console.log(line(r));
}

async function run(names: string[]) {
  console.log(`${host}/${config.mongoDb}`);
  const csAll = (await col("users").find({ app_role: "cs" }, { projection: { full_name: 1, email: 1, status: 1, no_auto_assign: 1 } }).toArray()) as any[];
  const named = (u: any, n: string) => [u.full_name, u.email].some((v) => String(v ?? "").trim().toLowerCase() === n);
  const unknown = names.filter((n) => !csAll.some((u) => named(u, n)));
  if (unknown.length) return console.log(`No CS account named: ${unknown.join(", ")} — nothing done.`);
  const out = csAll.filter((u) => names.some((n) => named(u, n)));
  const outIds = new Set(out.map((u) => String(u._id)));
  for (const u of out) console.log(`${u.full_name} <${u.email}>: ${u.no_auto_assign ? "already out of the rotation" : "will get no new students"}`);

  const days = Number(option("days") ?? 0);
  if (option("days") !== undefined && !(days > 0 && days <= 365)) return console.log("--days must be 1 to 365 — nothing done.");
  let toMove: any[];
  let what: string;
  if (days) {
    // Every student who arrived in the last `days` days and is with them now, whatever the source.
    const since = new Date(Date.now() - days * 864e5);
    toMove = (await col("students").find({
      primary_mentor_id: { $in: [...outIds] },
      $or: [{ created_date: { $gte: since.toISOString() } }, { created_date: { $gte: since } }],
    }, { projection: STUDENT_FIELDS }).sort({ created_date: 1 }).toArray()) as any[];
    what = `Arrived in the last ${days} day${days === 1 ? "" : "s"} (since ${when(since)}) and with them now`;
  } else {
    const students = (await col("students").find({
      primary_mentor_id: { $in: [...outIds] },
      first_assignee_id: { $in: [...outIds] },
      finance_invoice_id: { $nin: [null, ""] },
    }, { projection: STUDENT_FIELDS }).toArray()) as any[];
    // Only those they still hold since the rotation gave them (first_assignee = them, never moved away and back by hand).
    toMove = students.filter((s) => String(s.first_assignee_id) === String(s.primary_mentor_id));
    what = "From sales, given to them by the rotation and still theirs";
  }

  // Where each goes: the other CS of the same team, in turn — the dry run follows each team's turn from where it
  // stands now; --apply takes the real turns (the same, unless a student arrives in between).
  const index = await loadTeams();
  const others = (teamId: string) => index.teams.find((t) => t.id === teamId)?.cs.filter((c) => !outIds.has(c.id)) ?? [];
  const lastKey = new Map<string, string>();
  const nextIn = async (teamId: string) => {
    const list = others(teamId);
    if (!lastKey.has(teamId)) lastKey.set(teamId, String(((await col("counters").findOne({ _id: csTurn(teamId) } as any)) as any)?.last_key ?? ""));
    const next = list.find((c) => c.key > lastKey.get(teamId)!) ?? list[0]!;
    lastKey.set(teamId, next.key);
    return next;
  };
  const plan: { s: any; teamId: string; teamName: string; options: number }[] = [];
  const rows: string[][] = [];
  let stayCount = 0;
  for (const s of toMove) {
    const team = index.teamOf(s.primary_mentor_id);
    const ok = !!team && others(team.id).length > 0;
    const to = ok ? (await nextIn(team!.id)).name : `stays — ${team ? "no other CS in the team" : "not on a team"}`;
    if (ok) plan.push({ s, teamId: team!.id, teamName: team!.name, options: others(team!.id).length });
    else stayCount++;
    rows.push([String(rows.length + 1), str(s.student_code), str(s.full_name, 30), str(s.email, 34), str(s.primary_mentor_name), team?.name ?? "—", s.created_date ? when(new Date(s.created_date)) : "—", cameFrom(s), to]);
  }
  console.log(`\n${what}: ${toMove.length} — ${plan.length} to share out in their team, ${stayCount} staying.\n`);
  const head = ["#", "Code", "Student", "Email", "CS now", "Team", "Arrived", "Came from", "Would go to"];
  if (rows.length) printTable(head, rows);
  const report = option("report");
  if (report) {
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    writeFileSync(report, csv + "\n");
    console.log(`\nSaved: ${report}`);
  }
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
    for (const h of history) { h.text = `${existing.primary_mentor_name} takes no new students${days ? ` — shared out with the last ${days} days' new students` : ""} — ${h.text}`; (h as any).via = "rotation_change"; }
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
