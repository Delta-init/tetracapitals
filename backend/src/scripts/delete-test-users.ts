/**
 * Deletes the test accounts — every user whose email ends in @deltatest.dev — and the test records made with them,
 * plus the finance test students listed below, with everything that hangs off them:
 *   - the test users, the commission credits paid to them and the referrals they started;
 *   - the test students: those a test user added (created_by), and TEST_STUDENTS (code and email must both match,
 *     or nothing is done) — with their deposits, the commission credits from those deposits, their history,
 *     follow-ups, requests and everything else filed under the student.
 *   - (2026-10-12) students whose name says test — "test" as a word, "abshar" (the developer's own test records), a
 *     name of one letter repeated — each listed with why, for review first; --keep=STU-1,STU-2 leaves those out,
 *     --also=STU-3 adds others; and every funding request a test user raised, whatever student it is on.
 * Kept: real students a test CS received first (their "First received by" still names the test CS, by choice), and
 * the audit log (`logs`), which records what was done.
 *
 *   cd backend
 *   bun src/scripts/delete-test-users.ts                       shows what it would delete
 *   bun src/scripts/delete-test-users.ts --apply               deletes; saves a full copy in an undo file first
 *   bun src/scripts/delete-test-users.ts --keep=STU-4131       …but not these students (codes, comma-separated)
 *   bun src/scripts/delete-test-users.ts --also=STU-4952       …and these too
 *   bun src/scripts/delete-test-users.ts --undo=<file> [--apply]   puts back everything that file holds
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env). Running it again finds nothing.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { EJSON } from "bson";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];

const TEST_EMAIL = /@deltatest\.dev$/i;
/** Students sent through finance and the LMS while those links were tested. */
const TEST_STUDENTS = [
  { code: "STU-4122", email: "absharameen625@gmail.com" },
  { code: "STU-4123", email: "absharameennaknabhahabhbahbabhabjhb625@gmail.com" },
  { code: "STU-4127", email: "info@xellaqqqqrfx.com" },
  { code: "STU-4157", email: "absharameen61111125@gmail.com" },
];
/** A test student by their name (2026-10-12): why, or null. */
const testByName = (name: unknown): string | null => {
  const n = String(name ?? "").trim();
  if (/\btest/i.test(n)) return "name says test";
  if (/abshar/i.test(n)) return "abshar (developer's test)";
  if (/^(.)\1{4,}$/i.test(n.replace(/\s+/g, ""))) return "one letter repeated";
  return null;
};
const codes = (v: string | undefined) => new Set((v ?? "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean));
const KEEP = codes(option("keep"));
const ALSO = codes(option("also"));

/** Everything filed under a student by `student_id`. */
const BY_STUDENT = ["funding_transactions", "commission_credits", "student_history", "student_followups", "student_followup_events",
  "student_calls", "student_requests", "tickets", "mentor_referrals", "mentor_deductions", "retention_assignments", "student_logs",
  "student_log_history", "mt5_accounts", "course_upgrades", "course_payments", "payment_link_requests", "notifications"];

type Found = Map<string, Map<string, any>>;   // collection → _id → doc

async function findAll(): Promise<{ found: Found; users: any[]; students: any[] }> {
  const found: Found = new Map();
  const add = (c: string, docs: any[]) => {
    const m = found.get(c) ?? new Map<string, any>();
    for (const d of docs) m.set(String(d._id), d);
    found.set(c, m);
  };

  const users = await col("users").find({ email: TEST_EMAIL }).toArray();
  const userIds = users.map((u) => String(u._id));
  add("users", users);

  const students: any[] = userIds.length ? await col("students").find({ created_by: { $in: userIds } }).toArray() : [];
  for (const t of TEST_STUDENTS) {
    const match = await col("students").find({ student_code: t.code, email: t.email }).toArray();
    if (match.length > 1) throw new Error(`${t.code} <${t.email}> matches ${match.length} students — nothing done`);
    if (match.length === 1 && !students.some((s) => String(s._id) === String(match[0]!._id))) students.push(match[0]);
  }
  // By name, and any added by code — less any kept (2026-10-12).
  for (const s of await col("students").find({ $or: [{ full_name: { $regex: "\\btest|abshar", $options: "i" } }, ...[...ALSO].map((c) => ({ student_code: { $regex: `^${c.replace(/[^A-Z0-9-]/g, "")}$`, $options: "i" } }))] }).toArray() as any[]) {
    const why = ALSO.has(String(s.student_code ?? "").toUpperCase()) ? "added by --also" : testByName(s.full_name);
    if (why && !students.some((x) => String(x._id) === String(s._id))) students.push({ ...s, _why: why });
  }
  for (const s of await col("students").find({ full_name: { $regex: "^\\s*(\\w)\\1{4,}\\s*$", $options: "i" } }).toArray() as any[]) {
    if (!students.some((x) => String(x._id) === String(s._id))) students.push({ ...s, _why: "one letter repeated" });
  }
  for (let i = students.length - 1; i >= 0; i--) if (KEEP.has(String(students[i].student_code ?? "").toUpperCase())) students.splice(i, 1);
  const studentIds = students.map((s) => String(s._id));
  add("students", students.map(({ _why, ...s }) => s));

  for (const c of BY_STUDENT) add(c, studentIds.length ? await col(c).find({ student_id: { $in: studentIds } }).toArray() : []);
  if (studentIds.length) add("student_requests", await col("student_requests").find({ created_student_id: { $in: studentIds } }).toArray());
  // Every funding request a test user raised, whatever student it is on (2026-10-12).
  if (userIds.length) add("funding_transactions", await col("funding_transactions").find({ $or: [{ requested_by_id: { $in: userIds } }, { initiating_mentor_id: { $in: userIds } }, { created_by: { $in: userIds } }] }).toArray());
  const txIds = [...(found.get("funding_transactions")?.keys() ?? [])];
  if (txIds.length) add("commission_credits", await col("commission_credits").find({ transaction_id: { $in: txIds } }).toArray());
  if (userIds.length) {
    add("commission_credits", await col("commission_credits").find({ recipient_id: { $in: userIds } }).toArray());
    add("commission_ledgers", await col("commission_ledgers").find({ mentor_id: { $in: userIds } }).toArray());
    add("mentor_referrals", await col("mentor_referrals").find({ $or: [{ initiating_mentor_id: { $in: userIds } }, { receiving_mentor_id: { $in: userIds } }] }).toArray());
  }
  for (const [c, m] of found) if (!m.size) found.delete(c);
  return { found, users, students };
}

async function remove() {
  const { found, users, students } = await findAll();
  const userIds = new Set(users.map((u) => String(u._id)));
  console.log(`\nTest users (@deltatest.dev): ${users.length}`);
  for (const u of users) console.log(`  ${u.full_name} <${u.email}> · ${u.app_role}${u.status === "inactive" ? " · switched off" : ""}${u.up_head_id ? ` · still in a team (Up Head ${u.up_head_name || u.up_head_id})` : ""}`);
  console.log(`\nTest students: ${students.length}`);
  for (const s of students) console.log(`  ${s.student_code} ${s.full_name} <${s.email}> · CS ${s.primary_mentor_name || "none"} · ${s._why || (s.created_by_name ? `added by test user ${s.created_by_name}` : "listed")}`);
  const txs = [...(found.get("funding_transactions")?.values() ?? [])];
  console.log(`\nTheir funding requests: ${txs.length}`);
  for (const t of txs) console.log(`  ${t.type} ${t.status} $${t.amount_usd} · ${t.student_name || ""} · by ${t.requested_by_name || t.initiating_mentor_name || "?"} · ${String(t.requested_at || "").slice(0, 10)}`);
  if (KEEP.size) console.log(`\nKept (--keep): ${[...KEEP].join(", ")}`);
  console.log(`\nWith them (${[...found.values()].reduce((n, m) => n + m.size, 0)} records in all):`);
  for (const [c, m] of found) console.log(`  ${c}: ${m.size}`);
  // Anything that would take money from a real person is shown, not hidden in a count.
  for (const c of (found.get("commission_credits") ?? new Map()).values()) {
    if (!userIds.has(String(c.recipient_id))) console.log(`  ! credit to a real person: ${c.recipient_name || c.recipient_id} — from a test deposit`);
  }
  const under = await col("users").find({ up_head_id: { $in: [...userIds] }, email: { $not: TEST_EMAIL } }, { projection: { full_name: 1 } }).toArray();
  if (under.length) console.log(`  ! real people reporting to a test user lose their Up Head: ${under.map((u: any) => u.full_name).join(", ")}`);
  const kept = await col("students").countDocuments({ first_assignee_id: { $in: [...userIds] }, _id: { $nin: students.map((s) => s._id) } });
  if (kept) console.log(`\nKept: ${kept} real student(s) a test CS received first — "First received by" stays as it is.`);
  if (!found.size) { console.log("\nNothing to delete."); return; }
  if (!apply) return;

  // The full copy goes to disk before anything is deleted, so an interrupted run can always be put back.
  const undoPath = join(homedir(), `test-users-delete-undo-${now.replace(/[:.]/g, "-")}.json`);
  const saved = { database: config.mongoDb, host, deleted_at: now, docs: Object.fromEntries([...found].map(([c, m]) => [c, [...m.values()]])) };
  await Bun.write(undoPath, EJSON.stringify(saved, undefined, 1, { relaxed: false }));
  for (const [c, m] of found) {
    const res = await col(c).deleteMany({ _id: { $in: [...m.values()].map((d) => d._id) } });
    console.log(`  deleted ${res.deletedCount} from ${c}`);
  }
  console.log(`\nDone. Undo file: ${undoPath}\n  bun src/scripts/delete-test-users.ts --undo=${undoPath}          (shows what it would put back)`);
}

async function undo(file: string) {
  const saved = EJSON.parse(await Bun.file(file).text(), { relaxed: false }) as { database: string; host: string; deleted_at: string; docs: Record<string, any[]> };
  if (saved.database !== config.mongoDb || saved.host !== host) throw new Error(`That undo file is for "${saved.database}" on ${saved.host}, not this database.`);
  console.log(`\nPutting back what was deleted on ${saved.deleted_at}:`);
  for (const [c, docs] of Object.entries(saved.docs)) {
    const there = new Set((await col(c).find({ _id: { $in: docs.map((d) => d._id) } }, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)));
    const missing = docs.filter((d) => !there.has(String(d._id)));
    console.log(`  ${c}: ${missing.length} to put back${there.size ? ` (${there.size} already there)` : ""}`);
    if (apply && missing.length) await col(c).insertMany(missing);
  }
}

await connectDb();
console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}`);
try {
  const undoFile = option("undo");
  if (undoFile) await undo(undoFile);
  else await remove();
} finally {
  await closeDb();
}
if (!apply) console.log("\nNothing was written. Run again with --apply to do it.");
