/**
 * Send back to the CS or to finance (the user, 2026-11-19: "send back to sales or send back to finance"):
 *
 *   1. A broker admin sends a bonus finance approved back to finance: finance is asked first (signed, its organization,
 *      what to check and why) — refused or unreachable, nothing changes here; taken, the request is with finance again
 *      (off MT5 Approvals' pending, on its Sent back tab), and finance's next decision brings it back at its amount.
 *   2. Refused: not a finance-approved bonus (a deposit, one finance still has, a sales-close credit), a CS asking, no
 *      note, a field finance doesn't check.
 *   3. Sent back to the CS with the amount and the receipt: the CS's new amount and receipt go through finance again
 *      (refused there: nothing changes); an MT5 fix alone goes straight back; several payments: not changed here; a
 *      deposit's amount: corrected, straight back.
 *   4. As before: no `to` is the CS.
 *
 * Run through ./test-funding-recheck.sh — a throwaway mongod, the API, and a stand-in finance served here.
 */
import bcrypt from "bcryptjs";
import { createHash, createHmac } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "";
const dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) {
  console.error(`Refusing to run: needs a scratch e2e database on 127.0.0.1, got ${uri} / ${dbName}`);
  process.exit(1);
}
const API = `http://127.0.0.1:${process.env.E2E_API_PORT}`;
const DECISION_SECRET = process.env.FINANCE_S2S_SECRET ?? "";
const CLIENT_ID = process.env.FINANCE_CLIENT_ID ?? "";
const INBOUND_SECRET = process.env.FINANCE_INTEGRATION_SECRET ?? "";
const ORG_ID = process.env.FINANCE_ORG_ID ?? "";

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
const show = (r: Res) => `${r.status} ${JSON.stringify(r.body).slice(0, 260)}`;
async function until(fn: () => Promise<boolean>, ms = 6000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await Bun.sleep(100); }
  return false;
}

/* ── A stand-in finance: takes requests, and answers rechecks as told. ── */
let rmode: "ok" | "refuse" | "down" = "ok";
const rechecks: { body: any; org: string | null }[] = [];
let badSignatures = 0, n = 0;
const finance = Bun.serve({
  port: Number(process.env.E2E_FAKE_FINANCE_PORT),
  async fetch(req) {
    const url = new URL(req.url);
    const raw = await req.text();
    const ts = req.headers.get("x-delta-timestamp") ?? "", nonce = req.headers.get("x-delta-nonce") ?? "";
    const expected = createHmac("sha256", INBOUND_SECRET).update(["POST", url.pathname, ts, nonce, createHash("sha256").update(raw).digest("hex")].join("\n")).digest("hex");
    if (req.headers.get("x-delta-client") !== CLIENT_ID || req.headers.get("x-delta-signature") !== expected) {
      badSignatures++;
      return Response.json({ error: { code: "UNAUTHENTICATED", message: "Unauthorized" } }, { status: 401 });
    }
    const body = JSON.parse(raw);
    if (url.pathname === "/api/v1/integrations/tetra-deposits") return Response.json({ data: { id: `fin-${++n}`, status: "pending", externalId: body.externalId } });
    if (url.pathname === "/api/v1/integrations/tetra-deposits/recheck") {
      rechecks.push({ body, org: req.headers.get("x-delta-org") });
      if (rmode === "down") return Response.json({ error: { code: "INTERNAL", message: "Finance is having a moment" } }, { status: 503 });
      if (rmode === "refuse") return Response.json({ error: { code: "CONFLICT", message: "Not sent back — its payment can't come off the invoice: reconciled" } }, { status: 409 });
      return Response.json({ data: { id: `fin-r${rechecks.length}`, status: "pending", externalId: body.externalId } });
    }
    if (url.pathname === "/api/v1/integrations/tetra-deposits/withdrawals") return Response.json({ data: { outcome: "withdrawn", message: "", removed: [] } });
    return Response.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
  },
});

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({});
const txs = db.collection("funding_transactions");
const txOf = async (id: string) => (await txs.findOne({ _id: new ObjectId(id) })) as any;

const hash = await bcrypt.hash("Password123!", 10);
const now = new Date().toISOString();
const person = (full_name: string, app_role: string) => ({
  _id: new ObjectId(), email: `${full_name.toLowerCase().replace(/\s+/g, ".")}@e2e-recheck.test`, full_name, app_role, password_hash: hash, created_date: now, updated_date: now,
});
const broker = person("Broker Bo", "broker_admin");
const mentor = person("Cara Cs", "junior_mentor");
await db.collection("users").insertMany([broker, mentor]);
const student = {
  _id: new ObjectId(), full_name: "Abel Student", email: "abel@e2e-recheck.test", student_code: "STU-9200", student_level: "LEVEL_1",
  status: "ACTIVE", primary_mentor_id: String(mentor._id), primary_mentor_name: mentor.full_name, team_name: "Team Money Heist", created_date: now,
};
await db.collection("students").insertOne(student);
await db.collection("mt5_accounts").insertOne({ _id: new ObjectId(), student_id: String(student._id), mt5_login: "5550001", platform: "MT5", created_date: now });

const login = async (u: any) => (await call("POST", "/api/auth/login", { email: u.email, password: "Password123!" })).body?.token as string;
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const [brokerToken, mentorToken] = [await login(broker), await login(mentor)];
check("signed in", !!brokerToken && !!mentorToken);
const cp = (aed: number) => ({ product: "DSLP Offer", kind: "partial", with_bonus: true, bonus_usd: 500, hold_aed: 0, balance_aed: 20000 - aed, paid_today_aed: aed, paid_before_aed: 0, paid_total_aed: aed, price: 20000, price_currency: "AED" });
let day = 0;
const raise = async (aed = 2250, over: Record<string, unknown> = {}) => {
  const r = await call("POST", "/api/entities/FundingTransaction", {
    type: "BONUS", status: "PENDING", tags: ["Course"], student_id: String(student._id), student_name: student.full_name, student_code: student.student_code,
    amount_usd: Math.round(aed / 3.67 * 100) / 100, amount_original: aed, amount_aed: aed, amount_currency: "AED", course_payment: cp(aed), payment_method: "Card", mt5_login: "5550001",
    screenshot_url: "http://127.0.0.1/uploads/proof.png", primary_mentor_id: String(mentor._id), primary_mentor_name: mentor.full_name,
    requested_by_id: String(mentor._id), requested_by_name: mentor.full_name, requested_at: new Date().toISOString(),
    initiating_mentor_id: String(mentor._id), initiating_mentor_name: mentor.full_name, meeting_mentor_none: true, ...over,
  }, as(mentorToken));
  const id = String(r.body?.id ?? "");
  // Out of the way of the repeat rule, so the next can be raised.
  if (id) await txs.updateOne({ _id: new ObjectId(id) }, { $set: { requested_at: `2026-01-0${++day}T00:00:00.000Z`, created_date: `2026-01-0${day}T00:00:00.000Z` } });
  return id;
};
const decide = (body: Record<string, unknown>) => call("POST", "/api/v1/integrations/finance/funding-decisions", body, { "x-finance-secret": DECISION_SECRET });
const financeApproves = async (id: string, aed: number) => {
  await until(async () => (await txOf(id))?.finance_approval?.state === "sent", 4000);
  return decide({ fundingId: id, financeId: "fin-x", decision: "approved", amountMinor: Math.round(aed / 3.67 * 100), transactionId: `TXN-${id.slice(-4)}-${aed}`, paymentMethod: "Card", mt5Login: "5550001", decidedBy: { name: "Asha Accountant" }, decidedAt: new Date().toISOString() });
};
const approvedBonus = async (aed = 2250) => { const id = await raise(aed); await financeApproves(id, aed); return id; };
const back = (id: string, body: Record<string, unknown>, token = brokerToken) => call("POST", "/api/functions/sendFundingBack", { id, ...body }, as(token));
const correct = (id: string, body: Record<string, unknown>) => call("POST", "/api/functions/correctFundingRequest", { id, ...body }, as(mentorToken));
const approvals = async () => (await call("POST", "/api/functions/getBonusApprovals", {}, as(brokerToken))).body;

/* ── 1. To finance ─────────────────────────────────────────────────────── */
step("1. A broker admin sends a bonus finance approved back to finance");
const a = await approvedBonus(2250);
let t = await txOf(a);
check("finance approved it: with the broker admins", t?.status === "PENDING" && t?.finance_approval?.decision === "approved", JSON.stringify(t?.finance_approval));
const asked = { to: "finance", fields: ["amount", "receipt"], note: "The receipt shows AED 4,500, not 2,250" };

rmode = "refuse";
let r = await back(a, asked);
t = await txOf(a);
check("finance refuses (reconciled): 409 with finance's words, nothing changed here",
  r.status === 409 && /reconciled/.test(r.body?.error ?? r.body?.message ?? JSON.stringify(r.body)) && t?.finance_approval?.state === "decided" && !t?.rechecking, show(r));
rmode = "down";
r = await back(a, asked);
t = await txOf(a);
check("finance unreachable: 502, nothing changed", r.status === 502 && t?.finance_approval?.state === "decided" && !t?.rechecking, show(r));
rmode = "ok";
const before = rechecks.length;
r = await back(a, asked);
t = await txOf(a);
const sent = rechecks[rechecks.length - 1];
check("taken: 200", r.status === 200 && r.body?.rechecking?.from === "broker_admin", show(r));
check("finance was asked signed, for its organization, with the request and what to check",
  rechecks.length === before + 1 && badSignatures === 0 && sent?.org === ORG_ID && sent?.body?.externalId === a && sent?.body?.type === "BONUS"
  && sent?.body?.recheck?.from === "broker_admin" && sent?.body?.recheck?.byName === "Broker Bo"
  && JSON.stringify(sent?.body?.recheck?.fields) === '["amount","receipt"]' && /4,500/.test(sent?.body?.recheck?.note ?? "")
  && typeof sent?.body?.recheck?.key === "string" && sent.body.recheck.key.startsWith(a), JSON.stringify(sent?.body?.recheck));
check("…and the same amounts it had (finance corrects them)", sent?.body?.amountMinor === Math.round(2250 / 3.67 * 100) && sent?.body?.coursePayment?.paidTodayAed === 2250, JSON.stringify({ a: sent?.body?.amountMinor, cp: sent?.body?.coursePayment }));
check("with finance again: sent, its approval kept in rechecks, rechecking says who and why",
  t?.status === "PENDING" && t?.finance_approval?.state === "sent" && !t?.finance_approval?.decision
  && t?.finance_approval?.rechecks?.[0]?.previous?.decided_by_name === "Asha Accountant" && t?.rechecking?.by_name === "Broker Bo" && t?.rechecking?.fields?.length === 2,
  JSON.stringify({ fa: t?.finance_approval, rechecking: t?.rechecking }));
check("…in its corrections", t?.corrections?.some((c: any) => c.kind === "sent_to_finance"), JSON.stringify(t?.corrections));
let list = await approvals();
check("MT5 Approvals: off pending, on the Sent back tab", !list?.pending?.some((x: any) => x.id === a) && list?.returned?.some((x: any) => x.id === a && x.rechecking?.at), JSON.stringify(list?.counts));
r = await call("PATCH", `/api/entities/FundingTransaction/${a}`, { status: "APPROVED" }, as(brokerToken));
check("the broker admin can't approve it while finance has it", r.status >= 400 && (await txOf(a))?.status === "PENDING", show(r));
r = await back(a, asked);
check("sent again while finance has it: refused", r.status === 409, show(r));
r = await decide({ fundingId: a, financeId: "fin-r", decision: "approved", amountMinor: Math.round(4500 / 3.67 * 100), transactionId: "TXN-A-4500", decidedBy: { name: "Asha Accountant" }, decidedAt: new Date().toISOString() });
t = await txOf(a);
check("finance approves it again at AED 4,500: back with the broker admins, at that amount",
  r.status === 200 && t?.status === "PENDING" && t?.finance_approval?.decision === "approved" && !t?.rechecking
  // Finance decides in dollars: $1,226.16 back in AED is 4,500.01 — as any amount finance corrects.
  && Math.abs(t?.course_payment?.paid_today_aed - 4500) < 0.05 && t?.course_payment?.requested_paid_today_aed === 2250, `${show(r)} ${JSON.stringify({ cp: t?.course_payment, rechecking: t?.rechecking })}`);
list = await approvals();
check("…on pending again", list?.pending?.some((x: any) => x.id === a) && !list?.returned?.some((x: any) => x.id === a));
r = await call("PATCH", `/api/entities/FundingTransaction/${a}`, { status: "APPROVED", approved_by_name: "Broker Bo", transaction_id: "MT5-A" }, as(brokerToken));
check("and the broker admin approves it", r.status === 200 && (await txOf(a))?.status === "APPROVED", show(r));

/* ── 2. Refused ────────────────────────────────────────────────────────── */
step("2. Not one for finance, or not asked right");
const b = await approvedBonus(2000);
r = await back(b, asked, mentorToken);
check("a CS can't send it anywhere", r.status === 403, show(r));
r = await back(b, { to: "finance", fields: ["amount"], note: "" });
check("no note for finance: refused", r.status === 400 && (await txOf(b))?.finance_approval?.state === "decided", show(r));
r = await back(b, { to: "finance", fields: ["email"], note: "x" });
check("the email isn't finance's to check: refused", r.status === 400, show(r));
r = await back(b, { to: "somewhere", fields: ["amount"], note: "x" });
check("only the CS or finance", r.status === 400, show(r));
const dep = (await txs.insertOne({ type: "DEPOSIT", status: "PENDING", student_id: String(student._id), student_name: student.full_name, amount_usd: 100, amount_original: 100, amount_currency: "USD",
  requested_by_id: String(mentor._id), primary_mentor_id: String(mentor._id), created_date: now })).insertedId.toString();
r = await back(dep, { to: "finance", fields: ["amount"], note: "x" });
check("a deposit never went to finance: refused", r.status === 409 && /Only a bonus/.test(r.body?.error ?? ""), show(r));
const withFin = await raise(1500);
await until(async () => (await txOf(withFin))?.finance_approval?.state === "sent", 4000);
r = await back(withFin, { to: "finance", fields: ["amount"], note: "x" });
check("one finance still has: refused", r.status === 409, show(r));
const credit = (await txs.insertOne({ type: "BONUS", status: "PENDING", bonus_credit: "sales_close", student_id: String(student._id), amount_usd: 500, created_date: now,
  finance_approval: { state: "decided", decision: "approved" } })).insertedId.toString();
r = await back(credit, { to: "finance", fields: ["amount"], note: "x" });
check("a sales-close credit: refused", r.status === 409, show(r));

/* ── 3. To the CS with the amount and the receipt ──────────────────────── */
step("3. Sent back to the CS: the amount and the receipt");
r = await back(b, { to: "cs", fields: ["amount", "receipt"], note: "Amount and receipt don't match" });
check("sent back to the CS with the amount and the receipt", r.status === 200 && JSON.stringify((await txOf(b))?.returned?.fields) === '["amount","receipt"]', show(r));
rmode = "refuse";
r = await correct(b, { amount: 4000, receiptUrl: "http://127.0.0.1/uploads/new-proof.png", receiptName: "new-proof.png" });
t = await txOf(b);
check("the CS's new amount, finance refusing: 409, nothing changed", r.status === 409 && t?.returned?.at && t?.amount_original === 2000 && t?.screenshot_url === "http://127.0.0.1/uploads/proof.png", show(r));
rmode = "ok";
const n2 = rechecks.length;
r = await correct(b, { amount: "4,000", receiptUrl: "http://127.0.0.1/uploads/new-proof.png", receiptName: "new-proof.png", note: "Typed it wrong" });
t = await txOf(b);
const sent2 = rechecks[rechecks.length - 1];
check("the CS's new amount and receipt: to finance again", r.status === 200 && r.body?.with_finance === true && rechecks.length === n2 + 1 && sent2?.body?.recheck?.from === "cs"
  && JSON.stringify(sent2?.body?.recheck?.fields) === '["amount","receipt"]' && sent2?.body?.recheck?.byName === "Cara Cs", `${show(r)} ${JSON.stringify(sent2?.body?.recheck)}`);
check("…finance sees the corrected amount and receipt", sent2?.body?.amountMinor === Math.round(4000 / 3.67 * 100) && sent2?.body?.coursePayment?.paidTodayAed === 4000
  && sent2?.body?.screenshotUrl === "http://127.0.0.1/uploads/new-proof.png", JSON.stringify({ a: sent2?.body?.amountMinor, cp: sent2?.body?.coursePayment, s: sent2?.body?.screenshotUrl }));
check("…kept here: the amounts, the receipt, corrected, with finance",
  t?.amount_original === 4000 && t?.amount_aed === 4000 && t?.amount_usd === Math.round(4000 / 3.67 * 100) / 100 && t?.course_payment?.paid_today_aed === 4000
  && t?.course_payment?.paid_total_aed === 4000 && t?.screenshot_url === "http://127.0.0.1/uploads/new-proof.png" && !t?.returned && t?.corrected?.to_finance === true
  && t?.finance_approval?.state === "sent" && t?.rechecking?.from === "cs", JSON.stringify({ o: t?.amount_original, usd: t?.amount_usd, cp: t?.course_payment, fa: t?.finance_approval?.state, rc: t?.rechecking }));
r = await decide({ fundingId: b, financeId: "fin-r2", decision: "approved", amountMinor: Math.round(4000 / 3.67 * 100), transactionId: "TXN-B-4000", decidedBy: { name: "Asha Accountant" }, decidedAt: new Date().toISOString() });
t = await txOf(b);
check("finance approves: back with the broker admins", r.status === 200 && t?.finance_approval?.decision === "approved" && !t?.rechecking && t?.status === "PENDING", show(r));

const c = await approvedBonus(1800);
await back(c, { fields: ["mt5"], note: "Wrong MT5" });
const n3 = rechecks.length;
r = await correct(c, { mt5Login: "5550009" });
t = await txOf(c);
check("an MT5 fix alone: straight back to the broker admin, not finance", r.status === 200 && !r.body?.with_finance && rechecks.length === n3
  && t?.finance_approval?.state === "decided" && t?.mt5_login === "5550009" && !t?.returned, show(r));

const d = await approvedBonus(2500);
await txs.updateOne({ _id: new ObjectId(d) }, { $set: { payments: [
  { method: "Card", amount: 1500, currency: "AED", receipt_url: "http://127.0.0.1/uploads/p1.png" },
  { method: "Cash", amount: 1000, currency: "AED", receipt_url: "http://127.0.0.1/uploads/p2.png" },
] } });
await back(d, { fields: ["amount"], note: "Check the amount" });
r = await correct(d, { amount: 3000 });
check("several payments: the amount isn't changed here", r.status === 409 && /several payments/.test(r.body?.error ?? "") && (await txOf(d))?.amount_original === 2500, show(r));

await back(dep, { fields: ["amount"], note: "It was $150" });
const n4 = rechecks.length;
r = await correct(dep, { amount: 150 });
t = await txOf(dep);
check("a deposit's amount: corrected, straight back", r.status === 200 && rechecks.length === n4 && t?.amount_usd === 150 && t?.amount_original === 150 && !t?.returned, show(r));

/* ── 4. As before ──────────────────────────────────────────────────────── */
step("4. As before");
const e = await approvedBonus(2100);
r = await back(e, { fields: ["email"], note: "Wrong email" });
check("no `to`: to the CS, as before", r.status === 200 && (await txOf(e))?.returned?.at && (await txOf(e))?.finance_approval?.state === "decided", show(r));
r = await correct(e, { email: "abel.new@e2e-recheck.test" });
check("…corrected straight back", r.status === 200 && !(await txOf(e))?.returned && (await db.collection("students").findOne({ _id: student._id }))?.email === "abel.new@e2e-recheck.test", show(r));

console.log(`\n${pass}/${pass + fail} checks passed`);
finance.stop(true);
await client.close();
process.exit(fail ? 1 : 0);
