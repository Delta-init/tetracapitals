import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EJSON } from "bson";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";

/**
 * Meeting requests removed (the user, 2026-11-09: "delete all meeting requests raised today"). Every request raised
 * on that Dubai day goes — whatever it became. An approved one's LMS meeting is NOT touched here: delete it silently
 * with the LMS's script (lms backend/src/scripts/delete-mentor-meeting.ts --id <id>), whose ids this prints.
 *
 *   cd backend
 *   bun src/scripts/delete-meeting-requests.ts                          shows them (today, Dubai)
 *   bun src/scripts/delete-meeting-requests.ts --apply                  deletes them; an undo file in your home folder first
 *   bun src/scripts/delete-meeting-requests.ts --undo=<file> --apply    puts them back
 *   --day=2026-11-09 for another day
 */

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];

await connectDb();
console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}\n`);
try {
  const undo = option("undo");
  if (undo) {
    const saved = EJSON.parse(readFileSync(undo, "utf8")) as any;
    console.log(`${saved.requests.length} request(s) ${apply ? "put back." : "would be put back — add --apply"}`);
    if (apply) for (const r of saved.requests) await col("meeting_requests").updateOne({ _id: r._id }, { $setOnInsert: r }, { upsert: true });
  } else {
    const day = option("day") ?? new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("--day is YYYY-MM-DD");
    const since = new Date(new Date(`${day}T00:00:00+04:00`).getTime()).toISOString();
    const until = new Date(new Date(`${day}T00:00:00+04:00`).getTime() + 864e5).toISOString();
    const list = (await col("meeting_requests").find({ requested_at: { $gte: since, $lt: until } }).sort({ requested_at: 1 }).toArray()) as any[];
    console.log(`Raised on ${day} (Dubai): ${list.length}`);
    for (const r of list) console.log(`  ${r.number ?? String(r._id).slice(-6)} · ${r.status} · ${r.student_name} · ${r.mentor_name}${r.lms_meeting_id ? ` · LMS meeting ${r.lms_meeting_id}` : ""}`);
    const lms = list.map((r) => r.lms_meeting_id).filter(Boolean);
    if (lms.length) console.log(`\nIn the LMS — delete silently there:\n  bun src/scripts/delete-mentor-meeting.ts ${lms.map((id) => `--id ${id}`).join(" ")} --commit`);
    if (list.length && apply) {
      const file = join(homedir(), `delete-meeting-requests-undo-${day}-${Date.now()}.json`);
      writeFileSync(file, EJSON.stringify({ database: config.mongoDb, host, day, requests: list }));
      const done = await col("meeting_requests").deleteMany({ _id: { $in: list.map((r) => r._id) } });
      console.log(`\n${done.deletedCount} deleted.\nUndo file: ${file}\n  bun src/scripts/delete-meeting-requests.ts --undo=${file} --apply`);
    } else if (list.length) console.log("\nNothing was written. Run again with --apply to do it.");
  }
} finally {
  await closeDb();
}
