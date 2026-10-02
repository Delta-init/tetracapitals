/**
 * Every student to Delta Open Students — no CS, no team — as the user asked on 2026-10-02, before giving them out
 * again. Each student is taken off their CS the app's own way (students/history.ts prepareStudentUpdate): the team and
 * the "given to them at" clock are cleared, assignment "open_pool", and their history says "CS changed from X to
 * nobody — team T → none" and "Moved to Delta Open Students". A Common CS is taken off too (so no CS sees them).
 * Enrolment, tags, payments, follow-ups, co-mentors, the senior mentor field and who received them first stay.
 * Nobody is emailed. Admins give them out again from the Students page's Delta Open Students tab.
 *
 *   cd backend
 *   bun src/scripts/unassign-all-students.ts                          shows what it would do (writes nothing)
 *   bun src/scripts/unassign-all-students.ts --apply                  does it; saves an undo file in your home folder
 *   bun src/scripts/unassign-all-students.ts --undo=<file> [--apply]  gives them back to the CS (and team, Common CS)
 *                                                                     they had — except students given out since
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env). Running it again changes nobody.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";
import { prepareStudentUpdate, type HistoryEntry } from "../students/history";
import type { AuthUser } from "../auth/middleware";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const MISSING = { $missing: true };
const ACTOR: AuthUser = { id: "", email: "", full_name: "All students unassigned", app_role: "super_admin" };
const VIA = "unassign-all";
const SCRIPT = "unassign-all-students";
const BATCH = 200;

const log = { script: SCRIPT, database: config.mongoDb, host, applied_at: now, history_ids: [] as string[],
  changes: [] as { id: string; before: Record<string, unknown>; after: Record<string, unknown> }[] };

const has = (v: unknown) => v !== undefined && v !== null && String(v) !== "";
const commons = (s: any) => (Array.isArray(s.common_cs) ? s.common_cs : []);
/** Still with somebody, or not yet in Delta Open Students. */
const todo = (s: any) => has(s.primary_mentor_id) || has(s.team_id) || s.assignment_status !== "open_pool" || commons(s).length > 0;

async function unassign() {
  const students = (await col("students").find({}).toArray()) as any[];
  const list = students.filter(todo);

  // What it comes to
  const byCs = new Map<string, number>();
  for (const s of list) {
    const k = `${String(s.team_name || "(no team)").padEnd(18)} ${s.primary_mentor_name || "(no CS)"}`;
    byCs.set(k, (byCs.get(k) ?? 0) + 1);
  }
  const coMentors = students.filter((s) => /"mentor_id"/.test(String(s.co_mentors_details ?? "")) || (Array.isArray(s.co_mentors_details) && s.co_mentors_details.length)).length;
  console.log(`\nStudents: ${students.length} · to Delta Open Students: ${list.length} · already there: ${students.length - list.length}`);
  console.log(`  a Common CS taken off too: ${list.filter((s) => commons(s).length).length} student(s)`);
  console.log(`  kept as they are: enrolment, tags, payments, follow-ups, co-mentors (${coMentors}), senior mentor (${students.filter((s) => has(s.senior_mentor_id)).length})`);
  console.log(`\nWith each team and CS now (all of them go):`);
  for (const [k, n] of [...byCs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${k.padEnd(46)} ${String(n).padStart(5)}`);
  if (!list.length || !apply) return;

  const undoPath = join(homedir(), `unassign-all-undo-${now.replace(/[:.]/g, "-")}.json`);
  let done = 0;
  try {
    for (let i = 0; i < list.length; i += BATCH) {
      const ops: any[] = [];
      const entries: HistoryEntry[] = [];
      for (const s of list.slice(i, i + BATCH)) {
        const data: Record<string, any> = { primary_mentor_id: "", primary_mentor_name: "", assignment_status: "open_pool", updated_date: now };
        const lines = await prepareStudentUpdate(s, data, ACTOR);   // clears team_id, team_name, assigned_at
        const common = commons(s);
        if (common.length) {
          data.common_cs = [];
          lines.push({ student_id: String(s._id), at: now, type: "made_common", by_id: null, by_name: ACTOR.full_name ?? "",
            text: `No longer Common with ${common.map((c: any) => c?.name || "a CS").join(", ")}`, from: common, to: [] });
        }
        for (const e of lines) e.via = VIA;
        entries.push(...lines);
        log.changes.push({ id: String(s._id), before: Object.fromEntries(Object.keys(data).map((k) => [k, k in s ? s[k] : MISSING])), after: data });
        ops.push({ updateOne: { filter: { _id: s._id }, update: { $set: data } } });
      }
      await col("students").bulkWrite(ops, { ordered: true });
      done += ops.length;
      if (entries.length) {
        const res = await col("student_history").insertMany(entries as any[]);
        log.history_ids.push(...Object.values(res.insertedIds).map(String));
      }
      process.stdout.write(`\r  ${done} / ${list.length}`);
    }
    console.log(`\n\nDone: ${done} student(s) in Delta Open Students.`);
  } finally {
    if (log.changes.length) {
      await Bun.write(undoPath, JSON.stringify(log, null, 1));
      console.log(`Undo file: ${undoPath}\n  bun src/scripts/unassign-all-students.ts --undo=${undoPath}          (shows what it would put back)`);
    }
  }
}

async function undo(file: string) {
  const saved = JSON.parse(await Bun.file(file).text()) as typeof log;
  if (saved.script !== SCRIPT) throw new Error(`${file} is not an undo file of ${SCRIPT}.`);
  if (saved.database !== config.mongoDb || saved.host !== host) throw new Error(`That undo file is for "${saved.database}" on ${saved.host}, not this database.`);
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  let back = 0;
  const kept: string[] = [];
  const ops: any[] = [];
  for (const c of [...saved.changes].reverse()) {
    const doc: any = await col("students").findOne({ _id: toObjectId(c.id) as any });
    if (!doc) continue;
    // Put back whole or not at all; updated_date only when nothing has touched the student since.
    const fields = Object.keys(c.before).filter((k) => k !== "updated_date");
    const moved = fields.filter((k) => !same(doc[k], c.after[k]));
    if (moved.length) { kept.push(`${doc.student_code}: ${moved.join(", ")} changed since — left as now`); continue; }
    const keys = "updated_date" in c.before && same(doc.updated_date, c.after.updated_date) ? [...fields, "updated_date"] : fields;
    const $set: Record<string, unknown> = {}, $unset: Record<string, ""> = {};
    for (const k of keys) { const v = c.before[k] as any; if (v && typeof v === "object" && v.$missing) $unset[k] = ""; else $set[k] = v; }
    back++;
    ops.push({ updateOne: { filter: { _id: doc._id }, update: { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) } } });
  }
  console.log(`\nUndo of "all students unassigned" on ${saved.applied_at}: ${back} student(s) given back, ${saved.history_ids.length} history line(s) removed`);
  for (const k of kept.slice(0, 50)) console.log(`  ${k}`);
  if (kept.length > 50) console.log(`  … and ${kept.length - 50} more`);
  if (!apply) return;
  for (let i = 0; i < ops.length; i += BATCH) await col("students").bulkWrite(ops.slice(i, i + BATCH), { ordered: true });
  await col("student_history").deleteMany({ _id: { $in: saved.history_ids.map((id) => toObjectId(id)) as any[] } });
}

await connectDb();
console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}`);
try {
  const undoFile = option("undo");
  if (undoFile) await undo(undoFile);
  else await unassign();
} finally {
  await closeDb();
}
if (!apply) console.log("\nNothing was written. Run again with --apply to do it.");
