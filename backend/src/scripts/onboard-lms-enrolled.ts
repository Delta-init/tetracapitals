import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ObjectId } from "mongodb";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";
import { enrolledNotOnboarded, onboardEnrolledStudents } from "../students/onboardByLms";

/**
 * The students on the Not onboarded list who are already on an LMS course, onboarded (the user, 2026-10-13) — as the
 * hourly LMS check now does by itself (students/onboardByLms.ts). Nothing is sent to them. Test records left alone.
 *
 *   cd backend
 *   bun src/scripts/onboard-lms-enrolled.ts                     shows who
 *   bun src/scripts/onboard-lms-enrolled.ts --apply             onboards them; an undo file first
 *   bun src/scripts/onboard-lms-enrolled.ts --undo=<file> [--apply]   back to not onboarded
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env).
 */

const apply = process.argv.includes("--apply");
const undo = process.argv.find((a) => a.startsWith("--undo="))?.slice(7);
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];

await connectDb();
console.log(`Database: ${host} / ${config.mongoDb} — ${apply ? "WRITING" : "dry run, nothing is written"}\n`);

if (undo) {
  const ids: string[] = JSON.parse(readFileSync(undo, "utf8")).student_ids;
  console.log(`${ids.length} student(s) back to not onboarded`);
  if (apply) {
    const r = await col("students").updateMany({ _id: { $in: ids.map((i) => new ObjectId(i)) }, onboarded_via: "lms_courses" },
      { $set: { onboarded: false }, $unset: { onboarded_at: "", onboarded_by_id: "", onboarded_by_name: "", onboarded_via: "" } });
    console.log(`put back ${r.modifiedCount}`);
  }
  await closeDb();
  process.exit(0);
}

const list = await enrolledNotOnboarded();
const byCs = new Map<string, number>();
for (const s of list) {
  byCs.set(s.primary_mentor_name || "no CS", (byCs.get(s.primary_mentor_name || "no CS") ?? 0) + 1);
  console.log(`  ${String(s.student_code).padEnd(9)} ${String(s.full_name ?? "").trim().slice(0, 34).padEnd(34)} ${String(s.primary_mentor_name ?? "").padEnd(20)} ${String(s.created_date).slice(0, 10)}  ${[...new Set((s.lms_courses ?? []).map((c: any) => c.title))].join("; ")}`);
}
console.log(`\n${list.length} to onboard:`);
for (const [cs, n] of [...byCs].sort((a, b) => b[1] - a[1])) console.log(`  ${cs.padEnd(22)} ${n}`);

if (apply && list.length) {
  const file = join(homedir(), `onboard-lms-enrolled-undo-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ student_ids: list.map((s) => String(s._id)) }, null, 1));
  const n = await onboardEnrolledStudents(list);
  console.log(`\nOnboarded ${n}. Undo: --undo=${file}`);
} else if (list.length) console.log("\nNothing was written. Run again with --apply to onboard them.");
await closeDb();
