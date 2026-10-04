/**
 * The Sales role, end to end, against a real API process (students/closedBy.ts):
 *
 *   - the API makes the role when it starts: "Sales", the Students page, data scope "closed";
 *   - its people see the students they closed — closed_by, from finance — and only those: the Students list
 *     (one list), the student page and what is on it (follow-ups, calls, deposits, MT5 accounts, history),
 *     nothing of anyone else's, through any entity;
 *   - they change nothing: no entity writes but their own notifications, no function but reads and their
 *     Mentor Calendar bookings;
 *   - finance's closedBy lands on the student — a new one, the same invoice again, an email already here —
 *     once per person;
 *   - "closed" on a built-in role means nothing; the CS and admins see what they always saw;
 *   - the Root portal can give somebody the Sales role.
 *
 * Run through ./test-sales-role.sh (throwaway mongod, the API — no .env).
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
const FINANCE_SECRET = process.env.FINANCE_S2S_SECRET ?? "";
const PORTAL_SECRET = process.env.ROOT_ERP_SECRET ?? "";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);

type Res = { status: number; body: any };
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function login(email: string): Promise<string> {
  const r = await call("POST", "/api/auth/login", { email, password: "Password123!" });
  if (!r.body?.token) throw new Error(`could not sign in as ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token;
}
const as = (token: string) => ({
  get: (path: string) => call("GET", path, undefined, { authorization: `Bearer ${token}` }),
  post: (path: string, body: unknown = {}) => call("POST", path, body, { authorization: `Bearer ${token}` }),
  patch: (path: string, body: unknown) => call("PATCH", path, body, { authorization: `Bearer ${token}` }),
  del: (path: string) => call("DELETE", path, undefined, { authorization: `Bearer ${token}` }),
  fn: (name: string, body: unknown = {}) => call("POST", `/api/functions/${name}`, body, { authorization: `Bearer ${token}` }),
});
const ids = (rows: any[]) => (Array.isArray(rows) ? rows : []).map((r) => String(r.id)).sort();
const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const salesRefusal = (r: Res) => r.status === 403 && /Sales role/.test(JSON.stringify(r.body));

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
if (!/127\.0\.0\.1/.test(uri)) process.exit(1);

step("The role, made when the API started");
const made: any = await db.collection("commission_roles").findOne({ role_key: "sales" });
check("there is a Sales role", !!made && made.name === "Sales" && made.active === true, JSON.stringify(made));
check("…its scope is the students they closed", made?.data_scope === "closed");
check("…and its page the Students page", JSON.stringify(made?.page_permissions) === JSON.stringify(["Students"]));
check("the API made the closed_by index", (await db.collection("students").indexes()).some((i) => i.key?.["closed_by.email"] === 1));
// Everything else emptied; the role made at start stays, as on a real server.
for (const c of await db.listCollections().toArray()) if (c.name !== "commission_roles") await db.collection(c.name).deleteMany({});

step("Setting up");
const hash = await bcrypt.hash("Password123!", 10);
const now = "2026-10-01T08:00:00.000Z";
const person = (full_name: string, email: string, app_role: string) => ({
  _id: new ObjectId(), email, full_name, app_role, password_hash: hash, commission_rate: 4, status: "active", created_date: now, updated_date: now,
});
const admin = person("Super Admin", "admin@e2e-sales.test", "super_admin");
const cs = person("Cee Ess", "cs@e2e-sales.test", "junior_mentor");
const aisha = person("Aisha Sales", "aisha@crm.e2e.test", "sales");
const bilal = person("Bilal Sales", "bilal@crm.e2e.test", "sales");
const senior = person("Senior Mentor", "senior@e2e-sales.test", "senior_mentor");
await db.collection("users").insertMany([admin, cs, aisha, bilal, senior] as any[]);
// "closed" set on a built-in role by hand: not honoured — built-in mentor students are not scoped on the backend.
await db.collection("commission_roles").insertOne({ role_key: "senior_mentor", name: "Senior Mentor", data_scope: "closed", page_permissions: ["Students"], active: true } as any);

const closer = (who: any, crm = "delta") => ({ email: who.email, name: who.full_name, crm });
const student = (n: number, closed_by: any[] | undefined, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), student_code: `STU-${String(n).padStart(4, "0")}`, full_name: `Student ${n}`, email: `student${n}@e2e-sales.test`,
  phone: `+9715000000${n}`, primary_mentor_id: String(cs._id), primary_mentor_name: cs.full_name, status: "ACTIVE",
  created_date: `2026-09-2${5 + n}T08:00:00.000Z`, finance_invoice_id: new ObjectId().toString(), ...(closed_by ? { closed_by } : {}), ...extra,
});
const s1 = student(1, [closer(aisha)]);
const s2 = student(2, [closer(bilal, "draw")], { sales_crm: "draw" });
const s3 = student(3, [closer(bilal, "remote"), closer(aisha)], { onboarded: true });
const s4 = student(4, undefined);
await db.collection("students").insertMany([s1, s2, s3, s4] as any[]);
const sid = (s: any) => String(s._id);
const deposit = (s: any, amount: number) => ({ _id: new ObjectId(), student_id: sid(s), student_name: s.full_name, type: "DEPOSIT", status: "APPROVED", amount_usd: amount, primary_mentor_id: String(cs._id), requested_at: now, created_date: now });
const d1 = deposit(s1, 500), d2 = deposit(s2, 900);
await db.collection("funding_transactions").insertMany([d1, d2] as any[]);
const m1 = { _id: new ObjectId(), student_id: sid(s1), mt5_login: "7001", created_date: now };
const m2 = { _id: new ObjectId(), student_id: sid(s2), mt5_login: "7002", created_date: now };
await db.collection("mt5_accounts").insertMany([m1, m2] as any[]);
const followup = (s: any) => ({ _id: new ObjectId(), student_id: sid(s), target_outcome: "Deposit", stage: "Contacted", next_followup_date: "2026-10-10", created_date: now });
await db.collection("student_followups").insertMany([followup(s1), followup(s2)] as any[]);
const callOf = (s: any, mins: number) => ({ _id: new ObjectId(), key: `e2e-call-${sid(s)}`, student_id: sid(s), user_id: String(cs._id), user_name: cs.full_name, direction: "out", status: "answered", started_at: new Date(Date.now() - mins * 60_000).toISOString(), talk_seconds: 60 });
const c1 = callOf(s1, 30), c2 = callOf(s2, 20);
await db.collection("student_calls").insertMany([c1, c2] as any[]);
await db.collection("student_logs").insertOne({ student_id: sid(s1), note: "a log", created_date: now } as any);
const n1 = { _id: new ObjectId(), user_id: String(aisha._id), title: "For Aisha", read: false, created_date: now };
const n2 = { _id: new ObjectId(), user_id: String(cs._id), title: "For the CS", read: false, created_date: now };
await db.collection("notifications").insertMany([n1, n2] as any[]);

const A = as(await login(aisha.email));
const B = as(await login(bilal.email));
const C = as(await login(cs.email));
const X = as(await login(admin.email));
const SM = as(await login(senior.email));

step("Who they are");
check("/me says Aisha's scope is closed", (await A.get("/api/auth/me")).body?.data_scope === "closed");
check("a built-in role set to closed by hand keeps its own (Senior Mentor: own)", (await SM.get("/api/auth/me")).body?.data_scope === "own");

step("The Students list: the students they closed");
let r = await A.fn("listStudents", {});
check("one list for them — all of theirs", r.status === 200 && JSON.stringify(r.body?.tabs) === JSON.stringify(["all"]), JSON.stringify(r.body?.tabs));
check("Aisha: students 1 and 3", same(ids(r.body?.rows), [sid(s1), sid(s3)]), JSON.stringify(ids(r.body?.rows)));
check("…each with who closed them", (r.body?.rows ?? []).every((s: any) => Array.isArray(s.closed_by) && s.closed_by.length > 0));
r = await B.fn("listStudents", {});
check("Bilal: students 2 and 3 (3 is both of theirs)", same(ids(r.body?.rows), [sid(s2), sid(s3)]), JSON.stringify(ids(r.body?.rows)));
check("a CS's own list is not theirs to ask for", (await A.fn("listStudents", { tab: "my" })).status === 403);
r = await A.fn("getStudentListOptions", {});
check("the filters' choices come from their students only", r.status === 200 && JSON.stringify(r.body?.mentors) === JSON.stringify([cs.full_name]));
r = await A.fn("findStudentByEmail", { email: s2.email });
check("looking up a student who is not theirs finds nobody", r.status === 200 && !r.body?.student, JSON.stringify(r.body));

step("Entities: theirs, and nobody else's");
r = await A.get("/api/entities/Student");
check("Student list: 1 and 3", same(ids(r.body), [sid(s1), sid(s3)]), JSON.stringify(ids(r.body)));
check("Student 1 by id: yes", (await A.get(`/api/entities/Student/${sid(s1)}`)).status === 200);
check("Student 2 by id: no", (await A.get(`/api/entities/Student/${sid(s2)}`)).status === 403);
check("Student 4 (closed by nobody) by id: no", (await A.get(`/api/entities/Student/${sid(s4)}`)).status === 403);
r = await A.post("/api/entities/Student/filter", { query: {} });
check("filtering for everyone still gives only theirs", same(ids(r.body), [sid(s1), sid(s3)]));
r = await A.get("/api/entities/FundingTransaction");
check("deposits: their students' only", same(ids(r.body), [String(d1._id)]), JSON.stringify(ids(r.body)));
check("another student's deposit by id: no", (await A.get(`/api/entities/FundingTransaction/${String(d2._id)}`)).status === 403);
r = await A.get("/api/entities/MT5Account");
check("MT5 accounts: their students' only", same(ids(r.body), [String(m1._id)]), JSON.stringify(ids(r.body)));
for (const e of ["User", "StudentLog", "Ticket", "StudentRequest", "ActivityLog", "MentorTarget", "RetentionAssignment"]) {
  r = await A.get(`/api/entities/${e}`);
  check(`${e}: nothing`, r.status === 200 && Array.isArray(r.body) && r.body.length === 0, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
}
r = await A.get("/api/entities/CommissionRole");
check("the roles (for the sidebar): yes", r.status === 200 && r.body.some((x: any) => x.role_key === "sales"));
r = await A.get("/api/entities/Notification");
check("notifications: their own only", same(ids(r.body), [String(n1._id)]), JSON.stringify(ids(r.body)));

step("They change nothing");
check("adding a student: refused", salesRefusal(await A.post("/api/entities/Student", { full_name: "New", email: "new@e2e-sales.test" })));
check("adding students in bulk: refused", salesRefusal(await A.post("/api/entities/Student/bulk", [{ full_name: "New", email: "new2@e2e-sales.test" }])));
check("a deposit request: refused", salesRefusal(await A.post("/api/entities/FundingTransaction", { student_id: sid(s1), type: "DEPOSIT", amount_usd: 10 })));
check("an MT5 account: refused", salesRefusal(await A.post("/api/entities/MT5Account", { student_id: sid(s1), mt5_login: "9999" })));
check("a ticket: refused", salesRefusal(await A.post("/api/entities/Ticket", { subject: "hi" })));
check("changing their own student: refused", (await A.patch(`/api/entities/Student/${sid(s1)}`, { notes: "changed" })).status === 403);
check("changing a deposit: refused", (await A.patch(`/api/entities/FundingTransaction/${String(d1._id)}`, { amount_usd: 1 })).status === 403);
check("deleting a student: refused", (await A.del(`/api/entities/Student/${sid(s1)}`)).status === 403);
check("their own notification, marked read: yes", (await A.patch(`/api/entities/Notification/${String(n1._id)}`, { read: true })).status === 200);
check("somebody else's notification: no", (await A.patch(`/api/entities/Notification/${String(n2._id)}`, { read: true })).status === 403);
const untouched: any = await db.collection("students").findOne({ _id: s1._id });
check("…and the student is as they were", !untouched?.notes && (await db.collection("students").countDocuments()) === 4);
for (const [name, body] of [
  ["setEnrolment", { studentId: sid(s1), status: "old" }],
  ["setStudentTag", { studentId: sid(s1), tag: "VIP", on: true }],
  ["setOnboarding", { studentId: sid(s1), mark: true }],
  ["updateStudentDetails", { studentId: sid(s1), phone: "+971500000000" }],
  ["createFollowup", { studentId: sid(s1), target_outcome: "Deposit" }],
  ["logFollowup", { followupId: String(new ObjectId()) }],
  ["callStudent", { studentId: sid(s1) }],
  ["requestPaymentLink", { studentId: sid(s1), amount: 100 }],
  ["createReferralRequest", { student_id: sid(s1), receiving_mentor_id: String(aisha._id) }],
  ["answerLmsTicket", { studentId: sid(s1), ticketId: "a".repeat(24), body: "hello" }],
  ["resolveLmsTicket", { studentId: sid(s1), ticketId: "a".repeat(24) }],
  ["searchStudents", { q: "Student" }],
  ["markStudentSeen", { id: sid(s1) }],
] as const) {
  const res = await A.fn(name, body);
  check(`${name}: refused`, salesRefusal(res), `${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
}
r = await A.fn("getMentorSchedule", {});
check("the Mentor Calendar (the Sales CRM's) is still theirs to use", !salesRefusal(r), `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

step("The student page: everything on it, read");
r = await A.fn("getStudentHistory", { studentId: sid(s1) });
check("history of student 1: yes", r.status === 200, `${r.status}`);
check("history of student 2: no", (await A.fn("getStudentHistory", { studentId: sid(s2) })).status === 403);
r = await A.fn("getFollowups", { studentId: sid(s1) });
check("student 1's follow-up: yes, to read", r.status === 200 && r.body?.followups?.length === 1 && r.body.followups[0].can_edit === false, JSON.stringify(r.body?.followups));
r = await A.fn("getFollowups", { studentId: sid(s2) });
check("student 2's: none", r.status === 200 && r.body?.followups?.length === 0, JSON.stringify(r.body?.followups));
r = await A.fn("getFollowups", {});
check("all their follow-ups: student 1's only", r.status === 200 && same((r.body?.followups ?? []).map((f: any) => f.student_id), [sid(s1)]));
r = await A.fn("getCalls", { studentId: sid(s1) });
check("student 1's calls: yes", r.status === 200 && JSON.stringify(r.body).includes(String(c1._id)), `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
r = await A.fn("getCalls", { studentId: sid(s2) });
check("student 2's calls: none", r.status === 200 && !JSON.stringify(r.body).includes(String(c2._id)));
r = await A.fn("getCalls", { range: "7" });
check("all their calls: student 1's, not student 2's", r.status === 200 && JSON.stringify(r.body).includes(String(c1._id)) && !JSON.stringify(r.body).includes(String(c2._id)));
r = await A.fn("getCallRecording", { callId: String(c2._id) });
check("a recording of another student's call: no", r.status === 403, `${r.status}`);
r = await A.fn("getStudentLmsCourses", { studentId: sid(s1) });
check("student 1's LMS courses: asked (no LMS here — not refused)", r.status !== 403, `${r.status}`);
check("student 2's LMS courses: no", (await A.fn("getStudentLmsCourses", { studentId: sid(s2) })).status === 403);
r = await A.fn("getPaymentLinks", { studentId: sid(s1) });
check("student 1's payment links: to read, not to ask for", r.status === 200 && r.body?.can_request === false && r.body?.can_approve === false, JSON.stringify(r.body));
r = await A.fn("getNotOnboarded", {});
check("not onboarded: student 1 (3 is onboarded; 2 is not theirs)", r.status === 200 && same(ids(r.body?.rows), [sid(s1)]), JSON.stringify(ids(r.body?.rows)));
const row1 = (r.body?.rows ?? [])[0];
check("…saying who closed them, and the CRM they came through (Delta's, for one from before finance said)",
  row1?.closed_by?.[0]?.email === aisha.email && row1?.sales_crm === "delta", JSON.stringify({ closed_by: row1?.closed_by, sales_crm: row1?.sales_crm }));
check("WhatsApp chats stay each CS's own", (await A.fn("getStudentWhatsApp", { studentId: sid(s1) })).status === 403);

step("Everyone else, as before");
r = await C.fn("listStudents", { tab: "my" });
check("the CS: all four of theirs", r.status === 200 && r.body?.total === 4, `${r.status} ${r.body?.total}`);
r = await C.get("/api/entities/Student");
check("the CS's entity list is not scoped (a built-in role)", Array.isArray(r.body) && r.body.length === 4);
check("the CS changes their student as before", (await C.fn("setEnrolment", { studentId: sid(s4), status: "old" })).status === 200);
r = await X.fn("listStudents", { tab: "all" });
check("the admin: all four", r.status === 200 && r.body?.total === 4);
r = await X.fn("getNotOnboarded", {});
const row2 = (r.body?.rows ?? []).find((x: any) => x.id === sid(s2));
check("the admin's Not onboarded: Draw's student says Draw, closed by Bilal", row2?.sales_crm === "draw" && row2?.closed_by?.[0]?.name === bilal.full_name, JSON.stringify(row2));
r = await SM.get("/api/entities/Student");
check("Senior Mentor (closed set by hand): unscoped, as before", Array.isArray(r.body) && r.body.length === 4);

step("Finance: who closed it");
const send = (body: unknown) => call("POST", "/api/v1/integrations/finance/students", body, { "x-finance-secret": FINANCE_SECRET });
// A team, so the new student has somewhere to go (a chief and their CS).
const chief = person("Chief One", "chief@e2e-sales.test", "chief_mentor");
await db.collection("users").insertOne({ ...chief, team_name: "Team One" } as any);
await db.collection("users").updateOne({ _id: cs._id }, { $set: { up_head_id: String(chief._id), up_head_name: chief.full_name } });
const inv = new ObjectId().toString();
const enrolment = (over: Record<string, unknown> = {}) => ({
  invoiceId: inv, invoiceNumber: "INV-0100", email: "fresh@e2e-sales.test", name: "Fresh Student", phone: "+971500001234",
  country: "United Arab Emirates", course: "Delta Wave Theory Trading Programme", crm: "delta", lmsUserId: new ObjectId().toString(), ...over,
});
r = await send(enrolment({ closedBy: { email: "  Aisha@CRM.e2e.test ", name: "Aisha Sales", crm: "delta" } }));
check("a new student from finance", r.status === 200 && r.body?.data?.created === true, `${r.status} ${JSON.stringify(r.body)}`);
let fresh: any = await db.collection("students").findOne({ finance_invoice_id: inv });
check("…with who closed it, the email as one", JSON.stringify(fresh?.closed_by) === JSON.stringify([{ email: aisha.email, name: "Aisha Sales", crm: "delta" }]), JSON.stringify(fresh?.closed_by));
r = await A.fn("listStudents", {});
check("…and in Aisha's list at once", ids(r.body?.rows).includes(String(fresh?._id)));
await send(enrolment({ closedBy: { email: aisha.email, name: "Aisha Sales", crm: "delta" } }));
fresh = await db.collection("students").findOne({ finance_invoice_id: inv });
check("the same invoice again: Aisha once", fresh?.closed_by?.length === 1);
await send(enrolment({ invoiceId: new ObjectId().toString(), invoiceNumber: "INV-0101", closedBy: { email: bilal.email, name: "Bilal Sales", crm: "remote" } }));
fresh = await db.collection("students").findOne({ _id: fresh._id });
check("a second course, closed by Bilal (an email already here): both of them", same((fresh?.closed_by ?? []).map((c: any) => c.email), [aisha.email, bilal.email]), JSON.stringify(fresh?.closed_by));
await send(enrolment({ invoiceId: new ObjectId().toString(), invoiceNumber: "INV-0102", closedBy: { email: bilal.email, name: "Bilal Sales", crm: "remote" } }));
fresh = await db.collection("students").findOne({ _id: fresh._id });
check("a third, Bilal again: still the two", fresh?.closed_by?.length === 2);
const inv2 = new ObjectId().toString();
await send(enrolment({ invoiceId: inv2, invoiceNumber: "INV-0103", email: "nobody@e2e-sales.test", closedBy: { email: "not an email", name: "?" } }));
const noCloser: any = await db.collection("students").findOne({ finance_invoice_id: inv2 });
check("a closedBy with no real email: the student, and nobody as closer", !!noCloser && !noCloser.closed_by, JSON.stringify(noCloser?.closed_by));
const inv3 = new ObjectId().toString();
await send(enrolment({ invoiceId: inv3, invoiceNumber: "INV-0104", email: "older@e2e-sales.test" }));
const older: any = await db.collection("students").findOne({ finance_invoice_id: inv3 });
check("finance saying nothing (an older finance): the student as ever", !!older && !older.closed_by);

step("The Root portal can give somebody the Sales role");
const service = (method: string, path: string, body?: unknown) => call(method, `/api/v1/service${path}`, body, { "x-portal-secret": PORTAL_SECRET });
r = await service("GET", "/roles");
const listed = (r.body?.data?.roles ?? []).find((x: any) => x.key === "sales");
check("Sales is among the roles", !!listed && listed.isSystem === false && /closed/.test(listed.description), JSON.stringify(listed));
r = await service("POST", "/provision-user", { email: "New.Rep@CRM.e2e.test", name: "New Rep", role: "sales" });
check("a new account as Sales", r.status === 200 && r.body?.data?.created === true, `${r.status} ${JSON.stringify(r.body)}`);
const rep: any = await db.collection("users").findOne({ email: "new.rep@crm.e2e.test" });
check("…with the role", rep?.app_role === "sales" && rep?.created_via === "root-portal");
r = await service("POST", "/provision-user", { email: cs.email, name: "Cee Ess", role: "sales" });
check("somebody already here keeps their role", r.body?.data?.created === false && (await db.collection("users").findOne({ _id: cs._id }) as any)?.app_role === "junior_mentor");

await client.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
