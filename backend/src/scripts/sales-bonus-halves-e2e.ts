/**
 * The sales-close bonus in halves (the user, 2026-10-27: "minimum 2k+ partial payment … for 2000 he gets 500 USD …
 * if he pays full he gets full"; a fixed half; Bangalore left for now) — end to end against the API:
 *   1. Part paid (AED 2,750 of 5,500, $1,000 bonus): Send sends the first half, $500; the broker admin approves it and
 *      onboarding verification passes; finance reports the course paid in full → the rest, $500, is raised by itself
 *      for the same MT5, and approved; a later fee update raises nothing more.
 *   2. Under AED 2,000 paid: held, Send refused; past AED 2,000: half can be sent.
 *   3. A request for the whole bonus raised before: refused while part paid; the next fee update splits it.
 *   4. A first half not approved yet when the course is paid in full: one request for all of it again, no rest.
 *   5. A Bangalore course in INR, more than AED 2,000's worth paid: still held for the full payment.
 *   6. scripts/sales-bonus-halves.ts: a dry run changes nothing; --write splits what is left.
 * Run through ./test-sales-bonus-halves.sh (throwaway mongod, the API — no .env). Scratch database only.
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
const errOf = (r: Res) => String(r.body?.error ?? r.body?.message ?? "");

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
const admin = person("Super Admin", "admin@e2e-halves.test", "super_admin");
const broker = person("Broker Admin", "broker@e2e-halves.test", "broker_admin");
const cs = person("Cee Ess", "cs@e2e-halves.test", "junior_mentor");
await db.collection("users").insertMany([admin, broker, cs] as any[]);
// IN-00116's shape: AED 5,500, AED 2,750 paid, $1,000 promised at the close.
const fee = (inv: string, extra: Record<string, unknown> = {}) => ({
  invoice_id: inv, invoice_number: `IN-${inv}`, course: "MARKET BREAK-OUT TRADING PROGRAM", currency: "AED",
  fee_minor: 550_000, paid_minor: 275_000, balance_minor: 275_000, status: "partial",
  bonus_given: true, bonus_minor: 100_000, bonus_currency: "USD", receipt_url: "https://files.test/receipt.pdf", receipt_name: "receipt.pdf", ...extra,
});
const student = (n: number, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), student_code: `STU-${String(n).padStart(4, "0")}`, full_name: `Student ${n}`, email: `student${n}@e2e-halves.test`,
  phone: `+9715000000${n}`, primary_mentor_id: String(cs._id), primary_mentor_name: cs.full_name, status: "ACTIVE",
  created_date: now, onboarded: true, onboarded_at: now, onboarded_by_name: cs.full_name, ...extra,
});
const s1 = student(1, { course_fees: [fee("inv-1")] });
const s2 = student(2, { course_fees: [fee("inv-2", { paid_minor: 112_500, balance_minor: 437_500 })] });
const s3 = student(3, { course_fees: [fee("inv-3")] });
const s4 = student(4, { course_fees: [fee("inv-4")] });
const s5 = student(5, { course_fees: [fee("inv-5", { currency: "INR", fee_minor: 15_000_000, paid_minor: 7_500_000, balance_minor: 7_500_000 })] });
const s6 = student(6, { course_fees: [fee("inv-6")] });
await db.collection("students").insertMany([s1, s2, s3, s4, s5, s6] as any[]);
const sid = (s: any) => String(s._id);
// A request for the whole $1,000, raised before this change (as IN-00116's was).
const whole = (s: any) => ({
  _id: new ObjectId(), type: "BONUS", status: "PENDING", bonus_credit: "sales_close",
  sales_close: { invoice_id: s.course_fees[0].invoice_id, invoice_number: s.course_fees[0].invoice_number, course: s.course_fees[0].course },
  amount_currency: "USD", amount_original: 1000, amount_usd: 1000, amount_aed: 3670, mt5_login: `923${s.student_code.slice(-3)}`,
  student_id: sid(s), student_name: s.full_name, student_code: s.student_code, primary_mentor_id: s.primary_mentor_id,
  requested_at: now, created_date: now, updated_date: now, notes: "raised before",
});
const t3 = whole(s3), t6 = whole(s6);
await db.collection("funding_transactions").insertMany([t3, t6] as any[]);
const tCs = await login(cs.email), tBroker = await login(broker.email), tAdmin = await login(admin.email);
check("signed in", !!tCs && !!tBroker && !!tAdmin);

const credits = (s: any) => db.collection("funding_transactions").find({ student_id: sid(s), bonus_credit: "sales_close" }).sort({ created_date: 1 }).toArray() as Promise<any[]>;
const approve = (id: unknown) => call("PATCH", `/api/entities/FundingTransaction/${id}`, { status: "APPROVED", approved_by_name: broker.full_name, approved_at: new Date().toISOString() }, as(tBroker));
let stamp = Date.now();
const feeUpdate = (s: any, paidMinor: number) => {
  const f = s.course_fees[0];
  const total = f.fee_minor;
  return call("POST", "/api/v1/integrations/finance/fee-updates", {
    invoiceId: f.invoice_id, invoiceNumber: f.invoice_number, email: s.email, course: f.course, currency: f.currency,
    totalMinor: total, paidMinor, balanceMinor: total - paidMinor, status: paidMinor >= total ? "paid" : "partial", nextDueOn: null,
    payments: [{ amountMinor: paidMinor, paidOn: "2026-10-08", method: "card" }],
    updatedAt: new Date(stamp += 1000).toISOString(),
  }, { "x-finance-secret": SECRET });
};
const bonusPending = async (s: any) => (await call("POST", "/api/functions/getStudentBonusPending", { studentId: sid(s) }, as(tCs))).body?.bonus_pending;
const verifying = async () => (await call("POST", "/api/functions/getNotOnboarded", {}, as(tAdmin))).body?.verifying ?? [];
const approvalsRow = async (id: unknown) => ((await call("POST", "/api/functions/getBonusApprovals", {}, as(tBroker))).body?.pending ?? []).find((x: any) => String(x.id ?? x._id) === String(id));

step("1. Part paid, AED 2,000+: half now, the rest once paid in full");
let r = await call("POST", "/api/functions/getSalesBonusToSend", { studentId: sid(s1) }, as(tCs));
const b1 = r.body?.bonuses?.[0];
check("Send bonus for credit: half of the $1,000 — $500 now, what is owed", r.status === 200 && b1?.half === true && b1.now === 500 && b1.amount === 1000 && b1.usd === 500 && b1.owed === "AED 2,750.00" && !r.body.after_payment?.length, show(r.body));
let bp = await bonusPending(s1);
check("the badge: needs a call + MT5, $500", bp?.stage === "needs_call" && bp?.total_usd === 500, show(bp));
r = await call("POST", "/api/functions/sendSalesBonusCredit", { studentId: sid(s1), mt5Login: "923071" }, as(tCs));
check("Send goes", r.status === 200 && r.body?.sent === 1, show(r.body));
let c = await credits(s1);
check("…one request: the first half, $500 (AED 1,835), for MT5 923071", c.length === 1 && c[0].bonus_part === "first_half" && c[0].amount_usd === 500 && c[0].amount_original === 500 && c[0].amount_aed === 1835 && c[0].mt5_login === "923071", show(c));
check("…its note says half now, the rest after full payment", /first half/.test(c[0].notes) && /rest once it is paid in full/.test(c[0].notes), c[0]?.notes);
let row = await approvalsRow(c[0]._id);
check("MT5 Approvals: the first half, not marked \"approve after full payment\"", row?.bonus_part === "first_half" && !row?.course_owed, show(row));
let v = (await verifying()).find((x: any) => x.full_name === "Student 1");
check("onboarding verification pending until it is approved, not \"after full payment\"", v?.verification === "pending" && v?.bonuses?.[0]?.part === "first_half" && !v.bonuses[0].after_payment, show(v?.bonuses));
r = await approve(c[0]._id);
check("the broker admin approves the first half while the course owes", r.status === 200 && r.body?.status === "APPROVED", show(r.body));
v = (await verifying()).find((x: any) => x.full_name === "Student 1");
check("onboarding verification passes with the first half", !v, show(v));
check("nothing pending on the badge", !(await bonusPending(s1)), show(await bonusPending(s1)));
r = await feeUpdate(s1, 550_000);
check("finance: paid in full", r.status === 200 && (r.body?.data ?? r.body)?.applied === true, show(r.body));
c = await credits(s1);
const rest = c.find((t) => t.bonus_part === "rest");
check("the rest is raised by itself: $500, same MT5, pending", c.length === 2 && rest?.status === "PENDING" && rest.amount_usd === 500 && rest.mt5_login === "923071" && rest.requested_by_name === "Paid in full", show(c));
bp = await bonusPending(s1);
check("the badge: $500 waiting for the broker admin", bp?.stage === "waiting_broker" && bp?.total_usd === 500, show(bp));
row = await approvalsRow(rest?._id);
check("MT5 Approvals: \"rest\", nothing owed", row?.bonus_part === "rest" && !row?.course_owed, show(row));
r = await approve(rest?._id);
check("…approved", r.status === 200 && r.body?.status === "APPROVED", show(r.body));
await feeUpdate(s1, 550_000);
check("another fee update raises nothing more", (await credits(s1)).length === 2);
const hist = await db.collection("student_history").find({ student_id: sid(s1), type: "bonus_sent" }).toArray().catch(() => []) as any[];
check("the student's history says the rest went", hist.some((h) => /the rest \(\$500\)/.test(String(h.text))), show(hist.map((h) => h.text)));

step("2. Under AED 2,000 paid: held; past it, half");
r = await call("POST", "/api/functions/sendSalesBonusCredit", { studentId: sid(s2), mt5Login: "923072" }, as(tCs));
check("Send refused, saying what is owed and that half goes from AED 2,000", r.status === 409 && /AED 4,375\.00 is still owed on IN-inv-2 — the sales bonus is sent once the course is paid in full, or half of it once AED 2,000 is paid/.test(errOf(r)), show(r.body));
bp = await bonusPending(s2);
check("the badge: after full payment", bp?.stage === "after_payment", show(bp));
await feeUpdate(s2, 200_000);
r = await call("POST", "/api/functions/getSalesBonusToSend", { studentId: sid(s2) }, as(tCs));
check("AED 2,000 paid: half can be sent now", r.body?.bonuses?.[0]?.half === true && r.body.bonuses[0].now === 500, show(r.body));

step("2b. Every payment's receipt (2026-10-27: only the close's showed)");
r = await call("POST", "/api/v1/integrations/finance/fee-updates", {
  invoiceId: "inv-2", invoiceNumber: "IN-inv-2", email: s2.email, course: s2.course_fees[0].course, currency: "AED",
  totalMinor: 550_000, paidMinor: 300_000, balanceMinor: 250_000, status: "partial", nextDueOn: null,
  payments: [
    { amountMinor: 112_500, paidOn: "2026-10-17", method: "Tabby", receipt: { url: "https://files.test/receipt.pdf", name: "Tabby receipt" } },
    { amountMinor: 187_500, paidOn: "2026-10-23", method: "Card", receipt: { url: "https://files.test/card.jpg", name: "RCT-00042" } },
    { amountMinor: 0, paidOn: "2026-10-24", method: "Cash", receipt: { url: "javascript:alert(1)", name: "bad" } },
  ],
  updatedAt: new Date(stamp += 1000).toISOString(),
}, { "x-finance-secret": SECRET });
const kept: any = (await db.collection("students").findOne({ _id: s2._id }))?.course_fees?.[0];
check("each recorded payment keeps its receipt; a link a browser can't open is dropped", r.status === 200 && kept?.payments?.[1]?.receipt_url === "https://files.test/card.jpg"
  && kept.payments[1].receipt_name === "RCT-00042" && !kept.payments[2].receipt_url, show(kept?.payments));
r = await call("POST", "/api/functions/getSalesBonusToSend", { studentId: sid(s2) }, as(tCs));
const urls = (r.body?.bonuses?.[0]?.receipts ?? []).map((x: any) => x.url);
check("Send bonus for credit: the close's receipt and the Card payment's — the same one once", urls.join() === "https://files.test/receipt.pdf,https://files.test/card.jpg", show(r.body?.bonuses?.[0]?.receipts));
await call("POST", "/api/functions/sendSalesBonusCredit", { studentId: sid(s2), mt5Login: "923072" }, as(tCs));
const t2 = (await credits(s2))[0];
const row2 = await approvalsRow(t2?._id);
const inv2 = (row2?.student?.invoices ?? []).find((f: any) => f.invoice_number === "IN-inv-2");
check("MT5 Approvals: the invoice's recorded payments with their receipts", inv2?.recorded_payments?.map((x: any) => x.receipt_url).join() === "https://files.test/receipt.pdf,https://files.test/card.jpg", show(inv2));

step("3. A request for all of it, raised before");
r = await approve(t3._id);
check("refused while part paid, saying it is split on the next payment update", r.status === 409 && /AED 2,750\.00 is still owed on IN-inv-3 — half the sales bonus can be credited now: this request for all of it is split in two on the course's next payment update/.test(errOf(r)), show(r.body));
row = await approvalsRow(t3._id);
check("MT5 Approvals marks it owed", row?.course_owed === "AED 2,750.00", show(row));
await feeUpdate(s3, 300_000);
let t: any = await db.collection("funding_transactions").findOne({ _id: t3._id });
check("the next fee update splits it: the first half, $500, its note kept", t?.bonus_part === "first_half" && t.amount_usd === 500 && /raised before/.test(t.notes), show(t));
r = await approve(t3._id);
check("…and it is approved", r.status === 200 && r.body?.status === "APPROVED", show(r.body));

step("4. Paid in full before the first half is approved");
r = await call("POST", "/api/functions/sendSalesBonusCredit", { studentId: sid(s4), mt5Login: "923074" }, as(tCs));
c = await credits(s4);
check("the first half went", r.body?.sent === 1 && c[0]?.bonus_part === "first_half", show(c));
await feeUpdate(s4, 550_000);
c = await credits(s4);
check("one request for all of it again: $1,000, no part, no rest", c.length === 1 && !("bonus_part" in c[0]) && c[0].amount_usd === 1000 && c[0].status === "PENDING", show(c));
r = await approve(c[0]._id);
check("…approved, credited once", r.status === 200 && (await credits(s4)).length === 1, show(r.body));

step("5. Bangalore, in INR: left as before");
r = await call("POST", "/api/functions/getSalesBonusToSend", { studentId: sid(s5) }, as(tCs));
check("₹75,000 paid of ₹150,000: still after full payment, no half", !r.body?.bonuses?.length && r.body?.after_payment?.length === 1, show(r.body));

step("6. scripts/sales-bonus-halves.ts");
const run = (...args: string[]) => {
  const p = Bun.spawnSync(["bun", "--no-env-file", "src/scripts/sales-bonus-halves.ts", ...args], { env: process.env as any });
  return p.stdout.toString() + p.stderr.toString();
};
let out = run();
check("a dry run lists the one left to split", /STU-0006 Student 6 · IN-inv-6: split — first half to approve now \(\$500\)/.test(out) && /1 to change/.test(out), out);
t = await db.collection("funding_transactions").findOne({ _id: t6._id });
check("…and changes nothing", !t?.bonus_part && t?.amount_usd === 1000, show(t));
out = run("--write");
t = await db.collection("funding_transactions").findOne({ _id: t6._id });
check("--write splits it", /1 changed/.test(out) && t?.bonus_part === "first_half" && t.amount_usd === 500, out + show(t));
check("run again: nothing to change", /0 to change/.test(run()));

console.log(`\n${pass}/${pass + fail} checks passed`);
await client.close();
process.exit(fail ? 1 : 0);
