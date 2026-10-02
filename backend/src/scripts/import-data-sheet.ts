/**
 * The DATA sheet of "Entire students data 3 - cleaned.xlsx" (2026-10-02): the students not on any CS's own sheet,
 * 4,307 rows of name / email / phone / date. The user: tag each row's students by how they match the portal, add the
 * ones not in the portal, and make the sheet's date every student's created date (the "Added" date).
 *
 * How a row matches — email: any address in the cell, case and spaces ignored, "gmail,com" read as gmail.com; phone:
 * the last 9 digits of any number in the cell; the same name: a shared word of 3+ letters, or 60% alike:
 *   DATA - same email and phone            email and phone on the same student
 *   DATA - same email, other phone         only the email
 *   DATA - same phone and name             only the phone, and the name agrees
 *   DATA - same phone, other name          only the phone, another name (family?) — tagged only
 *   DATA - email and phone on 2 students   the email on one student, the phone on another — both tagged only
 *   DATA - new                             neither — added as a new student
 * Rows with no email and no phone are skipped. Rows of the same person (same email, or same phone and name) make one
 * new student.
 *
 * New students go to Delta Open Students (no CS, no team), Not enrolled, with the next STU codes and "Imported by DATA
 * sheet import" in their history; nobody is emailed. The sheet's date (the earliest of the person's rows) becomes the
 * created date of the new students and of every student a row matched by email, or by phone and name — said in their
 * history as a details change. Each tag put on an existing student says "Tag added" in their history, as by hand.
 *
 *   cd backend
 *   bun src/scripts/import-data-sheet.ts --file=<…/Entire students data 3 - DATA (for import).json>   dry run
 *   bun src/scripts/import-data-sheet.ts --file=<…> --apply            does it; saves an undo file first
 *   bun src/scripts/import-data-sheet.ts --undo=<file> [--apply]       puts it back — a new student only when nobody
 *                                                                      has worked on them since
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env). Running it again changes nothing.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { EJSON } from "bson";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";
import { nextStudentCode } from "../lib/studentCode";
import { stampNewStudents, recordHistory, type HistoryEntry } from "../students/history";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const SCRIPT = "import-data-sheet";
const BATCH = "data-sheet-2026-10-02";
const BY = "DATA sheet import";
const MISSING = { $missing: true };
const CHUNK = 200;

const TAGS = {
  both: { name: "DATA - same email and phone", color: "#16a34a" },
  email: { name: "DATA - same email, other phone", color: "#0284c7" },
  phoneName: { name: "DATA - same phone and name", color: "#7c3aed" },
  phoneOther: { name: "DATA - same phone, other name", color: "#dc2626" },
  split: { name: "DATA - email and phone on 2 students", color: "#db2777" },
  added: { name: "DATA - new", color: "#2563eb" },
} as const;
type Kind = keyof typeof TAGS;
/** A row of these is the student's own, so its date becomes their created date. */
const OWN: Kind[] = ["both", "email", "phoneName"];
/** Someone has worked on a new student when any of these points at them. */
const LINKED = ["student_followups", "student_followup_events", "student_calls", "funding_transactions", "student_requests", "tickets",
  "commission_credits", "mentor_referrals", "student_logs", "student_log_history", "whatsapp_links", "tabby_links"];

type Row = { row: number; name: string; email: string; phone: string; date: string; date_raw: string };

const emailsIn = (cell: unknown) => new Set(String(cell ?? "").toLowerCase().replace(/,com/g, ".com").replace(/\s+/g, "").match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []);
const phoneKeys = (p: unknown) => new Set(String(p ?? "").split(/[\/,;|]/).map((x) => x.replace(/\D/g, "")).filter((x) => x.length >= 9).map((x) => x.slice(-9)));
const norm = (n: unknown) => String(n ?? "").toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, " ").trim().replace(/\s+/g, " ");
const meet = <T,>(a: Set<T>, b: Set<T>) => [...a].some((x) => b.has(x));
/** Characters in common, the way Python's difflib counts them (longest common run, then either side of it). */
function common(a: string, b: string): number {
  if (!a || !b) return 0;
  let best = 0, ai = 0, bi = 0;
  const run = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const was = run[j];
      run[j] = a[i - 1] === b[j - 1] ? prev + 1 : 0;
      if (run[j] > best) { best = run[j]; ai = i - best; bi = j - best; }
      prev = was;
    }
  }
  return best ? best + common(a.slice(0, ai), b.slice(0, bi)) + common(a.slice(ai + best), b.slice(bi + best)) : 0;
}
function sameName(x: unknown, y: unknown): boolean {
  const a = norm(x), b = norm(y);
  if (!a || !b) return true;
  const words = (s: string) => new Set(s.split(" ").filter((w) => w.length >= 3));
  return meet(words(a), words(b)) || (2 * common(a, b)) / (a.length + b.length) >= 0.6;
}
const day = (iso: unknown) => String(iso ?? "").slice(0, 10);
const shown = (iso: unknown) => (day(iso) ? new Date(`${day(iso)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "none");
/** A sheet date as a created date: midday UTC, so it shows as that day wherever it is read. */
const createdAt = (date: string) => `${date}T12:00:00.000Z`;

const log = {
  script: SCRIPT, database: config.mongoDb, host, applied_at: now, batch: BATCH,
  tags_made: [] as string[],
  changed: [] as { id: string; tags_added: string[]; had_tags?: boolean; before: Record<string, unknown>; after: Record<string, unknown> }[],
  created: [] as { id: string; code: string; rows: number[] }[],
  history_ids: [] as unknown[],
};

async function run(file: string) {
  const rows: Row[] = (JSON.parse(await Bun.file(file).text()).rows ?? []) as Row[];
  const students = (await col("students").find({}, { projection: { student_code: 1, full_name: 1, email: 1, phone: 1, tags: 1, created_date: 1, updated_date: 1, import_batch: 1, sheet_rows: 1 } }).toArray()) as any[];
  // Students this import made already, and the rows they came from
  const done = new Set(students.filter((s) => s.import_batch === BATCH).flatMap((s) => (Array.isArray(s.sheet_rows) ? s.sheet_rows : [])));
  const byEmail = new Map<string, any[]>(), byPhone = new Map<string, any[]>();
  for (const s of students.filter((x) => x.import_batch !== BATCH)) {
    for (const e of emailsIn(s.email)) byEmail.set(e, [...(byEmail.get(e) ?? []), s]);
    for (const k of phoneKeys(s.phone)) byPhone.set(k, [...(byPhone.get(k) ?? []), s]);
  }
  const byId = new Map(students.map((s) => [String(s._id), s]));

  // 1. How each row matches
  const kinds = new Map<string, Set<Kind>>(), dateOf = new Map<string, string>();
  const rowCount = new Map<Kind, number>();
  const fresh: Row[] = [], skipped: Row[] = [];
  for (const r of rows) {
    if (done.has(r.row)) continue;
    const E = new Map<string, any>(), P = new Map<string, any>();
    for (const e of emailsIn(r.email)) for (const s of byEmail.get(e) ?? []) E.set(String(s._id), s);
    for (const k of phoneKeys(r.phone)) for (const s of byPhone.get(k) ?? []) P.set(String(s._id), s);
    let kind: Kind, ids: string[];
    if (E.size && P.size) {
      const both = [...E.keys()].filter((i) => P.has(i));
      [kind, ids] = both.length ? ["both", both] : ["split", [...new Set([...E.keys(), ...P.keys()])]];
    } else if (E.size) [kind, ids] = ["email", [...E.keys()]];
    else if (P.size) {
      const same = [...P.values()].filter((s) => sameName(r.name, s.full_name)).map((s) => String(s._id));
      [kind, ids] = same.length ? ["phoneName", same] : ["phoneOther", [...P.keys()]];
    } else {
      (emailsIn(r.email).size || phoneKeys(r.phone).size ? fresh : skipped).push(r);
      continue;
    }
    rowCount.set(kind, (rowCount.get(kind) ?? 0) + 1);
    for (const id of ids) {
      kinds.set(id, (kinds.get(id) ?? new Set()).add(kind));
      if (OWN.includes(kind) && r.date && (!dateOf.has(id) || r.date < dateOf.get(id)!)) dateOf.set(id, r.date);
    }
  }

  // 2. What changes on the students already here
  const changes: { s: any; add: string[]; created?: string }[] = [];
  for (const [id, ks] of kinds) {
    const s = byId.get(id)!;
    const have: string[] = Array.isArray(s.tags) ? s.tags : [];
    const add = [...ks].map((k) => TAGS[k].name).filter((n) => !have.includes(n));
    const date = dateOf.get(id);
    const created = date && day(s.created_date) !== date ? createdAt(date) : undefined;
    if (add.length || created) changes.push({ s, add, created });
  }

  // 3. The new students: one per person
  const parent = fresh.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (let a = 0; a < fresh.length; a++) for (let b = a + 1; b < fresh.length; b++) {
    const x = fresh[a], y = fresh[b];
    if ((meet(emailsIn(x.email), emailsIn(y.email)) && sameName(x.name, y.name))
      || (meet(phoneKeys(x.phone), phoneKeys(y.phone)) && x.name && y.name && sameName(x.name, y.name))) parent[find(a)] = find(b);
  }
  const people = new Map<number, Row[]>();
  fresh.forEach((r, i) => people.set(find(i), [...(people.get(find(i)) ?? []), r]));
  const checks: string[] = [];
  const docs = [...people.values()].map((group) => {
    group.sort((a, b) => a.row - b.row);
    const rowsOf = group.map((r) => r.row);
    const all = [...new Set(group.flatMap((r) => [...emailsIn(r.email)]))];
    const own = group.find((r) => emailsIn(r.email).size);
    const typed = own ? own.email.replace(/\p{Cf}/gu, "").trim() : "";          // invisible marks pasted in with it
    const single = /^[^@\s,;]+@[^@\s,;]+\.[A-Za-z]{2,}$/.test(typed) ? typed : "";
    const email = single || all[0] || "";
    const others = all.filter((e) => e !== email.toLowerCase());
    const named = group.find((r) => r.name)?.name ?? "";
    const name = named || (email ? email.split("@")[0] : "No name");
    const phones: string[] = [];
    for (const r of group) if (r.phone && !phones.some((p) => meet(phoneKeys(p), phoneKeys(r.phone)))) phones.push(r.phone);
    const date = group.map((r) => r.date).filter(Boolean).sort()[0] ?? "";
    const odd = group.filter((r) => r.email && !emailsIn(r.email).has(r.email.trim().toLowerCase()));
    if (!named) checks.push(`row ${rowsOf.join("+")}: no name — named "${name}" after their email`);
    for (const r of odd) checks.push(`row ${r.row}: email "${r.email}" → ${emailsIn(r.email).size ? [...emailsIn(r.email)].join(", ") : "no email"}`);
    return {
      full_name: name, email, phone: phones.join(" / "), country: "",
      notes: others.length ? `Other email on the DATA sheet: ${others.join(", ")}` : "",
      primary_mentor_id: "", primary_mentor_name: "", senior_mentor_id: "", senior_mentor_name: "",
      assignment_status: "open_pool", status: "ACTIVE", student_level: "LEVEL_1",
      source: "data_sheet", import_batch: BATCH, sheet_row: rowsOf[0], sheet_rows: rowsOf,
      created_date: date ? createdAt(date) : now, updated_date: now, created_by_id: "", created_by_name: BY,
    } as Record<string, any>;
  });

  // What it comes to
  const perTag = new Map<Kind, number>();
  for (const ks of kinds.values()) for (const k of ks) perTag.set(k, (perTag.get(k) ?? 0) + 1);
  console.log(`\nRows: ${rows.length}${done.size ? ` (${done.size} already added by this import)` : ""} · matched ${[...rowCount.values()].reduce((a, b) => a + b, 0)} · not in the portal ${fresh.length} → ${docs.length} new students · no email and no phone (skipped) ${skipped.length}`);
  console.log(`\nTags (students):`);
  for (const k of Object.keys(TAGS) as Kind[]) console.log(`  ${TAGS[k].name.padEnd(38)} ${String(k === "added" ? docs.length : perTag.get(k) ?? 0).padStart(5)}${k === "added" ? " (new)" : ` (from ${rowCount.get(k) ?? 0} rows)`}`);
  console.log(`  students with two or more of them: ${[...kinds.values()].filter((ks) => ks.size > 1).length}`);
  console.log(`\nStudents already here that change: ${changes.length} — tags added on ${changes.filter((c) => c.add.length).length}, created date set from the sheet on ${changes.filter((c) => c.created).length} (${[...dateOf.keys()].length - changes.filter((c) => c.created).length} already had that day)`);
  console.log(`\nSkipped, no email and no phone: ${skipped.map((r) => `row ${r.row} ${r.name || "(no name)"}`).join(", ") || "none"}`);
  console.log(`\nTo check on the new students: ${checks.length}`);
  for (const c of checks) console.log(`  ${c}`);
  // Students by month of their created date from the sheet
  const month = new Map<string, [number, number]>();
  for (const [id] of dateOf) { const m = dateOf.get(id)!.slice(0, 7); const v = month.get(m) ?? [0, 0]; v[0]++; month.set(m, v); }
  for (const d of docs) { const m = d.created_date === now ? "no date" : day(d.created_date).slice(0, 7); const v = month.get(m) ?? [0, 0]; v[1]++; month.set(m, v); }
  console.log(`\nBy month of the sheet date — month: already here / new / total`);
  for (const [m, [a, b]] of [...month.entries()].sort()) console.log(`  ${m}  ${String(a).padStart(4)} ${String(b).padStart(4)} ${String(a + b).padStart(5)}`);
  if (!apply) return;

  const undoPath = join(homedir(), `data-sheet-undo-${now.replace(/[:.]/g, "-")}.json`);
  const saveUndo = () => Bun.write(undoPath, EJSON.stringify(log, undefined, 1, { relaxed: false }));
  try {
    // a. The tags
    const have = new Set((await col("student_tags").find({}, { projection: { name: 1 } }).toArray()).map((t: any) => String(t.name)));
    const make = Object.values(TAGS).filter((t) => !have.has(t.name))
      .map((t) => ({ name: t.name, color: t.color, kind: "custom", active: true, created_date: now, updated_date: now, created_by: "", created_by_name: BY }));
    if (make.length) { await col("student_tags").insertMany(make); log.tags_made.push(...make.map((t) => t.name)); }
    await saveUndo();

    // b. The students already here: tags, and the sheet's date as created date
    for (let i = 0; i < changes.length; i += CHUNK) {
      const part = changes.slice(i, i + CHUNK);
      const ops: any[] = [], lines: HistoryEntry[] = [];
      for (const { s, add, created } of part) {
        const id = String(s._id);
        const set: Record<string, unknown> = { updated_date: now };
        if (created) set.created_date = created;
        log.changed.push({ id, tags_added: add, had_tags: "tags" in s, before: Object.fromEntries(Object.keys(set).map((f) => [f, f in s ? s[f] : MISSING])), after: set });
        ops.push({ updateOne: { filter: { _id: s._id }, update: { $set: set, ...(add.length ? { $addToSet: { tags: { $each: add } } } : {}) } } });
        for (const name of add) lines.push({ student_id: id, at: now, type: "tag_changed", text: `Tag added: ${name}`, by_id: null, by_name: BY, to: name });
        if (created) lines.push({ student_id: id, at: now, type: "details_changed", text: `Details changed — Created date: ${shown(s.created_date)} → ${shown(created)} (DATA sheet)`,
          by_id: null, by_name: BY, from: { created_date: s.created_date ?? "" }, to: { created_date: created } });
      }
      await col("students").bulkWrite(ops, { ordered: true });
      if (lines.length) log.history_ids.push(...Object.values((await col("student_history").insertMany(lines as any[])).insertedIds));
      await saveUndo();
      process.stdout.write(`\r  students changed: ${Math.min(i + CHUNK, changes.length)} / ${changes.length}`);
    }

    // c. The new students
    await stampNewStudents(docs);                                   // no CS: no team, nobody received them yet
    for (const d of docs) d.tags = [TAGS.added.name];               // after stamping, which clears tags
    for (let i = 0; i < docs.length; i += CHUNK) {
      const part = docs.slice(i, i + CHUNK);
      for (const d of part) d.student_code = await nextStudentCode();
      const res = await col("students").insertMany(part);
      part.forEach((d, j) => { d._id = res.insertedIds[j]; log.created.push({ id: String(d._id), code: d.student_code, rows: d.sheet_rows }); });
      const lines: HistoryEntry[] = part.map((d) => ({ student_id: String(d._id), at: now, type: "created", by_id: null, by_name: BY,
        text: `Imported by ${BY} (DATA row ${d.sheet_rows.join(", ")}${d.created_date !== now ? `, sheet date ${shown(d.created_date)}` : ""})` }));
      log.history_ids.push(...Object.values((await col("student_history").insertMany(lines as any[])).insertedIds));
      await saveUndo();
      process.stdout.write(`\r  new students: ${Math.min(i + CHUNK, docs.length)} / ${docs.length}      `);
    }
    console.log(`\n\nDone: ${log.tags_made.length} tag(s) made, ${log.changed.length} student(s) changed, ${log.created.length} new student(s)${log.created.length ? ` (${log.created[0].code} → ${log.created[log.created.length - 1].code})` : ""}.`);
  } finally {
    if (log.tags_made.length || log.changed.length || log.created.length) {
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
  const notes: string[] = [];
  // 1. The students that were here: the tags it added come off; created date (and updated date) back when untouched
  const ops: any[] = [];
  for (const c of saved.changed) {
    const doc: any = await col("students").findOne({ _id: toObjectId(c.id) as any }, { projection: { student_code: 1, tags: 1, created_date: 1, updated_date: 1 } });
    if (!doc) continue;
    const $set: Record<string, unknown> = {}, $unset: Record<string, ""> = {};
    for (const f of Object.keys(c.after)) {
      if (!same(doc[f], c.after[f])) { if (f !== "updated_date") notes.push(`${doc.student_code}: ${f} changed since — left as now`); continue; }
      const v = c.before[f] as any;
      if (v && typeof v === "object" && v.$missing) $unset[f] = ""; else $set[f] = v;
    }
    let pull = c.tags_added.filter((t) => Array.isArray(doc.tags) && doc.tags.includes(t));
    // A student who had no tags at all gets none again, rather than an empty list
    if (pull.length && c.had_tags === false && doc.tags.every((t: string) => pull.includes(t))) { $unset.tags = ""; pull = []; }
    if (!Object.keys($set).length && !Object.keys($unset).length && !pull.length) continue;
    ops.push({ updateOne: { filter: { _id: doc._id }, update: { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}), ...(pull.length ? { $pull: { tags: { $in: pull } } } : {}) } } });
  }
  // 2. The new students, unless somebody has worked on them since (given to a CS, or anything filed under them)
  const remove: any[] = [];
  for (const c of saved.created) {
    const doc: any = await col("students").findOne({ _id: toObjectId(c.id) as any });
    if (!doc) continue;
    const links = (await Promise.all(LINKED.map(async (l) => ((await col(l).countDocuments({ student_id: c.id })) ? l : "")))).filter(Boolean);
    if (doc.primary_mentor_id || links.length) { notes.push(`${c.code} ${doc.full_name}: kept — ${[doc.primary_mentor_id ? `with ${doc.primary_mentor_name || "a CS"}` : "", ...links].filter(Boolean).join(", ")}`); continue; }
    remove.push(doc);
  }
  console.log(`\nUndo of the DATA sheet import on ${saved.applied_at}: ${ops.length} student(s) put back, ${remove.length} of ${saved.created.length} new student(s) removed, ${saved.history_ids.length} history line(s) removed, tags made: ${saved.tags_made.length}`);
  for (const n of notes.slice(0, 60)) console.log(`  ${n}`);
  if (notes.length > 60) console.log(`  … and ${notes.length - 60} more`);
  if (!apply) return;
  for (let i = 0; i < ops.length; i += CHUNK) await col("students").bulkWrite(ops.slice(i, i + CHUNK), { ordered: true });
  await col("student_history").deleteMany({ _id: { $in: saved.history_ids as any[] } });
  if (remove.length) {
    await col("student_history").deleteMany({ student_id: { $in: remove.map((d) => String(d._id)) } });   // incl. lines the LMS check wrote
    await col("students").deleteMany({ _id: { $in: remove.map((d) => d._id) } });
  }
  // 3. The tags it made, once nobody has them
  for (const name of saved.tags_made) if (!(await col("students").countDocuments({ tags: name }))) await col("student_tags").deleteOne({ name });
}

await connectDb();
console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}`);
try {
  const undoFile = option("undo"), file = option("file");
  if (undoFile) await undo(undoFile);
  else if (file) await run(file);
  else console.log("Give --file=<the DATA sheet as JSON> (or --undo=<file>).");
} finally {
  await closeDb();
}
if (!apply) console.log("\nNothing was written. Run again with --apply to do it.");
