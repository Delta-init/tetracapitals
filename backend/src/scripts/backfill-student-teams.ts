/**
 * Stores the team on students who have a mentor but no team yet — the ones
 * from before the team was kept on the student.
 *
 *   cd backend
 *   bun src/scripts/backfill-student-teams.ts            shows what it would do (writes nothing)
 *   bun src/scripts/backfill-student-teams.ts --apply    stores it
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's
 * .env) and the same teams as the Teams page (students/teams.ts): a student's
 * team is their primary mentor's. A student whose mentor is on no team is left
 * without one. Students that already have a team are not touched, so it is
 * safe to run again.
 */
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { loadTeams } from "../students/teams";

const apply = process.argv.includes("--apply");
await connectDb();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}\n`);

const { teamOf } = await loadTeams();
const students = col("students");
const cursor = students.find(
  { primary_mentor_id: { $nin: [null, ""] }, $or: [{ team_id: { $exists: false } }, { team_id: null }, { team_id: "" }] },
  { projection: { primary_mentor_id: 1 } },
);

const perTeam = new Map<string, number>();
let onNoTeam = 0;
let batch: any[] = [];
let stored = 0;
for await (const s of cursor as any) {
  const team = teamOf(s.primary_mentor_id);
  if (!team) { onNoTeam++; continue; }
  perTeam.set(team.name, (perTeam.get(team.name) ?? 0) + 1);
  batch.push({ updateOne: { filter: { _id: s._id }, update: { $set: { team_id: team.id, team_name: team.name } } } });
  if (apply && batch.length >= 500) { stored += (await students.bulkWrite(batch)).modifiedCount; batch = []; }
}
if (apply && batch.length) stored += (await students.bulkWrite(batch)).modifiedCount;

const total = [...perTeam.values()].reduce((a, b) => a + b, 0);
for (const [name, n] of [...perTeam].sort((a, b) => b[1] - a[1])) console.log(`  ${name}: ${n}`);
console.log(`\n${apply ? `Stored the team on ${stored}` : `Would store the team on ${total}`} student(s); ${onNoTeam} have a mentor who is on no team and are left as they are.`);
if (!apply) console.log("Run again with --apply to store it.");
await closeDb();
