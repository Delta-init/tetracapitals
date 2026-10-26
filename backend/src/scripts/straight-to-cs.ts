import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EJSON } from "bson";
import { ObjectId } from "mongodb";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";
import { loadTeams } from "../students/teams";

/**
 * A student shown as having come straight to the CS they're with now (the user, 2026-10-26: Abinson Abraham,
 * STU-5178, "remove the old history, show he came straight to athira").
 *
 * Their hand-overs in their history (assigned / mentor_changed — what the Student moves list and the student's path
 * are made of) are removed, all but how they first arrived (arrived / created, and the assigned beside it), which now
 * names their current CS as who got them; their "first received by" is that CS too. Nothing else in their history —
 * notes, calls, follow-ups, payments — is touched.
 *
 *   cd backend
 *   bun src/scripts/straight-to-cs.ts --code=STU-5178                  dry run: what would change
 *   bun src/scripts/straight-to-cs.ts --code=STU-5178 --apply          does it; an undo file in your home folder first
 *   bun src/scripts/straight-to-cs.ts --undo=<undo file> --apply       puts it back as it was
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env).
 */

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const MOVES = ["assigned", "mentor_changed"];
const ARRIVALS = ["arrived", "created"];
const FIRST = ["first_assignee_id", "first_assignee_name", "first_assignee_role", "first_assigned_at", "assigned_at"];

await connectDb();
console.log(`${host}/${config.mongoDb}${apply ? "" : " — dry run"}`);
try {
  const undo = option("undo");
  if (undo) {
    const u = EJSON.parse(readFileSync(undo, "utf8")) as any;
    console.log(`Undo for ${u.student.full_name} (${u.student.student_code}): ${u.removed.length} entries back, ${u.changed.length} put back as they were`);
    if (apply) {
      if (u.removed.length) await col("student_history").insertMany(u.removed);
      for (const d of u.changed) await col("student_history").replaceOne({ _id: d._id }, d);
      for (const d of u.added ?? []) await col("student_history").deleteOne({ _id: d });
      const set: any = {}, unset: any = {};
      for (const k of FIRST) (u.student[k] === undefined ? (unset[k] = "") : (set[k] = u.student[k]));
      await col("students").updateOne({ _id: u.student._id }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });
      console.log("Put back.");
    } else console.log("Dry run — add --apply to put it back.");
  } else {
    const code = option("code");
    if (!code) { console.log("Give --code=STU-…"); process.exit(1); }
    const student: any = await col("students").findOne({ student_code: code });
    if (!student) { console.log(`No student ${code}`); process.exit(1); }
    const csId = String(student.primary_mentor_id ?? "");
    const teams = await loadTeams();
    const cs: any = csId ? teams.userById.get(csId) : null;
    if (!cs) { console.log(`${student.full_name} has no CS now — nothing to point at.`); process.exit(1); }
    const team = teams.teamOf(csId);
    const to = { id: csId, name: String(cs.full_name ?? ""), team: team?.name ?? null };
    const entries = (await col("student_history").find({ student_id: String(student._id), type: { $in: [...MOVES, ...ARRIVALS] } }).sort({ at: 1 }).toArray()) as any[];
    const arrival = entries.find((e) => ARRIVALS.includes(e.type));
    const firstAssigned = arrival ? entries.find((e) => e.type === "assigned" && e.at === arrival.at) : entries.find((e) => e.type === "assigned");
    const remove = entries.filter((e) => MOVES.includes(e.type) && e !== firstAssigned);
    console.log(`${student.full_name} (${code}) — with ${to.name}${to.team ? ` · ${to.team}` : ""} now`);
    console.log(`  how they arrived: ${arrival ? `${arrival.type} ${String(arrival.at).slice(0, 16)}` : "no arrival entry"}`);
    console.log(`  first hand-over: ${firstAssigned ? `${String(firstAssigned.at).slice(0, 16)} → ${firstAssigned.to?.name ?? "?"} — becomes → ${to.name}` : "none — one is added, to " + to.name}`);
    for (const e of remove) console.log(`  remove: ${String(e.at).slice(0, 16)} ${e.type} ${e.from?.name ?? "—"} → ${e.to?.name ?? "—"}  ${String(e.text ?? "").slice(0, 70)}`);
    console.log(`  first received by: ${student.first_assignee_name ?? "—"} → ${to.name}`);
    if (!apply) console.log("Dry run — add --apply to do it.");
    else {
      const file = join(homedir(), `straight-to-cs-undo-${code}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      const keep: any = { _id: student._id, full_name: student.full_name, student_code: code };
      for (const k of FIRST) keep[k] = student[k];
      const added: any[] = [];
      writeFileSync(file, EJSON.stringify({ student: keep, removed: remove, changed: firstAssigned ? [firstAssigned] : [], added }, { relaxed: false }));
      console.log(`Undo file: ${file}`);
      if (remove.length) await col("student_history").deleteMany({ _id: { $in: remove.map((e) => e._id) } });
      const at = firstAssigned?.at ?? arrival?.at ?? student.first_assigned_at ?? student.created_date ?? new Date().toISOString();
      if (firstAssigned) {
        await col("student_history").updateOne({ _id: firstAssigned._id }, { $set: { to, from: null, text: `Given to ${to.name}${to.team ? ` (${to.team})` : ""}` } });
      } else {
        const id = new ObjectId();
        added.push(id);
        await col("student_history").insertOne({ _id: id, student_id: String(student._id), at, type: "assigned", by_id: null, by_name: "System", from: null, to, text: `Given to ${to.name}${to.team ? ` (${to.team})` : ""}` } as any);
        writeFileSync(file, EJSON.stringify({ student: keep, removed: remove, changed: [], added }, { relaxed: false }));
      }
      await col("students").updateOne({ _id: student._id }, { $set: { first_assignee_id: csId, first_assignee_name: to.name, first_assignee_role: String(cs.app_role ?? ""), first_assigned_at: at } });
      console.log(`Done: ${remove.length} hand-over(s) removed; ${student.full_name} came straight to ${to.name}.`);
    }
  }
} finally {
  await closeDb();
}
