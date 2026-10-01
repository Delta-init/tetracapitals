/**
 * A CS's own students sheet → the portal: every student on it is given to that CS. Those already in the portal move
 * to them (their history notes it, team included); new ones are created under them. Rows marked CLOSED (enrolled)
 * get Enrolment: Closed; every other row gets Enrolment: Old (from the CS's earlier list, not enrolled) — a student
 * already Closed is never put back to Old. One sheet per CS, run with that CS's email.
 *
 *   cd backend
 *   bun src/scripts/assign-cs-sheet.ts --cs=<cs email> --file=<the sheet's JSON>     shows what it would do
 *   bun src/scripts/assign-cs-sheet.ts --cs=<cs email> --file=<…> --apply            does it; saves an undo file
 *   bun src/scripts/assign-cs-sheet.ts --undo=<file> [--apply]                       puts back what --apply did
 *
 * The JSON: { rows: [{ row, name, email, phone, closed }] } — made from the CS's spreadsheet.
 * Already in the portal: the same email, or the same phone (any number in the cell, last 9 digits). The sheet is the
 * CS's own list, so a phone match is taken as the same student even when the name is spelled differently — those are
 * listed. A student another CS's sheet already gave to them is on both CSs' lists: they stay with that CS and become
 * Common with this one (students.common_cs) — both see and work on them, tagged Common. No email and no phone: skipped.
 * New students are created as the app's own import creates them (next STU code, ACTIVE, LEVEL_1, team from the CS).
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env). Running it again changes nothing.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";
import { isMentorRole } from "../lib/roles";
import { nextStudentCode } from "../lib/studentCode";
import { loadTeams } from "../students/teams";
import { stampNewStudents, recordCreated, prepareStudentUpdate, describePerson, type HistoryEntry } from "../students/history";
import { commonIds } from "../students/followups";
import type { AuthUser } from "../auth/middleware";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const MISSING = { $missing: true };
const LINKED = ["student_followups", "student_calls", "funding_transactions", "student_requests", "tickets",
  "commission_credits", "commission_ledgers", "mentor_referrals", "manual_commission_adjustments"];

interface Row { row: number; name: string; email: string; phone: string; closed: boolean }

const emailsOf = (v: unknown) => [...new Set((String(v ?? "").match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) ?? []).map((e) => e.toLowerCase().replace(/[.,]+$/, "")))];
/** Every number in a phone cell, by its last 9 digits ("564643928.0" was a number cell; "(wp)" and new lines split). */
const phoneKeys = (v: unknown) => [...new Set(String(v ?? "").replace(/\.0$/, "").split(/[\n\r/,;|]+| - /)
  .map((x) => x.replace(/\(.*?\)/g, "").replace(/\D/g, "").replace(/^00/, "")).filter((x) => x.length >= 7).map((x) => x.slice(-9)))];
const SKIP = new Set(["mohammed", "muhammed", "muhammad", "mohamed", "mohammad", "md", "mohd"]);
const words = (n: unknown) => String(n ?? "").toLowerCase().replace(/\s+/g, " ").replace(/[^a-z ]/g, "").split(" ").filter((w) => w && !SKIP.has(w));
const samePerson = (a: unknown, b: unknown) => {
  const x = words(a), y = words(b);
  return !!(x.length && y.length) && (x[0] === y[0] || x.every((w) => y.includes(w)) || y.every((w) => x.includes(w)));
};

const log = { database: config.mongoDb, host, batch: "", cs: "", applied_at: now, created: [] as string[], history_ids: [] as string[],
  changes: [] as { id: string; before: Record<string, unknown>; after: Record<string, unknown> }[] };

async function insertHistory(entries: HistoryEntry[]) {
  if (!entries.length) return;
  const res = await col("student_history").insertMany(entries as any[]);
  log.history_ids.push(...Object.values(res.insertedIds).map(String));
}

async function assign(csEmail: string, file: string) {
  const cs: any = await col("users").findOne({ email: csEmail.trim().toLowerCase() });
  if (!cs) throw new Error(`No account for ${csEmail}`);
  if (cs.status === "inactive" || !isMentorRole(String(cs.app_role ?? ""))) throw new Error(`${csEmail} is switched off or not a CS / mentor`);
  const csName = String(cs.full_name || cs.email);
  const rows = (JSON.parse(await Bun.file(file).text()).rows ?? []) as Row[];
  if (!rows.length) throw new Error(`No rows in ${file}`);
  log.batch = `cs-sheet-${csEmail.split("@")[0]}-${now.slice(0, 10)}`;
  log.cs = csEmail;
  const ACTOR: AuthUser = { id: "", email: "", full_name: `${csName}'s students sheet`, app_role: "super_admin" };

  const byEmail = new Map<string, any[]>(), byPhone = new Map<string, any[]>();
  for await (const s of col("students").find({}) as any) {
    for (const e of emailsOf(s.email)) byEmail.set(e, [...(byEmail.get(e) ?? []), s]);
    for (const k of phoneKeys(s.phone)) byPhone.set(k, [...(byPhone.get(k) ?? []), s]);
  }

  const move: { r: Row; s: any }[] = [], common: { r: Row; s: any }[] = [], already: { r: Row; s: any }[] = [];
  const create: Row[] = [], skipped: Row[] = [], notes: string[] = [];
  const takenBy = new Map<string, Row>();   // a portal student two rows point at is moved once
  const newBy = new Map<string, Row>();     // a new student on two rows is created once
  for (const r of rows) {
    const emails = emailsOf(r.email), keys = phoneKeys(r.phone);
    if (!emails.length && !keys.length) { skipped.push(r); continue; }
    const found = new Map<string, any>();
    for (const e of emails) for (const s of byEmail.get(e) ?? []) found.set(String(s._id), s);
    for (const k of keys) for (const s of byPhone.get(k) ?? []) found.set(String(s._id), s);
    if (!found.size) {
      const twin = [...emails, ...keys].map((k) => newBy.get(k)).find(Boolean);
      if (twin) { notes.push(`row ${r.row} ${r.name} — same new student as row ${twin.row}: created once`); if (r.closed) twin.closed = true; continue; }
      for (const k of [...emails, ...keys]) newBy.set(k, r);
      create.push(r);
      continue;
    }
    const list = [...found.values()];
    if (!list.some((s) => samePerson(s.full_name, r.name))) notes.push(`row ${r.row} ${r.name} — taken as ${list.map((s) => `${s.student_code} ${String(s.full_name ?? "").trim()}`).join(", ")} (name spelled differently)`);
    if (list.length > 1) notes.push(`row ${r.row} ${r.name} — ${list.length} portal records, all go to ${csName}: ${list.map((s) => `${s.student_code} ${String(s.full_name ?? "").trim()}`).join(", ")}`);
    for (const s of list) {
      const first = takenBy.get(String(s._id));
      if (first) { notes.push(`row ${r.row} ${r.name} — same portal student as row ${first.row} (${s.student_code})`); if (r.closed) first.closed = true; continue; }
      takenBy.set(String(s._id), r);
      if (String(s.primary_mentor_id ?? "") === String(cs._id)) already.push({ r, s });
      else if (s.cs_sheet?.cs && s.cs_sheet.cs !== csEmail) {
        // On another CS's own sheet too: they stay with that CS and become Common with this one.
        notes.push(`row ${r.row} ${r.name} — ${s.student_code} is on ${s.cs_sheet.cs}'s sheet too (${String(s.cs_sheet.at).slice(0, 10)}): stays with ${s.primary_mentor_name || "them"}, Common with ${csName}`);
        (commonIds(s).includes(String(cs._id)) ? already : common).push({ r, s });
      } else move.push({ r, s });
    }
  }
  const closedRows = rows.filter((r) => r.closed);
  const toClose = [...move, ...common, ...already].filter(({ r, s }) => r.closed && s.enrolment_status !== "closed");
  // Not CLOSED on the sheet → Old, unless they are Closed already (an enrolled student is never put back) or Old.
  const toOld = [...move, ...common, ...already].filter(({ r, s }) => !r.closed && s.enrolment_status !== "closed" && s.enrolment_status !== "old");

  console.log(`\n${csName}'s sheet: ${rows.length} rows`);
  const alreadyCommon = already.filter(({ s }) => String(s.primary_mentor_id ?? "") !== String(cs._id)).length;
  console.log(`  already in the portal: ${move.length + common.length + already.length} record(s) — ${move.length} move to ${csName}, ${common.length} become Common with ${csName}, ${already.length} are theirs already${alreadyCommon ? ` (${alreadyCommon} as Common)` : ""}`);
  const from: Record<string, number> = {};
  for (const { s } of move) { const k = `${s.primary_mentor_name || "(no CS)"} · ${s.team_name || "(no team)"}`; from[k] = (from[k] ?? 0) + 1; }
  for (const [k, n] of Object.entries(from).sort((a, b) => b[1] - a[1])) console.log(`    from ${k}: ${n}`);
  console.log(`  new, created under ${csName}: ${create.length}`);
  console.log(`  CLOSED (enrolled) on the sheet: ${closedRows.length} → Enrolment set to Closed on ${toClose.length + create.filter((r) => r.closed).length}`);
  console.log(`  not CLOSED → Enrolment set to Old on ${toOld.length + create.filter((r) => !r.closed).length}`);
  console.log(`  no email or phone (skipped): ${skipped.length}${skipped.length ? " — " + skipped.map((r) => `row ${r.row} ${r.name}`).join(", ") : ""}`);
  console.log(`\nTo know about (${notes.length}):`);
  for (const n of notes) console.log(`  ${n}`);
  if (!apply) return;

  const undoPath = join(homedir(), `cs-sheet-undo-${csEmail.split("@")[0]}-${now.replace(/[:.]/g, "-")}.json`);
  try {
    const marker = { cs: csEmail, batch: log.batch, at: now };
    const index = await loadTeams();
    // 1. move the ones already in the portal (history line + team, as any change of CS)
    for (const { s } of move) {
      // Loaded before the portal kept who received a student first: that was the CS they are with now, so the
      // history reads "CS changed from <them> to <this CS>" rather than calling this their first assignment.
      if (!s.first_assignee_id && s.primary_mentor_id) {
        const first = { first_assignee_id: String(s.primary_mentor_id), first_assignee_name: String(s.primary_mentor_name ?? ""), first_assignee_role: String(index.userById.get(String(s.primary_mentor_id))?.app_role ?? ""), first_assigned_at: String(s.assigned_at || s.created_date || now) };
        log.changes.push({ id: String(s._id), before: Object.fromEntries(Object.keys(first).map((k) => [k, k in s ? s[k] : MISSING])), after: first });
        await col("students").updateOne({ _id: s._id }, { $set: first });
        Object.assign(s, first);
      }
      const data: Record<string, any> = { primary_mentor_id: String(cs._id), primary_mentor_name: csName, cs_sheet: marker, updated_date: now };
      const entries = await prepareStudentUpdate(s, data, ACTOR);
      for (const e of entries) e.via = "cs-sheet";
      log.changes.push({ id: String(s._id), before: Object.fromEntries(Object.keys(data).map((k) => [k, k in s ? s[k] : MISSING])), after: data });
      await col("students").updateOne({ _id: s._id }, { $set: data });
      Object.assign(s, data);
      await insertHistory(entries);
    }
    // 1b. Common: on another CS's own sheet too — they stay with that CS, and this CS is added; both have the student.
    for (const { r, s } of common) {
      const team = index.teamOf(String(cs._id));
      const entry = { id: String(cs._id), name: csName, email: csEmail, team_name: team?.name ?? "", at: now, via: "cs-sheet", sheet_row: r.row };
      const data = { common_cs: [...(Array.isArray(s.common_cs) ? s.common_cs : []), entry], updated_date: now };
      log.changes.push({ id: String(s._id), before: Object.fromEntries(Object.keys(data).map((k) => [k, k in s ? s[k] : MISSING])), after: data });
      await col("students").updateOne({ _id: s._id }, { $set: data });
      Object.assign(s, data);
      await insertHistory([{
        student_id: String(s._id), at: now, type: "made_common", text: `Common — also with ${describePerson(index, cs._id, csName)}: on their sheet too`,
        by_id: null, by_name: ACTOR.full_name!, to: { id: entry.id, name: csName, team: entry.team_name || null }, via: "cs-sheet",
      }]);
    }
    // 2. Enrolment: Closed for the CLOSED rows already in the portal
    for (const { s } of toClose) {
      const data = { enrolment_status: "closed", enrolment_updated_at: now, enrolment_updated_by_id: "", enrolment_updated_by_name: ACTOR.full_name!, updated_date: now };
      log.changes.push({ id: String(s._id), before: Object.fromEntries(Object.keys(data).map((k) => [k, k in s ? s[k] : MISSING])), after: data });
      await col("students").updateOne({ _id: s._id }, { $set: data });
      await insertHistory([{ student_id: String(s._id), at: now, type: "enrolment_changed", text: "Enrolment closed — enrolled", by_id: null, by_name: ACTOR.full_name!, from: s.enrolment_status === "old" ? "old" : "open", to: "closed", via: "cs-sheet" }]);
    }
    // 2b. Enrolment: Old for the rest
    for (const { s } of toOld) {
      const data = { enrolment_status: "old", enrolment_updated_at: now, enrolment_updated_by_id: "", enrolment_updated_by_name: ACTOR.full_name!, updated_date: now };
      log.changes.push({ id: String(s._id), before: Object.fromEntries(Object.keys(data).map((k) => [k, k in s ? s[k] : MISSING])), after: data });
      await col("students").updateOne({ _id: s._id }, { $set: data });
      await insertHistory([{ student_id: String(s._id), at: now, type: "enrolment_changed", text: "Enrolment set to Old", by_id: null, by_name: ACTOR.full_name!, from: s.enrolment_status === "closed" ? "closed" : "open", to: "old", via: "cs-sheet" }]);
    }
    // 3. create the new ones under the CS
    const docs: any[] = create.map((r) => {
      const emails = emailsOf(r.email);
      return {
        full_name: r.name.trim() || emails[0]?.split("@")[0] || r.phone.trim(), email: r.email.trim(), phone: r.phone.trim(), country: "", notes: "",
        primary_mentor_id: String(cs._id), primary_mentor_name: csName, senior_mentor_id: "", senior_mentor_name: "",
        assignment_status: "assigned", status: "ACTIVE", student_level: "LEVEL_1",
        source: "cs_sheet", import_batch: log.batch, cs_sheet: marker, sheet_row: r.row,
        enrolment_status: r.closed ? "closed" : "old", enrolment_updated_at: now, enrolment_updated_by_id: "", enrolment_updated_by_name: ACTOR.full_name,
        created_date: now, updated_date: now, created_by_id: "", created_by_name: ACTOR.full_name,
      };
    });
    if (docs.length) {
      await stampNewStudents(docs, index);
      for (const d of docs) d.student_code = await nextStudentCode();
      const res = await col("students").insertMany(docs);
      docs.forEach((d, i) => { d._id = res.insertedIds[i]; log.created.push(String(d._id)); });
      await recordCreated(docs, ACTOR, "imported", index);
      await insertHistory(docs.map((d) => ({
        student_id: String(d._id), at: now, type: "enrolment_changed" as const, text: d.enrolment_status === "closed" ? "Enrolment closed — enrolled" : "Enrolment set to Old",
        by_id: null, by_name: ACTOR.full_name!, from: "open", to: d.enrolment_status, via: "cs-sheet",
      })));
    }
    console.log(`\nDone: ${move.length} moved to ${csName}, ${common.length} made Common, ${toClose.length} set to Closed, ${toOld.length} set to Old, ${docs.length} created${docs.length ? ` (${docs[0].student_code} → ${docs[docs.length - 1].student_code})` : ""}.`);
  } finally {
    if (log.changes.length || log.created.length) {
      await Bun.write(undoPath, JSON.stringify(log, null, 1));
      console.log(`Undo file: ${undoPath}\n  bun src/scripts/assign-cs-sheet.ts --undo=${undoPath}          (shows what it would put back)`);
    }
  }
}

async function undo(file: string) {
  const saved = JSON.parse(await Bun.file(file).text()) as typeof log;
  if (saved.database !== config.mongoDb || saved.host !== host) throw new Error(`That undo file is for "${saved.database}" on ${saved.host}, not this database.`);
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  let restored = 0;
  const kept: string[] = [];
  for (const c of [...saved.changes].reverse()) {
    const doc: any = await col("students").findOne({ _id: toObjectId(c.id) as any });
    if (!doc) continue;
    // A change is put back whole or not at all: if anything it wrote was changed since (by a later run or a user), it
    // is left as it is now. updated_date goes back only when nothing has touched the student since — a created
    // student's updated_date is how a later undo of the run that created them tells they were never worked on.
    const fields = Object.keys(c.before).filter((k) => k !== "updated_date");
    const moved = fields.filter((k) => !same(doc[k], c.after[k]));
    if (moved.length) { kept.push(`${doc.student_code}: ${moved.join(", ")} changed since — this change left as now`); continue; }
    if (!fields.length) continue;
    const keys = "updated_date" in c.before && same(doc.updated_date, c.after.updated_date) ? [...fields, "updated_date"] : fields;
    const $set: Record<string, unknown> = {}, $unset: Record<string, ""> = {};
    for (const k of keys) { const v = c.before[k] as any; if (v && typeof v === "object" && v.$missing) $unset[k] = ""; else $set[k] = v; }
    restored++;
    if (apply) await col("students").updateOne({ _id: doc._id }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) });
  }
  const remove: any[] = [];
  for (const id of saved.created) {
    const doc: any = await col("students").findOne({ _id: toObjectId(id) as any });
    if (!doc) continue;
    const links = (await Promise.all(LINKED.map(async (c) => ((await col(c).countDocuments({ student_id: id })) ? c : "")))).filter(Boolean);
    if (links.length || doc.updated_date !== saved.applied_at) kept.push(`${doc.student_code} ${doc.full_name}: worked on since — not removed`);
    else remove.push(doc);
  }
  console.log(`\nUndo of ${saved.batch}: ${restored} student(s) put back, ${remove.length} created student(s) removed, ${saved.history_ids.length} history line(s) removed`);
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
  const undoFile = option("undo"), cs = option("cs"), file = option("file");
  if (undoFile) await undo(undoFile);
  else if (cs && file) await assign(cs, file);
  else console.log("Give --cs=<cs email> --file=<the sheet's JSON> (or --undo=<undo file>).");
} finally {
  await closeDb();
}
if (!apply) console.log("\nNothing was written. Run again with --apply to make these changes.");
