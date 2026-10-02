/**
 * Students recorded more than once under the same name and the same phone, with different emails (mostly typos —
 * gmaill, gamil, .cim, yahoo for gmail): 28 students on 58 records on 2026-10-02. The user: merge them all; when the
 * copies are with different CSs, the student is Common. (Same email and same name: merge-duplicate-students.ts.)
 *
 * Same name: ignoring case, spaces and punctuation. Same phone: the last 9 digits of any number in the phone field, so
 * +971, a leading 0 or spaces don't matter. Records joined through any shared name and number are one group.
 *
 * The copy kept is the one with a Delta LMS account (its email is the one the LMS knows, so Enrolled and the classes
 * keep working), else the one with approved payments, else the oldest. Everything filed under the other copies moves
 * onto it — payments (showing the kept code), enrolment requests, logs, tickets, referrals, history (a line that only
 * repeats one the kept copy has is dropped), whatever else points at them — and it takes their tags, Course fees,
 * notes, Level 2, an enrolment Closed, and fields it lacks (country, LMS course…). The kept copy keeps its CS (or takes
 * a copy's when it has none); the other copies' CSs become its Common CSs. Then the extra copies are removed, and a
 * history line on the kept copy names them with their emails.
 *
 *   cd backend
 *   bun src/scripts/merge-same-name-phone.ts                         shows what it would do
 *   bun src/scripts/merge-same-name-phone.ts --apply                 does it; saves a full copy in an undo file first
 *   bun src/scripts/merge-same-name-phone.ts --undo=<file> [--apply] puts everything back
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env). Running it again changes nothing.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { EJSON } from "bson";
import { config } from "../config";
import { connectDb, col, db, closeDb } from "../db";
import { toObjectId } from "../lib/id";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const MISSING = { $missing: true };
const BY = "Duplicate merge";
const SCRIPT = "merge-same-name-phone";

/** Fields that point at a student, in any collection — and lists of student ids (WhatsApp messages). */
const REFS = ["student_id", "created_student_id", "existing_student_id"];
const LISTS = ["student_ids"];
/** Taken whole from another copy when the kept one has the first field empty. */
const FILL = [
  ["phone"], ["country"], ["lms_course"], ["user_id"], ["lms_user_id", "lms_academy"],
  ["finance_invoice_id", "finance_invoice_number"], ["senior_mentor_id", "senior_mentor_name"],
  ["first_assignee_id", "first_assignee_name", "first_assignee_role", "first_assigned_at"],
];
/** The CS, taken from a copy only when the kept one has nobody. */
const CS = ["primary_mentor_id", "primary_mentor_name", "team_id", "team_name", "assigned_at", "assignment_status"];
const ENROLMENT = ["enrolment_status", "enrolment_updated_at", "enrolment_updated_by_id", "enrolment_updated_by_name", "enrolment_manual"];

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** The last 9 digits of each number in a phone field — "+971 50 123 4567 / 0551234567" gives two. */
const phoneKeys = (p: unknown) => String(p ?? "").split(/[\/,;|]/).map((x) => x.replace(/\D/g, "")).filter((x) => x.length >= 9).map((x) => x.slice(-9));
const has = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const lineKey = (h: any) => `${h.type}|${h.text}|${String(h.at ?? "").slice(0, 16)}`;
const levelNo = (l: unknown) => Number(/^LEVEL_(\d+)$/.exec(String(l ?? ""))?.[1] ?? 1);
const commons = (s: any): any[] => (Array.isArray(s.common_cs) ? s.common_cs : []);
const lms = (s: any) => s.lms_account?.exists === true;
const label = (s: any) => `${s.student_code} <${String(s.email ?? "").trim()}>`;

type Plan = { keep: any; extras: any[]; why: string; data: Record<string, unknown>; notes: string[] };
type Op =
  | { kind: "drop"; c: string; d: any }                              // a history line the kept copy already has
  | { kind: "move"; c: string; d: any; f: string; to: unknown }      // repointed at the kept copy
  | { kind: "code"; c: string; d: any; from: string; to: string }    // its student_code, to the kept copy's
  | { kind: "list"; c: string; d: any; f: string };                  // a list of student ids

const log = {
  script: SCRIPT, database: config.mongoDb, host, applied_at: now,
  deleted: {} as Record<string, any[]>,                                    // collection → full documents
  moved: [] as { col: string; id: unknown; field: string; from: unknown; to: unknown }[],
  lists: [] as { col: string; id: unknown; field: string; before: unknown; after: unknown }[],
  kept: [] as { id: string; before: Record<string, unknown>; after: Record<string, unknown> }[],
  history_ids: [] as unknown[],
};
const remember = (c: string, docs: any[]) => { if (docs.length) (log.deleted[c] ??= []).push(...docs); };

/** Students joined by a shared name + number, two or more to a group. */
function groupsOf(students: any[]): any[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => { const p = parent.get(x)!; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  const first = new Map<string, string>();
  for (const s of students) parent.set(String(s._id), String(s._id));
  for (const s of students) {
    const name = norm(s.full_name);
    if (!name) continue;
    for (const key of phoneKeys(s.phone).map((k) => `${name}|${k}`)) {
      const seen = first.get(key);
      if (seen) parent.set(find(String(s._id)), find(seen)); else first.set(key, String(s._id));
    }
  }
  const groups = new Map<string, any[]>();
  for (const s of students) { const r = find(String(s._id)); groups.set(r, [...(groups.get(r) ?? []), s]); }
  return [...groups.values()].filter((g) => g.length > 1);
}

async function merge() {
  const students = (await col("students").find({}).toArray()) as any[];
  const approved = new Map<string, number>();
  const groups = groupsOf(students);
  for (const s of groups.flat()) approved.set(String(s._id), await col("funding_transactions").countDocuments({ student_id: String(s._id), status: /^approved$/i }));
  const paid = (s: any) => approved.get(String(s._id)) ?? 0;

  // Which copy stays
  const plan: Plan[] = groups.map((g) => {
    const [keep, ...extras] = [...g].sort((a, b) => Number(lms(b)) - Number(lms(a)) || paid(b) - paid(a)
      || String(a.created_date ?? "").localeCompare(String(b.created_date ?? "")) || String(a._id).localeCompare(String(b._id)));
    const why = lms(keep) && !extras.some(lms) ? "LMS account" : paid(keep) > Math.max(...extras.map(paid)) ? "approved payments" : "oldest";
    return { keep, extras, why, data: {}, notes: [] };
  });

  // What each kept copy takes from the others
  const csIds = [...new Set(plan.flatMap((p) => p.extras.map((x) => String(x.primary_mentor_id ?? ""))).filter(Boolean))];
  const csEmail = new Map(((await col("users").find({ _id: { $in: csIds.map((id) => toObjectId(id)).filter(Boolean) as any[] } }, { projection: { email: 1 } }).toArray()) as any[])
    .map((u) => [String(u._id), String(u.email ?? "")]));
  for (const p of plan) {
    const { keep: k, extras, data } = p;
    const union = (field: string, keyOf: (v: any) => string) => {
      const have: any[] = Array.isArray(k[field]) ? k[field] : [];
      const add = extras.flatMap((x) => (Array.isArray(x[field]) ? x[field] : [])).filter((v, i, a) => !have.some((h) => keyOf(h) === keyOf(v)) && a.findIndex((w) => keyOf(w) === keyOf(v)) === i);
      if (add.length) data[field] = [...have, ...add];
    };
    union("tags", (v) => String(v));
    union("course_fees", (v) => (has(v?.invoice_id) ? String(v.invoice_id) : JSON.stringify(v)));
    if (!has(k.primary_mentor_id)) {
      const from = extras.find((x) => has(x.primary_mentor_id));
      if (from) { for (const f of CS) if (from[f] !== undefined) data[f] = from[f]; p.notes.push(`CS ${from.primary_mentor_name || "?"} from ${from.student_code}`); }
    }
    const cs = String(data.primary_mentor_id ?? k.primary_mentor_id ?? "");
    const common = [...commons(k)];
    const addCommon = (c: any) => { if (has(c?.id) && String(c.id) !== cs && !common.some((h) => String(h?.id) === String(c.id))) common.push(c); };
    for (const x of extras) {
      for (const c of commons(x)) addCommon(c);
      if (has(x.primary_mentor_id)) addCommon({ id: String(x.primary_mentor_id), name: x.primary_mentor_name ?? "", email: csEmail.get(String(x.primary_mentor_id)) ?? "", team_name: x.team_name ?? "", at: now, via: "duplicate-merge", from_code: x.student_code ?? "" });
    }
    if (common.length > commons(k).length) { data.common_cs = common; p.notes.push(`Common with ${common.slice(commons(k).length).map((c) => c.name || "a CS").join(", ")}`); }
    for (const block of FILL) if (!has(k[block[0]])) { const from = extras.find((x) => has(x[block[0]])); if (from) for (const f of block) if (from[f] !== undefined) data[f] = from[f]; }
    const notes = [...new Set([k, ...extras].map((s) => String(s.notes ?? "").trim()).filter(Boolean))].join("\n\n");
    if (notes && notes !== String(k.notes ?? "").trim()) data.notes = notes;
    const top = extras.reduce((a, s) => (levelNo(s.student_level) > levelNo(a.student_level) ? s : a), k);
    if (top !== k) data.student_level = top.student_level;
    if (k.enrolment_status !== "closed") {
      const closed = extras.find((x) => x.enrolment_status === "closed");
      if (closed) for (const f of ENROLMENT) if (closed[f] !== undefined) data[f] = closed[f];
    }
    data.updated_date = now;
  }

  // Everything that points at an extra copy, in any collection
  const keptOf = new Map(plan.flatMap((p) => p.extras.map((x) => [String(x._id), p] as const)));
  const extraIds = [...keptOf.keys()];
  const anyId = [...extraIds, ...extraIds.map((id) => toObjectId(id)).filter(Boolean)] as any[];
  const keptHistory = new Map<string, Set<string>>();
  for (const p of plan) keptHistory.set(String(p.keep._id), new Set(((await col("student_history").find({ student_id: String(p.keep._id) }).toArray()) as any[]).map(lineKey)));
  const ops: Op[] = [];
  const recoded = new Set<string>();
  const collections = (await db().listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith("system.")).sort();
  for (const c of collections) {
    for (const f of LISTS) for (const d of (await col(c).find({ [f]: { $in: anyId } }).toArray()) as any[]) ops.push({ kind: "list", c, d, f });
    for (const f of REFS) {
      for (const d of (await col(c).find({ [f]: { $in: anyId } }).toArray()) as any[]) {
        if (c === "students" && keptOf.has(String(d._id))) continue;           // an extra copy itself — removed anyway
        const p = keptOf.get(String(d[f]))!;
        const x = p.extras.find((e) => String(e._id) === String(d[f]))!;
        const keepId = String(p.keep._id);
        if (c === "student_history" && f === "student_id") {
          const seen = keptHistory.get(keepId)!;
          if (seen.has(lineKey(d))) { ops.push({ kind: "drop", c, d }); continue; }
          seen.add(lineKey(d));
        }
        ops.push({ kind: "move", c, d, f, to: typeof d[f] === "string" ? keepId : toObjectId(keepId) });
        const code = String(p.keep.student_code ?? "");
        if (has(x.student_code) && d.student_code === x.student_code && code !== x.student_code && !recoded.has(`${c}|${d._id}`)) {
          recoded.add(`${c}|${d._id}`);
          ops.push({ kind: "code", c, d, from: x.student_code, to: code });
        }
      }
    }
  }

  // What it comes to
  console.log(`\nSame name and same phone: ${plan.length} student(s) on ${plan.reduce((n, p) => n + 1 + p.extras.length, 0)} records → ${extraIds.length} extra copies to merge`);
  for (const p of [...plan].sort((a, b) => norm(a.keep.full_name).localeCompare(norm(b.keep.full_name)))) {
    const takes = Object.keys(p.data).filter((f) => f !== "updated_date" && f !== "common_cs" && !CS.includes(f) && !(ENROLMENT.includes(f) && f !== "enrolment_status"));
    console.log(`  ${String(p.keep.full_name).trim()} — keep ${label(p.keep)} (${p.why}) · merge ${p.extras.map(label).join(", ")}${takes.length ? ` · takes ${takes.join(", ")}` : ""}${p.notes.length ? ` · ${p.notes.join(" · ")}` : ""}`);
  }
  const count = (kind: Op["kind"]) => { const m = new Map<string, number>(); for (const o of ops) if (o.kind === kind) m.set(o.c, (m.get(o.c) ?? 0) + 1); return [...m].map(([c, n]) => `${c} ${n}`).join(", ") || "none"; };
  console.log(`\nRecords moved onto the kept copies: ${count("move")}`);
  console.log(`  showing the kept copy's code from now on: ${count("code")}`);
  console.log(`  history lines dropped (the kept copy has the same line): ${ops.filter((o) => o.kind === "drop").length}`);
  console.log(`  lists of students (WhatsApp): ${count("list")}`);
  if (!apply || !plan.length) return;

  const undoPath = join(homedir(), `same-name-phone-merge-undo-${now.replace(/[:.]/g, "-")}.json`);
  // Everything this run will delete or change is copied to the undo file before anything happens.
  remember("students", plan.flatMap((p) => p.extras));
  const saveUndo = () => Bun.write(undoPath, EJSON.stringify(log, undefined, 1, { relaxed: false }));
  await saveUndo();

  try {
    // 1. Everything filed under the extra copies, onto the kept ones
    for (const o of ops) {
      if (o.kind === "drop") { remember(o.c, [o.d]); await col(o.c).deleteOne({ _id: o.d._id }); }
      else if (o.kind === "move") { log.moved.push({ col: o.c, id: o.d._id, field: o.f, from: o.d[o.f], to: o.to }); await col(o.c).updateOne({ _id: o.d._id }, { $set: { [o.f]: o.to } }); }
      else if (o.kind === "code") { log.moved.push({ col: o.c, id: o.d._id, field: "student_code", from: o.from, to: o.to }); await col(o.c).updateOne({ _id: o.d._id }, { $set: { student_code: o.to } }); }
      else {
        const cur: any = await col(o.c).findOne({ _id: o.d._id });
        if (!Array.isArray(cur?.[o.f])) continue;
        const after: unknown[] = [];
        for (const v of cur[o.f]) { const p = keptOf.get(String(v)); const nv = p ? String(p.keep._id) : v; if (!after.some((a) => String(a) === String(nv))) after.push(nv); }
        log.lists.push({ col: o.c, id: o.d._id, field: o.f, before: cur[o.f], after });
        await col(o.c).updateOne({ _id: o.d._id }, { $set: { [o.f]: after } });
      }
    }
    await saveUndo();
    // 2. The extra copies go (first, so a number they hold can move to the kept copy); the kept ones take what they
    //    lacked, with a line in their history
    for (const p of plan) {
      const keepId = String(p.keep._id);
      await col("students").deleteMany({ _id: { $in: p.extras.map((x) => x._id) } });
      log.kept.push({ id: keepId, before: Object.fromEntries(Object.keys(p.data).map((f) => [f, f in p.keep ? p.keep[f] : MISSING])), after: p.data });
      await col("students").updateOne({ _id: p.keep._id }, { $set: p.data });
      const text = `Duplicate record${p.extras.length > 1 ? "s" : ""} ${p.extras.map(label).join(", ")} merged into this one (same name and phone)${p.notes.length ? ` — ${p.notes.join("; ")}` : ""}`;
      const res = await col("student_history").insertOne({ student_id: keepId, at: now, type: "merged", text, by_id: null, by_name: BY } as any);
      log.history_ids.push(res.insertedId);
      await saveUndo();
    }
    console.log(`\nDone: ${plan.length} student(s) merged, ${extraIds.length} extra copies removed.`);
  } finally {
    await saveUndo();
    console.log(`Undo file: ${undoPath}\n  bun src/scripts/${SCRIPT}.ts --undo=${undoPath}          (shows what it would put back)`);
  }
}

async function undo(file: string) {
  const saved = EJSON.parse(await Bun.file(file).text(), { relaxed: false }) as typeof log;
  if (saved.script !== SCRIPT) throw new Error(`${file} is not an undo file of ${SCRIPT}.`);
  if (saved.database !== config.mongoDb || saved.host !== host) throw new Error(`That undo file is for "${saved.database}" on ${saved.host}, not this database.`);
  // 1. The kept copies' fields, whole or not at all (first, so a number they took can go back to its copy)
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
  // 2. What was deleted comes back (students first, so everything filed under them has them again)
  let back = 0;
  for (const [c, docs] of Object.entries(saved.deleted).sort(([a], [b]) => (a === "students" ? -1 : b === "students" ? 1 : 0))) {
    const there = new Set((await col(c).find({ _id: { $in: docs.map((d) => d._id) } }, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)));
    const missing = docs.filter((d) => !there.has(String(d._id)));
    back += missing.length;
    if (apply && missing.length) await col(c).insertMany(missing);
  }
  // 3. What was moved onto a kept copy goes back to its own
  let unmoved = 0;
  for (const m of [...saved.moved].reverse()) {
    const doc: any = await col(m.col).findOne({ _id: m.id as any });
    if (!doc || !same(doc[m.field], m.to)) continue;
    unmoved++;
    if (apply) await col(m.col).updateOne({ _id: doc._id }, { $set: { [m.field]: m.from } });
  }
  for (const l of [...saved.lists].reverse()) {
    const doc: any = await col(l.col).findOne({ _id: l.id as any });
    if (!doc || !same(doc[l.field], l.after)) continue;
    unmoved++;
    if (apply) await col(l.col).updateOne({ _id: doc._id }, { $set: { [l.field]: l.before } });
  }
  console.log(`\nUndo of the same-name-and-phone merge on ${saved.applied_at}: ${back} deleted record(s) put back, ${unmoved} moved record(s) returned, ${restored} kept copy(ies) restored, ${saved.history_ids.length} merge line(s) removed`);
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
