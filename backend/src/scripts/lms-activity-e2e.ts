/**
 * LMS support tickets and class assignments, told to the student's CS — end to
 * end against a throwaway database, a real API process (for the student page)
 * and a stand-in LMS served here (students/lmsActivity.ts, functions/lmsSupport.ts).
 *
 *   - switched on, it starts from now: nothing from before is told;
 *   - each kind — a ticket opened, a reply, an assignment sent, rejected,
 *     approved — reaches the student's CS by email and the bell, with a link
 *     to the student; asked again over the overlap, nobody is told twice;
 *   - no active CS (none, or switched off): every active super admin instead;
 *   - matched by LMS id, else by email whatever its case; somebody not a
 *     student here is passed over;
 *   - an email that fails is tried again, three times in all; mail not set
 *     up: the bell still rings;
 *   - the LMS down loses nothing; two runs at once tell once;
 *   - the student page shows the tickets and assignments to whoever may see
 *     the student, and says plainly when the LMS is too old to share them.
 *
 * Run through ./test-lms-activity.sh (throwaway mongod, the API — no .env).
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
const SECRET = process.env.LMS_SERVICE_SECRET ?? "";
const APP = process.env.APP_BASE_URL ?? "";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);

/* ── A stand-in LMS: the three /service routes, behind its secret ── */
let lmsMode: "ok" | "down" | "old" = "ok";
const events: any[] = [];
const asked: string[] = [];
const tickets = new Map<string, any[]>();
const assignments = new Map<string, any[]>();
const lms = Bun.serve({
  port: Number(process.env.E2E_FAKE_LMS_PORT),
  async fetch(req) {
    const url = new URL(req.url);
    if (req.headers.get("x-portal-secret") !== SECRET) return Response.json({ success: false, error: { message: "Bad secret" } }, { status: 401 });
    if (lmsMode === "down") return Response.json({ success: false, error: { message: "LMS is down" } }, { status: 503 });
    if (lmsMode === "old") return Response.json({ success: false, error: { code: "NOT_FOUND", message: "Route not found" } }, { status: 404 });
    if (url.pathname === "/api/v1/service/student-activity") {
      const since = url.searchParams.get("since") ?? "";
      asked.push(since);
      return Response.json({ success: true, data: { events: events.filter((e) => e.at > since), until: new Date().toISOString() } });
    }
    const body: any = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").toLowerCase();
    if (url.pathname === "/api/v1/service/support-tickets") return Response.json({ success: true, data: { email, exists: tickets.has(email), tickets: tickets.get(email) ?? [] } });
    if (url.pathname === "/api/v1/service/class-assignments") return Response.json({ success: true, data: { email, exists: assignments.has(email), assignments: assignments.get(email) ?? [] } });
    return Response.json({ success: false, error: { message: "Route not found" } }, { status: 404 });
  },
});

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
if (!/127\.0\.0\.1/.test(uri)) process.exit(1);
// Emptied rather than dropped: the API made its indexes when it started.
for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({});

const { connectDb, closeDb } = await import("../db");
await connectDb();
const { runLmsActivity } = await import("../students/lmsActivity");

/* ── Mail, caught here instead of sent ── */
type Mail = { to: string; subject: string; html: string; text: string };
let mailMode: "ok" | "fail" | "off" = "ok";
const mails: Mail[] = [];
const send = async (m: Mail) => {
  if (mailMode === "off") return { ok: false as const, error: "Email is not configured on the server (SMTP settings)", notConfigured: true };
  if (mailMode === "fail") return { ok: false as const, error: "Connection refused" };
  mails.push(m);
  return { ok: true as const, messageId: `<m${mails.length}@e2e>`, accepted: [m.to], response: "250 OK" };
};
const run = () => runLmsActivity({ send });
const mailsTo = (to: string) => mails.filter((m) => m.to === to);

step("Setting up");
const hash = await bcrypt.hash("Password123!", 10);
const now = new Date().toISOString();
const person = (full_name: string, app_role: string, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), email: `${full_name.toLowerCase().replace(/\s+/g, ".")}@e2e-activity.test`, full_name, app_role,
  password_hash: hash, status: "active", created_date: now, updated_date: now, ...extra,
});
const cara = person("Cara CS", "cs");
const cody = person("Cody CS", "cs");
const olive = person("Olive CS", "cs", { status: "inactive" });
const sam = person("Sam Super", "super_admin");
const sue = person("Sue Super", "super_admin");
const sid = person("Sid Super", "super_admin", { status: "inactive" });
await db.collection("users").insertMany([cara, cody, olive, sam, sue, sid]);
// A CS sees their own students, as Role Management can set it.
await db.collection("commission_roles").insertOne({ role_key: "cs", name: "CS", data_scope: "own", created_date: now });
const student = (full_name: string, email: string, code: string, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), full_name, email, student_code: code, status: "ACTIVE", student_level: "LEVEL_1", created_date: now, updated_date: now, ...extra,
});
const leila = student("Leila Learner", "Leila.Learner@E2E-lms.test", "STU-0101", { primary_mentor_id: String(cara._id), primary_mentor_name: cara.full_name });
const omar = student("Omar Open", "omar@e2e-lms.test", "STU-0102");
const ivy = student("Ivy Idle", "ivy@e2e-lms.test", "STU-0103", { primary_mentor_id: String(olive._id), primary_mentor_name: olive.full_name });
const nina = student("Nina Linked", "nina.portal@e2e-lms.test", "STU-0104", { lms_user_id: "LMS-NINA", primary_mentor_id: String(cody._id), primary_mentor_name: cody.full_name });
await db.collection("students").insertMany([leila, omar, ivy, nina]);
check("two CS people, one switched off; three super admins, one switched off; four students", true);

let k = 0, lastAt = 0;
/** One event, a moment after the last, so the order they are told in is the order they happened. */
const ev = (type: string, who: { email: string; name: string; lmsUserId?: string }, extra: Record<string, unknown>) => {
  lastAt = Math.max(Date.now(), lastAt + 1);
  return { key: `${type}:${++k}`, type, at: new Date(lastAt).toISOString(), student: { lmsUserId: who.lmsUserId ?? `lms-${k}`, email: who.email, name: who.name }, ...extra };
};
const LEILA = { email: "leila.learner@e2e-lms.test", name: "Leila L." };
const ticket = (subject: string, message: string) => ({ ticket: { id: "t1", subject, category: "technical", status: "open", message } });
const work = (extra: Record<string, unknown> = {}) => ({ assignment: { id: "a1", title: "Wave count on EURUSD", note: "London session", files: 1, course: "Delta Wave Theory", className: "Wave counts, part 2", classAt: now, mentor: "Marco Mentor", attempt: 1, status: "pending", ...extra } });

step("Switched on: it starts from now");
events.push({ ...ev("ticket_opened", LEILA, ticket("From last week", "old news")), at: new Date(Date.now() - 3_600_000).toISOString() });
let r = await run();
const settings: any = await db.collection("app_settings").findOne({ _id: "lms_activity" } as any);
check("the first run only marks where it starts", r.ok && r.new === 0 && mails.length === 0 && !!settings?.cursor && asked.length === 0, JSON.stringify(r));
r = await run();
check("...and what happened before is never told", r.ok && r.new === 0 && mails.length === 0 && asked.length === 1, JSON.stringify(r));
check("each run asks again over the last few minutes", new Date(settings.cursor).getTime() - new Date(asked[0]!).getTime() === 5 * 60_000, `${settings.cursor} vs ${asked[0]}`);

step("A ticket opened, by a student with a CS");
events.push(ev("ticket_opened", LEILA, ticket("Video does not play", "The video will not play on my phone")));
r = await run();
const first = mailsTo(cara.email)[0];
check("their CS gets an email", r.ok && r.told === 1 && mails.length === 1 && !!first, JSON.stringify(r));
check("...matched by email, whatever its case, and named as the portal has them",
  /New support ticket — Leila Learner \(STU-0101\): Video does not play/.test(first?.subject ?? ""), first?.subject);
check("...with what they wrote and a link to them", (first?.html ?? "").includes("The video will not play on my phone") &&
  (first?.html ?? "").includes(`${APP}/StudentDetail?id=${leila._id}`) && (first?.text ?? "").includes(`${APP}/StudentDetail?id=${leila._id}`));
const bell = await db.collection("notifications").find({ user_id: String(cara._id) }).toArray();
check("...and the bell, opening the student", bell.length === 1 && bell[0]!.link === `/StudentDetail?id=${leila._id}` && bell[0]!.title === "New support ticket");
const kept: any = await db.collection("lms_activity").findOne({ _id: events[1]!.key } as any);
check("kept, with who was told and that the email went", kept?.outcome === "told" && kept?.to === "cs" && kept?.recipients?.[0]?.id === String(cara._id) &&
  kept?.mail?.state === "sent" && kept?.mail?.message_ids?.length === 1, JSON.stringify(kept?.mail));

step("A reply, an assignment sent again, one rejected, one approved");
events.push(ev("ticket_reply", LEILA, ticket("Video does not play", "It is an iPhone 13")));
events.push(ev("assignment_submitted", LEILA, work({ attempt: 2 })));
events.push(ev("assignment_reviewed", LEILA, work({ decision: "rejected", reason: "Add the chart for wave 3", status: "rejected" })));
events.push(ev("assignment_reviewed", LEILA, work({ decision: "approved", status: "approved", title: "First wave count" })));
r = await run();
const subjects = mailsTo(cara.email).slice(1).map((m) => m.subject);
check("four more emails to their CS", r.told === 4 && subjects.length === 4, JSON.stringify(subjects));
check("...each saying what happened", /replied on a support ticket: Video does not play/.test(subjects[0] ?? "") &&
  /sent a revision of an assignment \(attempt 2\): Wave count on EURUSD/.test(subjects[1] ?? "") &&
  /assignment was rejected: Wave count on EURUSD/.test(subjects[2] ?? "") && /assignment was approved: First wave count/.test(subjects[3] ?? ""), JSON.stringify(subjects));
check("...a rejection with the mentor's reason", mailsTo(cara.email)[3]!.html.includes("Add the chart for wave 3") && mailsTo(cara.email)[3]!.html.includes("Marco Mentor"));
const before = mails.length;
r = await run();
check("asked again over the overlap: nobody is told twice", r.ok && r.events >= 5 && r.new === 0 && mails.length === before, JSON.stringify(r));

step("No active CS: the super admins");
events.push(ev("ticket_opened", { email: "omar@e2e-lms.test", name: "Omar" }, ticket("Billing question", "Was I charged twice?")));
events.push(ev("assignment_submitted", { email: "ivy@e2e-lms.test", name: "Ivy" }, work()));
r = await run();
check("a student with no CS: every active super admin, not the switched-off one",
  mailsTo(sam.email).some((m) => m.subject.includes("Omar Open")) && mailsTo(sue.email).some((m) => m.subject.includes("Omar Open")) && mailsTo(sid.email).length === 0);
check("...told why it comes to them", mailsTo(sam.email).find((m) => m.subject.includes("Omar Open"))!.html.includes("has no CS in the portal"));
check("a student whose CS is switched off: the super admins too, not that CS",
  mailsTo(sue.email).some((m) => m.subject.includes("Ivy Idle")) && mailsTo(olive.email).length === 0);
check("...and their bells", (await db.collection("notifications").countDocuments({ user_id: { $in: [String(sam._id), String(sue._id)] } })) === 4);

step("Matched by LMS id; somebody not here is passed over");
events.push(ev("ticket_opened", { email: "nina.lms@e2e-lms.test", name: "Nina", lmsUserId: "LMS-NINA" }, ticket("Password", "Cannot log in")));
events.push(ev("ticket_opened", { email: "stranger@e2e-lms.test", name: "Stranger" }, ticket("Hello", "Who are you?")));
const sentBefore = mails.length;
r = await run();
check("the LMS id finds the student even with another email there", mailsTo(cody.email).some((m) => m.subject.includes("Nina Linked")));
const stranger: any = await db.collection("lms_activity").findOne({ "lms_student.email": "stranger@e2e-lms.test" } as any);
check("not a student here: nobody told, and kept as such", r.told === 1 && r.not_told === 1 && mails.length === sentBefore + 1 && stranger?.outcome === "not_a_student");

step("Email failing, or not set up");
mailMode = "fail";
events.push(ev("ticket_reply", LEILA, ticket("Video does not play", "Any news?")));
r = await run();
let rec: any = await db.collection("lms_activity").findOne({ _id: events[events.length - 1]!.key } as any);
check("a failed send: waits to be tried again, with the reason", r.mail_failed === 1 && rec?.mail?.state === "retry" && rec?.mail?.attempts === 1 && /Connection refused/.test(rec?.mail?.error ?? ""), JSON.stringify(rec?.mail));
await run(); await run();
rec = await db.collection("lms_activity").findOne({ _id: rec._id } as any);
check("...three tries in all, then it stops", rec?.mail?.state === "failed" && rec?.mail?.attempts === 3, JSON.stringify(rec?.mail));
r = await run();
check("...and is not tried a fourth time", r.mail_failed === 0 && (await db.collection("lms_activity").findOne({ _id: rec._id } as any) as any)?.mail?.attempts === 3);
events.push(ev("assignment_submitted", LEILA, work({ title: "Retry me" })));
await run();
mailMode = "ok";
await run();
const retried: any = await db.collection("lms_activity").findOne({ _id: events[events.length - 1]!.key } as any);
check("a send that fails once goes on the next run", retried?.mail?.state === "sent" && retried?.mail?.attempts === 2 && mailsTo(cara.email).some((m) => m.subject.includes("Retry me")));
mailMode = "off";
events.push(ev("ticket_reply", LEILA, ticket("Video does not play", "Hello?")));
const bellsBefore = await db.collection("notifications").countDocuments({ user_id: String(cara._id) });
await run();
const off: any = await db.collection("lms_activity").findOne({ _id: events[events.length - 1]!.key } as any);
check("mail not set up: marked so, not retried — and the bell still rings",
  off?.mail?.state === "off" && (await db.collection("notifications").countDocuments({ user_id: String(cara._id) })) === bellsBefore + 1);
mailMode = "ok";

step("The LMS down; two runs at once");
const cursorBefore = ((await db.collection("app_settings").findOne({ _id: "lms_activity" } as any)) as any)?.cursor;
lmsMode = "down";
events.push(ev("ticket_opened", LEILA, ticket("While it was down", "Hi")));
r = await run();
const cursorDown = ((await db.collection("app_settings").findOne({ _id: "lms_activity" } as any)) as any)?.cursor;
check("down: the run says why and the place is kept", !r.ok && /down|would not/i.test(r.error ?? "") && cursorDown === cursorBefore, JSON.stringify(r));
lmsMode = "ok";
r = await run();
check("...back up: what happened meanwhile is told", r.ok && mailsTo(cara.email).some((m) => m.subject.includes("While it was down")));
events.push(ev("ticket_opened", LEILA, ticket("Only once", "Hi")));
const both = await Promise.all([run(), run()]);
check("two runs at once: one does it, the other says one is going, and it is told once",
  both.filter((x) => x.ok).length === 1 && both.some((x) => x.error === "A run is already going") && mailsTo(cara.email).filter((m) => m.subject.includes("Only once")).length === 1,
  JSON.stringify(both.map((x) => x.error ?? "ok")));

step("The student's page");
type Res = { status: number; body: any };
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const res = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const login = async (u: any) => (await call("POST", "/api/auth/login", { email: u.email, password: "Password123!" })).body?.token as string;
const as = (token: string) => ({ authorization: `Bearer ${token}` });
tickets.set("leila.learner@e2e-lms.test", [{ id: "t1", subject: "Video does not play", category: "technical", status: "open", messages: [{ from: "student", body: "It will not play", at: now }] }]);
assignments.set("leila.learner@e2e-lms.test", [{ id: "a1", title: "Wave count on EURUSD", status: "rejected", reason: "Add the chart", attempt: 1, files: ["chart.png"] }]);
const caraToken = await login(cara);
const page = await call("POST", "/api/functions/getStudentLmsSupport", { studentId: String(leila._id) }, as(caraToken));
check("their CS sees the tickets and the assignments", page.status === 200 && page.body?.available === true && page.body?.has_account === true &&
  page.body?.tickets?.[0]?.subject === "Video does not play" && page.body?.assignments?.[0]?.reason === "Add the chart", JSON.stringify(page.body).slice(0, 300));
const other = await call("POST", "/api/functions/getStudentLmsSupport", { studentId: String(leila._id) }, as(await login(cody)));
check("another CS does not", other.status === 403, `${other.status}`);
const admin = await call("POST", "/api/functions/getStudentLmsSupport", { studentId: String(leila._id) }, as(await login(sam)));
check("a super admin does", admin.status === 200 && admin.body?.tickets?.length === 1);
lmsMode = "old";
const old = await call("POST", "/api/functions/getStudentLmsSupport", { studentId: String(leila._id) }, as(caraToken));
check("an LMS too old to share them: said plainly", old.status === 200 && old.body?.available === false && /needs its update/.test(old.body?.message ?? ""), JSON.stringify(old.body));
lmsMode = "ok";

await closeDb();
await client.close();
lms.stop(true);
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
