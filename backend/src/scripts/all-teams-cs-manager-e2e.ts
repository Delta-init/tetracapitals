/**
 * A CS Manager over every team, end to end on made-up staff shaped like live:
 *   - the script's dry run changes nothing; --apply makes the Super Admin a CS Manager over every team; again: nothing;
 *   - they see every CS's students (the Students page's Team tab) and follow-ups — and each chief still sees exactly
 *     their own team, and the other CS Manager theirs;
 *   - they are every CS's leader for the alerts (leadersOf), beside the CS's chief or CS Manager;
 *   - not on the round of new students (a team's CS);
 *   - the undo puts the Super Admin back.
 * Run through ./test-all-teams-cs-manager.sh. Refuses anything but a scratch database on 127.0.0.1.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { MongoClient, ObjectId } from "mongodb";
import { signJwt } from "../auth/jwt";

const uri = process.env.MONGO_URI ?? "";
const dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) {
  console.error(`Refusing to run: needs a scratch e2e database on 127.0.0.1, got ${uri} / ${dbName}`);
  process.exit(1);
}
const API = `http://127.0.0.1:${process.env.E2E_API_PORT}`;
const WORK = process.env.E2E_WORK ?? "";
let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);

const client = await new MongoClient(uri).connect();
const db = client.db(dbName);
const now = new Date().toISOString();
const u = (email: string, full_name: string, app_role: string, up?: any, extra: any = {}) => ({ _id: new ObjectId(), email, full_name, app_role, status: "active", created_date: now, ...(up ? { up_head_id: String(up._id), up_head_name: up.full_name } : {}), ...extra });
const raghav = u("raghav@e2e.test", "Raghav", "chief_mentor", null, { team_name: "Team Wall Street" });
const midlaj = u("midlaj@e2e.test", "Midlaj", "chief_mentor", null, { team_name: "Team Gladiators" });
const ambili = u("ambili@e2e.test", "ambili B", "cs_manager");
const cs1 = u("cs1@e2e.test", "Anuja", "cs", raghav), cs2 = u("cs2@e2e.test", "Ajna", "cs", midlaj), cs3 = u("cs3@e2e.test", "Teena", "cs", ambili);
const doney = u("doney@deltainstitutions.com", "doney", "super_admin");
await db.collection("users").insertMany([raghav, midlaj, ambili, cs1, cs2, cs3, doney] as any[]);
// As on live: a CS sees their own students, a CS Manager their team's.
await db.collection("commission_roles").insertMany([
  { role_key: "cs", name: "CS", data_scope: "own", page_permissions: ["Students"], created_date: now },
  { role_key: "cs_manager", name: "CS Manager", data_scope: "downline", page_permissions: ["Students"], created_date: now },
] as any[]);
const st = (name: string, cs: any) => ({ _id: new ObjectId(), full_name: name, primary_mentor_id: String(cs._id), primary_mentor_name: cs.full_name, student_code: `STU-${name}`, status: "active", created_date: now });
const s1 = st("One", cs1), s2 = st("Two", cs2), s3 = st("Three", cs3);
await db.collection("students").insertMany([s1, s2, s3] as any[]);
await db.collection("student_followups").insertMany([s1, s2, s3].map((s) => ({ student_id: String(s._id), target_outcome: "DSLP", stage: "Contacted", next_followup_date: "2099-01-01", last_contact_date: "", followup_count: 0, created_date: now })) as any[]);

const script = async (...args: string[]) => {
  const p = Bun.spawn(["bun", "--no-env-file", "src/scripts/set-all-teams-cs-manager.ts", "--email=doney@deltainstitutions.com", ...args], { env: { ...process.env, HOME: WORK }, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text() + await new Response(p.stderr).text();
  await p.exited;
  return out;
};
const call = async (who: any, fn: string, body: unknown) => {
  const token = await signJwt({ sub: String(who._id), email: who.email, app_role: who.app_role, full_name: who.full_name });
  const r = await fetch(`${API}/api/functions/${fn}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) as any };
};
const names = (rows: any[]) => rows.map((r) => r.full_name ?? r.student_name).sort().join(",");

step("The script");
let out = await script();
check("dry run says what it will do", /Will be: CS Manager over every team — 3 active CS/.test(out) && /stop being a Super Admin/.test(out), out);
check("…and changes nothing", (await db.collection("users").findOne({ _id: doney._id }))?.app_role === "super_admin");
out = await script("--apply");
const d: any = await db.collection("users").findOne({ _id: doney._id });
check("--apply: CS Manager over every team", d.app_role === "cs_manager" && d.all_teams_cs_manager === true, out);
check("…nobody else's Up Head changed", (await db.collection("users").countDocuments({ up_head_id: String(doney._id) })) === 0);
check("again: nothing to do", /Already CS Manager over every team/.test(await script("--apply")));
const doneyNow = { ...doney, app_role: "cs_manager" };

step("Who sees what");
let r = await call(doneyNow, "listStudents", { tab: "team" });
check("Doney: every CS's students on the Team tab", r.status === 200 && names(r.body.rows) === "One,Three,Two", JSON.stringify(r.body).slice(0, 200));
r = await call(doneyNow, "getFollowups", {});
check("…and every CS's follow-ups", r.status === 200 && (r.body.followups ?? []).length === 3, JSON.stringify(r.body).slice(0, 200));
r = await call(raghav, "listStudents", { tab: "team" });
check("a chief still sees exactly their own team", r.status === 200 && names(r.body.rows) === "One", JSON.stringify(r.body).slice(0, 200));
r = await call(midlaj, "getFollowups", {});
check("…and its follow-ups only", (r.body.followups ?? []).length === 1);
r = await call(ambili, "listStudents", { tab: "team" });
check("the other CS Manager: still only theirs", r.status === 200 && names(r.body.rows) === "Three", JSON.stringify(r.body).slice(0, 200));
r = await call(cs1, "listStudents", { tab: "my" });
check("a CS: still their own", names(r.body.rows) === "One");

step("Who is told");
const { connectDb, closeDb } = await import("../db");
const { loadTeams } = await import("../students/teams");
const { leadersOf } = await import("../students/followupReminders");
await connectDb();
const teams = await loadTeams();
const leaders = (cs: any) => leadersOf(String(cs._id), teams).sort();
check("a chief's CS: the chief and Doney", JSON.stringify(leaders(cs1)) === JSON.stringify([String(raghav._id), String(doney._id)].sort()), JSON.stringify(leaders(cs1)));
check("the other chief's CS: that chief and Doney", leaders(cs2).includes(String(midlaj._id)) && leaders(cs2).includes(String(doney._id)) && leaders(cs2).length === 2);
check("ambili's CS: ambili and Doney", leaders(cs3).includes(String(ambili._id)) && leaders(cs3).includes(String(doney._id)));
check("Doney is no team's CS — never handed new students", teams.teams.every((t) => !t.cs.some((m) => m.id === String(doney._id))));
await closeDb();

step("Undo");
const undoFile = readdirSync(WORK).find((f) => f.startsWith("all-teams-cs-manager-undo-"))!;
const p = Bun.spawn(["bun", "--no-env-file", "src/scripts/set-all-teams-cs-manager.ts", `--undo=${join(WORK, undoFile)}`, "--apply"], { env: { ...process.env, HOME: WORK }, stdout: "pipe", stderr: "pipe" });
await p.exited;
const back: any = await db.collection("users").findOne({ _id: doney._id });
check("the undo puts the Super Admin back", back.app_role === "super_admin" && back.all_teams_cs_manager === undefined, JSON.stringify(back));

await client.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
