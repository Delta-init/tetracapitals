/**
 * Mentors' time off on the Mentor Calendar — end to end, against a real API process and the real LMS
 * (functions/mentorCalendar.ts markMentorTimeOff / removeMentorTimeOff / getMentorSchedule, the LMS's
 * /service/mentor-time-off and /service/mentors):
 *
 *   - a mentor marks their own; a chief mentor their team's; an admin anyone's; nobody else another's;
 *   - the calendar shows it to everyone — its reason only to whoever may mark it — and may_mark_time_off says who;
 *   - booking a session in it is refused with the LMS's words; beside it is fine;
 *   - what was already booked inside it is told back and stays;
 *   - taken away (by whoever may mark it), the time can be booked again.
 *
 * Run through ./test-mentor-time-off.sh (throwaway mongod, this API and the LMS — no .env).
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

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
const lms = client.db(lmsDbName);
for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({});
// The LMS keeps what it made at boot (its academies, roles); only what this test makes is cleared.
for (const c of ["users", "mentortimeoffs", "mentormeetings"]) await lms.collection(c).deleteMany({});

step("Setting up");
// The LMS: one academy, three instructors.
// The academy this API is set to ask about (LMS_REMOTE_ORG_ID) — the LMS made its own two at boot beside it.
const org = new ObjectId(process.env.E2E_LMS_ORG);
await lms.collection("organizations").updateOne({ _id: org }, { $set: { name: "E2E Academy", slug: "e2e-academy", currency: "AED", paymentGateway: "abzer", updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
const instructor = (name: string, email: string) => ({ _id: new ObjectId(), name, email, passwordHash: "x", role: "instructor", isActive: true, isVerified: true, organizationId: org, createdAt: new Date(), updatedAt: new Date() });
await lms.collection("users").insertMany([instructor("HAFFIS", "haf@e2e-off.test"), instructor("MOIZ", "moiz@e2e-off.test"), instructor("RIYA", "riya@e2e-off.test")]);

// The portal: an admin, a chief mentor over Haffis, Haffis and Moiz (mentors), a CS.
const hash = await bcrypt.hash("Password123!", 10);
const chiefId = new ObjectId();
const person = (email: string, full_name: string, app_role: string, extra: Record<string, unknown> = {}) =>
  ({ _id: new ObjectId(), email, full_name, app_role, password_hash: hash, status: "active", created_date: "2026-01-01T00:00:00.000Z", ...extra });
await db.collection("users").insertMany([
  person("admin@e2e-off.test", "Admin", "super_admin"),
  { ...person("chief@e2e-off.test", "Chief", "chief_mentor"), _id: chiefId },
  person("haf@e2e-off.test", "Haffis", "junior_mentor", { up_head_id: String(chiefId) }),
  person("moiz@e2e-off.test", "Moiz", "junior_mentor"),
  person("cs@e2e-off.test", "Cee Ess", "cs"),
] as any[]);
const tokens: Record<string, string> = {};
for (const who of ["admin", "chief", "haf", "moiz", "cs"]) {
  const r = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${who}@e2e-off.test`, password: "Password123!" }) });
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
const rowOf = (res: any, email: string) => (res.body?.mentors ?? []).find((m: any) => m.email === email);

step("Who may mark it");
let r = await call("haf", "markMentorTimeOff", { mentorEmail: "haf@e2e-off.test", startsAt: dubaiAt(2, "14:00").toISOString(), endsAt: dubaiAt(2, "18:00").toISOString(), reason: "Doctor" });
const hafOff = r.body?.timeOff?.id;
check("Haffis marks his own afternoon", r.status === 200 && !!hafOff && r.body?.timeOff?.createdByName === "Haffis", `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
r = await call("moiz", "markMentorTimeOff", { mentorEmail: "haf@e2e-off.test", startsAt: dubaiAt(3, "10:00").toISOString(), endsAt: dubaiAt(3, "11:00").toISOString() });
check("Moiz cannot mark Haffis", r.status === 403, `${r.status} ${msg(r)}`);
r = await call("cs", "markMentorTimeOff", { mentorEmail: "moiz@e2e-off.test", startsAt: dubaiAt(3, "10:00").toISOString(), endsAt: dubaiAt(3, "11:00").toISOString() });
check("a CS cannot mark anyone", r.status === 403);
r = await call("chief", "markMentorTimeOff", { mentorEmail: "HAF@e2e-off.test", startsAt: dubaiAt(4, "00:00").toISOString(), endsAt: dubaiAt(5, "00:00").toISOString(), allDay: true, reason: "Training" });
const chiefOff = r.body?.timeOff?.id;
check("the chief marks Haffis (his team) a whole day", r.status === 200 && r.body?.timeOff?.allDay === true, `${r.status} ${msg(r)}`);
r = await call("chief", "markMentorTimeOff", { mentorEmail: "moiz@e2e-off.test", startsAt: dubaiAt(3, "10:00").toISOString(), endsAt: dubaiAt(3, "11:00").toISOString() });
check("…but not Moiz, who isn't on his team", r.status === 403);
r = await call("admin", "markMentorTimeOff", { mentorEmail: "riya@e2e-off.test", startsAt: dubaiAt(3, "10:00").toISOString(), endsAt: dubaiAt(3, "12:00").toISOString(), reason: "Errand" });
check("an admin marks anyone — Riya, not in the portal at all", r.status === 200, `${r.status} ${msg(r)}`);
r = await call("haf", "markMentorTimeOff", { mentorEmail: "haf@e2e-off.test", startsAt: dubaiAt(3, "12:00").toISOString(), endsAt: dubaiAt(3, "11:00").toISOString() });
check("an end before the start: refused in the LMS's words", r.status >= 400 && /after the start/.test(msg(r)), `${r.status} ${msg(r)}`);

step("On the calendar");
let s = await call("moiz", "getMentorSchedule", week);
check("Moiz sees Haffis's two — without the reasons — and may not mark them", rowOf(s, "haf@e2e-off.test")?.timeOff?.length === 2 && rowOf(s, "haf@e2e-off.test").timeOff.every((t: any) => t.reason === null) && rowOf(s, "haf@e2e-off.test").may_mark_time_off === false, JSON.stringify(rowOf(s, "haf@e2e-off.test")?.timeOff));
check("…and may mark his own", rowOf(s, "moiz@e2e-off.test")?.may_mark_time_off === true);
s = await call("haf", "getMentorSchedule", week);
check("Haffis sees his own reasons", rowOf(s, "haf@e2e-off.test")?.timeOff?.map((t: any) => t.reason).sort().join() === "Doctor,Training");
s = await call("chief", "getMentorSchedule", week);
check("the chief sees his team's reasons, not Riya's", rowOf(s, "haf@e2e-off.test")?.timeOff?.every((t: any) => t.reason) && rowOf(s, "riya@e2e-off.test")?.timeOff?.[0]?.reason === null);
s = await call("admin", "getMentorSchedule", week);
check("an admin sees every reason and may mark everyone", rowOf(s, "riya@e2e-off.test")?.timeOff?.[0]?.reason === "Errand" && (s.body?.mentors ?? []).every((m: any) => m.may_mark_time_off === true));

step("Booking around it");
const book = (who: string, start: Date, mins = 30) => call(who, "bookMentorMeeting", { mentorEmail: "haf@e2e-off.test", title: "Intro call", kind: "student", scheduledStart: start.toISOString(), durationMins: mins, attendees: [{ name: "A Student" }], inPerson: true, location: "Room 2" });
r = await book("cs", dubaiAt(2, "15:00"));
check("a session in it is refused, in the LMS's words", r.status === 409 && /HAFFIS is not available/.test(msg(r)), `${r.status} ${msg(r)}`);
r = await book("cs", dubaiAt(4, "11:00"));
check("…in the whole day too", r.status === 409, `${r.status} ${msg(r)}`);
r = await book("cs", dubaiAt(2, "18:00"));
const after = r.body?.meeting?.id;
check("right after it is fine", r.status === 200 && !!after, `${r.status} ${msg(r)}`);
r = await call("haf", "markMentorTimeOff", { mentorEmail: "haf@e2e-off.test", startsAt: dubaiAt(2, "17:30").toISOString(), endsAt: dubaiAt(2, "19:00").toISOString() });
const lateOff = r.body?.timeOff?.id;
check("time off over that session: marked, the session told back, not cancelled", r.status === 200 && r.body?.alreadyBooked?.some((b: any) => b.id === after) && !(await lms.collection("mentormeetings").findOne({ _id: new ObjectId(after) }))?.cancelledAt, JSON.stringify(r.body?.alreadyBooked));

step("Taken away");
r = await call("moiz", "removeMentorTimeOff", { mentorEmail: "haf@e2e-off.test", timeOffId: hafOff });
check("Moiz cannot take Haffis's away", r.status === 403);
r = await call("haf", "removeMentorTimeOff", { mentorEmail: "moiz@e2e-off.test", timeOffId: hafOff });
check("Haffis cannot take it away by naming Moiz", r.status === 403, String(r.status));
r = await call("haf", "removeMentorTimeOff", { mentorEmail: "haf@e2e-off.test", timeOffId: hafOff });
check("Haffis takes his own away", r.status === 200, `${r.status} ${msg(r)}`);
r = await book("cs", dubaiAt(2, "15:00"));
check("…and 15:00 can be booked again", r.status === 200, `${r.status} ${msg(r)}`);
r = await call("chief", "removeMentorTimeOff", { mentorEmail: "haf@e2e-off.test", timeOffId: chiefOff });
check("the chief takes his away", r.status === 200);
r = await call("admin", "removeMentorTimeOff", { mentorEmail: "haf@e2e-off.test", timeOffId: lateOff });
check("an admin takes any away", r.status === 200);
check("Haffis has none left", (await lms.collection("mentortimeoffs").countDocuments({})) === 1);

await client.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
