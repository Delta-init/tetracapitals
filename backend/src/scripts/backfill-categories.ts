import { writeFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EJSON } from "bson";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";
import { NEW_DATA_DAYS } from "../students/followups";

/**
 * Categories for what came before them (the user, 2026-10-25):
 *   - each follow-up without one gets one by the same rules as new ones — an onboarding call: Onboarding; opened
 *     within 2 days after the student was told about a class they attended: Class Completion; opened within
 *     NEW_DATA_DAYS of the student's arrival: New Data; else Course Pitch;
 *   - each student with a class completion is a Class Completion student (with their latest class).
 * Program Completion is set by the hourly LMS check by itself.
 *
 *   cd backend
 *   bun src/scripts/backfill-categories.ts                       dry run: what would be set
 *   bun src/scripts/backfill-categories.ts --apply               does it; an undo file in your home folder first
 *   bun src/scripts/backfill-categories.ts --undo=<file> --apply  takes back what it set
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env). Running it again changes nothing.
 */

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const DAY = 86_400_000;

await connectDb();
console.log(`${host}/${config.mongoDb}${apply ? "" : " — dry run"}`);
try {
  const undo = option("undo");
  if (undo) {
    const u = EJSON.parse(readFileSync(undo, "utf8")) as any;
    console.log(`Undo: ${u.followups.length} follow-ups, ${u.students.length} students`);
    if (apply) {
      for (const id of u.followups) await col("student_followups").updateOne({ _id: id }, { $unset: { category: "" } });
      for (const s of u.students) {
        await col("students").updateOne({ _id: s.id }, { $pull: { categories: "class_completion" } as any, ...(s.had_at ? {} : { $unset: { class_completion_at: "" } }) });
      }
      console.log("Taken back.");
    } else console.log("Dry run — add --apply to take it back.");
  } else {
    const followups = (await col("student_followups").find({ $or: [{ category: { $exists: false } }, { category: "" }] }, { projection: { student_id: 1, target_outcome: 1, created_date: 1 } }).toArray()) as any[];
    const studentIds = [...new Set(followups.map((f) => String(f.student_id)))];
    const { ObjectId } = await import("mongodb");
    const students = new Map(((await col("students").find({ _id: { $in: studentIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id)) } }, { projection: { created_date: 1 } }).toArray()) as any[]).map((s) => [String(s._id), s]));
    const completions = (await col("class_completions").find({}, { projection: { student_id: 1, notified_at: 1, ended_at: 1 } }).toArray()) as any[];
    const toldAt = new Map<string, number[]>();
    for (const c of completions) {
      const t = Date.parse(String(c.notified_at || c.ended_at || ""));
      if (!Number.isNaN(t)) toldAt.set(String(c.student_id), [...(toldAt.get(String(c.student_id)) ?? []), t]);
    }
    const counts: Record<string, number> = { onboarding: 0, class_completion: 0, new_data: 0, course_pitch: 0 };
    const sets: { id: any; category: string }[] = [];
    for (const f of followups) {
      const opened = Date.parse(String(f.created_date ?? ""));
      const arrived = Date.parse(String(students.get(String(f.student_id))?.created_date ?? ""));
      let category = "course_pitch";
      if (f.target_outcome === "Onboarding call") category = "onboarding";
      else if (!Number.isNaN(opened) && (toldAt.get(String(f.student_id)) ?? []).some((t) => opened >= t && opened - t <= 2 * DAY)) category = "class_completion";
      else if (!Number.isNaN(opened) && !Number.isNaN(arrived) && opened - arrived <= NEW_DATA_DAYS * DAY) category = "new_data";
      counts[category]++;
      sets.push({ id: f._id, category });
    }
    console.log(`Follow-ups without a category: ${followups.length} → ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);

    const latest = new Map<string, string>();
    for (const c of completions) {
      const sid = String(c.student_id), at = String(c.ended_at ?? "");
      if (!latest.has(sid) || at > latest.get(sid)!) latest.set(sid, at);
    }
    const need = (await col("students").find({ _id: { $in: [...latest.keys()].filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id)) }, categories: { $ne: "class_completion" } }, { projection: { class_completion_at: 1 } }).toArray()) as any[];
    console.log(`Students with a class completion, not yet marked Class Completion: ${need.length}`);

    if (!apply) console.log("Dry run — add --apply to set them.");
    else {
      const file = join(homedir(), `categories-undo-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      writeFileSync(file, EJSON.stringify({ followups: sets.map((x) => x.id), students: need.map((s) => ({ id: s._id, had_at: !!s.class_completion_at })) }, { relaxed: false }));
      console.log(`Undo file: ${file}`);
      for (let i = 0; i < sets.length; i += 1000) {
        await col("student_followups").bulkWrite(sets.slice(i, i + 1000).map((x) => ({ updateOne: { filter: { _id: x.id, $or: [{ category: { $exists: false } }, { category: "" }] }, update: { $set: { category: x.category } } } })), { ordered: false });
      }
      for (const s of need) {
        await col("students").updateOne({ _id: s._id }, { $addToSet: { categories: "class_completion" }, $max: { class_completion_at: latest.get(String(s._id)) } } as any);
      }
      console.log(`Done: ${sets.length} follow-ups, ${need.length} students.`);
    }
  }
} finally {
  await closeDb();
}
