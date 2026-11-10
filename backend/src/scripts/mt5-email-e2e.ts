/**
 * A student's two emails (the user, 2026-11-10) — end to end, against a real API process:
 *
 *   - `email` stays the primary one, their LMS email; `mt5_email` is the email their MT5 account is under, kept on the
 *     student — one address, lower-cased; an edit is in their history; empty means their LMS email is used;
 *   - every funding request keeps the MT5 email it went on: as typed on the form, else the student's MT5 email, else
 *     their LMS email; one typed for a student with none yet is kept as theirs (never their LMS email, never over one
 *     they have); not one address: refused, nothing raised;
 *   - a course payment sent to finance still names the student by their LMS email (finance invoices that client), and
 *     carries the MT5 email beside it;
 *   - their CS sets it on Edit details (updateStudentDetails); MT5 Approvals shows and finds it; a co-management
 *     request, once approved, goes on the student's MT5 email too.
 *
 * Run through ./test-mt5-email.sh (throwaway mongod, the API, a stand-in finance — no .env).
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

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
async function until(fn: () => Promise<boolean>, ms = 4000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  return fn();
}

/* A stand-in finance that takes whatever it is sent (the signature is finance-funding-e2e's to check). */
const received: any[] = [];
const finance = Bun.serve({
  port: Number(process.env.E2E_FAKE_FINANCE_PORT),
  async fetch(req) {
    const body = JSON.parse(await req.text());
    received.push(body);
    return Response.json({ data: { id: `fin-${received.length}`, status: "pending", externalId: body.externalId } });
  },
});

type Res = { status: number; body: any };
async function call(method: string, path: string, token: string, body?: unknown): Promise<Res> {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function login(email: string): Promise<string> {
  const r = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "Password123!" }) });
  const token = ((await r.json().catch(() => ({}))) as any).token;
  if (!token) throw new Error(`could not sign in as ${email}: ${r.status}`);
  return token;
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
for (const c of await db.listCollections().toArray()) if (c.name !== "commission_roles") await db.collection(c.name).deleteMany({});

step("Setting up");
const hash = await bcrypt.hash("Password123!", 10);
const now = "2026-11-01T08:00:00.000Z";
const person = (full_name: string, email: string, app_role: string) => ({
  _id: new ObjectId(), email, full_name, app_role, password_hash: hash, commission_rate: 4, status: "active", created_date: now, updated_date: now,
});
const admin = person("Super Admin", "admin@e2e-mt5mail.test", "super_admin");
const cs = person("Cee Ess", "cs@e2e-mt5mail.test", "junior_mentor");
const other = person("Other Mentor", "other@e2e-mt5mail.test", "junior_mentor");
await db.collection("users").insertMany([admin, cs, other] as any[]);
const student = (n: number, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), student_code: `STU-${String(n).padStart(4, "0")}`, full_name: `Student ${n}`, email: `lms${n}@e2e-mt5mail.test`,
  phone: `+9715000000${n}`, primary_mentor_id: String(cs._id), primary_mentor_name: cs.full_name, status: "ACTIVE", created_date: now, ...extra,
});
const sA = student(1);                                            // no MT5 email yet
const sB = student(2, { mt5_email: "mt5-2@broker.test" });        // has one
const sC = student(3, { email: "" });                             // no email at all
const sD = student(4);
await db.collection("students").insertMany([sA, sB, sC, sD] as any[]);
const sid = (s: any) => String(s._id);
const tAdmin = await login(admin.email);
const tCs = await login(cs.email);
check("signed in", !!tAdmin && !!tCs);
const studentOf = (s: any) => db.collection("students").findOne({ _id: s._id }) as Promise<any>;
const historyOf = (s: any) => db.collection("student_history").find({ student_id: sid(s), type: "details_changed" }).sort({ at: 1 }).toArray() as Promise<any[]>;
const edit = (s: any, data: Record<string, unknown>) => call("PATCH", `/api/entities/Student/${sid(s)}`, tAdmin, data);

step("The student's MT5 email, set on the Edit Student form");
let r = await edit(sA, { mt5_email: "  MT5-1@Broker.TEST " });
let a: any = await studentOf(sA);
check("saved, trimmed and lower-cased", r.status === 200 && a.mt5_email === "mt5-1@broker.test", JSON.stringify(r.body).slice(0, 200));
check("…their LMS email as it was", a.email === "lms1@e2e-mt5mail.test");
let h = await historyOf(sA);
check("…in their history, from and to", h.length === 1 && /MT5 email: none → mt5-1@broker\.test/.test(h[0].text) && h[0].by_name === admin.full_name, JSON.stringify(h));
r = await edit(sA, { mt5_email: "a@one.test, b@two.test" });
check("two addresses: refused", r.status === 400 && /one email address/.test(r.body?.error ?? ""), JSON.stringify(r.body));
r = await edit(sA, { mt5_email: "not an email" });
check("not an address: refused", r.status === 400 && /one email address/.test(r.body?.error ?? ""));
check("…nothing changed", (await studentOf(sA)).mt5_email === "mt5-1@broker.test" && (await historyOf(sA)).length === 1);
r = await edit(sA, { ...(await studentOf(sA)), _id: undefined, id: sid(sA), full_name: "Student 1" });
check("the whole form saved again, MT5 email the same: no history line", r.status === 200 && (await historyOf(sA)).length === 1);
r = await edit(sA, { mt5_email: "" });
a = await studentOf(sA);
h = await historyOf(sA);
check("emptied: their LMS email is used, said so", r.status === 200 && a.mt5_email === "" && h.length === 2 && /none \(their LMS email is used\)/.test(h[1].text), JSON.stringify(h.map((x) => x.text)));

step("A new student with an MT5 email");
r = await call("POST", "/api/entities/Student", tAdmin, { full_name: "Student 9", email: "lms9@e2e-mt5mail.test", mt5_email: "MT5-9@Broker.test", status: "ACTIVE" });
check("made, the MT5 email lower-cased", r.status === 200 && r.body?.mt5_email === "mt5-9@broker.test" && r.body?.email === "lms9@e2e-mt5mail.test", JSON.stringify(r.body).slice(0, 200));
r = await call("POST", "/api/entities/Student", tAdmin, { full_name: "Student 10", email: "lms10@e2e-mt5mail.test", mt5_email: "nope" });
check("not an address: refused, not made", r.status === 400 && /one email address/.test(r.body?.error ?? "") && !(await db.collection("students").findOne({ email: "lms10@e2e-mt5mail.test" })));
r = await call("POST", "/api/entities/Student/bulk", tAdmin, [{ full_name: "Student 11", email: "lms11@e2e-mt5mail.test", mt5_email: "x@y" }]);
check("imported with one that isn't an address: refused", r.status === 400 && /one email address/.test(r.body?.error ?? "") && !(await db.collection("students").findOne({ email: "lms11@e2e-mt5mail.test" })), `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

step("Funding requests go on the MT5 email");
const request = (s: any, extra: Record<string, unknown> = {}) => call("POST", "/api/entities/FundingTransaction", tCs, {
  type: "DEPOSIT", status: "PENDING", student_id: sid(s), student_name: s.full_name, student_code: s.student_code, amount_usd: 100 + Math.round(Math.random() * 900),
  payment_method: "USDT", mt5_login: "7001001", screenshot_url: "http://127.0.0.1/uploads/proof.png", primary_mentor_id: String(cs._id),
  requested_by_id: String(cs._id), requested_at: new Date().toISOString(), ...extra,
});
const txOf = (id: string) => db.collection("funding_transactions").findOne({ _id: new ObjectId(id) }) as Promise<any>;
r = await request(sB);
check("none typed, the student has an MT5 email: that one", r.status === 200 && (await txOf(r.body.id))?.mt5_email === "mt5-2@broker.test", JSON.stringify(r.body).slice(0, 200));
r = await request(sA);
check("none typed, they have none: their LMS email", r.status === 200 && (await txOf(r.body.id))?.mt5_email === "lms1@e2e-mt5mail.test");
check("…and their LMS email isn't made their MT5 email", (await studentOf(sA)).mt5_email === "");
r = await request(sA, { mt5_email: " Typed-1@Broker.TEST" });
check("typed: the request goes on it, lower-cased", r.status === 200 && (await txOf(r.body.id))?.mt5_email === "typed-1@broker.test");
a = await studentOf(sA);
h = await historyOf(sA);
check("…kept as theirs — they had none", a.mt5_email === "typed-1@broker.test" && a.email === "lms1@e2e-mt5mail.test", JSON.stringify(a));
check("…in their history, by who raised it", /MT5 email: none → typed-1@broker\.test \(from a funding request\)/.test(h[h.length - 1]?.text ?? "") && h[h.length - 1]?.by_name === cs.full_name, JSON.stringify(h.map((x) => x.text)));
r = await request(sA, { mt5_email: "other-1@broker.test" });
check("another typed: this request goes on it…", r.status === 200 && (await txOf(r.body.id))?.mt5_email === "other-1@broker.test");
check("…theirs stays as it was", (await studentOf(sA)).mt5_email === "typed-1@broker.test");
r = await request(sD, { mt5_email: "LMS4@e2e-mt5mail.test" });
check("their LMS email typed: the request on it, not kept as an MT5 email", r.status === 200 && (await txOf(r.body.id))?.mt5_email === "lms4@e2e-mt5mail.test" && !(await studentOf(sD)).mt5_email);
r = await request(sB, { mt5_email: "lms2@e2e-mt5mail.test" });
check("a student with an MT5 email, their LMS email typed: the request on it, theirs unchanged", r.status === 200 && (await txOf(r.body.id))?.mt5_email === "lms2@e2e-mt5mail.test" && (await studentOf(sB)).mt5_email === "mt5-2@broker.test");
r = await request(sC, { type: "WITHDRAWAL", screenshot_url: "" });
check("a student with no email at all: raised, no MT5 email on it", r.status === 200 && !("mt5_email" in ((await txOf(r.body.id)) ?? {})));
const count = await db.collection("funding_transactions").countDocuments({});
r = await request(sA, { mt5_email: "a@one.test; b@two.test" });
check("typed, not one address: refused", r.status === 400 && /one email address/.test(r.body?.error ?? ""), JSON.stringify(r.body));
check("…nothing raised", (await db.collection("funding_transactions").countDocuments({})) === count);
r = await call("POST", "/api/entities/FundingTransaction/bulk", tCs, [{ type: "DEPOSIT", status: "PENDING", student_id: sid(sB), amount_usd: 5, mt5_email: "bad" }]);
check("imported with one that isn't an address: refused", r.status === 400 && /one email address/.test(r.body?.error ?? "") && (await db.collection("funding_transactions").countDocuments({})) === count, `${r.status} ${JSON.stringify(r.body)}`);
r = await call("POST", "/api/entities/FundingTransaction/bulk", tCs, [{ type: "DEPOSIT", status: "PENDING", student_id: sid(sB), amount_usd: 5 }]);
check("imported with none: the student's MT5 email", r.status === 200 && (await db.collection("funding_transactions").findOne({ amount_usd: 5 }))?.mt5_email === "mt5-2@broker.test", JSON.stringify(r.body).slice(0, 160));
const one: any = await db.collection("funding_transactions").findOne({ student_id: sid(sB) });
r = await call("PATCH", `/api/entities/FundingTransaction/${String(one._id)}`, tAdmin, { mt5_email: "  Fixed-2@Broker.test " });
check("changed on a request: tidied", r.status === 200 && (await txOf(String(one._id)))?.mt5_email === "fixed-2@broker.test", JSON.stringify(r.body).slice(0, 160));
r = await call("PATCH", `/api/entities/FundingTransaction/${String(one._id)}`, tAdmin, { mt5_email: "nope" });
check("…to one that isn't an address: refused", r.status === 400 && (await txOf(String(one._id)))?.mt5_email === "fixed-2@broker.test");

step("A course payment at finance: the invoice on the LMS email, the MT5 email beside it");
const coursePayment = {
  product: "DWT", kind: "partial", with_bonus: true, bonus_usd: 500, hold_aed: 0, balance_aed: 1250,
  paid_today_aed: 2000, paid_before_aed: 0, paid_total_aed: 2000, price: 3250, price_currency: "AED", instalments: 2,
};
r = await request(sB, { type: "BONUS", tags: ["Course"], amount_usd: 544.96, amount_original: 2000, amount_currency: "AED", course_payment: coursePayment, meeting_mentor_none: true });
check("raised", r.status === 200, JSON.stringify(r.body).slice(0, 200));
check("sent to finance", await until(async () => received.length > 0));
const sent = received[0];
check("the student by their LMS email (whom finance invoices)", sent?.student?.email === "lms2@e2e-mt5mail.test", JSON.stringify(sent?.student));
check("…their MT5 email beside it", sent?.mt5Email === "mt5-2@broker.test", String(sent?.mt5Email));

step("Their CS sets it on Edit details");
const details = (s: any, body: Record<string, unknown>) => call("POST", "/api/functions/updateStudentDetails", tCs, { studentId: sid(s), ...body });
r = await details(sD, { mt5_email: " CS-Set@Broker.TEST " });
let d: any = await studentOf(sD);
h = await historyOf(sD);
check("saved, lower-cased", r.status === 200 && d.mt5_email === "cs-set@broker.test" && d.email === "lms4@e2e-mt5mail.test", JSON.stringify(r.body));
check("…in their history, by their CS", /MT5 email: none → cs-set@broker\.test/.test(h[h.length - 1]?.text ?? "") && h[h.length - 1]?.by_name === cs.full_name, JSON.stringify(h.map((x) => x.text)));
r = await details(sD, { mt5_email: "two@a.test b@c.test" });
check("not one address: refused, unchanged", r.status === 400 && /one email address/.test(r.body?.error ?? "") && (await studentOf(sD)).mt5_email === "cs-set@broker.test", JSON.stringify(r.body));
r = await details(sD, { email: "lms4-new@e2e-mt5mail.test" });
h = await historyOf(sD);
check("the LMS email changed: called that in their history, the MT5 email left alone", r.status === 200 && /LMS email: lms4@e2e-mt5mail\.test → lms4-new@e2e-mt5mail\.test/.test(h[h.length - 1]?.text ?? "") && (await studentOf(sD)).mt5_email === "cs-set@broker.test", JSON.stringify(h.map((x) => x.text)));
r = await details(sD, { full_name: "Student 4", email: "lms4-new@e2e-mt5mail.test", mt5_email: "cs-set@broker.test", phone: (sD as any).phone, country: "", language: "" });
check("the whole dialog saved, nothing different: unchanged", r.status === 200 && r.body?.unchanged === true, JSON.stringify(r.body));
r = await details(sD, { mt5_email: "" });
check("emptied: their LMS email is used again", r.status === 200 && (await studentOf(sD)).mt5_email === "");

step("MT5 Approvals shows it");
// Finance has decided these already (a bonus with finance waits there before it is listed here).
await db.collection("funding_transactions").insertMany([
  { type: "BONUS", status: "PENDING", student_id: sid(sB), student_name: sB.full_name, student_code: sB.student_code, amount_usd: 50, mt5_login: "7002222", tags: ["Course"], requested_at: new Date().toISOString(), created_date: new Date().toISOString() },
  { type: "BONUS", status: "PENDING", student_id: sid(sB), student_name: sB.full_name, student_code: sB.student_code, amount_usd: 55, mt5_login: "7002111", mt5_email: "own-2@broker.test", tags: ["Course"], requested_at: new Date().toISOString(), created_date: new Date().toISOString() },
] as any[]);
r = await call("POST", "/api/functions/getBonusApprovals", tAdmin, {});
const listed = (b: any): any[] => ["pending", "approved", "rejected", "returned"].flatMap((k) => (Array.isArray(b?.[k]) ? b[k] : []));
const rows = listed(r.body);
const viaRequest = rows.find((t) => t.mt5_login === "7002111");
const older = rows.find((t) => t.mt5_login === "7002222");
check("a bonus raised with its own: that one, not the student's", r.status === 200 && viaRequest?.mt5_email === "own-2@broker.test", `${r.status} ${Object.keys(r.body ?? {}).join(",")} ${JSON.stringify(viaRequest?.mt5_email)}`);
check("one from before (none on it): the student's MT5 email", older?.mt5_email === "mt5-2@broker.test", JSON.stringify(older?.mt5_email));
await db.collection("funding_transactions").insertOne({ type: "BONUS", status: "APPROVED", approved_at: "2026-01-05T08:00:00.000Z", student_id: sid(sA), student_name: sA.full_name, student_code: sA.student_code, amount_usd: 60, mt5_login: "7001999", mt5_email: "old-only@broker.test", tags: ["Course"], created_date: "2026-01-05T08:00:00.000Z" } as any);
r = await call("POST", "/api/functions/getBonusApprovals", tAdmin, { search: "old-only@broker" });
const foundRows = listed(r.body);
check("an older approved one found by its MT5 email", r.status === 200 && foundRows.some((t) => t.mt5_login === "7001999"), JSON.stringify(foundRows.map((t) => t.mt5_login)));

step("A co-management request goes on the student's MT5 email");
const tOther = await login(other.email);
r = await call("POST", "/api/functions/createReferralRequest", tOther, {
  student_id: sid(sB), student_name: sB.full_name, student_code: sB.student_code, receiving_mentor_id: String(cs._id), receiving_mentor_name: cs.full_name,
  requested_deposit_amount: 275, payment_method: "UPI", mt5_login: "7002333", screenshot_url: "http://127.0.0.1/uploads/proof.png", transaction_type: "DEPOSIT",
});
const referralId = r.body?.referral?.id;
check("asked", r.status === 200 && !!referralId, JSON.stringify(r.body).slice(0, 200));
r = await call("POST", "/api/functions/processReferralResponse", tCs, { referral_id: referralId, action: "approve" });
const viaReferral: any = await db.collection("funding_transactions").findOne({ mt5_login: "7002333" });
check("approved: the request made with the student's MT5 email", r.status === 200 && viaReferral?.mt5_email === "mt5-2@broker.test", JSON.stringify({ status: r.status, mt5_email: viaReferral?.mt5_email }));

finance.stop(true);
await client.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
