/**
 * Switch off the CS accounts emptied by the reshuffle (the user, 2026-11-06: haritha.kg, CS 1- MH, CS2 - EX).
 * The same as Personnel's On/Off switch (functions/setUserStatus.ts): status "inactive", so they can't sign in and an
 * open session stops at once; every payment, call, commission and history line keeps their name. Nothing is deleted.
 * Stops if any of them still has students (run reshuffle-cs.ts first). Writes a Log row per account.
 *
 *   cd backend
 *   bun src/scripts/switch-off-cs.ts                       shows what it would do
 *   bun src/scripts/switch-off-cs.ts --apply               does it; saves an undo file in your home folder
 *   bun src/scripts/switch-off-cs.ts --undo=<file> --apply switches them back on as they were
 *   --names="a,b,c"                                        other accounts (exact full names)
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const names = (option("names") ?? "haritha.kg,CS 1- MH,CS2 - EX").split(",").map((n) => n.trim()).filter(Boolean);
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const BY = "CS switch-off";

await connectDb();
try {
  console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}\n`);
  const undo = option("undo");
  if (undo) {
    const saved = await Bun.file(undo).json();
    for (const u of saved.users) {
      console.log(`  ${u.full_name} <${u.email}> → ${u.before.status ?? "active"}`);
      if (apply) await col("users").updateOne({ _id: toObjectId(u.id) as any }, { $set: { status: u.before.status ?? "active", updated_date: now, status_changed_by_name: BY, status_changed_at: now } });
    }
    console.log(apply ? "\nPut back." : "\nNothing was written. Add --apply to put it back.");
  } else {
    const users = (await col("users").find({ full_name: { $in: names } }, { projection: { password_hash: 0 } }).toArray()) as any[];
    const missing = names.filter((n) => !users.some((u) => u.full_name === n));
    if (missing.length) throw new Error(`Not found: ${missing.join(", ")}`);
    if (users.length !== names.length) throw new Error(`A name fits more than one account:\n  ${users.map((u) => `${u.full_name} <${u.email}>`).join("\n  ")}`);
    const log = { database: config.mongoDb, host, applied_at: now, users: [] as any[] };
    // Every account checked before anything is written.
    for (const u of users) {
      const left = await col("students").countDocuments({ primary_mentor_id: { $in: [u._id, String(u._id)] } } as any);
      if (left) throw new Error(`${u.full_name} still has ${left} student(s) — move them first (reshuffle-cs.ts); nothing was written`);
    }
    for (const u of users) {
      const off = u.status === "inactive";
      console.log(`  ${u.full_name} <${u.email}> (${u.app_role}): ${off ? "already off" : "→ off"} · students: 0`);
      if (off) continue;
      log.users.push({ id: String(u._id), full_name: u.full_name, email: u.email, before: { status: u.status ?? null } });
      if (!apply) continue;
      await col("users").updateOne({ _id: u._id }, { $set: { status: "inactive", updated_date: now, status_changed_by_name: BY, status_changed_at: now } });
      await col("logs").insertOne({
        timestamp: now, user_id: "", user_email: "", user_name: BY, user_role: "super_admin",
        action_type: "set_user_status", entity_type: "User", entity_id: String(u._id),
        details: JSON.stringify({ target_user: u.full_name, target_email: u.email, from: "active", to: "inactive" }),
        success: true, created_date: now,
      } as any);
    }
    if (apply && log.users.length) {
      const file = join(homedir(), `cs-switch-off-undo-${now.replace(/[:.]/g, "-")}.json`);
      await Bun.write(file, JSON.stringify(log, null, 2));
      console.log(`\nDone: ${log.users.length} account(s) switched off.\nUndo file: ${file}\n  bun src/scripts/switch-off-cs.ts --undo=${file} --apply`);
    } else console.log(apply ? "\nNothing to do." : "\nNothing was written. Run again with --apply to do it.");
  }
} finally {
  await closeDb();
}
