/**
 * A Chief Mentor's staff meeting on the Mentor Calendar — end to end, against a real API process and the real LMS
 * (functions/mentorCalendar.ts bookMentorMeeting / updateMentorMeeting / getMentorSchedule; the LMS's
 * /service/mentor-meetings and /service/mentors). The user, 2026-11-14: "an option in meeting with: staff meeting, only
 * for the Chief… staff can be selected; if they have a meeting at that time it shows the specific mentor".
 *
 *   - who books one: a Chief Mentor and an admin (may_staff_meeting); with whom: a chief their team (may_invite),
 *     an admin anyone; nobody else, and never as a student meeting;
 *   - booked: one meeting on the Chief's and every picked mentor's calendar, nobody typed;
 *   - somebody busy then: refused in the LMS's words, naming them and what they are in;
 *   - changed: somebody taken off (off their calendar), nobody added from outside the team;
 *   - called off: off everybody's.
 *
 * Run through ./test-staff-meetings.sh (throwaway mongod, this API and the LMS — no .env).
 * Refuses anything but scratch databases on 127.0.0.1.
 */
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "";
const dbName = process.env.MONGO_DB ?? "";
const lmsDbName = process.env.E2E_LMS_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName) || !/e2e/.test(lmsDbName)) {
  console.error(`Refusing to run: needs scratch e2e databases on 127.0.0.1, got ${uri} / ${dbName} / ${lmsDbName}`);
  process.exit(1);
}
const API = `http://127.0.0.1:${process.env.E2E_API_PORT}`;

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
const j = (v: unknown) => JSON.stringify(v).slice(0, 400);

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
const lms = client.db(lmsDbName);
for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({});
// The LMS keeps what it made at boot (its academies, roles); only what this test makes is cleared.
for (const c of ["users", "mentortimeoffs", "mentormeetings", "liveclasses"]) await lms.collection(c).deleteMany({});

step("Setting up");
const org = new ObjectId(process.env.E2E_LMS_ORG);
await lms.collection("organizations").updateOne({ _id: org }, { $set: { name: "E2E Academy", slug: "e2e-academy", currency: "AED", paymentGateway: "abzer", updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
const instructor = (name: string, email: string) => ({ _id: new ObjectId(), name, email, passwordHash: "x", role: "instructor", isActive: true, isVerified: true, organizationId: org, createdAt: new Date(), updatedAt: new Date() });
// The LMS's mentors: the Chief, two of the Chief's team, one of another team.
const mentors = [instructor("CHIEF", "chief@e2e-sm.test"), instructor("HAFFIS", "haf@e2e-sm.test"), instructor("RIYA", "riya@e2e-sm.test"), instructor("MOIZ", "moiz@e2e-sm.test")];
await lms.collection("users").insertMany(mentors);

// The portal: an admin, a chief mentor over Haffis and Riya, Moiz (nobody's team here), a CS.
const hash = await bcrypt.hash("Password123!", 10);
const chiefId = new ObjectId();
const person = (email: string, full_name: string, app_role: string, extra: Record<string, unknown> = {}) =>
  ({ _id: new ObjectId(), email, full_name, app_role, password_hash: hash, status: "active", created_date: "2026-01-01T00:00:00.000Z", ...extra });
await db.collection("users").insertMany([
  person("admin@e2e-sm.test", "Admin", "super_admin"),
  { ...person("chief@e2e-sm.test", "Chief", "chief_mentor"), _id: chiefId },
  person("haf@e2e-sm.test", "Haffis", "junior_mentor", { up_head_id: String(chiefId) }),
  person("riya@e2e-sm.test", "Riya", "senior_mentor", { up_head_id: String(chiefId) }),
  person("moiz@e2e-sm.test", "Moiz", "junior_mentor"),
  person("cs@e2e-sm.test", "Cee Ess", "cs"),
] as any[]);
const tokens: Record<string, string> = {};
for (const who of ["admin", "chief", "haf", "moiz", "cs"]) {
  const r = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${who}@e2e-sm.test`, password: "Password123!" }) });
  tokens[who] = ((await r.json()) as any).token;
}
check("everyone signed in", Object.values(tokens).every(Boolean), JSON.stringify(Object.keys(tokens).filter((k) => !tokens[k])));
const call = async (who: string, name: string, body: unknown) => {
  const r = await fetch(`${API}/api/functions/${name}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tokens[who]}` }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};
const msg = (r: { body: any }) => String(r.body?.error ?? r.body?.message ?? "");
const DAY = 864e5;
const dubaiAt = (days: number, hhmm: string) => new Date(`${new Date(Date.now() + days * DAY).toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" })}T${hhmm}:00+04:00`);
const week = { from: new Date().toISOString(), to: new Date(Date.now() + 7 * DAY).toISOString() };
const schedule = async (who: string) => (await call(who, "getMentorSchedule", week)).body;
const columnOf = (s: any, name: string) => (s?.mentors ?? []).find((m: any) => m.name === name);
const onCalendar = (s: any, name: string, id: string) => (columnOf(s, name)?.meetings ?? []).some((m: any) => m.id === id);

step("1. Who books a staff meeting, and with whom");
let s = await schedule("chief");
check("a Chief Mentor does — with themselves and their team, not somebody else's mentor", s.may_staff_meeting === true
  && columnOf(s, "CHIEF")?.may_invite === true && columnOf(s, "HAFFIS")?.may_invite === true && columnOf(s, "RIYA")?.may_invite === true && columnOf(s, "MOIZ")?.may_invite === false, j((s.mentors ?? []).map((m: any) => [m.name, m.may_invite])));
s = await schedule("admin");
check("an admin does — with anyone", s.may_staff_meeting === true && (s.mentors ?? []).every((m: any) => m.may_invite === true));
s = await schedule("haf");
check("a mentor of the team doesn't, and may name nobody", s.may_staff_meeting === false && (s.mentors ?? []).every((m: any) => m.may_invite === false));
check("…nor a CS", (await schedule("cs")).may_staff_meeting === false);

step("2. The Chief books one");
const base = { mentorEmail: "chief@e2e-sm.test", title: "Weekly team meeting", kind: "staff", durationMins: 60, scheduledStart: dubaiAt(1, "10:00").toISOString(), attendees: [] };
let r = await call("haf", "bookMentorMeeting", { ...base, mentorEmail: "haf@e2e-sm.test", staffEmails: ["riya@e2e-sm.test"] });
check("a mentor naming staff: refused", r.status === 403 && /Only a Chief Mentor/.test(msg(r)), j(r.body));
r = await call("chief", "bookMentorMeeting", { ...base, staffEmails: ["haf@e2e-sm.test", "moiz@e2e-sm.test"] });
check("the Chief naming another team's mentor: refused, naming them", r.status === 403 && /Not in your team: moiz@e2e-sm\.test/.test(msg(r)) && !/haf@/.test(msg(r)), j(r.body));
r = await call("chief", "bookMentorMeeting", { ...base, kind: "student", staffEmails: ["haf@e2e-sm.test"] });
check("staff named on a student meeting: refused", r.status === 403 && /meeting with staff/.test(msg(r)), j(r.body));
r = await call("chief", "bookMentorMeeting", { ...base, mentorEmail: "moiz@e2e-sm.test", staffEmails: ["haf@e2e-sm.test"] });
check("the Chief making it another team's mentor's meeting: refused", r.status === 403 && /Not in your team: moiz@/.test(msg(r)), j(r.body));
check("…none of which was booked", (await lms.collection("mentormeetings").countDocuments({})) === 0);
r = await call("chief", "bookMentorMeeting", { ...base, staffEmails: ["haf@e2e-sm.test", "RIYA@e2e-sm.test", "chief@e2e-sm.test"] });
const id = String(r.body?.meeting?.id ?? "");
check("with Haffis and Riya, nobody typed: booked — both invited, the Chief counted once", r.status === 200 && !!id && (r.body.meeting.staff ?? []).length === 2
  && (r.body.meeting.attendees ?? []).map((a: any) => a.email).sort().join() === "haf@e2e-sm.test,riya@e2e-sm.test", j(r.body));
s = await schedule("cs");
check("on the Chief's, Haffis's and Riya's calendars for everybody looking — not Moiz's", onCalendar(s, "CHIEF", id) && onCalendar(s, "HAFFIS", id) && onCalendar(s, "RIYA", id) && !onCalendar(s, "MOIZ", id));
const seen = (columnOf(s, "HAFFIS")?.meetings ?? []).find((m: any) => m.id === id);
check("…said to be a staff meeting, the Chief's", seen?.staffMeeting === true && seen?.mentorName === "CHIEF", j(seen));

step("3. Somebody busy then is named");
r = await call("chief", "bookMentorMeeting", { ...base, title: "A second one", scheduledStart: dubaiAt(1, "10:30").toISOString(), mentorEmail: "riya@e2e-sm.test", staffEmails: ["haf@e2e-sm.test"] });
check("Riya's own meeting over it: refused in the LMS's words", r.status === 409 && /overlaps a meeting already booked: Weekly team meeting/.test(msg(r)), j(r.body));
await lms.collection("liveclasses").insertOne({ title: "Forex A", instructorId: mentors[1]!._id, organizationId: org, scheduledStart: dubaiAt(1, "15:00"), durationMins: 60, status: "scheduled", bookedCount: 0, sessionCapacity: 30, createdAt: new Date(), updatedAt: new Date() } as any);
r = await call("chief", "bookMentorMeeting", { ...base, title: "Afternoon", scheduledStart: dubaiAt(1, "15:30").toISOString(), staffEmails: ["haf@e2e-sm.test", "riya@e2e-sm.test"] });
check("over Haffis's class: refused naming Haffis and the class — not Riya", r.status === 409 && /Busy then: HAFFIS \(class: Forex A\)/.test(msg(r)) && !/RIYA/.test(msg(r)), j(r.body));
r = await call("admin", "bookMentorMeeting", { ...base, title: "Admin's, across teams", scheduledStart: dubaiAt(2, "10:00").toISOString(), mentorEmail: "moiz@e2e-sm.test", staffEmails: ["riya@e2e-sm.test"] });
check("an admin, across teams: booked", r.status === 200 && (r.body.meeting?.staff ?? []).length === 1, j(r.body));

step("4. Changed, and called off");
r = await call("chief", "getMentorMeeting", { meetingId: id });
check("read back for changing: its mentors", (r.body?.staff ?? []).map((x: any) => x.email).sort().join() === "haf@e2e-sm.test,riya@e2e-sm.test", j(r.body?.staff));
r = await call("chief", "updateMentorMeeting", { meetingId: id, staffEmails: ["haf@e2e-sm.test", "moiz@e2e-sm.test"] });
check("adding another team's mentor: refused", r.status === 403 && /Not in your team: moiz@/.test(msg(r)), j(r.body));
r = await call("haf", "updateMentorMeeting", { meetingId: id, title: "Not mine" });
check("somebody in it who didn't book it can't change it (the LMS's rule)", r.status === 409 && /Only the person who booked this/.test(msg(r)), j(r.body));
r = await call("chief", "updateMentorMeeting", { meetingId: id, staffEmails: ["haf@e2e-sm.test"] });
s = await schedule("cs");
check("Riya taken off: off her calendar, still on Haffis's and the Chief's", r.status === 200 && !onCalendar(s, "RIYA", id) && onCalendar(s, "HAFFIS", id) && onCalendar(s, "CHIEF", id), j(r.body));
r = await call("chief", "updateMentorMeeting", { meetingId: id, scheduledStart: dubaiAt(1, "15:15").toISOString() });
check("moved into Haffis's class: refused naming him, left where it was", r.status === 409 && /HAFFIS \(class: Forex A\)/.test(msg(r))
  && +new Date((await lms.collection("mentormeetings").findOne({ _id: new ObjectId(id) }))!.scheduledStart) === +dubaiAt(1, "10:00"), j(r.body));
r = await call("chief", "cancelMentorMeeting", { meetingId: id });
s = await schedule("cs");
check("called off: off everybody's calendar", r.status === 200 && !onCalendar(s, "CHIEF", id) && !onCalendar(s, "HAFFIS", id));

step("5. Any other meeting, as it was");
r = await call("haf", "bookMentorMeeting", { ...base, mentorEmail: "moiz@e2e-sm.test", title: "A plain staff chat", scheduledStart: dubaiAt(3, "10:00").toISOString(), attendees: [{ name: "Somebody" }] });
check("a mentor books a plain staff meeting with anyone, as before", r.status === 200 && (r.body.meeting?.staff ?? []).length === 0, j(r.body));
r = await call("chief", "bookMentorMeeting", { ...base, title: "Nobody in it", scheduledStart: dubaiAt(3, "12:00").toISOString(), staffEmails: [] });
check("a staff meeting with nobody in it: refused by the LMS", r.status === 409 && /Say who the mentor is meeting/.test(msg(r)), j(r.body));

await client.close();
console.log(`\n${fail ? "\x1b[31m" : "\x1b[32m"}${pass}/${pass + fail} checks passed\x1b[0m`);
process.exit(fail ? 1 : 0);
