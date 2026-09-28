/**
 * Who gets a new student, the team stored on them, and their history — end to
 * end, against a real API process.
 *
 *   - two rounds: teams in turn, and within each team its CS people in turn —
 *     team 1 CS1, team 2 CS1, team 3 CS1, team 4 CS1, team 1 CS2, …; a team
 *     with no CS person, or only switched-off ones, sits out and rejoins in its
 *     place once it has one;
 *   - the team and who received them first are stored on the student, and the
 *     server keeps them right: the team follows the mentor, the first receiver
 *     never changes, and neither can be written by a client;
 *   - every change to a student is in their history, whichever way it was made;
 *     older students' history comes from their record and their requests;
 *   - only somebody who may see the student may read it;
 *   - the backfill script stores the team on students from before.
 *
 * Run through ./test-student-history.sh (throwaway mongod, the API — no .env).
 * Refuses anything but a scratch database on 127.0.0.1.
 */
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "";
const dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) {
  console.error(`Refusing to run: needs a scratch e2e database on 127.0.0.1, got ${uri} / ${dbName}`);
  process.exit(1);
}
const API = `http://127.0.0.1:${process.env.E2E_API_PORT}`;
const LMS_SECRET = process.env.LMS_S2S_SECRET ?? "";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);

type Res = { status: number; body: any };
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const r = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
let n = 0;
const fromLms = () => {
  n++;
  return call("POST", "/api/v1/integrations/lms/students", {
    lmsUserId: new ObjectId().toString(), email: `learner${n}@e2e-history.test`, name: `Learner ${n}`,
    course: "Delta Wave Theory Trading Programme", academy: "Delta Dubai",
  }, { "x-lms-secret": LMS_SECRET });
};

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
if (!/127\.0\.0\.1/.test(uri)) process.exit(1);
for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({});

step("Setting up");
const hash = await bcrypt.hash("Password123!", 10);
const person = (full_name: string, app_role: string, created_date: string, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), email: `${full_name.toLowerCase().replace(/\s+/g, ".")}@e2e-history.test`,
  full_name, app_role, password_hash: hash, created_date, updated_date: created_date, ...extra,
});
const under = (lead: any, name: string, role: string, created_date: string, extra: Record<string, unknown> = {}) =>
  person(name, role, created_date, { up_head_id: String(lead._id), up_head_name: lead.full_name, ...extra });
const A = person("Alpha Lead", "chief_mentor", "2026-01-01T00:00:00.000Z", { team_name: "Alpha" });
const B = person("Bravo Lead", "chief_mentor", "2026-02-01T00:00:00.000Z", { team_name: "Bravo" });
const C = person("Charlie Lead", "chief_mentor", "2026-03-01T00:00:00.000Z", { team_name: "Charlie" });
const D = person("Delta Lead", "chief_mentor", "2026-04-01T00:00:00.000Z", { team_name: "Delta" });
const E = person("Echo Lead", "chief_mentor", "2026-05-01T00:00:00.000Z", { team_name: "Echo" });
const F = person("Foxtrot Lead", "chief_mentor", "2026-06-01T00:00:00.000Z", { team_name: "Foxtrot" });
const a1 = under(A, "Asha", "cs", "2026-01-02T00:00:00.000Z"), a2 = under(A, "Arun", "cs", "2026-01-03T00:00:00.000Z");
const aj = under(A, "Ajay", "junior_mentor", "2026-01-04T00:00:00.000Z");
const b1 = under(B, "Bina", "cs", "2026-02-02T00:00:00.000Z");
const c1 = under(C, "Chitra", "cs", "2026-03-02T00:00:00.000Z"), c2 = under(C, "Chetan", "cs", "2026-03-03T00:00:00.000Z");
const d1 = under(D, "Dev", "cs", "2026-04-02T00:00:00.000Z");
const ej = under(E, "Esha", "junior_mentor", "2026-05-02T00:00:00.000Z");              // Echo: nobody in CS
const f1 = under(F, "Farid", "cs", "2026-06-02T00:00:00.000Z", { status: "inactive" }); // Foxtrot: its only CS switched off
const admin = person("Ad Min", "super_admin", "2025-11-01T00:00:00.000Z");
await db.collection("users").insertMany([A, B, C, D, E, F, a1, a2, aj, b1, c1, c2, d1, ej, f1, admin] as any[]);
await db.collection("commission_roles").insertOne({ name: "CS", role_key: "cs", data_scope: "own", active: true, page_permissions: ["Students"] });
check("six teams: four with CS people, one with none, one whose only CS person is switched off", true);

const login = async (u: any) => (await call("POST", "/api/auth/login", { email: u.email, password: "Password123!" })).body?.token as string;
const adminToken = await login(admin);
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const history = (id: string, token = adminToken) => call("POST", "/api/functions/getStudentHistory", { studentId: id }, as(token));
const student = async (id: string) => db.collection("students").findOne({ _id: new ObjectId(id) }) as Promise<any>;

step("Teams in turn, and each team's CS people in turn");
const got: any[] = [];
for (let i = 0; i < 7; i++) got.push((await fromLms()).body?.data);
check("team 1 CS1, team 2 CS1, team 3 CS1, team 4 CS1, team 1 CS2, team 2 CS1 again, team 3 CS2",
  JSON.stringify(got.map((d) => `${d?.teamName}/${d?.mentorName}`)) ===
  JSON.stringify(["Alpha/Asha", "Bravo/Bina", "Charlie/Chitra", "Delta/Dev", "Alpha/Arun", "Bravo/Bina", "Charlie/Chetan"]),
  JSON.stringify(got.map((d) => `${d?.teamName}/${d?.mentorName}`)));
check("a team with no CS person, and one whose only CS person is switched off, sit out",
  !got.some((d) => ["Echo", "Foxtrot"].includes(d?.teamName)));
await db.collection("users").insertOne(under(E, "Eli", "cs", "2026-05-03T00:00:00.000Z") as any);
const rejoin = [(await fromLms()).body?.data, (await fromLms()).body?.data];
check("given a CS person, a team rejoins the round in its place: after team 3 comes Delta, then Echo",
  rejoin[0]?.teamName === "Delta" && rejoin[1]?.teamName === "Echo" && rejoin[1]?.mentorName === "Eli", JSON.stringify(rejoin));

const firstId = got[0].studentId as string;
let s = await student(firstId);
check("the team is stored on the student", s?.team_id === String(A._id) && s?.team_name === "Alpha", JSON.stringify({ team_id: s?.team_id, team_name: s?.team_name }));
check("...and who received them first", s?.first_assignee_id === String(a1._id) && s?.first_assignee_name === "Asha" && s?.first_assignee_role === "cs" && !!s?.first_assigned_at);
let h = await history(firstId);
check("their history: arrived from the LMS, then given to Asha of Alpha in turn",
  h.status === 200 && JSON.stringify(h.body.events.map((e: any) => e.type)) === JSON.stringify(["arrived", "assigned"]) &&
  /Arrived from the Delta LMS — Delta Wave Theory Trading Programme \(Delta Dubai\)/.test(h.body.events[0].text) &&
  /Given to Asha \(CS\) of team Alpha, in turn/.test(h.body.events[1].text), JSON.stringify(h.body));
check("...with the team, the first receiver and where they came from",
  h.body.team?.name === "Alpha" && h.body.team?.stored === true && h.body.firstReceivedBy?.name === "Asha" && h.body.firstReceivedBy?.role === "CS" &&
  h.body.firstReceivedBy?.fromRecords === false && h.body.cameFrom?.label === "Delta LMS", JSON.stringify(h.body));

step("Changes, whichever screen makes them");
// A transfer to a CS person in another team, as the transfer approval makes it.
let r = await call("PATCH", `/api/entities/Student/${firstId}`, { primary_mentor_id: String(d1._id), primary_mentor_name: "Dev", assignment_status: "assigned" }, as(adminToken));
s = await student(firstId);
check("a transfer: the team follows the new mentor", r.status === 200 && s?.team_id === String(D._id) && s?.team_name === "Delta");
check("...who received them first does not change", s?.first_assignee_name === "Asha");
r = await call("PATCH", `/api/entities/Student/${firstId}`, { first_assignee_name: "Somebody Else", team_id: "x", team_name: "Made Up", notes: "edited" }, as(adminToken));
s = await student(firstId);
check("neither can be written by a client", s?.first_assignee_name === "Asha" && s?.team_name === "Delta" && s?.notes === "edited");
await call("PATCH", `/api/entities/Student/${firstId}`, { student_level: "LEVEL_2" }, as(adminToken));
await call("PATCH", `/api/entities/Student/${firstId}`, { status: "INACTIVE" }, as(adminToken));
h = await history(firstId);
const types = h.body.events.map((e: any) => e.type);
check("all of it in the history, in order", JSON.stringify(types) === JSON.stringify(["arrived", "assigned", "mentor_changed", "level_changed", "status_changed"]), JSON.stringify(types));
const moved = h.body.events.find((e: any) => e.type === "mentor_changed");
check("...the transfer says from whom, to whom, the team change, and who did it",
  /from Asha to Dev \(CS\) of team Delta — team Alpha → Delta/.test(moved?.text ?? "") && moved?.by === "Ad Min", JSON.stringify(moved));
check("...and the level and status changes say what they were",
  /Level 1 to Level 2/.test(h.body.events[3]?.text ?? "") && /ACTIVE to INACTIVE/.test(h.body.events[4]?.text ?? ""), JSON.stringify(h.body.events.slice(3)));

// Added on the Students page with a mentor.
r = await call("POST", "/api/entities/Student", { student_code: "STU-9001", full_name: "Hand Added", email: "hand@e2e-history.test",
  primary_mentor_id: String(b1._id), primary_mentor_name: "Bina", assignment_status: "assigned", status: "ACTIVE", student_level: "LEVEL_1",
  team_name: "Made Up", first_assignee_name: "Made Up" }, as(adminToken));
const handId = r.body?.id as string;
s = await student(handId);
check("added by hand: team and first receiver from its mentor, whatever the client sent",
  s?.team_name === "Bravo" && s?.team_id === String(B._id) && s?.first_assignee_name === "Bina" && s?.first_assignee_role === "cs", JSON.stringify(s));
h = await history(handId);
check("...its history: added by whom, and given to whom",
  JSON.stringify(h.body.events.map((e: any) => e.type)) === JSON.stringify(["created", "assigned"]) && /Added by Ad Min/.test(h.body.events[0].text) &&
  /Given to Bina \(CS\) of team Bravo/.test(h.body.events[1].text), JSON.stringify(h.body.events));

// Added with nobody, then taken from Delta Open Students.
r = await call("POST", "/api/entities/Student", { student_code: "STU-9002", full_name: "Pool Student", email: "pool@e2e-history.test",
  assignment_status: "open_pool", status: "ACTIVE", student_level: "LEVEL_1" }, as(adminToken));
const poolId = r.body?.id as string;
s = await student(poolId);
check("added with nobody: no team and no first receiver yet", s?.team_id === "" && !s?.first_assignee_id);
await call("PATCH", `/api/entities/Student/${poolId}`, { primary_mentor_id: String(c2._id), primary_mentor_name: "Chetan", assignment_status: "assigned" }, as(adminToken));
s = await student(poolId);
check("taken from the pool: that is who received them first, and their team is stored",
  s?.first_assignee_name === "Chetan" && s?.team_name === "Charlie" && !!s?.first_assigned_at);
h = await history(poolId);
check("...and the history says so", /Given to Chetan \(CS\) of team Charlie, from Delta Open Students/.test(h.body.events.at(-1)?.text ?? ""), JSON.stringify(h.body.events));

step("Who may read a student's history");
const devToken = await login(d1);
const ashaToken = await login(a1);
check("their mentor may", (await history(firstId, devToken)).status === 200);
check("a CS person who only sees their own may not read another's student's", (await history(firstId, ashaToken)).status === 403);
check("nobody signed in may not", (await call("POST", "/api/functions/getStudentHistory", { studentId: firstId })).status === 401);
check("a student that does not exist: not found", (await history(new ObjectId().toString())).status === 404);

step("Students from before the history was kept");
const oldId = new ObjectId();
await db.collection("students").insertOne({ _id: oldId, student_code: "STU-0100", full_name: "Old Student", email: "old@e2e-history.test",
  primary_mentor_id: String(b1._id), primary_mentor_name: "Bina", assignment_status: "assigned", status: "ACTIVE", student_level: "LEVEL_1",
  created_by_name: "Old Mentor", created_date: "2026-02-01T09:00:00.000Z" });
await db.collection("student_requests").insertMany([
  { request_type: "NEW_ENROLLMENT", created_student_id: String(oldId), requested_by_name: "Old Mentor", requested_primary_mentor_name: "Old Mentor",
    status: "APPROVED", requested_at: "2026-02-01T09:00:01.000Z" },
  { request_type: "TRANSFER", existing_student_id: String(oldId), requested_by_name: "Bina", requested_primary_mentor_name: "Bina",
    previous_mentor_name: "Old Mentor", status: "TRANSFERRED", level_upgrade_approved_by_name: "Academic Head", requested_at: "2026-03-01T10:00:00.000Z" },
]);
h = await history(String(oldId));
check("their history comes from their record and their requests, in order",
  JSON.stringify(h.body.events.map((e: any) => e.type)) === JSON.stringify(["created", "request", "request"]) &&
  /Added by Old Mentor/.test(h.body.events[0].text) && /Transfer from Old Mentor to Bina requested by Bina — done by Academic Head/.test(h.body.events[2].text),
  JSON.stringify(h.body.events));
check("who received them first is worked out from those records, and says so",
  h.body.firstReceivedBy?.name === "Old Mentor" && h.body.firstReceivedBy?.fromRecords === true, JSON.stringify(h.body.firstReceivedBy));
check("their team is worked out from their mentor until it is stored", h.body.team?.name === "Bravo" && h.body.team?.stored === false, JSON.stringify(h.body.team));

step("Storing the team on students from before");
const run = (...args: string[]) => {
  const p = Bun.spawnSync(["bun", "--no-env-file", "src/scripts/backfill-student-teams.ts", ...args], {
    env: { ...process.env, MONGO_URI: uri, MONGO_DB: dbName }, stdout: "pipe", stderr: "pipe",
  });
  return `${p.stdout.toString()}${p.stderr.toString()}`;
};
let out = run();
check("a dry run says what it would store, and stores nothing",
  /Would store the team on 1 student/.test(out) && !(await db.collection("students").findOne({ _id: oldId }))?.team_id, out);
out = run("--apply");
check("--apply stores it", /Stored the team on 1 student/.test(out) && (await db.collection("students").findOne({ _id: oldId }))?.team_name === "Bravo", out);
out = run("--apply");
check("...and running it again changes nothing", /Stored the team on 0 student/.test(out), out);

await db.dropDatabase();
await client.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
