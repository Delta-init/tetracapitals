/**
 * Adds the students from "Entire students data - split by team" who are not in the portal yet — each to the team
 * the sheet gave them (25% a team, month by month), and to that team's CS people in turns. Students already in the
 * portal are left exactly as they are.
 *
 *   cd backend
 *   bun src/scripts/import-students-sheet.ts --file=<…/Entire students data - split by team (for import).json>
 *                                                         shows what it would do (writes nothing)
 *   bun src/scripts/import-students-sheet.ts --file=<…> --apply      adds them; saves an undo file
 *   bun src/scripts/import-students-sheet.ts --undo=<file> [--apply] removes what --apply added (only students
 *                                                                    nobody has worked on since)
 *
 * Already in the portal: the same email, or the same phone (last 9 digits) and the same person's name. Skipped: no
 * email and no phone. No name: named after their email for now (listed for a check). Family pairs sharing a phone
 * or email go to the same CS. Created as the app's own import
 * creates students — next STU code, ACTIVE, LEVEL_1, assigned, team from the mentor, "Imported by Students sheet
 * import" in their history — marked source "students_sheet" with the sheet's date as joined_date. Nothing is emailed.
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env). Safe to run again: once added,
 * a student matches by email or phone and is not added twice.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";
import { nextStudentCode } from "../lib/studentCode";
import { loadTeams } from "../students/teams";
import { stampNewStudents, recordCreated } from "../students/history";
import type { AuthUser } from "../auth/middleware";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = new Date().toISOString();
const BATCH = `students-sheet-${now.slice(0, 10)}`;
const ACTOR: AuthUser = { id: "", email: "", full_name: "Students sheet import", app_role: "super_admin" };
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
/** Records that point at a student — one of these and --undo leaves the student alone. */
const LINKED = ["student_followups", "student_calls", "funding_transactions", "student_requests", "tickets",
  "commission_credits", "commission_ledgers", "mentor_referrals", "manual_commission_adjustments"];

interface SheetStudent { sheet_row: number; team: string; name: string; email: string; phone: string; joined_date: string; partner_row: number | null }

const emailsOf = (v: string) => [...new Set((v.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) ?? []).map((e) => e.toLowerCase().replace(/[.,]+$/, "")))];
function phoneKeys(v: string): string[] {
  const out: string[] = [];
  for (const part of v.split(/[/,;|]| - |[A-Za-z]+/)) {
    const d = part.replace(/\D/g, "");
    if (d.length > 13) {           // two numbers with only spaces between them
      let acc = "";
      for (const tok of part.trim().split(/\s+/)) {
        acc += tok.replace(/\D/g, "");
        if (acc.length >= 9 && (acc.length >= 12 || !/^(971|91)/.test(acc))) { out.push(acc); acc = ""; }
      }
      if (acc.length >= 7) out.push(acc);
    } else if (d.length >= 7) out.push(d);
  }
  return [...new Set(out.map((d) => (d.startsWith("00") ? d.slice(2) : d).slice(-9)))];
}
const keyOf = (p: unknown) => { const d = String(p ?? "").replace(/\D/g, "").replace(/^00/, ""); return d.length >= 7 ? d.slice(-9) : ""; };
const SKIP = new Set(["mohammed", "muhammed", "muhammad", "mohamed", "mohammad", "md", "mohd"]);
/** A name's words: any whitespace (tabs too) separates them; letters only; Mohammed and its spellings left out. */
const words = (n: unknown) => String(n ?? "").toLowerCase().replace(/\s+/g, " ").replace(/[^a-z ]/g, "").split(" ").filter((w) => w && !SKIP.has(w));
/** Same person behind a shared phone: the same first name, or one name's words all inside the other's ("Noushad" / "Ahammed Noushad"). */
function samePerson(a: unknown, b: unknown): boolean {
  const x = words(a), y = words(b);
  if (!x.length || !y.length) return false;
  return x[0] === y[0] || x.every((w) => y.includes(w)) || y.every((w) => x.includes(w));
}

async function importStudents(file: string) {
  const sheet = (JSON.parse(await Bun.file(file).text()).students ?? []) as SheetStudent[];
  if (!sheet.length) throw new Error(`No students in ${file}`);

  // Who is in the portal already.
  const byEmail = new Map<string, any>(), byPhone = new Map<string, any[]>(), byName = new Map<string, any>();
  for await (const s of col("students").find({}, { projection: { email: 1, phone: 1, full_name: 1, student_code: 1 } }) as any) {
    for (const e of emailsOf(String(s.email ?? ""))) byEmail.set(e, s);
    const k = keyOf(s.phone);
    if (k) byPhone.set(k, [...(byPhone.get(k) ?? []), s]);
    byName.set(String(s.full_name ?? "").trim().toLowerCase(), s);
  }
  const inPortal: SheetStudent[] = [], noContact: SheetStudent[] = [], add: (SheetStudent & { review: string })[] = [];
  for (const x of sheet) {
    const emails = emailsOf(x.email), keys = phoneKeys(x.phone);
    if (emails.some((e) => byEmail.has(e))) { inPortal.push(x); continue; }
    const phoneMates = keys.flatMap((k) => byPhone.get(k) ?? []);
    if (phoneMates.some((s) => samePerson(s.full_name, x.name))) { inPortal.push(x); continue; }
    if (!emails.length && !keys.length) { noContact.push(x); continue; }
    // No name in the sheet: named after their email (or phone) rather than left blank — listed for a check.
    const named = x.name.trim() || emails[0]?.split("@")[0] || x.phone.trim();
    const review = [
      ...(x.name.trim() ? [] : [`no name in the sheet — named "${named}" for now`]),
      ...phoneMates.map((s) => `shares a phone with ${s.student_code} ${String(s.full_name ?? "").trim()}`),
      ...(byName.has(x.name.trim().toLowerCase()) ? [`same name as ${byName.get(x.name.trim().toLowerCase()).student_code}`] : []),
    ].join("; ");
    add.push({ ...x, name: named, review });
  }

  // The four teams and their CS people, in the order the portal gives them turns.
  const index = await loadTeams();
  const teamOf = new Map<string, (typeof index.teams)[number]>();
  for (const t of ["Wall Street", "Gladiators", "Expandables", "Money Heist"]) {
    const team = index.teams.find((x) => x.name === `Team ${t}`);
    if (!team || !team.active || !team.cs.length) throw new Error(`"Team ${t}" has no active CS here — nothing was changed.`);
    teamOf.set(t, team);
  }

  // In turns within each team, by the sheet's date; family pairs to the same CS.
  add.sort((a, b) => a.team.localeCompare(b.team) || (a.joined_date || "9999").localeCompare(b.joined_date || "9999") || a.sheet_row - b.sheet_row);
  const turn = new Map<string, number>(), csOf = new Map<number, { id: string; name: string }>();
  for (const x of add) {
    const partnerCs = x.partner_row != null ? csOf.get(x.partner_row) : undefined;
    if (partnerCs) { csOf.set(x.sheet_row, partnerCs); continue; }
    const cs = teamOf.get(x.team)!.cs, i = turn.get(x.team) ?? 0;
    csOf.set(x.sheet_row, cs[i % cs.length]);
    turn.set(x.team, i + 1);
  }

  console.log(`\nIn the sheet: ${sheet.length} · already in the portal (left as they are): ${inPortal.length} · no email or phone (skipped): ${noContact.length} · to add: ${add.length}`);
  for (const [t, team] of teamOf) {
    const mine = add.filter((x) => x.team === t);
    const per = team.cs.map((c) => `${c.name} ${mine.filter((x) => csOf.get(x.sheet_row)!.id === c.id).length}`).join(", ");
    console.log(`  ${team.name}: ${mine.length} → ${per}`);
  }
  const toCheck = add.filter((x) => x.review);
  console.log(`\nTo check after (added as new students): ${toCheck.length}`);
  for (const x of toCheck) console.log(`  row ${x.sheet_row} ${x.name} — ${x.review}`);
  console.log(`\nSkipped, no email or phone: ${noContact.map((x) => `row ${x.sheet_row} ${x.name}`).join(", ") || "none"}`);
  if (!apply) return;

  const docs: any[] = add.map((x) => {
    const cs = csOf.get(x.sheet_row)!;
    return {
      full_name: x.name.trim(), email: x.email.trim(), phone: x.phone.trim(), country: "", notes: "",
      primary_mentor_id: cs.id, primary_mentor_name: cs.name, senior_mentor_id: "", senior_mentor_name: "",
      assignment_status: "assigned", status: "ACTIVE", student_level: "LEVEL_1",
      source: "students_sheet", import_batch: BATCH, joined_date: x.joined_date, sheet_row: x.sheet_row,
      created_date: now, updated_date: now, created_by_id: "", created_by_name: ACTOR.full_name,
    };
  });
  await stampNewStudents(docs, index);              // team from the mentor, who received them first, assigned_at
  const added: { id: string; code: string; sheet_row: number }[] = [];
  const undoPath = join(homedir(), `students-sheet-undo-${now.replace(/[:.]/g, "-")}.json`);
  try {
    for (let i = 0; i < docs.length; i += 200) {
      const part = docs.slice(i, i + 200);
      for (const d of part) d.student_code = await nextStudentCode();
      const res = await col("students").insertMany(part);
      part.forEach((d, j) => { d._id = res.insertedIds[j]; added.push({ id: String(d._id), code: d.student_code, sheet_row: d.sheet_row }); });
    }
    await recordCreated(docs.filter((d) => d._id), ACTOR, "imported", index);
  } finally {
    if (added.length) {
      await Bun.write(undoPath, JSON.stringify({ database: config.mongoDb, host, batch: BATCH, applied_at: now, students: added }, null, 1));
      console.log(`\nAdded ${added.length} students: ${added[0].code} → ${added[added.length - 1].code}`);
      console.log(`Undo file: ${undoPath}\n  bun src/scripts/import-students-sheet.ts --undo=${undoPath}          (shows what it would remove)`);
    }
  }
}

async function undo(file: string) {
  const saved = JSON.parse(await Bun.file(file).text());
  if (saved.database !== config.mongoDb || saved.host !== host) throw new Error(`That undo file is for "${saved.database}" on ${saved.host}, not this database.`);
  const keep: string[] = [], remove: any[] = [];
  for (const s of saved.students as { id: string; code: string }[]) {
    const doc: any = await col("students").findOne({ _id: toObjectId(s.id) as any });
    if (!doc) continue;
    const links = (await Promise.all(LINKED.map(async (c) => ((await col(c).countDocuments({ student_id: s.id })) ? c : "")))).filter(Boolean);
    const edited = doc.updated_date !== saved.applied_at;
    if (links.length || edited) keep.push(`${s.code} ${doc.full_name} — ${[edited ? "edited since" : "", ...links].filter(Boolean).join(", ")}`);
    else remove.push(doc);
  }
  console.log(`\nUndo of ${saved.batch} (${saved.applied_at}): ${remove.length} student(s) to remove; ${keep.length} kept because someone has worked on them`);
  for (const k of keep) console.log(`  kept: ${k}`);
  if (!apply || !remove.length) return;
  const ids = remove.map((d) => String(d._id));
  await col("student_history").deleteMany({ student_id: { $in: ids } });
  const res = await col("students").deleteMany({ _id: { $in: remove.map((d) => d._id) } });
  console.log(`Removed ${res.deletedCount} student(s) and their history.`);
}

await connectDb();
console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}`);
try {
  const undoFile = option("undo"), file = option("file");
  if (undoFile) await undo(undoFile);
  else if (file) await importStudents(file);
  else console.log("Give --file=<the import JSON> (or --undo=<undo file>).");
} finally {
  await closeDb();
}
if (!apply) console.log("\nNothing was written. Run again with --apply to make these changes.");
