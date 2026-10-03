/**
 * Old students are onboarded (the user, 2026-10-03): every student added before 25 September 2026 (00:00 UAE time) who
 * is not Onboarded yet is marked Onboarded with no message sent — as "Mark onboarded without sending" does — whatever
 * their enrolment. (The Old ones were done on 2 October by old-new-by-month.ts; this takes the rest, mostly Enrolled.)
 * Students added from that day on keep theirs, for the real welcome. Each change goes in their history.
 * --before=YYYY-MM-DD for another day (00:00 UAE).
 *
 *   cd backend
 *   bun src/scripts/onboard-old-students.ts                          shows what it would do
 *   bun src/scripts/onboard-old-students.ts --apply                  does it; saves an undo file first
 *   bun src/scripts/onboard-old-students.ts --undo=<file> [--apply]  puts it back (a student changed since is left as now)
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env). Running it again changes nothing.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { EJSON } from "bson";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";
import type { HistoryEntry } from "../students/history";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const SCRIPT = "onboard-old-students";
const BY = "Old students onboarded";
const MISSING = { $missing: true };
const CHUNK = 500;

/** The cut-off: 00:00 UAE (UTC+4) on --before, 25 September 2026 unless told. */
function cutoff(): string {
  const day = option("before") ?? "2026-09-25";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`--before=${day} is not a date (YYYY-MM-DD)`);
  return new Date(`${day}T00:00:00+04:00`).toISOString();
}

const log = {
  script: SCRIPT, database: config.mongoDb, host, applied_at: now, before: "",
  changes: [] as { id: string; before: Record<string, unknown>; after: Record<string, unknown> }[],
  history_ids: [] as unknown[],
};

const enrolment = (s: any) => (s.enrolment_status === "closed" ? "Enrolled" : s.enrolment_status === "old" ? "Old" : "Not enrolled");

async function run() {
  const before = cutoff();
  log.before = before;
  // created_date is kept as ISO text; any other kind of value is reported, never guessed at.
  const odd = await col("students").countDocuments({ created_date: { $not: { $type: "string" } } } as any);
  const students = (await col("students").find(
    { created_date: { $type: "string", $lt: before }, onboarded: { $ne: true } } as any,
    { projection: { student_code: 1, created_date: 1, enrolment_status: 1, onboarded: 1, onboarded_at: 1, onboarded_by_id: 1, onboarded_by_name: 1, updated_date: 1 } },
  ).toArray()) as any[];
  const later = await col("students").countDocuments({ created_date: { $type: "string", $gte: before }, onboarded: { $ne: true } } as any);

  const byEnrolment = new Map<string, number>(), byYear = new Map<string, number>();
  for (const s of students) {
    byEnrolment.set(enrolment(s), (byEnrolment.get(enrolment(s)) ?? 0) + 1);
    const y = String(s.created_date).slice(0, 4);
    byYear.set(y, (byYear.get(y) ?? 0) + 1);
  }
  console.log(`\nAdded before ${before} (00:00 UAE) and not Onboarded yet: ${students.length} → Onboarded, no message sent`);
  console.log(`  by enrolment: ${[...byEnrolment.entries()].map(([k, n]) => `${k} ${n}`).join(" · ") || "none"}`);
  console.log(`  by year added: ${[...byYear.entries()].sort().map(([k, n]) => `${k} ${n}`).join(" · ") || "none"}`);
  console.log(`  left as they are — added on or after that day, not Onboarded: ${later}`);
  if (odd) console.log(`  ${odd} student(s) have no readable date added — left as they are`);
  if (!students.length || !apply) return;

  const undoPath = join(homedir(), `${SCRIPT}-undo-${now.replace(/[:.]/g, "-")}.json`);
  const saveUndo = () => Bun.write(undoPath, EJSON.stringify(log, undefined, 1, { relaxed: false }));
  const data = { onboarded: true, onboarded_at: now, onboarded_by_id: "", onboarded_by_name: BY, updated_date: now };
  try {
    await saveUndo();
    for (let i = 0; i < students.length; i += CHUNK) {
      const part = students.slice(i, i + CHUNK);
      for (const s of part) log.changes.push({ id: String(s._id), before: Object.fromEntries(Object.keys(data).map((f) => [f, f in s ? s[f] : MISSING])), after: data });
      await col("students").bulkWrite(part.map((s) => ({ updateOne: { filter: { _id: s._id }, update: { $set: data } } })), { ordered: true });
      const lines: HistoryEntry[] = part.map((s) => ({
        student_id: String(s._id), at: now, type: "onboarding_changed", text: "Marked as onboarded — no message sent",
        by_id: null, by_name: BY, from: s.onboarded === true, to: true, via: SCRIPT,
      }));
      log.history_ids.push(...Object.values((await col("student_history").insertMany(lines as any[])).insertedIds));
      await saveUndo();
      process.stdout.write(`\r  ${Math.min(i + CHUNK, students.length)} / ${students.length}`);
    }
    console.log(`\n\nDone: ${students.length} student(s) marked Onboarded.`);
  } finally {
    if (log.changes.length) {
      await saveUndo();
      console.log(`Undo file: ${undoPath}\n  bun src/scripts/${SCRIPT}.ts --undo=${undoPath}          (shows what it would put back)`);
    }
  }
}

async function undo(file: string) {
  const saved = EJSON.parse(await Bun.file(file).text(), { relaxed: false }) as typeof log;
  if (saved.script !== SCRIPT) throw new Error(`${file} is not an undo file of ${SCRIPT}.`);
  if (saved.database !== config.mongoDb || saved.host !== host) throw new Error(`That undo file is for "${saved.database}" on ${saved.host}, not this database.`);
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  // Each student's fields, whole or not at all; updated_date only when untouched since
  const docs = new Map(((await col("students").find({ _id: { $in: saved.changes.map((c) => toObjectId(c.id)) as any[] } }).toArray()) as any[])
    .map((d) => [String(d._id), d]));
  const ops: any[] = [], kept: string[] = [];
  for (const c of saved.changes) {
    const doc: any = docs.get(c.id);
    if (!doc) continue;
    const fields = Object.keys(c.before).filter((f) => f !== "updated_date");
    const moved = fields.filter((f) => !same(doc[f], c.after[f]));
    if (moved.length) { kept.push(`${doc.student_code}: ${moved.join(", ")} changed since — left as now`); continue; }
    const keys = same(doc.updated_date, c.after.updated_date) ? [...fields, "updated_date"] : fields;
    const $set: Record<string, unknown> = {}, $unset: Record<string, ""> = {};
    for (const f of keys) { const v = c.before[f] as any; if (v && typeof v === "object" && v.$missing) $unset[f] = ""; else $set[f] = v; }
    ops.push({ updateOne: { filter: { _id: doc._id }, update: { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) } } });
  }
  console.log(`\nUndo of "${BY}" on ${saved.applied_at}: ${ops.length} student(s) put back, ${saved.history_ids.length} history line(s) removed`);
  for (const k of kept.slice(0, 50)) console.log(`  ${k}`);
  if (kept.length > 50) console.log(`  … and ${kept.length - 50} more`);
  if (!apply) return;
  for (let i = 0; i < ops.length; i += CHUNK) await col("students").bulkWrite(ops.slice(i, i + CHUNK), { ordered: true });
  await col("student_history").deleteMany({ _id: { $in: saved.history_ids as any[] } });
}

await connectDb();
console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}`);
try {
  const undoFile = option("undo");
  if (undoFile) await undo(undoFile);
  else await run();
} finally {
  await closeDb();
}
if (!apply) console.log("\nNothing was written. Run again with --apply to do it.");
