/**
 * scripts/exclude-from-rotation.ts and the rotation's "No new students" switch (students/teams.ts), on made-up staff:
 * the dry run writes nothing; --apply takes the two CS out of the turns and shares out only the students the rotation
 * gave them from sales and they still hold, to the other CS of the same team; hand-added ones stay; running again
 * changes nothing; the undo puts it all back. Run through ./test-exclude-from-rotation.sh. Scratch database only.
 */
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "", dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) { console.error("Refusing to run"); process.exit(1); }
let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); } else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const client = await new MongoClient(uri).connect();
const db = client.db(dbName);
await db.dropDatabase();
let t = 0;
const u = (name: string, app_role: string, up?: ObjectId, extra: any = {}) => ({ _id: new ObjectId(), full_name: name, email: `${name.replace(/\W/g, "").toLowerCase()}@e2e.test`, app_role, status: "active", up_head_id: up ? String(up) : "", created_date: `2026-01-0${++t}`, ...extra });
const chief = u("Chief A", "chief_mentor", undefined, { team_name: "Team A" });
const cs1 = u("CS 1- MH", "cs", chief._id), csA = u("CS Anna", "cs", chief._id), csB = u("CS Ben", "cs", chief._id);
const chief2 = u("Chief B", "chief_mentor", undefined, { team_name: "Team B" });
const cs2 = u("CS2 - EX", "cs", chief2._id);   // alone in their team: their students stay
await db.collection("users").insertMany([chief, cs1, csA, csB, chief2, cs2] as any[]);
const st = (name: string, mentor: any, extra: any = {}) => ({ _id: new ObjectId(), full_name: name, student_code: name, primary_mentor_id: String(mentor._id), primary_mentor_name: mentor.full_name, first_assignee_id: String(mentor._id), team_id: String(chief._id), team_name: "Team A", assignment_status: "assigned", finance_invoice_id: `INV-${name}`, ...extra });
const sales = [1, 2, 3, 4].map((i) => st(`S${i}`, cs1));
const byHand = st("H1", cs1, { finance_invoice_id: "" });
const movedIn = st("M1", cs1, { first_assignee_id: String(csA._id) });
const lone = st("L1", cs2, { team_id: String(chief2._id), team_name: "Team B" });
await db.collection("students").insertMany([...sales, byHand, movedIn, lone] as any[]);
const mentorOf = async (s: any) => String(((await db.collection("students").findOne({ _id: s._id })) as any).primary_mentor_id);
const run = async (...args: string[]) => {
  const p = Bun.spawn(["bun", "--no-env-file", "src/scripts/exclude-from-rotation.ts", ...args], { stdout: "pipe", stderr: "pipe", env: process.env });
  const out = await new Response(p.stdout).text() + await new Response(p.stderr).text(); await p.exited; return out;
};

let out = await run();
check("dry run: the 4 from sales to share, 1 staying (no other CS in Team B)", /still theirs: 5 — 4 to share out in their team, 1 staying/.test(out), out);
const goes = (o: string) => o.split("\n").filter((l) => /^\| \d/.test(l)).map((l) => l.split("|").at(-2)!.trim());
check("…as a table, each with where they'd go, in turn", goes(out).join() === "CS Anna,CS Ben,CS Anna,CS Ben,stays — no other CS in the team", goes(out).join());
check("…writing nothing", (await mentorOf(sales[0])) === String(cs1._id) && !(await db.collection("users").findOne({ _id: cs1._id }) as any).no_auto_assign);

out = await run("--apply");
const after = await Promise.all(sales.map(mentorOf));
check("--apply: the 4 shared 2 and 2 between the team's other CS", after.filter((m) => m === String(csA._id)).length === 2 && after.filter((m) => m === String(csB._id)).length === 2, after.join());
check("…same team kept", (await db.collection("students").countDocuments({ _id: { $in: sales.map((s) => s._id) }, team_id: String(chief._id) })) === 4);
check("…added by hand, or moved to them by hand: stay", (await mentorOf(byHand)) === String(cs1._id) && (await mentorOf(movedIn)) === String(cs1._id));
check("…alone in a team: stays", (await mentorOf(lone)) === String(cs2._id));
check("…both switched to no new students", (await db.collection("users").countDocuments({ _id: { $in: [cs1._id, cs2._id] }, no_auto_assign: true })) === 2);
check("…each move in the student's history", (await db.collection("student_history").countDocuments({ via: "rotation_change" })) === 4);

const { connectDb, closeDb } = await import("../db");
const { loadTeams } = await import("../students/teams");
await connectDb();
const teams = (await loadTeams()).teams;
check("the rotation's turns leave them out", teams.find((x) => x.name === "Team A")!.cs.map((c) => c.name).join() === "CS Anna,CS Ben" && teams.find((x) => x.name === "Team B")!.cs.length === 0);
await closeDb();

check("running again changes nothing", /still theirs: 1 — 0 to share out/.test(await run("--apply")));
const undoFile = out.match(/Undo file: (\S+)/)?.[1] ?? "";
await run(`--undo=${undoFile}`, "--apply");
check("the undo puts students and switches back", (await Promise.all(sales.map(mentorOf))).every((m) => m === String(cs1._id)) && (await db.collection("users").countDocuments({ no_auto_assign: true })) === 0);
(await import("node:fs")).rmSync(undoFile, { force: true });

console.log("\n\x1b[1mThe last 3 days' new students (--days=3)\x1b[0m");
const ago = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
const recentHand = st("R1", cs1, { finance_invoice_id: "", created_date: ago(1), full_name: "Recent By Hand" });
const recentLms = st("R2", cs1, { finance_invoice_id: "", source: "delta_lms", created_date: ago(2), full_name: "Recent From LMS" });
const old = st("O1", cs1, { created_date: ago(10), full_name: "Old One" });
const otherCs = st("X1", csA, { created_date: ago(1), full_name: "Anna's Own" });
await db.collection("students").insertMany([recentHand, recentLms, old, otherCs] as any[]);
await db.collection("users").updateMany({}, { $unset: { no_auto_assign: "" } });
const csv = `${process.env.HOME}/moves.csv`;
out = await run("--days=3", `--report=${csv}`);
check("dry run: only the 2 who arrived in the last 3 days, whatever the source", /in the last 3 days .*: 2 — 2 to share out/.test(out) && /Recent By Hand/.test(out) && /Recent From LMS/.test(out) && !/Old One/.test(out) && !/Anna's Own/.test(out), out);
check("…with where they came from", /Added here/.test(out) && /Delta LMS/.test(out));
check("…saved as CSV", (await Bun.file(csv).text()).split("\n").filter(Boolean).length === 3);
out = await run("--days=3", "--apply");
check("--apply moves those 2, one to each other CS", [await mentorOf(recentHand), await mentorOf(recentLms)].sort().join() === [String(csA._id), String(csB._id)].sort().join());
check("…the older ones stay", (await mentorOf(old)) === String(cs1._id) && (await mentorOf(sales[0])) === String(cs1._id));
(await import("node:fs")).rmSync(out.match(/Undo file: (\S+)/)?.[1] ?? "", { force: true });

await db.dropDatabase(); await client.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
