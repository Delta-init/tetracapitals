/**
 * The sales-close bonus waits for the course to be paid in full (the user, 2026-10-17: "partial payment from the sales
 * never gets the bonus in the commission portal — only after the full payment is finished can the bonus request be
 * raised"; students/salesBonusPaid.ts) — end to end against the API:
 *   1. A part-paid course (AED 1,125 of 2,250 owed, $500 bonus): Send bonus for credit has nothing to send and says
 *      what is owed; Send is refused; the badge reads "after full payment"; verification pending, saying why.
 *   2. A request raised before (pending): a broker admin can't approve it while the course owes — MT5 Approvals says
 *      so; the Bonus pending filter finds it under "after full payment".
 *   3. Finance reports the course paid in full: the bonus goes for credit, and is approved.
 *   4. Not held: a course-upgrade bonus credit, and a course with no balance known.
 * Run through ./test-sales-bonus-paid.sh (throwaway mongod, the API — no .env). Scratch database only.
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
const show = (v: unknown) => String(JSON.stringify(v) ?? "undefined").slice(0, 400);

type Res = { status: number; body: any };
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const r = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
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
const admin = person("Super Admin", "admin@e2e-paid.test", "super_admin");
const broker = person("Broker Admin", "broker@e2e-paid.test", "broker_admin");
const cs = person("Cee Ess", "cs@e2e-paid.test", "junior_mentor");
await db.collection("users").insertMany([admin, broker, cs] as any[]);
const fee = (inv: string, extra: Record<string, unknown> = {}) => ({
  invoice_id: inv, invoice_number: `IN-${inv}`, course: "COURSE 1 - MARKET BREAKOUT THEORY (WITH CREDIT)", currency: "AED",
  fee_minor: 225_000, paid_minor: 112_500, balance_minor: 112_500, status: "partial",
  bonus_given: true, bonus_minor: 50_000, bonus_currency: "USD", receipt_url: "https://files.test/receipt.pdf", receipt_name: "receipt.pdf", ...extra,
});
const student = (n: number, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), student_code: `STU-${String(n).padStart(4, "0")}`, full_name: `Student ${n}`, email: `student${n}@e2e-paid.test`,
  phone: `+9715000000${n}`, primary_mentor_id: String(cs._id), primary_mentor_name: cs.full_name, status: "ACTIVE",
  created_date: now, onboarded: true, onboarded_at: now, onboarded_by_name: cs.full_name, ...extra,
});
// 1: part paid, nothing raised. 2: part paid, a request raised before the rule. 3: a course-upgrade credit while a
// course owes. 4: no balance known (an older close).
const s1 = student(1, { course_fees: [fee("inv-1")] });
const s2 = student(2, { course_fees: [fee("inv-2")] });
const s3 = student(3, { course_fees: [fee("inv-3")] });
const s4 = student(4, { course_fees: [fee("inv-4", { balance_minor: undefined, paid_minor: undefined, status: undefined })] });
await db.collection("students").insertMany([s1, s2, s3, s4] as any[]);
const sid = (s: any) => String(s._id);
const credit = (s: any, kind: "sales_close" | "course_upgrade", extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), type: "BONUS", status: "PENDING", bonus_credit: kind,
  ...(kind === "sales_close" ? { sales_close: { invoice_id: s.course_fees[0].invoice_id, invoice_number: s.course_fees[0].invoice_number, course: "COURSE 1" } } : { course_upgrade: { upgrade_id: "up-1", course: "COURSE 2" } }),
  amount_currency: "USD", amount_original: 500, amount_usd: 500, amount_aed: 1835, mt5_login: `700${s.student_code.slice(-4)}`,
  student_id: sid(s), student_name: s.full_name, student_code: s.student_code, primary_mentor_id: s.primary_mentor_id,
  requested_at: now, created_date: now, updated_date: now, ...extra,
});
const t2 = credit(s2, "sales_close");
const t3 = credit(s3, "course_upgrade");
await db.collection("funding_transactions").insertMany([t2, t3] as any[]);
const tCs = await login(cs.email), tBroker = await login(broker.email), tAdmin = await login(admin.email);
check("signed in", !!tCs && !!tBroker && !!tAdmin);
const bonusPending = async (s: any) => (await call("POST", "/api/functions/getStudentBonusPending", { studentId: sid(s) }, as(tCs))).body?.bonus_pending;
const verifying = async () => (await call("POST", "/api/functions/getNotOnboarded", {}, as(tAdmin))).body?.verifying ?? [];

step("1. A part-paid course: its bonus waits");
let r = await call("POST", "/api/functions/getSalesBonusToSend", { studentId: sid(s1) }, as(tCs));
check("Send bonus for credit: nothing to send, the bonus held with what is owed", r.status === 200 && r.body.bonuses?.length === 0 && r.body.after_payment?.[0]?.owed === "AED 1,125.00" && r.body.after_payment[0].amount === 500, show(r.body));
r = await call("POST", "/api/functions/sendSalesBonusCredit", { studentId: sid(s1), mt5Login: "7000001" }, as(tCs));
check("Send is refused, saying what is owed", r.status === 409 && /AED 1,125\.00 is still owed on IN-inv-1 — the sales bonus is sent once the course is paid in full/.test(String(r.body?.error ?? r.body?.message ?? "")), show(r.body));
check("…and nothing was raised", (await db.collection("funding_transactions").countDocuments({ student_id: sid(s1) })) === 0);
let bp = await bonusPending(s1);
check("the badge: $500, after full payment", bp?.stage === "after_payment" && bp?.after_payment?.count === 1 && bp?.total_usd === 500 && bp?.needs_call?.count === 0, show(bp));
let v = (await verifying()).find((x: any) => x.full_name === "Student 1");
check("onboarding verification pending — the bonus after full payment, what is owed", v?.verification === "pending" && v?.bonuses?.[0]?.after_payment === true && v.bonuses[0].owed === "AED 1,125.00" && v.bonuses[0].state === "not_requested", show(v?.bonuses));
r = await call("POST", "/api/v1/integrations/finance/students/lookup", { emails: [s1.email] }, { "x-finance-secret": SECRET });
const looked = r.body?.data?.students?.[0] ?? r.body?.students?.[0];
check("finance's lookup (the CRMs' commission step): still pending, the states it knows", looked?.verification === "pending" && looked?.bonuses?.[0]?.state === "not_requested", show(r.body));

step("2. A request raised before: not approved while the course owes");
r = await call("PATCH", `/api/entities/FundingTransaction/${t2._id}`, { status: "APPROVED", approved_by_name: broker.full_name, approved_at: now }, as(tBroker));
check("a broker admin approving it: refused, saying what is owed", r.status === 409 && /AED 1,125\.00 is still owed on IN-inv-2 — the sales bonus is approved once the course is paid in full/.test(String(r.body?.error ?? r.body?.message ?? "")), show(r.body));
check("…still pending", (await db.collection("funding_transactions").findOne({ _id: t2._id }) as any)?.status === "PENDING");
r = await call("POST", "/api/functions/getBonusApprovals", {}, as(tBroker));
const row2 = (r.body?.pending ?? []).find((x: any) => String(x.id ?? x._id) === String(t2._id));
check("MT5 Approvals shows it with what is owed", row2?.course_owed === "AED 1,125.00", show(row2 ?? r.body?.pending?.map((x: any) => x.id)));
bp = await bonusPending(s2);
check("its badge: after full payment, not waiting for a broker admin", bp?.stage === "after_payment" && bp?.waiting_broker?.count === 0, show(bp));
r = await call("POST", "/api/functions/listStudents", { tab: "all", filters: { bonus: "after_payment" } }, as(tAdmin));
const names = (r.body?.rows ?? []).map((x: any) => x.full_name).sort().join(",");
check("the Students filter \"after full payment\" finds the three with a sales bonus on a course still owing", names === "Student 1,Student 2,Student 3", `${r.status} ${names} ${show(r.body).slice(0, 200)}`);
r = await call("POST", "/api/functions/masterEditTransaction", { id: String(t2._id), patch: { status: "APPROVED" } }, as(tAdmin));
check("…the master editor can't approve it either", r.status === 409, show(r.body));

step("3. Finance reports it paid in full");
const paidUp = (s: any) => call("POST", "/api/v1/integrations/finance/fee-updates", {
  invoiceId: s.course_fees[0].invoice_id, invoiceNumber: s.course_fees[0].invoice_number, email: s.email, course: s.course_fees[0].course,
  currency: "AED", totalMinor: 225_000, paidMinor: 225_000, balanceMinor: 0, status: "paid", nextDueOn: null,
  payments: [{ amountMinor: 112_500, paidOn: "2026-10-01", method: "tabby" }, { amountMinor: 112_500, paidOn: "2026-10-17", method: "card" }],
  updatedAt: new Date().toISOString(),
}, { "x-finance-secret": SECRET });
r = await paidUp(s1);
check("the fee update lands", r.status === 200, show(r.body));
bp = await bonusPending(s1);
check("the badge: needs a call + MT5 now", bp?.stage === "needs_call" && bp?.after_payment?.count === 0, show(bp));
r = await call("POST", "/api/functions/sendSalesBonusCredit", { studentId: sid(s1), mt5Login: "7000001" }, as(tCs));
check("Send goes: on MT5 Approvals for the broker admin", r.status === 200 && r.body?.sent === 1, show(r.body));
const raised: any = await db.collection("funding_transactions").findOne({ student_id: sid(s1), bonus_credit: "sales_close" });
check("…a $500 sales-close credit, pending", raised?.status === "PENDING" && raised?.amount_usd === 500);
r = await call("PATCH", `/api/entities/FundingTransaction/${raised._id}`, { status: "APPROVED", approved_by_name: broker.full_name, approved_at: now }, as(tBroker));
check("…and the broker admin approves it", r.status === 200 && r.body?.status === "APPROVED", show(r.body));
v = (await verifying()).find((x: any) => x.full_name === "Student 1");
check("onboarding verification no longer pending", !v, show(v));
await paidUp(s2);
r = await call("PATCH", `/api/entities/FundingTransaction/${t2._id}`, { status: "APPROVED", approved_by_name: broker.full_name, approved_at: now }, as(tBroker));
check("the one raised before: approved once paid", r.status === 200 && r.body?.status === "APPROVED", show(r.body));

step("4. Not held");
r = await call("PATCH", `/api/entities/FundingTransaction/${t3._id}`, { status: "APPROVED", approved_by_name: broker.full_name, approved_at: now }, as(tBroker));
check("a course-upgrade bonus credit: approved while another course owes", r.status === 200 && r.body?.status === "APPROVED", show(r.body));
r = await call("POST", "/api/functions/getSalesBonusToSend", { studentId: sid(s4) }, as(tCs));
check("a course with no balance known (an older close): sent as before", r.body?.bonuses?.length === 1 && !r.body?.after_payment?.length, show(r.body));
r = await call("POST", "/api/functions/getSalesBonusToSend", { studentId: sid(s3) }, as(tCs));
check("…while the course-upgrade student's own sales bonus still waits for its course", r.body?.bonuses?.length === 0 && r.body?.after_payment?.length === 1, show(r.body));

console.log(`\n${pass}/${pass + fail} checks passed`);
await client.close();
process.exit(fail ? 1 : 0);
