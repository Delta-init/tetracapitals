/**
 * Gives every portal user a new password and writes them all to one Excel file, for an admin to hand out.
 * Skipped: the test accounts (@deltatest.dev) and KEEP below, whose passwords stay as they are. Switched-off
 * accounts get one too and are marked so in the file.
 *
 * Passwords: 10 characters, letters and digits without look-alikes (no 0/O, 1/l/I), at least one of each kind —
 * stored as bcrypt hashes exactly as the Personnel "reset password" stores them, with the same audit line, which
 * never holds the password.
 *
 * The Excel file is written before anything changes, so nobody can end up with a password nobody has. It is the
 * only place the passwords exist: share them, then delete it. They are never printed.
 *
 *   cd backend
 *   bun src/scripts/reset-passwords.ts                           shows who would get a new password
 *   bun src/scripts/reset-passwords.ts --apply                   does it: Excel in Downloads, undo file in your home folder
 *   bun src/scripts/reset-passwords.ts --undo=<file> [--apply]   puts the old passwords back (for whoever still has the new one)
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env). Every --apply makes new
 * passwords again — run it once.
 */
import bcrypt from "bcryptjs";
import { chmodSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";
import { loadTeams } from "../students/teams";
import { roleLabel } from "../students/history";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const MISSING = { $missing: true };

const TEST_EMAIL = /@deltatest\.dev$/i;
/** Their passwords stay as they are (the user's choice). */
const KEEP = new Set(["doney@deltainstitutions.com", "shafeel112233@gmail.com"]);
const ACTOR = "Password reset script";
const RESET_FIELDS = ["password_hash", "password_reset_at", "password_reset_by_id", "password_reset_by_name", "updated_date"];

const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ", LOWER = "abcdefghjkmnpqrstuvwxyz", DIGIT = "23456789";
const CHARS = UPPER + LOWER + DIGIT;
/** One character, every one equally likely (bytes past the last whole round are thrown back). */
function pick(chars: string): string {
  const limit = 256 - (256 % chars.length), buf = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return chars[buf[0]! % chars.length]!;
  }
}
function newPassword(): string {
  for (;;) {
    const p = Array.from({ length: 10 }, () => pick(CHARS)).join("");
    if (/[A-Z]/.test(p) && /[a-z]/.test(p) && /[2-9]/.test(p)) return p;
  }
}

interface Row { id: string; name: string; email: string; role: string; team: string; status: string; password: string }

/** The logins sheet, through openpyxl — the backend has no Excel library of its own. Only the owner can open it. */
async function writeExcel(path: string, rows: Row[]) {
  const py = `
import json, sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
rows = json.load(sys.stdin)
wb = Workbook(); ws = wb.active; ws.title = "Logins"
ws.append(["Name", "Email (login)", "Role", "Team", "Status", "New password"])
for r in rows: ws.append([r["name"], r["email"], r["role"], r["team"], r["status"], r["password"]])
for c in ws[1]: c.font = Font(bold=True, color="FFFFFF"); c.fill = PatternFill("solid", fgColor="1E3A5F")
for col, w in zip("ABCDEF", [28, 38, 18, 22, 14, 18]): ws.column_dimensions[col].width = w
for c in ws["F"][1:]: c.font = Font(name="Menlo")
ws.freeze_panes = "A2"; ws.auto_filter.ref = ws.dimensions
wb.save(sys.argv[1])
`;
  const proc = Bun.spawn(["python3", "-c", py, path], { stdin: "pipe", stdout: "inherit", stderr: "inherit" });
  proc.stdin.write(JSON.stringify(rows));
  proc.stdin.end();
  if ((await proc.exited) !== 0 || !existsSync(path)) throw new Error("Could not write the Excel file — nothing was changed");
  chmodSync(path, 0o600);
}

async function reset() {
  const users = (await col("users")
    .find({}, { projection: { full_name: 1, email: 1, app_role: 1, status: 1, password_hash: 1, password_reset_at: 1, password_reset_by_id: 1, password_reset_by_name: 1, updated_date: 1 } })
    .sort({ full_name: 1 })
    .toArray()) as any[];
  const targets = users.filter((u) => !TEST_EMAIL.test(String(u.email ?? "")) && !KEEP.has(String(u.email ?? "").toLowerCase()));
  const kept = users.filter((u) => KEEP.has(String(u.email ?? "").toLowerCase()));
  const tests = users.filter((u) => TEST_EMAIL.test(String(u.email ?? ""))).length;

  console.log(`\nNew password for ${targets.length} user(s):`);
  for (const u of targets) console.log(`  ${u.full_name || "(no name)"} <${u.email}> · ${roleLabel(u.app_role) || "no role"}${u.status === "inactive" ? " · switched off" : ""}`);
  console.log(`\nLeft as they are: ${kept.map((u) => `${u.full_name} <${u.email}>`).join(", ") || "nobody"}${tests ? `; ${tests} test account(s)` : ""}`);
  const again = targets.filter((u) => u.password_reset_by_name === ACTOR && Date.parse(u.password_reset_at) > Date.now() - 86_400_000);
  if (again.length) console.log(`\n! ${again.length} of them got a password from this script in the last day — --apply gives them another one.`);
  if (!targets.length || !apply) return;

  // Excel first: if it cannot be written, nothing changes.
  const check = Bun.spawnSync(["python3", "-c", "import openpyxl"]);
  if (check.exitCode !== 0) throw new Error("python3 with openpyxl is needed to write the Excel file — nothing was changed");
  const teams = await loadTeams();
  const rows: Row[] = targets.map((u) => ({
    id: String(u._id), name: String(u.full_name || ""), email: String(u.email), role: roleLabel(u.app_role),
    team: teams.teamOf(u._id)?.name ?? "", status: u.status === "inactive" ? "Switched off" : "Active", password: newPassword(),
  }));
  const stamp = now.replace(/[:.]/g, "-");
  let excel = join(homedir(), "Downloads", `Portal logins ${now.slice(0, 10)}.xlsx`);
  if (existsSync(excel)) excel = join(homedir(), "Downloads", `Portal logins ${stamp}.xlsx`);
  await writeExcel(excel, rows);

  const hashes = new Map<string, string>();
  for (const r of rows) hashes.set(r.id, await bcrypt.hash(r.password, 10));
  // The old hashes, so --undo can put them back; never a password.
  const undoPath = join(homedir(), `password-reset-undo-${stamp}.json`);
  await Bun.write(undoPath, JSON.stringify({
    database: config.mongoDb, host, reset_at: now,
    users: targets.map((u) => ({
      id: String(u._id), email: u.email,
      before: Object.fromEntries(RESET_FIELDS.map((k) => [k, k in u ? u[k] : MISSING])),
      after_hash: hashes.get(String(u._id)),
    })),
  }, null, 1));
  chmodSync(undoPath, 0o600);

  for (const r of rows) {
    await col("users").updateOne(
      { _id: toObjectId(r.id) as any },
      { $set: { password_hash: hashes.get(r.id), updated_date: now, password_reset_by_id: "", password_reset_by_name: ACTOR, password_reset_at: now } },
    );
  }
  await col("logs").insertMany(rows.map((r) => ({
    timestamp: now, user_id: "", user_email: "", user_name: ACTOR, user_role: "",
    action_type: "reset_user_password", entity_type: "User", entity_id: r.id,
    // Never the password itself.
    details: JSON.stringify({ target_user: r.name, target_email: r.email, via: "reset-passwords script" }),
    success: true, created_date: now,
  })) as any[]);

  console.log(`\nDone: ${rows.length} new passwords.`);
  console.log(`Excel: ${excel}\n  The only copy of the passwords — share them, then delete it.`);
  console.log(`Undo file: ${undoPath}\n  bun src/scripts/reset-passwords.ts --undo=${undoPath}          (shows what it would put back)`);
}

async function undo(file: string) {
  const saved = JSON.parse(await Bun.file(file).text()) as { database: string; host: string; reset_at: string; users: { id: string; email: string; before: Record<string, any>; after_hash: string }[] };
  if (saved.database !== config.mongoDb || saved.host !== host) throw new Error(`That undo file is for "${saved.database}" on ${saved.host}, not this database.`);
  let back = 0;
  const left: string[] = [];
  for (const u of saved.users) {
    const doc: any = await col("users").findOne({ _id: toObjectId(u.id) as any }, { projection: { password_hash: 1 } });
    if (!doc) continue;
    // Somebody whose password was set again since (by an admin, or a later run) keeps that one.
    if (doc.password_hash !== u.after_hash) { left.push(u.email); continue; }
    const $set: Record<string, unknown> = {}, $unset: Record<string, ""> = {};
    for (const [k, v] of Object.entries(u.before)) { if (v && typeof v === "object" && v.$missing) $unset[k] = ""; else $set[k] = v; }
    back++;
    if (apply) await col("users").updateOne({ _id: doc._id }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) });
  }
  console.log(`\nUndo of the reset on ${saved.reset_at}: ${back} old password(s) put back${left.length ? `; ${left.length} changed since, left as now: ${left.join(", ")}` : ""}`);
}

await connectDb();
console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}`);
try {
  const undoFile = option("undo");
  if (undoFile) await undo(undoFile);
  else await reset();
} finally {
  await closeDb();
}
if (!apply) console.log("\nNothing was written. Run again with --apply to do it.");
