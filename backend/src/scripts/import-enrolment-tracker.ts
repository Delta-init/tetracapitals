/**
 * The CS enrolment tracker (one tab per CS: course, amount pitched, bonus, pending, status, remarks) → the portal.
 * Each row's payment goes on the student as a `course_fees` entry, beside the ones Delta finance sends, so the
 * student page's Course fees card shows it — marked as from the tracker, with the CS tab it came from.
 *
 * Students already in the portal are found as the CS-sheet import finds them (the same email, or the same phone —
 * any number in the cell, last 9 digits); every record that matches gets the payment. Nobody is moved and no
 * enrolment is changed. Students not in the portal are made, under the CS of their tab (no CS: Delta Open
 * Students), enrolled (Enrolment: Closed, with the "Closed - <course>" tag when the course is a product), with
 * their payments. A row with no email and no phone is skipped.
 *
 *   cd backend
 *   bun src/scripts/import-tracker-payments.ts --file=<the tracker's JSON>            shows what it would do
 *   bun src/scripts/import-tracker-payments.ts --file=<…> --apply                     does it; saves an undo file
 *   bun src/scripts/import-tracker-payments.ts --undo=<file> [--apply]                takes back what --apply did
 *
 * The JSON: { rows: [{ tab, row, cs_email, name, phone, email, course, fee, currency, bonus_usd, pending, status,
 * remarks }] } — made from the tracker. Amounts as written (not minor units). Running it again adds nothing: each
 * row is kept once per student, by its tab and row.
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";
import { nextStudentCode } from "../lib/studentCode";
import { loadTeams } from "../students/teams";
import { stampNewStudents, recordCreated, type HistoryEntry } from "../students/history";
import { CLOSED_PREFIX } from "../students/tags";
import type { AuthUser } from "../auth/middleware";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const LINKED = ["student_followups", "student_calls", "funding_transactions", "student_requests", "tickets",
  "commission_credits", "commission_ledgers", "mentor_referrals", "manual_commission_adjustments"];
const ACTOR: AuthUser = { id: "", email: "", full_name: "CS enrolment tracker", app_role: "super_admin" };

interface Row {
  tab: string; row: number; cs_email: string; name: string; phone: string; email: string; course: string;
  fee: number | null; currency: string; bonus_usd: number | null; pending: number | null; status: string; remarks: string;
}

const emailsOf = (v: unknown) => [...new Set((String(v ?? "").match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) ?? []).map((e) => e.toLowerCase().replace(/[.,]+$/, "")))];
/** Every number in a phone cell, by its last 9 digits. */
const phoneKeys = (v: unknown) => [...new Set(String(v ?? "").replace(/\.0$/, "").split(/[\n\r/,;|]+| - /)
  .map((x) => x.replace(/\(.*?\)/g, "").replace(/\D/g, "").replace(/^00/, "")).filter((x) => x.length >= 7).map((x) => x.slice(-9)))];
const minor = (v: number | null) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100));

/** One tracker row as a Course fees entry — the same shape finance's are, plus where it came from. */
function feeEntry(r: Row, csName: string) {
  const fee = minor(r.fee), pending = minor(r.pending);
  return {
    invoice_id: `tracker:${r.tab}:${r.row}`,
    invoice_number: "",
    course: r.course,
    currency: r.currency || "AED",
    fee_minor: fee,
    // Paid only where the tracker gives both the amount and what is still to collect.
    paid_minor: fee !== null && pending !== null ? Math.max(0, fee - pending) : null,
    balance_minor: pending,
    bonus_given: r.bonus_usd === null ? null : r.bonus_usd > 0,
    bonus_minor: minor(r.bonus_usd) ?? 0,
    bonus_currency: "USD",
    receipt_url: "",
    receipt_name: "",
    source: "cs_tracker",
    tracker_tab: r.tab,
    tracker_cs: csName,
    payment_status: r.status,
    remarks: r.remarks,
    recorded_at: now,
  };
}

const log = { database: config.mongoDb, host, applied_at: now, created: [] as string[], history_ids: [] as string[],
  added: [] as { id: string; invoice_ids: string[]; updated_before: unknown; fees_existed: boolean }[] };

async function insertHistory(entries: HistoryEntry[]) {
  if (!entries.length) return;
  const res = await col("student_history").insertMany(entries as any[]);
  log.history_ids.push(...Object.values(res.insertedIds).map(String));
}

async function importRows(file: string) {
  const rows = (JSON.parse(await Bun.file(file).text()).rows ?? []) as Row[];
  if (!rows.length) throw new Error(`No rows in ${file}`);

  const csByEmail = new Map<string, any>();
  for (const e of new Set(rows.map((r) => r.cs_email).filter(Boolean))) {
    const u = await col("users").findOne({ email: e.toLowerCase() });
    if (!u) throw new Error(`No account for ${e} — nothing done`);
    csByEmail.set(e, u);
  }
  const csName = (r: Row) => String(csByEmail.get(r.cs_email)?.full_name || r.tab.charAt(0) + r.tab.slice(1).toLowerCase());

  const byEmail = new Map<string, any[]>(), byPhone = new Map<string, any[]>();
  for await (const s of col("students").find({}) as any) {
    for (const e of emailsOf(s.email)) byEmail.set(e, [...(byEmail.get(e) ?? []), s]);
    for (const k of phoneKeys(s.phone)) byPhone.set(k, [...(byPhone.get(k) ?? []), s]);
  }

  const toAdd = new Map<string, { s: any; entries: any[] }>();   // student id → the entries it gets
  const create: { r: Row; entries: any[] }[] = [];
  const newBy = new Map<string, { r: Row; entries: any[] }>();   // a new student on two rows is made once
  const skipped: Row[] = [], notes: string[] = [];
  let already = 0;
  for (const r of rows) {
    const emails = emailsOf(r.email), keys = phoneKeys(r.phone);
    if (!emails.length && !keys.length) { skipped.push(r); continue; }
    const entry = feeEntry(r, csName(r));
    const found = new Map<string, any>();
    for (const e of emails) for (const s of byEmail.get(e) ?? []) found.set(String(s._id), s);
    for (const k of keys) for (const s of byPhone.get(k) ?? []) found.set(String(s._id), s);
    if (!found.size) {
      const twin = [...emails, ...keys].map((k) => newBy.get(k)).find(Boolean);
      if (twin) { twin.entries.push(entry); notes.push(`${r.tab} row ${r.row} ${r.name} — same new student as ${twin.r.tab} row ${twin.r.row}: made once, with both payments`); continue; }
      const c = { r, entries: [entry] };
      for (const k of [...emails, ...keys]) newBy.set(k, c);
      create.push(c);
      continue;
    }
    if (found.size > 1) notes.push(`${r.tab} row ${r.row} ${r.name} — ${found.size} portal records, each gets this payment: ${[...found.values()].map((s) => s.student_code).join(", ")}`);
    for (const s of found.values()) {
      if ((Array.isArray(s.course_fees) ? s.course_fees : []).some((f: any) => f?.invoice_id === entry.invoice_id)) { already++; continue; }
      const t = toAdd.get(String(s._id)) ?? { s, entries: [] };
      t.entries.push(entry);
      toAdd.set(String(s._id), t);
    }
  }

  const products = new Set((await col("transaction_tags").find({ active: { $ne: false } }, { projection: { name: 1 } }).toArray()).map((t: any) => String(t.name ?? "").trim().toUpperCase()));
  const entriesAdded = [...toAdd.values()].reduce((n, t) => n + t.entries.length, 0);
  console.log(`\nTracker: ${rows.length} rows`);
  console.log(`  in the portal: payment added to ${toAdd.size} student(s) (${entriesAdded} payment row(s))${already ? `; ${already} already there` : ""}`);
  console.log(`  not in the portal, made with their payments: ${create.length}`);
  for (const c of create) {
    const cs = csByEmail.get(c.r.cs_email);
    console.log(`    ${c.r.tab} row ${c.r.row} ${c.r.name} <${c.r.email || "-"}> ${c.r.phone || ""} · ${c.r.course || "no course"} · ${cs ? `CS ${cs.full_name}` : "no CS → Delta Open Students"}`);
  }
  console.log(`  no email and no phone (skipped): ${skipped.length}${skipped.length ? " — " + skipped.map((r) => `${r.tab} row ${r.row} ${r.name}`).join(", ") : ""}`);
  console.log(`\nTo know about (${notes.length}):`);
  for (const n of notes) console.log(`  ${n}`);
  if (!apply) return;

  const undoPath = join(homedir(), `tracker-payments-undo-${now.replace(/[:.]/g, "-")}.json`);
  try {
    // 1. the payments, on the students already here
    for (const { s, entries } of toAdd.values()) {
      await col("students").updateOne({ _id: s._id }, { $push: { course_fees: { $each: entries } }, $set: { updated_date: now } } as any);
      log.added.push({ id: String(s._id), invoice_ids: entries.map((e) => e.invoice_id), updated_before: s.updated_date ?? null, fees_existed: "course_fees" in s });
    }
    // 2. the students who are not here yet
    const index = await loadTeams();
    const docs: any[] = create.map(({ r, entries }) => {
      const cs = csByEmail.get(r.cs_email);
      const emails = emailsOf(r.email);
      return {
        full_name: r.name || emails[0]?.split("@")[0] || r.phone, email: emails[0] ?? "", phone: r.phone, country: "",
        // Text in the email column that is no email is kept where somebody can read it, not stored as one.
        notes: `From the CS enrolment tracker (${r.tab} tab)${r.remarks ? ` — ${r.remarks}` : ""}${!emails.length && r.email ? `. Email on the tracker: "${r.email}"` : ""}`,
        primary_mentor_id: cs ? String(cs._id) : "", primary_mentor_name: cs ? String(cs.full_name || cs.email) : "",
        senior_mentor_id: "", senior_mentor_name: "",
        assignment_status: cs ? "assigned" : "open_pool", status: "ACTIVE", student_level: "LEVEL_1",
        source: "cs_tracker", import_batch: `cs-tracker-${now.slice(0, 10)}`,
        enrolment_status: "closed", enrolment_updated_at: now, enrolment_updated_by_id: "", enrolment_updated_by_name: ACTOR.full_name,
        course_fees: entries,
        created_date: now, updated_date: now, created_by_id: "", created_by_name: ACTOR.full_name,
      };
    });
    if (docs.length) {
      await stampNewStudents(docs, index);
      // After stamping, which clears the fields only the server sets: the course tag, where the course is a product.
      docs.forEach((d, i) => {
        const course = create[i]!.r.course;
        if (course && products.has(course)) d.tags = [`${CLOSED_PREFIX}${course}`];
      });
      for (const d of docs) d.student_code = await nextStudentCode();
      const res = await col("students").insertMany(docs);
      docs.forEach((d, i) => { d._id = res.insertedIds[i]; log.created.push(String(d._id)); });
      await recordCreated(docs, ACTOR, "imported", index);
      await insertHistory(docs.map((d) => ({
        student_id: String(d._id), at: now, type: "enrolment_changed" as const,
        text: `Enrolment closed — enrolled (CS enrolment tracker${d.course_fees[0]?.course ? `, ${d.course_fees[0].course}` : ""})`,
        by_id: null, by_name: ACTOR.full_name!, from: "open", to: "closed", via: "cs-tracker",
      })));
    }
    console.log(`\nDone: payments added to ${toAdd.size} student(s), ${docs.length} made${docs.length ? ` (${docs[0].student_code} → ${docs[docs.length - 1].student_code})` : ""}.`);
  } finally {
    if (log.added.length || log.created.length) {
      await Bun.write(undoPath, JSON.stringify(log, null, 1));
      console.log(`Undo file: ${undoPath}\n  bun src/scripts/import-tracker-payments.ts --undo=${undoPath}          (shows what it would take back)`);
    }
  }
}

async function undo(file: string) {
  const saved = JSON.parse(await Bun.file(file).text()) as typeof log;
  if (saved.database !== config.mongoDb || saved.host !== host) throw new Error(`That undo file is for "${saved.database}" on ${saved.host}, not this database.`);
  let taken = 0;
  for (const a of saved.added) {
    const doc: any = await col("students").findOne({ _id: toObjectId(a.id) as any }, { projection: { course_fees: 1, updated_date: 1 } });
    const n = (Array.isArray(doc?.course_fees) ? doc.course_fees : []).filter((f: any) => a.invoice_ids.includes(f?.invoice_id)).length;
    if (!n) continue;
    taken += n;
    // A student who had no Course fees before has none again (not an empty list); updated_date goes back only when
    // nothing else has touched the student since.
    const left = doc.course_fees.filter((f: any) => !a.invoice_ids.includes(f?.invoice_id));
    const $unset: Record<string, ""> = {}, $set: Record<string, unknown> = {};
    if (!left.length && a.fees_existed === false) $unset.course_fees = "";
    if (doc.updated_date === saved.applied_at) { if (a.updated_before === null) $unset.updated_date = ""; else $set.updated_date = a.updated_before; }
    const update: Record<string, unknown> = "course_fees" in $unset ? {} : { $pull: { course_fees: { invoice_id: { $in: a.invoice_ids } } } };
    if (Object.keys($unset).length) update.$unset = $unset;
    if (Object.keys($set).length) update.$set = $set;
    if (apply) await col("students").updateOne({ _id: doc._id }, update as any);
  }
  const remove: any[] = [], kept: string[] = [];
  for (const id of saved.created) {
    const doc: any = await col("students").findOne({ _id: toObjectId(id) as any });
    if (!doc) continue;
    const links = (await Promise.all(LINKED.map(async (c) => ((await col(c).countDocuments({ student_id: id })) ? c : "")))).filter(Boolean);
    if (links.length || doc.updated_date !== saved.applied_at) kept.push(`${doc.student_code} ${doc.full_name}: worked on since — not removed`);
    else remove.push(doc);
  }
  console.log(`\nUndo of the tracker import on ${saved.applied_at}: ${taken} payment row(s) taken off, ${remove.length} made student(s) removed`);
  for (const k of kept) console.log(`  ${k}`);
  if (!apply) return;
  await col("student_history").deleteMany({ _id: { $in: saved.history_ids.map((id) => toObjectId(id)) as any[] } });
  if (remove.length) {
    await col("student_history").deleteMany({ student_id: { $in: remove.map((d) => String(d._id)) } });
    await col("students").deleteMany({ _id: { $in: remove.map((d) => d._id) } });
  }
}

await connectDb();
console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}`);
try {
  const undoFile = option("undo"), file = option("file");
  if (undoFile) await undo(undoFile);
  else if (file) await importRows(file);
  else console.log("Give --file=<the tracker's JSON> (or --undo=<undo file>).");
} finally {
  await closeDb();
}
if (!apply) console.log("\nNothing was written. Run again with --apply to do it.");
