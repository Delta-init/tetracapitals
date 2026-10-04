/**
 * Onboarding verification: a student promised an MT5 bonus at the sales close is onboarded only once a broker admin
 * approves it (students/bonusVerification.ts) — end to end against the API:
 *   - the Not onboarded page: waiting (no welcome yet), verifying (welcomed, bonus pending or rejected), approved
 *     this month; a student promised no bonus is onboarded by the welcome alone;
 *   - a broker admin rejects; the student's CS submits it again (resubmitSalesBonus) — with a note, a new MT5 login;
 *     who may, and what is refused;
 *   - finance's lookup carries onboarded / verification / bonuses, by finance's invoice id;
 *   - the 6-hour reminder to broker admins and Super Admins (students/bonusVerifyAlerts.ts): once, daytime only.
 * Run through ./test-bonus-verification.sh (throwaway mongod, the API — no .env). Scratch database only.
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
const SECRET = process.env.FINANCE_S2S_SECRET ?? "";

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
const as = (token: string) => ({ authorization: `Bearer ${token}` });
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
const now = new Date().toISOString();
const person = (full_name: string, email: string, app_role: string) => ({
  _id: new ObjectId(), email, full_name, app_role, password_hash: hash, commission_rate: 4, status: "active", created_date: now, updated_date: now,
});
const admin = person("Super Admin", "admin@e2e-verify.test", "super_admin");
const broker = person("Broker Admin", "broker@e2e-verify.test", "broker_admin");
const cs = person("Cee Ess", "cs@e2e-verify.test", "junior_mentor");
const other = person("Other Mentor", "other@e2e-verify.test", "junior_mentor");
await db.collection("users").insertMany([admin, broker, cs, other] as any[]);
const fee = (inv: string, given: boolean, minor = 0) => ({ invoice_id: inv, invoice_number: `IN-${inv}`, course: "COURSE 1 (WITH CREDIT)", bonus_given: given, bonus_minor: minor, bonus_currency: "USD" });
const student = (n: number, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), student_code: `STU-${String(n).padStart(4, "0")}`, full_name: `Student ${n}`, email: `student${n}@e2e-verify.test`,
  phone: `+9715000000${n}`, primary_mentor_id: String(cs._id), primary_mentor_name: cs.full_name, status: "ACTIVE",
  created_date: now, finance_invoice_id: `inv-${n}`, ...extra,
});
const welcomed = { onboarded: true, onboarded_at: now, onboarded_by_name: cs.full_name };
// 1: welcomed, $500 promised, its bonus pending. 2: welcomed, no bonus. 3: not welcomed yet, $500 promised.
// 4: welcomed, bonus approved today. 5: welcomed, $1,000 promised, the MT5 not known yet (no request raised).
const s1 = student(1, { ...welcomed, course_fees: [fee("inv-1", true, 50_000)] });
const s2 = student(2, { ...welcomed, course_fees: [fee("inv-2", false)] });
const s3 = student(3, { course_fees: [fee("inv-3", true, 50_000)] });
const s4 = student(4, { ...welcomed, course_fees: [fee("inv-4", true, 50_000)] });
const s5 = student(5, { ...welcomed, course_fees: [fee("inv-5", true, 100_000)] });
const s6 = student(6, { ...welcomed, course_fees: [fee("inv-6", true, 50_000)], primary_mentor_id: String(other._id), primary_mentor_name: other.full_name });
await db.collection("students").insertMany([s1, s2, s3, s4, s5, s6] as any[]);
const sid = (s: any) => String(s._id);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const bonusTx = (s: any, inv: string, status: string, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), type: "BONUS", status, bonus_credit: "sales_close", sales_close: { invoice_id: inv, invoice_number: `IN-${inv}`, course: "COURSE 1" },
  amount_currency: "USD", amount_original: 500, amount_usd: 500, amount_aed: 1835, mt5_login: `700${s.student_code.slice(-4)}`,
  student_id: sid(s), student_name: s.full_name, student_code: s.student_code, primary_mentor_id: s.primary_mentor_id,
  requested_at: hoursAgo(8), created_date: hoursAgo(8), updated_date: hoursAgo(8), ...extra,
});
const t1 = bonusTx(s1, "inv-1", "PENDING");
const t3 = bonusTx(s3, "inv-3", "PENDING");
const t4 = bonusTx(s4, "inv-4", "APPROVED", { approved_by_name: broker.full_name, approved_at: now });
const t6 = bonusTx(s6, "inv-6", "REJECTED", { approved_by_name: broker.full_name, approved_at: now, rejection_reason: "Wrong account" });
await db.collection("funding_transactions").insertMany([t1, t3, t4, t6] as any[]);
await db.collection("mt5_accounts").insertOne({ student_id: sid(s2), mt5_login: "9998887", platform: "MT5", is_primary: true, created_date: now } as any);
const tCs = await login(cs.email), tOther = await login(other.email), tBroker = await login(broker.email), tAdmin = await login(admin.email);
check("signed in", !!tCs && !!tBroker && !!tAdmin && !!tOther);
const page = async (token: string) => (await call("POST", "/api/functions/getNotOnboarded", {}, as(token))).body;
const ids = (rows: any[] | undefined) => (rows ?? []).map((r) => r.full_name).sort().join(",");

step("Case 1 — the Not onboarded page: waiting, verifying, approved");
let p = await page(tCs);
check("not welcomed yet: on the first list, as before", ids(p.rows) === "Student 3", ids(p.rows));
check("…with its bonus pending", p.rows?.[0]?.verification === "pending" && p.rows?.[0]?.bonuses?.[0]?.state === "pending");
check("welcomed, bonus pending or not raised yet: verifying", ids(p.verifying) === "Student 1,Student 5", ids(p.verifying));
const v5 = p.verifying?.find((r: any) => r.full_name === "Student 5");
check("…a bonus with no request yet reads as not requested", v5?.bonuses?.[0]?.state === "not_requested" && v5?.verification === "pending", JSON.stringify(v5?.bonuses));
check("welcomed, bonus approved this month: approved, with when", ids(p.approved) === "Student 4" && !!p.approved[0].verified_at, JSON.stringify(p.approved));
check("welcomed with no bonus: onboarded, on none of the lists", ![...p.rows, ...p.verifying, ...p.approved].some((r: any) => r.full_name === "Student 2"));
check("another CS's student is not on mine", ![...p.rows, ...p.verifying, ...p.approved].some((r: any) => r.full_name === "Student 6"));
p = await page(tAdmin);
check("an admin sees the other CS's rejected one too", p.verifying?.some((r: any) => r.full_name === "Student 6" && r.verification === "rejected" && r.bonuses?.[0]?.reason === "Wrong account"), JSON.stringify(p.verifying?.map((r: any) => [r.full_name, r.verification])));

step("Case 1 — a broker admin rejects; the CS submits it again");
let r = await call("PATCH", `/api/entities/FundingTransaction/${t1._id}`, { status: "REJECTED", approved_by_name: broker.full_name, approved_at: new Date().toISOString(), rejection_reason: "Receipt unreadable" }, as(tBroker));
check("the broker admin's rejection stands", r.status === 200, JSON.stringify(r.body));
p = await page(tCs);
const v1 = p.verifying?.find((r: any) => r.full_name === "Student 1");
check("…the student reads rejected, with the reason and who", v1?.verification === "rejected" && v1?.bonuses?.[0]?.reason === "Receipt unreadable" && v1?.bonuses?.[0]?.decided_by === broker.full_name, JSON.stringify(v1?.bonuses));
r = await call("POST", "/api/functions/resubmitSalesBonus", { transactionId: String(t1._id), note: "Clear receipt attached", mt5Login: "700 5555" }, as(tCs));
check("the CS submits it again", r.status === 200 && r.body?.status === "PENDING" && r.body?.mt5_login === "7005555", JSON.stringify(r.body));
const after: any = await db.collection("funding_transactions").findOne({ _id: t1._id });
check("…pending again, the decision cleared, the rejection kept", after.status === "PENDING" && !after.approved_by_name && !after.rejection_reason && after.rejections?.length === 1 && after.rejections[0].reason === "Receipt unreadable" && after.resubmit_count === 1, JSON.stringify(after));
check("…the new MT5 kept as the student's", !!(await db.collection("mt5_accounts").findOne({ student_id: sid(s1), mt5_login: "7005555" })));
check("…and in the student's history", !!(await db.collection("student_history").findOne({ student_id: sid(s1), type: "onboarding_changed", text: /submitted again/ })) || !!(await db.collection("student_histories").findOne({ student_id: sid(s1), text: /submitted again/ })));
check("…the verifiers were told at once", (await db.collection("notifications").countDocuments({ type: "bonus_verification", user_id: { $in: [String(broker._id), String(admin._id)] } })) === 2);
p = await page(tCs);
check("…verifying again, pending", p.verifying?.find((r: any) => r.full_name === "Student 1")?.verification === "pending");
r = await call("PATCH", `/api/entities/FundingTransaction/${t1._id}`, { status: "APPROVED", approved_by_name: broker.full_name, approved_at: new Date().toISOString() }, as(tBroker));
p = await page(tCs);
check("approved: off verifying, onto approved", r.status === 200 && !p.verifying?.some((r: any) => r.full_name === "Student 1") && p.approved?.some((r: any) => r.full_name === "Student 1"));

step("Case 3/4 — what Submit again refuses");
r = await call("POST", "/api/functions/resubmitSalesBonus", { transactionId: String(t3._id) }, as(tCs));
check("a pending bonus: 409", r.status === 409, JSON.stringify(r.body));
r = await call("POST", "/api/functions/resubmitSalesBonus", {}, as(tCs));
check("no transaction: 400", r.status === 400);
r = await call("POST", "/api/functions/resubmitSalesBonus", { transactionId: String(new ObjectId()) }, as(tCs));
check("a transaction that doesn't exist: 404", r.status === 404);
r = await call("POST", "/api/functions/resubmitSalesBonus", { transactionId: String(t6._id) }, as(tCs));
check("another CS's student: 403", r.status === 403, JSON.stringify(r.body));
r = await call("POST", "/api/functions/resubmitSalesBonus", { transactionId: String(t6._id), mt5Login: "12" }, as(tOther));
check("not an MT5 login: 400", r.status === 400, JSON.stringify(r.body));
r = await call("POST", "/api/functions/resubmitSalesBonus", { transactionId: String(t6._id), mt5Login: "9998887" }, as(tOther));
check("another student's MT5: 409, nothing changed", r.status === 409 && (await db.collection("funding_transactions").findOne({ _id: t6._id }) as any)?.status === "REJECTED", JSON.stringify(r.body));
r = await call("POST", "/api/functions/resubmitSalesBonus", { transactionId: String(t6._id) });
check("no token: 401", r.status === 401);
r = await call("POST", "/api/functions/resubmitSalesBonus", { transactionId: String(t6._id) }, as(tOther));
check("their own CS may", r.status === 200 && r.body?.status === "PENDING");

step("Finance's lookup: onboarded, verification, bonuses");
const look = (body: unknown) => call("POST", "/api/v1/integrations/finance/students/lookup", body, { "x-finance-secret": SECRET });
r = await look({ codes: ["STU-0001", "STU-0002", "STU-0003", "STU-0005"] });
const by = new Map((r.body?.data?.students ?? []).map((x: any) => [x.code, x]));
const l1: any = by.get("STU-0001"), l2: any = by.get("STU-0002"), l3: any = by.get("STU-0003"), l5: any = by.get("STU-0005");
check("the lookup answers", r.status === 200 && by.size === 4, JSON.stringify(r.body));
check("approved bonus: onboarded and verified, by invoice", l1?.onboarded === true && l1?.verification === "approved" && l1?.bonuses?.[0]?.invoice_id === "inv-1" && l1?.bonuses?.[0]?.state === "approved");
check("no bonus promised: onboarded, verification none", l2?.onboarded === true && l2?.verification === "none" && l2?.bonuses?.length === 0, JSON.stringify(l2));
check("not welcomed, bonus pending: not onboarded, pending", l3?.onboarded === false && l3?.verification === "pending");
check("welcomed, no request yet: pending, not requested", l5?.verification === "pending" && l5?.bonuses?.[0]?.state === "not_requested");
check("…who onboarded them and when", l1?.onboarded_by === cs.full_name && !!l1?.onboarded_at);
r = await call("POST", "/api/v1/integrations/finance/students/lookup", { codes: ["STU-0001"] }, { "x-finance-secret": "wrong" });
check("a wrong secret: 401", r.status === 401);

step("The 6-hour reminder to broker admins and Super Admins");
const { connectDb } = await import("../db");
await connectDb();
const { bonusVerifyAlertTick } = await import("../students/bonusVerifyAlerts");
await db.collection("notifications").deleteMany({});
// 10:00 UAE today = 06:00 UTC: daytime. t3 was raised 8 hours before the run; t6 was just submitted again.
const day = new Date(); day.setUTCHours(6, 0, 0, 0);
await db.collection("funding_transactions").updateOne({ _id: t3._id }, { $set: { requested_at: new Date(day.getTime() - 8 * 3_600_000).toISOString() } });
await db.collection("funding_transactions").updateOne({ _id: t6._id }, { $set: { resubmitted_at: new Date(day.getTime() - 3_600_000).toISOString() } });
const night = new Date(day.getTime() + 13 * 3_600_000); // 23:00 UAE
check("not at night", (await bonusVerifyAlertTick(night.getTime())) === 0);
let told = await bonusVerifyAlertTick(day.getTime());
check("one waiting 8 hours is told; one submitted again an hour ago is not yet", told === 1, String(told));
check("…to the broker admin and the Super Admin, not the CSs", (await db.collection("notifications").countDocuments({ type: "bonus_verification" })) === 2 && (await db.collection("notifications").countDocuments({ user_id: { $in: [String(cs._id), String(other._id)] } })) === 0);
told = await bonusVerifyAlertTick(day.getTime() + 600_000);
check("once only", told === 0);

console.log(`\n${pass}/${pass + fail} checks passed`);
await client.close();
process.exit(fail ? 1 : 0);
