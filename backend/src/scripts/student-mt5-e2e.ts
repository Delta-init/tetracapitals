/**
 * A student's MT5 accounts, kept from wherever their login is given — end to end, against a real API process
 * (students/mt5.ts, the call log, funding requests, co-management requests):
 *
 *   - the call log keeps the MT5 given, from a call that didn't connect too — the sales close's bonus waits for a
 *     call that connected, and then goes in the MT5 they have, once per invoice;
 *   - another student's MT5 is refused before anything is written; a login is digits only;
 *   - a funding request keeps the MT5 it names as the student's: the first is primary, spaces taken out, nothing
 *     twice, not another student's, not something that isn't a login;
 *   - a co-management request keeps its MT5 once approved, by the mentor who typed it — not before;
 *   - a student's accounts are asked for by student: theirs, and nobody else's.
 *
 * Run through ./test-student-mt5.sh (throwaway mongod, the API — no .env).
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
const now = "2026-10-01T08:00:00.000Z";
const person = (full_name: string, email: string, app_role: string) => ({
  _id: new ObjectId(), email, full_name, app_role, password_hash: hash, commission_rate: 4, status: "active", created_date: now, updated_date: now,
});
const admin = person("Super Admin", "admin@e2e-mt5.test", "super_admin");
const cs = person("Cee Ess", "cs@e2e-mt5.test", "junior_mentor");
const other = person("Other Mentor", "other@e2e-mt5.test", "junior_mentor");
await db.collection("users").insertMany([admin, cs, other] as any[]);
const student = (n: number, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), student_code: `STU-${String(n).padStart(4, "0")}`, full_name: `Student ${n}`, email: `student${n}@e2e-mt5.test`,
  phone: `+9715000000${n}`, primary_mentor_id: String(cs._id), primary_mentor_name: cs.full_name, status: "ACTIVE", created_date: now, ...extra,
});
// Student 1 was promised AED 1,835 of bonus at the sales close; student 2 nothing.
const s1 = student(1, { course_fees: [{ invoice_id: "inv-1", invoice_number: "IN-00001", course: "DSLP", bonus_given: true, bonus_minor: 183_500, bonus_currency: "AED" }] });
const s2 = student(2);
await db.collection("students").insertMany([s1, s2] as any[]);
const sid = (s: any) => String(s._id);
const followup = (s: any) => ({ _id: new ObjectId(), student_id: sid(s), target_outcome: "Onboarding call", stage: "New", followup_count: 0, next_followup_date: "2026-10-05", created_date: now });
const f1 = followup(s1), f2 = followup(s2);
await db.collection("student_followups").insertMany([f1, f2] as any[]);
const tCs = await login(cs.email);
const tOther = await login(other.email);
check("signed in", !!tCs && !!tOther);
const accounts = (s: any) => db.collection("mt5_accounts").find({ student_id: sid(s) }).sort({ created_date: 1 }).toArray() as Promise<any[]>;
const credits = (s: any) => db.collection("funding_transactions").find({ student_id: sid(s), bonus_credit: "sales_close" }).toArray() as Promise<any[]>;
const log = (f: any, extra: Record<string, unknown>) => call("POST", "/api/functions/logFollowup", tCs, { id: String(f._id), stage: "Contacted", ...extra });

step("The call log: a call that didn't connect");
let r = await log(f1, { connected: false, mt5Login: "700 1001" });
check("logged", r.status === 200 && r.body?.ok === true, JSON.stringify(r.body));
check("…its MT5 kept (spaces out), said so", r.body?.mt5_saved === true);
let a1 = await accounts(s1);
check("…as theirs, primary, from the call log", a1.length === 1 && a1[0].mt5_login === "7001001" && a1[0].is_primary === true && a1[0].source === "call log" && a1[0].created_by_name === cs.full_name, JSON.stringify(a1));
check("…the sales close's bonus waits for a call that connects", r.body?.bonus_credits === 0 && (await credits(s1)).length === 0);
r = await call("POST", "/api/functions/getFollowups", tCs, { studentId: sid(s1) });
check("the next call log shows it saved, not asked", JSON.stringify(r.body?.mt5) === JSON.stringify(["7001001"]), JSON.stringify(r.body?.mt5));

step("The call log: the call that connects — no MT5 given, they have one");
r = await log(f1, { connected: true });
check("logged", r.status === 200 && r.body?.ok === true, JSON.stringify(r.body));
let c1 = await credits(s1);
check("…the sales close's bonus sent to be credited, in the MT5 they have", r.body?.bonus_credits === 1 && c1.length === 1 && c1[0].mt5_login === "7001001" && c1[0].amount_usd === 500, JSON.stringify(c1));
r = await log(f1, { connected: true });
check("another call: once per invoice", r.body?.bonus_credits === 0 && (await credits(s1)).length === 1);
r = await log(f1, {});
check("a follow-up's own call (not asked whether it connected): nothing new either", r.status === 200 && r.body?.bonus_credits === 0 && (await credits(s1)).length === 1);

step("The call log: logins that aren't theirs to keep");
const before: any = await db.collection("student_followups").findOne({ _id: f2._id });
r = await log(f2, { connected: false, mt5Login: "7001001" });
check("another student's MT5: refused", r.status === 409 && /another student/.test(r.body?.error ?? ""), JSON.stringify(r.body));
check("…without saying whose", !/Student 1|STU-0001/.test(JSON.stringify(r.body)));
const after: any = await db.collection("student_followups").findOne({ _id: f2._id });
check("…and nothing written: the follow-up as it was, no account, no onboarding call", after.followup_count === before.followup_count && after.stage === "New" && (await accounts(s2)).length === 0 && !(await db.collection("students").findOne({ _id: s2._id }))?.onboarding_call);
check("…the MT5 still the first student's", (await accounts(s1)).length === 1);
r = await log(f2, { mt5Login: "12ab34" });
check("not a login number: refused", r.status === 400 && /digits only/.test(r.body?.error ?? ""), JSON.stringify(r.body));
r = await log(f1, { connected: false, mt5Login: "7001001" });
check("their own MT5 again: fine, nothing new", r.status === 200 && r.body?.mt5_saved === false && (await accounts(s1)).length === 1);
r = await log(f2, { connected: false });
check("a call that didn't connect, no MT5: logged, nothing kept", r.status === 200 && (await accounts(s2)).length === 0);

step("A funding request keeps its MT5 as the student's");
const request = (s: any, mt5_login: unknown, extra: Record<string, unknown> = {}) => call("POST", "/api/entities/FundingTransaction", tCs, {
  type: "DEPOSIT", status: "PENDING", student_id: sid(s), student_name: s.full_name, student_code: s.student_code, amount_usd: 100,
  payment_method: "USDT", mt5_login, screenshot_url: "http://127.0.0.1/uploads/proof.png", primary_mentor_id: String(cs._id),
  requested_by_id: String(cs._id), requested_at: now, ...extra,
});
r = await request(s2, "7002002");
check("raised", r.status === 200 && !!r.body?.id, JSON.stringify(r.body));
let a2 = await accounts(s2);
check("…its MT5 theirs now: primary, from a funding request, by who raised it", a2.length === 1 && a2[0].mt5_login === "7002002" && a2[0].is_primary === true && a2[0].source === "funding request" && a2[0].created_by === cs.email && a2[0].student_code === "STU-0002", JSON.stringify(a2));
r = await request(s2, " 7002 003 ");
a2 = await accounts(s2);
check("a second one, spaces out: kept, not primary", r.status === 200 && a2.length === 2 && a2[1].mt5_login === "7002003" && a2[1].is_primary === false, JSON.stringify(a2.map((a) => a.mt5_login)));
r = await request(s2, "7002002");
check("the same one again: raised, not kept twice", r.status === 200 && (await accounts(s2)).length === 2);
r = await request(s2, "7001001");
check("another student's MT5: the request stands, the MT5 stays theirs", r.status === 200 && (await accounts(s2)).length === 2 && (await accounts(s1)).length === 1);
r = await request(s2, "Delayed due to my travel");
check("not a login: the request stands, nothing kept", r.status === 200 && (await accounts(s2)).length === 2);
r = await request(s2, 7002005);
check("a login sent as a number: kept as text", r.status === 200 && (await accounts(s2)).some((a) => a.mt5_login === "7002005"));
r = await request(s2, "", { type: "WITHDRAWAL", screenshot_url: "" });
check("no MT5 at all: the request stands, nothing kept", r.status === 200 && (await accounts(s2)).length === 3);
r = await request({ ...s2, _id: new ObjectId() }, "7009999");
check("a student who isn't here: nothing kept", r.status === 200 && !(await db.collection("mt5_accounts").findOne({ mt5_login: "7009999" })));

step("A co-management request keeps its MT5 once approved");
r = await call("POST", "/api/functions/createReferralRequest", tOther, {
  student_id: sid(s2), student_name: s2.full_name, student_code: s2.student_code, receiving_mentor_id: String(cs._id), receiving_mentor_name: cs.full_name,
  requested_deposit_amount: 250, payment_method: "UPI", mt5_login: "7002004", screenshot_url: "http://127.0.0.1/uploads/proof.png", transaction_type: "DEPOSIT",
});
const referralId = r.body?.referral?.id;
check("asked", r.status === 200 && !!referralId, JSON.stringify(r.body));
check("…its MT5 not kept yet", !(await db.collection("mt5_accounts").findOne({ mt5_login: "7002004" })));
r = await call("POST", "/api/functions/processReferralResponse", tCs, { referral_id: referralId, action: "approve" });
check("approved by their CS", r.status === 200 && r.body?.success === true, JSON.stringify(r.body));
const viaReferral: any = await db.collection("mt5_accounts").findOne({ mt5_login: "7002004" });
check("…its MT5 theirs now, by the mentor who typed it", viaReferral?.student_id === sid(s2) && viaReferral.source === "co-management request" && viaReferral.created_by_name === other.full_name && viaReferral.created_by === other.email && viaReferral.is_primary === false, JSON.stringify(viaReferral));
check("…and the funding request made with it", !!(await db.collection("funding_transactions").findOne({ student_id: sid(s2), mt5_login: "7002004", initiating_mentor_id: String(other._id) })));

step("A student's accounts, asked for by student");
r = await call("POST", "/api/entities/MT5Account/filter", tCs, { query: { student_id: sid(s2) }, order: "created_date" });
const listed = (Array.isArray(r.body) ? r.body : []).map((a: any) => a.mt5_login);
check("theirs, oldest first — nobody else's", r.status === 200 && JSON.stringify(listed) === JSON.stringify(["7002002", "7002003", "7002005", "7002004"]), JSON.stringify(listed));
r = await call("POST", "/api/entities/MT5Account/filter", tOther, { query: { student_id: sid(s1) } });
check("…for any staff, as the MT5 list always was", r.status === 200 && Array.isArray(r.body) && r.body.length === 1 && r.body[0].mt5_login === "7001001");

await client.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
