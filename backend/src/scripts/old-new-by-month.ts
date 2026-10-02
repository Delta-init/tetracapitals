/**
 * Old and New by month (the user, 2026-10-02): the DATA sheet's "DATA - …" tags come off every student and off the
 * Student Tags list; a student added before this month who is not enrolled becomes Old, and one added this month who is
 * Old goes back to Not enrolled; every student added this month gets the "New" tag (made on the list as a custom tag,
 * put on once — it stays until taken off); every Old student is marked Onboarded with no message sent, as "Mark
 * onboarded without sending" does. Enrolled students keep their enrolment. Each change goes in their history.
 * "This month" starts on the 1st at 00:00 UAE time (--since=YYYY-MM-DD for another day).
 *
 *   cd backend
 *   bun src/scripts/old-new-by-month.ts                          shows what it would do
 *   bun src/scripts/old-new-by-month.ts --apply                  does it; saves an undo file first
 *   bun src/scripts/old-new-by-month.ts --undo=<file> [--apply]  puts it back (a field changed since is left as now)
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
const SCRIPT = "old-new-by-month";
const BY = "Old and New by month";
const MISSING = { $missing: true };
const CHUNK = 200;
const NEW_TAG = { name: "New", color: "#0ea5e9" };
const DATA = /^DATA - /;

/** The 1st of this month at 00:00 in the UAE (UTC+4), as an ISO time — or --since. */
function monthStart(): string {
  const since = option("since");
  if (since) return new Date(`${since}T00:00:00+04:00`).toISOString();
  const uae = new Date(Date.now() + 4 * 3600e3);
  return new Date(Date.UTC(uae.getUTCFullYear(), uae.getUTCMonth(), 1) - 4 * 3600e3).toISOString();
}

const log = {
  script: SCRIPT, database: config.mongoDb, host, applied_at: now, since: "",
  changes: [] as { id: string; before: Record<string, unknown>; after: Record<string, unknown> }[],
  history_ids: [] as unknown[],
  tags_deleted: [] as any[],
  tag_made: null as unknown,
};

async function run() {
  const since = monthStart();
  log.since = since;
  const students = (await col("students").find({}, { projection: { student_code: 1, created_date: 1, enrolment_status: 1, tags: 1, onboarded: 1, onboarded_at: 1,
    onboarded_by_id: 1, onboarded_by_name: 1, enrolment_updated_at: 1, enrolment_updated_by_id: 1, enrolment_updated_by_name: 1, updated_date: 1 } }).toArray()) as any[];
  const dataTags = (await col("student_tags").find({ name: { $regex: DATA.source } }).toArray()) as any[];

  const plans: { s: any; data: Record<string, unknown>; lines: Omit<HistoryEntry, "student_id">[] }[] = [];
  const n = { untagged: new Map<string, number>(), toOld: 0, toOpen: 0, newTag: 0, onboarded: 0, thisMonth: 0 };
  for (const s of students) {
    const isNew = String(s.created_date ?? "") >= since;              // ISO times compare in time order
    if (isNew) n.thisMonth++;
    const data: Record<string, unknown> = {}, lines: Omit<HistoryEntry, "student_id">[] = [];
    const line = (type: HistoryEntry["type"], text: string, from: unknown, to: unknown) => lines.push({ at: now, type, text, by_id: null, by_name: BY, from, to });
    // Tags: the DATA ones off; New on those added this month
    const tags: string[] = Array.isArray(s.tags) ? s.tags : [];
    const off = tags.filter((t) => DATA.test(t));
    const addNew = isNew && !tags.includes(NEW_TAG.name);
    if (off.length || addNew) {
      data.tags = [...tags.filter((t) => !DATA.test(t)), ...(addNew ? [NEW_TAG.name] : [])];
      for (const t of off) { line("tag_changed", `Tag removed: ${t}`, t, null); n.untagged.set(t, (n.untagged.get(t) ?? 0) + 1); }
      if (addNew) { line("tag_changed", `Tag added: ${NEW_TAG.name}`, null, NEW_TAG.name); n.newTag++; }
    }
    // Enrolment: Old before this month (not enrolled), not Old this month; Enrolled stays
    const status = s.enrolment_status === "closed" || s.enrolment_status === "old" ? s.enrolment_status : "open";
    const next = !isNew && status === "open" ? "old" : isNew && status === "old" ? "open" : status;
    if (next !== status) {
      Object.assign(data, { enrolment_status: next, enrolment_updated_at: now, enrolment_updated_by_id: "", enrolment_updated_by_name: BY });
      line("enrolment_changed", next === "old" ? "Enrolment set to Old — added before this month" : "Enrolment set to Open — added this month (New)", status, next);
      if (next === "old") n.toOld++; else n.toOpen++;
    }
    // Every Old student is onboarded — no message sent
    if (next === "old" && s.onboarded !== true) {
      Object.assign(data, { onboarded: true, onboarded_at: now, onboarded_by_id: "", onboarded_by_name: BY });
      line("onboarding_changed", "Marked as onboarded — no message sent", false, true);
      n.onboarded++;
    }
    if (Object.keys(data).length) { data.updated_date = now; plans.push({ s, data, lines }); }
  }

  console.log(`\nThis month starts ${since} (1st, 00:00 UAE) · students: ${students.length}, added this month: ${n.thisMonth}`);
  console.log(`  DATA tags taken off: ${[...n.untagged.values()].reduce((a, b) => a + b, 0)} on ${plans.filter((p) => (p.s.tags ?? []).some((t: string) => DATA.test(t))).length} students — ${[...n.untagged.entries()].map(([t, c]) => `${t} ${c}`).join(" · ") || "none"}`);
  console.log(`  DATA tags deleted from the Student Tags list: ${dataTags.map((t) => t.name).join(", ") || "none"}`);
  console.log(`  Not enrolled → Old (added before this month): ${n.toOld}`);
  console.log(`  Old → Not enrolled (added this month): ${n.toOpen}`);
  console.log(`  "New" tag put on (added this month): ${n.newTag}${(await col("student_tags").findOne({ name: NEW_TAG.name })) ? "" : " — the tag is made on the list"}`);
  console.log(`  marked Onboarded, no message sent (Old): ${n.onboarded}`);
  console.log(`  students changed: ${plans.length}`);
  if (!apply) return;

  const undoPath = join(homedir(), `old-new-by-month-undo-${now.replace(/[:.]/g, "-")}.json`);
  const saveUndo = () => Bun.write(undoPath, EJSON.stringify(log, undefined, 1, { relaxed: false }));
  try {
    // 1. The New tag on the list
    if (!(await col("student_tags").findOne({ name: NEW_TAG.name }))) {
      const res = await col("student_tags").insertOne({ name: NEW_TAG.name, color: NEW_TAG.color, kind: "custom", active: true,
        created_date: now, updated_date: now, created_by: "", created_by_name: BY } as any);
      log.tag_made = res.insertedId;
    }
    await saveUndo();
    // 2. The students
    for (let i = 0; i < plans.length; i += CHUNK) {
      const part = plans.slice(i, i + CHUNK);
      for (const { s, data } of part) log.changes.push({ id: String(s._id), before: Object.fromEntries(Object.keys(data).map((f) => [f, f in s ? s[f] : MISSING])), after: data });
      await col("students").bulkWrite(part.map(({ s, data }) => ({ updateOne: { filter: { _id: s._id }, update: { $set: data } } })), { ordered: true });
      const lines = part.flatMap(({ s, lines }) => lines.map((l) => ({ ...l, student_id: String(s._id) })));
      if (lines.length) log.history_ids.push(...Object.values((await col("student_history").insertMany(lines as any[])).insertedIds));
      await saveUndo();
      process.stdout.write(`\r  ${Math.min(i + CHUNK, plans.length)} / ${plans.length}`);
    }
    // 3. The DATA tags off the list, once nobody has them
    for (const t of dataTags) {
      if (await col("students").countDocuments({ tags: t.name })) { console.log(`\n  ${t.name} is still on a student — left on the list`); continue; }
      log.tags_deleted.push(t);
      await col("student_tags").deleteOne({ _id: t._id });
    }
    console.log(`\n\nDone: ${plans.length} student(s) changed, ${log.tags_deleted.length} DATA tag(s) off the list${log.tag_made ? ", the New tag made" : ""}.`);
  } finally {
    if (log.changes.length || log.tags_deleted.length || log.tag_made) {
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
  // 1. The DATA tags back on the list (before the students have them again)
  let tagsBack = 0;
  for (const t of saved.tags_deleted) if (!(await col("student_tags").findOne({ _id: t._id }))) { tagsBack++; if (apply) await col("student_tags").insertOne(t); }
  // 2. Each student's fields, whole or not at all; updated_date only when untouched since
  const ops: any[] = [], kept: string[] = [];
  for (const c of saved.changes) {
    const doc: any = await col("students").findOne({ _id: toObjectId(c.id) as any });
    if (!doc) continue;
    const fields = Object.keys(c.before).filter((f) => f !== "updated_date");
    const moved = fields.filter((f) => !same(doc[f], c.after[f]));
    if (moved.length) { kept.push(`${doc.student_code}: ${moved.join(", ")} changed since — left as now`); continue; }
    const keys = same(doc.updated_date, c.after.updated_date) ? [...fields, "updated_date"] : fields;
    const $set: Record<string, unknown> = {}, $unset: Record<string, ""> = {};
    for (const f of keys) { const v = c.before[f] as any; if (v && typeof v === "object" && v.$missing) $unset[f] = ""; else $set[f] = v; }
    ops.push({ updateOne: { filter: { _id: doc._id }, update: { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) } } });
  }
  console.log(`\nUndo of "Old and New by month" on ${saved.applied_at}: ${ops.length} student(s) put back, ${saved.history_ids.length} history line(s) removed, ${tagsBack} DATA tag(s) back on the list`);
  for (const k of kept.slice(0, 50)) console.log(`  ${k}`);
  if (kept.length > 50) console.log(`  … and ${kept.length - 50} more`);
  if (!apply) return;
  for (let i = 0; i < ops.length; i += CHUNK) await col("students").bulkWrite(ops.slice(i, i + CHUNK), { ordered: true });
  await col("student_history").deleteMany({ _id: { $in: saved.history_ids as any[] } });
  // 3. The New tag off the list, once nobody has it
  if (saved.tag_made && !(await col("students").countDocuments({ tags: NEW_TAG.name }))) await col("student_tags").deleteOne({ _id: saved.tag_made as any });
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
