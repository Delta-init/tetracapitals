/**
 * Students recorded more than once — the same email and the same name (double saves: most copies were made within
 * the same minute, many with the same STU code) — are merged into one, and the test records below are deleted.
 *
 * In each group the copy kept is the one with deposits (never on more than one copy), else the oldest. The others'
 * records are moved onto it — enrolment requests, logs, tickets, referrals, history (a history line that only repeats
 * one the kept copy has — the same event at the same time — is dropped rather than shown twice) — their tags, Course
 * fees and Common entries are added to it, empty fields (phone, country, LMS course…) are filled from them, and an
 * enrolment Closed on any copy carries over. Then the extra copies are removed, and a history line on the kept copy
 * says which.
 * TEST_RECORDS are deleted with everything filed under them; only those exact records (id, name and email must match).
 *
 *   cd backend
 *   bun src/scripts/merge-duplicate-students.ts                         shows what it would do
 *   bun src/scripts/merge-duplicate-students.ts --apply                 does it; saves a full copy in an undo file first
 *   bun src/scripts/merge-duplicate-students.ts --undo=<file> [--apply] puts everything back
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env). Running it again changes nothing.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { EJSON } from "bson";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const MISSING = { $missing: true };
const BY = "Duplicate merge";

/** Test students made while the portal was being built (user, 2026-10-02): id, name and email must all match. */
const TEST_RECORDS = [
  { id: "69ac6975c4413774333d128a", name: "ytfuyfutcf", email: "test9876@gmail.com" },
  { id: "699a26f34e514b420df3a5a3", name: "test", email: "test9876@gmail.com" },
  { id: "6998b00847b171b1818e8410", name: "Carlton Test", email: "testcarlton9@gmail.com" },
  { id: "6998af8647b171b1818e83f3", name: "Carlton Test", email: "testcarlton9@gmail.com" },
  { id: "6998ad2dddc8941ee8c55009", name: "shafeel test", email: "testcarlton9@gmail.com" },
];
/** Where a student is referred to, by field. */
const LINKS: [string, string][] = [
  ["funding_transactions", "student_id"], ["commission_credits", "student_id"], ["mentor_referrals", "student_id"],
  ["mentor_deductions", "student_id"], ["retention_assignments", "student_id"], ["student_followups", "student_id"],
  ["student_followup_events", "student_id"], ["student_calls", "student_id"], ["student_logs", "student_id"],
  ["student_log_history", "student_id"], ["tickets", "student_id"], ["student_requests", "created_student_id"],
  ["student_requests", "existing_student_id"], ["student_requests", "student_id"], ["student_history", "student_id"],
];
/** Filled on the kept copy from another when it has none. */
const FILL = ["phone", "country", "lms_course", "lms_user_id", "lms_academy", "user_id", "finance_invoice_id", "finance_invoice_number"];

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const nameKey = (s: unknown) => norm(s).replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
const at = (h: any) => String(h.at ?? "").slice(0, 16);

const log = {
  database: config.mongoDb, host, applied_at: now,
  deleted: {} as Record<string, any[]>,                                    // collection → full documents
  moved: [] as { col: string; id: unknown; field: string; from: string; to: string }[],
  kept: [] as { id: string; before: Record<string, unknown>; after: Record<string, unknown> }[],
  history_ids: [] as unknown[],
};
const remember = (c: string, docs: any[]) => { if (docs.length) (log.deleted[c] ??= []).push(...docs); };

async function merge() {
  const students = (await col("students").find({}).toArray()) as any[];
  const byEmail = new Map<string, any[]>();
  for (const s of students) { const e = norm(s.email); if (e.includes("@")) byEmail.set(e, [...(byEmail.get(e) ?? []), s]); }
  const groups = [...byEmail.values()]
    .flatMap((g) => { const byName = new Map<string, any[]>(); for (const s of g) byName.set(nameKey(s.full_name), [...(byName.get(nameKey(s.full_name)) ?? []), s]); return [...byName.values()]; })
    .filter((g) => g.length > 1);
  const tests = TEST_RECORDS.map((t) => ({ t, s: students.find((s) => String(s._id) === t.id) }));
  const testIds = new Set(tests.filter(({ t, s }) => s && s.full_name === t.name && norm(s.email) === norm(t.email)).map(({ t }) => t.id));
  const deposits = new Map<string, number>();
  for (const g of groups) for (const s of g) deposits.set(String(s._id), await col("funding_transactions").countDocuments({ student_id: String(s._id) }));

  const plan = groups.filter((g) => !g.some((s) => testIds.has(String(s._id)))).map((g) => {
    const sorted = [...g].sort((a, b) => (deposits.get(String(b._id))! - deposits.get(String(a._id))!)
      || (String(a.created_date ?? "") < String(b.created_date ?? "") ? -1 : String(a.created_date ?? "") > String(b.created_date ?? "") ? 1 : 0)
      || (String(a._id) < String(b._id) ? -1 : 1));
    return { keep: sorted[0], extras: sorted.slice(1) };
  });

  console.log(`\nSame email and same name: ${plan.length} student(s) on ${plan.reduce((n, p) => n + 1 + p.extras.length, 0)} records → ${plan.reduce((n, p) => n + p.extras.length, 0)} extra copies to merge`);
  for (const p of plan) {
    const cs = new Set([p.keep, ...p.extras].map((s) => s.primary_mentor_name || "no CS"));
    console.log(`  ${String(p.keep.full_name).trim()} <${p.keep.email}> — keep ${p.keep.student_code} (${deposits.get(String(p.keep._id))} deposit(s)), merge ${p.extras.map((s) => s.student_code).join(", ")}${cs.size > 1 ? ` · copies with different CSs (${[...cs].join(", ")}) — kept with ${p.keep.primary_mentor_name || "no CS"}` : ""}`);
  }
  console.log(`\nTest records to delete: ${testIds.size}${tests.some(({ t }) => !testIds.has(t.id)) ? ` (${tests.filter(({ t }) => !testIds.has(t.id)).length} not found as listed — left alone)` : ""}`);
  for (const { t, s } of tests) if (testIds.has(t.id)) console.log(`  ${s.student_code} ${s.full_name} <${s.email}> · ${s.primary_mentor_name || "no CS"}`);
  if (!apply || (!plan.length && !testIds.size)) return;

  const undoPath = join(homedir(), `duplicate-merge-undo-${now.replace(/[:.]/g, "-")}.json`);
  // Everything this run will delete or change is copied to the undo file before anything happens.
  const extraIds = plan.flatMap((p) => p.extras.map((s) => String(s._id)));
  const goneIds = [...extraIds, ...testIds];
  remember("students", students.filter((s) => goneIds.includes(String(s._id))));
  const testLinked: Record<string, any[]> = {};
  for (const [c, f] of LINKS) {
    const docs = (await col(c).find({ [f]: { $in: [...testIds] } }).toArray()) as any[];
    if (docs.length) testLinked[c] = [...(testLinked[c] ?? []), ...docs.filter((d) => !(testLinked[c] ?? []).some((x) => String(x._id) === String(d._id)))];
  }
  for (const [c, docs] of Object.entries(testLinked)) remember(c, docs);
  const saveUndo = () => Bun.write(undoPath, EJSON.stringify(log, undefined, 1, { relaxed: false }));
  await saveUndo();

  try {
    // 1. The duplicates
    for (const p of plan) {
      const keepId = String(p.keep._id), k = p.keep;
      const keepHistory = new Set(((await col("student_history").find({ student_id: keepId }).toArray()) as any[]).map((h) => `${h.type}|${h.text}|${at(h)}`));
      for (const x of p.extras) {
        const xId = String(x._id);
        for (const [c, f] of LINKS) {
          const docs = (await col(c).find({ [f]: xId }).toArray()) as any[];
          for (const d of docs) {
            if (c === "student_history" && keepHistory.has(`${d.type}|${d.text}|${at(d)}`)) { remember(c, [d]); await col(c).deleteOne({ _id: d._id }); continue; }
            log.moved.push({ col: c, id: d._id, field: f, from: xId, to: keepId });
            await col(c).updateOne({ _id: d._id }, { $set: { [f]: keepId } });
            if (c === "student_history") keepHistory.add(`${d.type}|${d.text}|${at(d)}`);
          }
        }
      }
      // What the copies had that the kept one lacks
      const data: Record<string, unknown> = {};
      const union = (field: string, keyOf: (v: any) => string) => {
        const have: any[] = Array.isArray(k[field]) ? k[field] : [];
        const add = p.extras.flatMap((x) => (Array.isArray(x[field]) ? x[field] : [])).filter((v, i, a) => !have.some((h) => keyOf(h) === keyOf(v)) && a.findIndex((w) => keyOf(w) === keyOf(v)) === i);
        if (add.length) data[field] = [...have, ...add];
      };
      union("tags", (v) => String(v));
      union("course_fees", (v) => String(v?.invoice_id));
      union("common_cs", (v) => String(v?.id));
      for (const f of FILL) if (!k[f]) { const from = p.extras.find((x) => x[f]); if (from) data[f] = from[f]; }
      if (k.enrolment_status !== "closed") {
        const closed = p.extras.find((x) => x.enrolment_status === "closed");
        if (closed) for (const f of ["enrolment_status", "enrolment_updated_at", "enrolment_updated_by_id", "enrolment_updated_by_name"]) data[f] = closed[f];
      }
      data.updated_date = now;
      log.kept.push({ id: keepId, before: Object.fromEntries(Object.keys(data).map((f) => [f, f in k ? k[f] : MISSING])), after: data });
      await col("students").updateOne({ _id: k._id }, { $set: data });
      const res = await col("student_history").insertOne({ student_id: keepId, at: now, type: "merged", text: `Duplicate record${p.extras.length > 1 ? "s" : ""} ${p.extras.map((x) => x.student_code).join(", ")} merged into this one (same email and name)`, by_id: null, by_name: BY } as any);
      log.history_ids.push(res.insertedId);
      await col("students").deleteMany({ _id: { $in: p.extras.map((x) => x._id) } });
      await saveUndo();
    }
    // 2. The test records, and everything filed under them
    for (const [c, docs] of Object.entries(testLinked)) await col(c).deleteMany({ _id: { $in: docs.map((d) => d._id) } });
    await col("students").deleteMany({ _id: { $in: [...testIds].map((id) => students.find((s) => String(s._id) === id)!._id) } });
    console.log(`\nDone: ${plan.length} student(s) merged (${extraIds.length} extra copies removed), ${testIds.size} test record(s) deleted.`);
  } finally {
    await saveUndo();
    console.log(`Undo file: ${undoPath}\n  bun src/scripts/merge-duplicate-students.ts --undo=${undoPath}          (shows what it would put back)`);
  }
}

async function undo(file: string) {
  const saved = EJSON.parse(await Bun.file(file).text(), { relaxed: false }) as typeof log;
  if (saved.database !== config.mongoDb || saved.host !== host) throw new Error(`That undo file is for "${saved.database}" on ${saved.host}, not this database.`);
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  // 1. What was deleted comes back (students first, so everything filed under them has them again)
  let back = 0;
  for (const [c, docs] of Object.entries(saved.deleted).sort(([a], [b]) => (a === "students" ? -1 : b === "students" ? 1 : 0))) {
    const there = new Set((await col(c).find({ _id: { $in: docs.map((d) => d._id) } }, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)));
    const missing = docs.filter((d) => !there.has(String(d._id)));
    back += missing.length;
    if (apply && missing.length) await col(c).insertMany(missing);
  }
  // 2. What was moved onto a kept copy goes back to its own
  let unmoved = 0;
  for (const m of [...saved.moved].reverse()) {
    const doc: any = await col(m.col).findOne({ _id: m.id as any });
    if (!doc || doc[m.field] !== m.to) continue;
    unmoved++;
    if (apply) await col(m.col).updateOne({ _id: doc._id }, { $set: { [m.field]: m.from } });
  }
  // 3. The kept copies' fields, whole or not at all
  let restored = 0;
  const kept: string[] = [];
  for (const c of [...saved.kept].reverse()) {
    const doc: any = await col("students").findOne({ _id: toObjectId(c.id) as any });
    if (!doc) continue;
    const fields = Object.keys(c.before).filter((f) => f !== "updated_date");
    const changed = fields.filter((f) => !same(doc[f], c.after[f]));
    if (changed.length) { kept.push(`${doc.student_code}: ${changed.join(", ")} changed since — left as now`); continue; }
    const keys = same(doc.updated_date, c.after.updated_date) ? [...fields, "updated_date"] : fields;
    const $set: Record<string, unknown> = {}, $unset: Record<string, ""> = {};
    for (const f of keys) { const v = c.before[f] as any; if (v && typeof v === "object" && v.$missing) $unset[f] = ""; else $set[f] = v; }
    restored++;
    if (apply) await col("students").updateOne({ _id: doc._id }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) });
  }
  console.log(`\nUndo of the duplicate merge on ${saved.applied_at}: ${back} deleted record(s) put back, ${unmoved} moved record(s) returned, ${restored} kept copy(ies) restored, ${saved.history_ids.length} merge line(s) removed`);
  for (const k of kept) console.log(`  ${k}`);
  if (apply) await col("student_history").deleteMany({ _id: { $in: saved.history_ids as any[] } });
}

await connectDb();
console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}`);
try {
  const undoFile = option("undo");
  if (undoFile) await undo(undoFile);
  else await merge();
} finally {
  await closeDb();
}
if (!apply) console.log("\nNothing was written. Run again with --apply to do it.");
