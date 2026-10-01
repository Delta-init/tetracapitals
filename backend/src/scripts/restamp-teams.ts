/**
 * A student's stored team (team_id / team_name) is worked out when they are given to a CS — so when a CS later moves
 * to another team (Teams page, Personnel), their students keep the old one. This sets it again from where each
 * student's CS is now, and does the same for the team shown on their Common entries (common_cs[].team_name).
 *
 * Only where the CS is on a team now: a student whose CS is on no team keeps what they have. Who can see a student
 * never depended on this (that follows the Up Head chain); the stored team is what the Team filter and team counts
 * use. updated_date is left alone — nobody worked on the student — so other imports' undo files still know them.
 *
 *   cd backend
 *   bun src/scripts/restamp-teams.ts                         shows what it would change
 *   bun src/scripts/restamp-teams.ts --apply                 does it; saves an undo file
 *   bun src/scripts/restamp-teams.ts --undo=<file> [--apply] puts back what --apply did
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env). Running it again changes nothing.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";
import { loadTeams } from "../students/teams";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const MISSING = { $missing: true };

const log = { database: config.mongoDb, host, applied_at: now,
  changes: [] as { id: string; before: Record<string, unknown>; after: Record<string, unknown> }[] };

async function restamp() {
  const index = await loadTeams();
  const students = (await col("students")
    .find({ primary_mentor_id: { $nin: [null, ""] } }, { projection: { student_code: 1, primary_mentor_id: 1, primary_mentor_name: 1, team_id: 1, team_name: 1, common_cs: 1 } })
    .toArray()) as any[];

  const plans: { s: any; data: Record<string, unknown>; why: string }[] = [];
  for (const s of students) {
    const data: Record<string, unknown> = {};
    const team = index.teamOf(s.primary_mentor_id);
    if (team && (String(s.team_id ?? "") !== team.id || String(s.team_name ?? "") !== team.name)) Object.assign(data, { team_id: team.id, team_name: team.name });
    if (Array.isArray(s.common_cs) && s.common_cs.length) {
      const common = s.common_cs.map((c: any) => {
        const t = c?.id ? index.teamOf(c.id) : null;
        return t && c.team_name !== t.name ? { ...c, team_name: t.name } : c;
      });
      if (JSON.stringify(common) !== JSON.stringify(s.common_cs)) data.common_cs = common;
    }
    if (Object.keys(data).length) plans.push({ s, data, why: "team_name" in data ? `"${s.team_name || "-"}" → "${data.team_name}"` : "Common entry's team" });
  }

  const by: Record<string, number> = {};
  for (const p of plans) { const k = `${p.s.primary_mentor_name || "?"} · ${p.why}`; by[k] = (by[k] ?? 0) + 1; }
  console.log(`\n${students.length} students with a CS; stored team out of date on ${plans.length}:`);
  for (const [k, n] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`  ${n} × ${k}`);
  if (!plans.length || !apply) return;

  const undoPath = join(homedir(), `restamp-teams-undo-${now.replace(/[:.]/g, "-")}.json`);
  try {
    for (const { s, data } of plans) {
      log.changes.push({ id: String(s._id), before: Object.fromEntries(Object.keys(data).map((k) => [k, k in s ? s[k] : MISSING])), after: data });
      await col("students").updateOne({ _id: s._id }, { $set: data });
    }
    console.log(`\nDone: ${plans.length} student(s) set to their CS's team.`);
  } finally {
    if (log.changes.length) {
      await Bun.write(undoPath, JSON.stringify(log, null, 1));
      console.log(`Undo file: ${undoPath}\n  bun src/scripts/restamp-teams.ts --undo=${undoPath}          (shows what it would put back)`);
    }
  }
}

async function undo(file: string) {
  const saved = JSON.parse(await Bun.file(file).text()) as typeof log;
  if (saved.database !== config.mongoDb || saved.host !== host) throw new Error(`That undo file is for "${saved.database}" on ${saved.host}, not this database.`);
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  let back = 0;
  const kept: string[] = [];
  for (const c of [...saved.changes].reverse()) {
    const doc: any = await col("students").findOne({ _id: toObjectId(c.id) as any });
    if (!doc) continue;
    // Put back whole or not at all: a student whose team changed again since (a new CS, say) keeps it.
    const moved = Object.keys(c.before).filter((k) => !same(doc[k], c.after[k]));
    if (moved.length) { kept.push(`${doc.student_code}: ${moved.join(", ")} changed since — left as now`); continue; }
    const $set: Record<string, unknown> = {}, $unset: Record<string, ""> = {};
    for (const [k, v] of Object.entries(c.before)) { if (v && typeof v === "object" && (v as any).$missing) $unset[k] = ""; else $set[k] = v; }
    back++;
    if (apply) await col("students").updateOne({ _id: doc._id }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) });
  }
  console.log(`\nUndo of the team re-stamp on ${saved.applied_at}: ${back} student(s) put back`);
  for (const k of kept) console.log(`  ${k}`);
}

await connectDb();
console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}`);
try {
  const undoFile = option("undo");
  if (undoFile) await undo(undoFile);
  else await restamp();
} finally {
  await closeDb();
}
if (!apply) console.log("\nNothing was written. Run again with --apply to do it.");
