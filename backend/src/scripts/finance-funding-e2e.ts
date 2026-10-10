/**
 * Funding requests and Delta finance, end to end, against a real API process
 * and a stand-in finance served here.
 *
 *   - a new DEPOSIT or WITHDRAWAL no longer goes to finance (the user,
 *     2026-10-10): only a broker admin or a Super Admin approves or rejects it
 *     here; deposits finance already had are still decided there (below, a
 *     deposit is put "with finance" as one sent before the switch was);
 *   - a new BONUS (a course payment) goes too, with its course payment, and
 *     needs its MT5 login and receipt; finance's approval is the first of two —
 *     it waits, PENDING, for a broker admin or a Super Admin, who are told and
 *     are the only ones who may approve it; a sales-close credit skips finance
 *     and a caller cannot claim to be one;
 *   - while finance has it, nobody here approves, rejects, deletes or changes
 *     what is being approved — not even the master editor;
 *   - finance's decision comes back on its own secret: approved at the amount
 *     finance settled on, commission credited up the chain, a Level 1
 *     student's first deposit moving them to Level 2, one audit line; or
 *     rejected with the accountant's reason;
 *   - the same decision twice is one decision, even at the same instant; a
 *     different one is refused, as is a transaction ID already used;
 *   - finance down is waited out; a bonus finance will not take is handed
 *     back and approved here;
 *   - the browser's own credit and co-mentor calls answer as they did.
 *
 * Run through ./test-finance-funding.sh. Refuses anything but a scratch database on 127.0.0.1.
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
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const show = (r: Res) => `${r.status} ${JSON.stringify(r.body).slice(0, 240)}`;
async function until(fn: () => Promise<boolean>, ms = 6000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await Bun.sleep(100);
  }
  return false;
}

/* ── A stand-in finance: checks each signature as finance's service-auth does, and answers as told. ── */
let mode: "up" | "down" | "refuse" = "up";
const received: { body: any; org: string | null }[] = [];
let badSignatures = 0;
const finance = Bun.serve({
  port: Number(process.env.E2E_FAKE_FINANCE_PORT),
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== "/api/v1/integrations/tetra-deposits") {
      return Response.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
    }
    const raw = await req.text();
    const ts = req.headers.get("x-delta-timestamp") ?? "";
    const nonce = req.headers.get("x-delta-nonce") ?? "";
    // Rebuilt here rather than imported, so the two sides cannot agree with themselves by mistake.
    const expected = createHmac("sha256", INBOUND_SECRET)
      .update(["POST", url.pathname + url.search, ts, nonce, createHash("sha256").update(raw).digest("hex")].join("\n"))
      .digest("hex");
    if (req.headers.get("x-delta-client") !== CLIENT_ID || req.headers.get("x-delta-signature") !== expected
      || !nonce || Math.abs(Date.now() - Number(ts)) > 300_000) {
      badSignatures++;
      return Response.json({ error: { code: "UNAUTHENTICATED", message: "Unauthorized" } }, { status: 401 });
    }
    if (mode === "down") return Response.json({ error: { code: "INTERNAL", message: "Finance is having a moment" } }, { status: 503 });
    if (mode === "refuse") return Response.json({ error: { code: "VALIDATION_ERROR", message: "student.name is required" } }, { status: 422 });
    const body = JSON.parse(raw);
    received.push({ body, org: req.headers.get("x-delta-org") });
    return Response.json({ data: { id: `fin-${received.length}`, status: "pending", externalId: body.externalId } });
  },
});

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
// Emptied rather than dropped: the API made its indexes when it started.
for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({});
const txs = db.collection("funding_transactions");
const txOf = async (id: string) => (await txs.findOne({ _id: new ObjectId(id) })) as any;

step("Setting up");
const indexes = await txs.indexes();
check("the API made the index the sender reads", indexes.some((i) => i.key?.["finance_approval.state"] === 1), JSON.stringify(indexes.map((i) => i.key)));
const hash = await bcrypt.hash("Password123!", 10);
const now = new Date().toISOString();
const plan = {
  _id: new ObjectId(), name: "E2E Plan", active: true, created_date: now,
  deposit_levels: [{ level: 1, percentage: 10 }, { level: 2, percentage: 5 }],
};
await db.collection("commission_plans").insertOne(plan);
const person = (full_name: string, app_role: string, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), email: `${full_name.toLowerCase().replace(/\s+/g, ".")}@e2e-funding.test`, full_name, app_role,
  password_hash: hash, created_date: now, updated_date: now, ...extra,
});
const admin = person("Super Admin", "super_admin");
const broker = person("Broker Bo", "broker_admin");
const plainAdmin = person("Plain Admin", "admin");
const chief = person("Chief Cara", "chief_mentor", { commission_plan_id: String(plan._id) });
const mentor = person("Mentor Meera", "junior_mentor", {
  commission_plan_id: String(plan._id), up_head_id: String(chief._id), up_head_name: chief.full_name,
});
await db.collection("users").insertMany([admin, chief, mentor, broker, plainAdmin]);
const student = {
  _id: new ObjectId(), full_name: "Student Sam", email: "sam@e2e-funding.test", student_code: "STU-0100",
  student_level: "LEVEL_1", status: "ACTIVE", primary_mentor_id: String(mentor._id), primary_mentor_name: mentor.full_name,
  team_name: "Team Cara", created_date: now,
};
const other = { ...student, _id: new ObjectId(), full_name: "Other Olga", email: "olga@e2e-funding.test", student_code: "STU-0101" };
await db.collection("students").insertMany([student, other]);
const mt5 = { _id: new ObjectId(), student_id: String(student._id), mt5_login: "5550001", platform: "MT5", created_date: now };
await db.collection("mt5_accounts").insertOne(mt5);

const login = async (u: any) => (await call("POST", "/api/auth/login", { email: u.email, password: "Password123!" })).body?.token as string;
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const adminToken = await login(admin);
const mentorToken = await login(mentor);
const brokerToken = await login(broker);
const plainToken = await login(plainAdmin);
check("an admin and a mentor can sign in", !!adminToken && !!mentorToken && !!brokerToken && !!plainToken);
const patchAs = (token: string, id: string, data: Record<string, unknown>) => call("PATCH", `/api/entities/FundingTransaction/${id}`, data, as(token));

/** A funding request as the Funding Requests form raises it. */
const raise = (over: Record<string, unknown> = {}) => call("POST", "/api/entities/FundingTransaction", {
  type: "DEPOSIT", status: "PENDING", student_id: String(student._id), student_name: student.full_name,
  student_code: student.student_code, amount_usd: 1000, payment_method: "USDT", mt5_login: "5550001",
  screenshot_url: "http://127.0.0.1/uploads/proof.png", primary_mentor_id: String(mentor._id),
  primary_mentor_name: mentor.full_name, requested_by_id: String(mentor._id), requested_by_name: mentor.full_name,
  requested_at: new Date().toISOString(), initiating_mentor_id: String(mentor._id), initiating_mentor_name: mentor.full_name,
  ...over,
}, as(mentorToken));
const stateOf = async (id: string) => (await txOf(id))?.finance_approval?.state;
/** A deposit sent to finance before deposits stopped going there (2026-10-10): still finance's to decide. */
let sentBefore = 0;
const withFinanceAlready = async (id: string) => {
  sentBefore++;
  const at = new Date().toISOString();
  await txs.updateOne({ _id: new ObjectId(id) }, { $set: { finance_approval: { state: "sent", queued_at: at, sent_at: at, attempts: 1, request_id: `fin-old-${sentBefore}` } } });
};
const decide = (body: Record<string, unknown>, secret: string | null = DECISION_SECRET) =>
  call("POST", "/api/v1/integrations/finance/funding-decisions", body, secret ? { "x-finance-secret": secret } : {});
const approve = (fundingId: string, over: Record<string, unknown> = {}) => decide({
  fundingId, financeId: "fin-x", decision: "approved", amountMinor: 95000, transactionId: "TXN-1001",
  paymentMethod: "USDT", mt5Login: "5550001", note: "Matched to the bank statement",
  decidedBy: { name: "Asha Accountant", email: "asha@delta.test" }, decidedAt: new Date().toISOString(), ...over,
});
const reject = (fundingId: string, over: Record<string, unknown> = {}) => decide({
  fundingId, decision: "rejected", reason: "No such payment on the statement", decidedBy: { name: "Asha Accountant" }, ...over,
});
const credits = (id: string) => db.collection("commission_credits").find({ transaction_id: id }).sort({ level: 1 }).toArray();
const logsFor = (id: string, action: string) => db.collection("logs").countDocuments({ entity_id: id, action_type: action });

step("The server's switch");
const link = await call("POST", "/api/functions/getFinanceLink", {}, as(mentorToken));
check("the pages can ask whether deposits go to finance — they do", link.status === 200 && link.body?.depositsToFinance === true, show(link));

step("A new deposit stays here, for a broker admin or a Super Admin (2026-10-10)");
const onOther = { student_id: String(other._id), student_name: other.full_name, student_code: other.student_code };
const n1r = await raise(onOther);
const n1 = String(n1r.body?.id ?? "");
await Bun.sleep(800);
check("raised by the mentor as usual, and not marked for finance", n1r.status === 200 && !!n1 && !n1r.body?.finance_approval, show(n1r));
check("nothing sent to finance", received.length === 0, String(received.length));
let r = await patchAs(plainToken, n1, { status: "APPROVED", approved_by_name: "Plain Admin" });
check("an admin who is not a broker admin cannot approve it", r.status === 403 && /broker admin/.test(JSON.stringify(r.body)), show(r));
r = await patchAs(plainToken, n1, { status: "REJECTED" });
check("nor reject it", r.status === 403, show(r));
r = await patchAs(mentorToken, n1, { status: "APPROVED" });
check("nor a mentor", r.status === 403, show(r));
r = await patchAs(plainToken, n1, { notes: "Checked the screenshot" });
check("an admin can still edit its other details", r.status === 200 && r.body?.notes === "Checked the screenshot" && r.body?.status === "PENDING", show(r));
r = await patchAs(brokerToken, n1, { status: "APPROVED", approved_by_name: "Broker Bo", transaction_id: "TXN-N1" });
check("a broker admin approves it", r.status === 200 && r.body?.status === "APPROVED", show(r));
const n2 = String((await raise(onOther)).body?.id ?? "");
r = await patchAs(adminToken, n2, { status: "REJECTED", rejection_reason: "Wrong amount" });
check("a Super Admin can decide one too", r.status === 200 && r.body?.status === "REJECTED", show(r));
r = await patchAs(plainToken, n2, { status: "PENDING" });
check("an admin cannot reopen a decided one either", r.status === 403, show(r));

step("Withdrawals, and whatever a caller claims, stay here");
const w = await raise({ type: "WITHDRAWAL", finance_approval: { state: "decided", decision: "approved" } });
await Bun.sleep(800);
check("a withdrawal is not sent, and the finance_approval it arrived with is dropped", w.status === 200 && !w.body?.finance_approval, show(w));
check("finance received nothing", received.length === 0, String(received.length));
const wid = String(w.body?.id ?? "");
r = await patchAs(plainToken, wid, { status: "APPROVED" });
check("an admin who is not a broker admin cannot approve a withdrawal", r.status === 403 && /withdrawal/.test(JSON.stringify(r.body)), show(r));
r = await patchAs(brokerToken, wid, { status: "REJECTED", rejection_reason: "Not enough equity" });
check("a broker admin decides it", r.status === 200 && r.body?.status === "REJECTED", show(r));

step("A deposit finance already had (sent before 2026-10-10)");
const d1r = await raise();
const d1 = String(d1r.body?.id ?? "");
await withFinanceAlready(d1);
check("with finance", (await stateOf(d1)) === "sent");

step("While finance has it, nobody here decides it");
const patch = (id: string, data: Record<string, unknown>) => call("PATCH", `/api/entities/FundingTransaction/${id}`, data, as(adminToken));
const fn = (name: string, body: unknown) => call("POST", `/api/functions/${name}`, body, as(adminToken));
r = await patch(d1, { status: "APPROVED", approved_by_name: "Super Admin" });
check("an admin cannot approve it here", r.status === 409 && /Delta Finance/.test(JSON.stringify(r.body)), show(r));
r = await patch(d1, { status: "REJECTED" });
check("nor reject it", r.status === 409, show(r));
r = await patch(d1, { amount_usd: 2000 });
check("nor change the amount finance is looking at", r.status === 409, show(r));
r = await patch(d1, { notes: "Client called about it", finance_approval: { state: "refused" } });
check("other details can still be edited — and finance_approval cannot be", r.status === 200 && r.body?.notes === "Client called about it" && r.body?.finance_approval?.state === "sent", show(r));
r = await call("DELETE", `/api/entities/FundingTransaction/${d1}`, undefined, as(adminToken));
check("nor delete it", r.status === 409, show(r));
r = await fn("masterEditTransaction", { id: d1, patch: { status: "APPROVED" } });
check("not even the master editor can approve it", r.status === 409, show(r));
r = await fn("masterBulkEditTransactions", { ids: [d1], patch: { amount_usd: 1 } });
check("nor bulk-edit its amount", r.status === 409, show(r));
r = await fn("masterDeleteTransaction", { id: d1 });
check("nor master-delete it", r.status === 409, show(r));
r = await fn("masterEditTransaction", { id: d1, patch: { payment_method: "UPI" } });
check("the master editor can still correct other fields", r.status === 200, show(r));
await patch(d1, { payment_method: "USDT" });
check("and it is still pending, with finance", (await txOf(d1))?.status === "PENDING" && (await stateOf(d1)) === "sent");

step("Only finance, on its own secret, with a decision that makes sense");
r = await decide({ fundingId: d1, decision: "approved", amountMinor: 95000, transactionId: "T" }, null);
check("no secret: refused", r.status === 401, show(r));
r = await decide({ fundingId: d1, decision: "approved", amountMinor: 95000, transactionId: "T" }, "not-the-secret");
check("the wrong secret: refused", r.status === 401, show(r));
r = await approve(d1, { transactionId: "" });
check("approving needs a transaction ID", r.status === 400, show(r));
r = await approve(d1, { amountMinor: 0 });
check("and an amount", r.status === 400, show(r));
r = await reject(d1, { reason: "" });
check("rejecting needs a reason", r.status === 400, show(r));
r = await decide({ fundingId: d1, decision: "maybe" });
check("a decision is approved or rejected", r.status === 400, show(r));
r = await approve(new ObjectId().toString());
check("a request no longer here: gone, so finance stops sending it", r.status === 410 && r.body?.error?.code === "GONE", show(r));
check("none of that touched it", (await txOf(d1))?.status === "PENDING" && (await credits(d1)).length === 0);

step("A request that never went to finance is not finance's to decide");
const legacy = await txs.insertOne({
  type: "DEPOSIT", status: "PENDING", student_id: String(other._id), student_name: other.full_name, amount_usd: 200,
  initiating_mentor_id: String(mentor._id), primary_mentor_id: String(mentor._id), requested_at: now, created_date: now,
});
r = await approve(String(legacy.insertedId), { transactionId: "TXN-L1" });
check("finance's decision on it is refused", r.status === 409 && r.body?.error?.code === "NOT_WITH_FINANCE", show(r));
r = await patch(String(legacy.insertedId), { status: "APPROVED", transaction_id: "TXN-L1", approved_by_name: "Super Admin" });
check("and it is approved here, as before", r.status === 200 && r.body?.status === "APPROVED", show(r));

step("A transaction ID already used is refused");
await txs.insertMany([
  { type: "DEPOSIT", status: "APPROVED", student_id: String(other._id), student_name: "Other Olga", amount_usd: 50, transaction_id: "TXN-OLD", created_date: now },
  { type: "DEPOSIT", status: "APPROVED", student_id: String(other._id), student_name: "Other Olga", amount_usd: 60, transaction_id: 777, created_date: now },
]);
r = await approve(d1, { transactionId: "TXN-OLD" });
check("one another request has", r.status === 409 && r.body?.error?.code === "DUPLICATE_TRANSACTION_ID" && /TXN-OLD/.test(r.body?.error?.message), show(r));
r = await approve(d1, { transactionId: "777" });
check("even one imported as a number", r.status === 409 && r.body?.error?.code === "DUPLICATE_TRANSACTION_ID", show(r));
check("and it is still pending, with nothing credited", (await txOf(d1))?.status === "PENDING" && (await credits(d1)).length === 0);

step("Approved in finance: approved here, with everything an approval does");
r = await approve(d1);
check("accepted", r.status === 200 && r.body?.data?.status === "APPROVED" && r.body.data.already === false, show(r));
let t = await txOf(d1);
check("approved at the amount finance settled on, the requested amount kept", t.status === "APPROVED" && t.amount_usd === 950 && t.requested_amount_usd === 1000, `${t.status} ${t.amount_usd} ${t.requested_amount_usd}`);
check("with finance's transaction ID, and its MT5 account matched", t.transaction_id === "TXN-1001" && t.mt5_account_id === String(mt5._id), `${t.transaction_id} ${t.mt5_account_id}`);
check("approved by the accountant, as Delta Finance", t.approved_by_name === "Asha Accountant (Delta Finance)" && !!t.approved_at, t.approved_by_name);
check("the decision and the accountant's note are on it", t.finance_approval?.state === "decided" && t.finance_approval.decision === "approved"
  && t.finance_approval.note === "Matched to the bank statement" && !!t.finance_approval.effects_at, JSON.stringify(t.finance_approval));
const c1 = await credits(d1);
check("commission credited up the chain, on 950", c1.length === 2 && c1[0]?.recipient_name === "Mentor Meera" && c1[0]?.commission_usd === 95
  && c1[1]?.recipient_name === "Chief Cara" && c1[1]?.commission_usd === 47.5, JSON.stringify(c1.map((c) => [c.recipient_name, c.commission_usd])));
check("the answer says so", r.body?.data?.credited === 2 && r.body?.data?.levelUpgraded === true, show(r));
const s1: any = await db.collection("students").findOne({ _id: student._id });
check("a Level 1 student's first deposit moves them to Level 2", s1?.student_level === "LEVEL_2", s1?.student_level);
const lv = await db.collection("student_history").find({ student_id: String(student._id), type: "level_changed" }).toArray();
check("and their history says who", lv.length === 1 && /Delta Finance/.test(String(lv[0]?.by_name)) && /first deposit/.test(String(lv[0]?.text)), JSON.stringify(lv));
check("one audit line, in the accountant's name", (await logsFor(d1, "approve_funding_transaction")) === 1
  && !!(await db.collection("logs").findOne({ entity_id: d1, user_name: "Asha Accountant (Delta Finance)" })));

step("The same decision twice is one decision");
r = await approve(d1);
check("finance retrying: yes, already", r.status === 200 && r.body?.data?.already === true, show(r));
check("nothing credited twice, nothing logged twice", (await credits(d1)).length === 2 && (await logsFor(d1, "approve_funding_transaction")) === 1);
r = await reject(d1);
check("a different decision now: refused", r.status === 409 && r.body?.error?.code === "ALREADY_DECIDED", show(r));

step("A second deposit, both deliveries of its approval at once");
const d2 = String((await raise({ amount_usd: 500 })).body?.id ?? "");
await withFinanceAlready(d2);
const both = await Promise.all([
  approve(d2, { amountMinor: 50000, transactionId: "TXN-1002" }),
  approve(d2, { amountMinor: 50000, transactionId: "TXN-1002" }),
]);
check("one of them recorded it; the other was told it is done, or to send it again",
  both.filter((x) => x.status === 200 && x.body?.data?.already === false).length === 1
    && both.some((x) => (x.status === 200 && x.body?.data?.already === true) || (x.status === 503 && x.body?.error?.code === "IN_PROGRESS")),
  both.map(show).join(" | "));
r = await approve(d2, { amountMinor: 50000, transactionId: "TXN-1002" });
check("sent again: done", r.status === 200 && r.body?.data?.already === true, show(r));
check("credited once, logged once", (await credits(d2)).length === 2 && (await logsFor(d2, "approve_funding_transaction")) === 1,
  `${(await credits(d2)).length} credits`);
check("no second level change", (await db.collection("student_history").countDocuments({ student_id: String(student._id), type: "level_changed" })) === 1);

step("Rejected in finance");
const d3 = String((await raise({ amount_usd: 700 })).body?.id ?? "");
await withFinanceAlready(d3);
r = await reject(d3);
t = await txOf(d3);
check("rejected here, with the accountant's reason", r.status === 200 && t.status === "REJECTED" && t.rejection_reason === "No such payment on the statement"
  && t.approved_by_name === "Asha Accountant (Delta Finance)", show(r));
check("nothing credited, one audit line", (await credits(d3)).length === 0 && (await logsFor(d3, "reject_funding_transaction")) === 1);
r = await approve(d3, { transactionId: "TXN-1003" });
check("approving it after all: refused", r.status === 409, show(r));

step("Finance down: waited out, then sent (a bonus — deposits no longer go)");
mode = "down";
const toFinance = (over: Record<string, unknown>) => raise({ type: "BONUS", tags: ["Course"], ...over });
const d4 = String((await toFinance({ amount_usd: 400 })).body?.id ?? "");
check("tried at once, and kept to try again", await until(async () => ((await txOf(d4))?.finance_approval?.attempts ?? 0) >= 1, 3000)
  && (await stateOf(d4)) === "queued" && /moment/.test(String((await txOf(d4))?.finance_approval?.last_error)), JSON.stringify((await txOf(d4))?.finance_approval));
r = await patch(d4, { status: "APPROVED" });
check("still finance's while it waits to go", r.status === 409, show(r));
mode = "up";
await Bun.sleep(2200);
const d5 = String((await toFinance({ amount_usd: 300 })).body?.id ?? "");
check("once finance is back, the waiting one goes with the next", await until(async () => (await stateOf(d4)) === "sent" && (await stateOf(d5)) === "sent", 4000),
  `${await stateOf(d4)} / ${await stateOf(d5)}`);

step("A bonus finance will not take is handed back");
mode = "refuse";
const d6 = String((await toFinance({ amount_usd: 250 })).body?.id ?? "");
check("marked as handed back, with finance's reason", await until(async () => (await stateOf(d6)) === "refused", 3000)
  && /student\.name/.test(String((await txOf(d6))?.finance_approval?.reason)), JSON.stringify((await txOf(d6))?.finance_approval));
r = await approve(d6, { transactionId: "TXN-1006" });
check("finance deciding it after all: refused", r.status === 409 && r.body?.error?.code === "NOT_WITH_FINANCE", show(r));
r = await patch(d6, { status: "APPROVED", transaction_id: "TXN-1006", approved_by_name: "Super Admin" });
check("it is approved here instead", r.status === 200 && r.body?.status === "APPROVED", show(r));
mode = "up";

step("A bonus: Delta Finance first, then a broker admin");
const coursePayment = {
  product: "DWT", kind: "partial", with_bonus: true, bonus_usd: 500, hold_aed: 0, balance_aed: 1250,
  paid_today_aed: 2000, paid_before_aed: 0, paid_total_aed: 2000, price: 3250, price_currency: "AED", instalments: 2,
};
const bonus = (over: Record<string, unknown> = {}) => raise({ type: "BONUS", tags: ["Course"], amount_usd: 544.96, amount_original: 2000, amount_currency: "AED", course_payment: coursePayment, ...over });
r = await bonus({ mt5_login: "" });
check("a bonus without the student's MT5 login: refused", r.status === 400 && /MT5/.test(JSON.stringify(r.body)), show(r));
r = await bonus({ screenshot_url: "" });
check("nor without the payment receipt", r.status === 400 && /receipt/.test(JSON.stringify(r.body)), show(r));
const before = received.length;
const b1r = await bonus({ bonus_credit: "sales_close", sales_close: { invoice_id: "x" } });
const b1 = String(b1r.body?.id ?? "");
check("raised, marked for finance — the sales-close credit it claimed to be dropped", b1r.status === 200 && b1r.body?.finance_approval?.state === "queued" && !b1r.body?.bonus_credit && !b1r.body?.sales_close, show(b1r));
check("sent to finance at once", await until(async () => (await stateOf(b1)) === "sent", 3000), String(await stateOf(b1)));
const sentBonus = received[before]?.body;
check("as a bonus, with the amount as typed (AED) and its course payment",
  sentBonus?.type === "BONUS" && sentBonus.amountMinor === 54496 && sentBonus.amountOriginal === 2000 && sentBonus.amountCurrency === "AED"
    && sentBonus.coursePayment?.product === "DWT" && sentBonus.coursePayment.kind === "partial" && sentBonus.coursePayment.withBonus === true
    && sentBonus.coursePayment.bonusUsd === 500 && sentBonus.coursePayment.balanceAed === 1250 && sentBonus.coursePayment.paidTodayAed === 2000
    && sentBonus.coursePayment.priceCurrency === "AED", JSON.stringify(sentBonus).slice(0, 500));
check("…and its MT5 login and receipt", sentBonus?.mt5Login === "5550001" && sentBonus.screenshotUrl === "http://127.0.0.1/uploads/proof.png");
r = await patchAs(brokerToken, b1, { status: "APPROVED", transaction_id: "TXN-B1" });
check("while finance has it, not even a broker admin approves it", r.status === 409 && /Delta Finance/.test(JSON.stringify(r.body)), show(r));
r = await approve(b1, { transactionId: "TXN-B1", amountMinor: 54496 });
let tb = await txOf(b1);
check("finance approves: accepted, and it stays PENDING here", r.status === 200 && r.body?.data?.status === "PENDING" && tb.status === "PENDING", show(r));
check("…with finance's approval, transaction ID and note recorded", tb.finance_approval?.state === "decided" && tb.finance_approval?.decision === "approved"
  && tb.transaction_id === "TXN-B1" && tb.finance_approval?.note === "Matched to the bank statement", JSON.stringify(tb.finance_approval));
check("…not yet approved by anyone here, and nobody's commission credited", !tb.approved_by_name && (await credits(b1)).length === 0, `${tb.approved_by_name}`);
check("…one audit line for finance's part", (await logsFor(b1, "accounts_approve_bonus")) === 1);
const told = await db.collection("notifications").find({ type: "bonus_to_approve" }).toArray();
const toldIds = told.map((n: any) => n.user_id).sort();
check("the broker admins and Super Admins are told it is theirs now — nobody else",
  JSON.stringify(toldIds) === JSON.stringify([String(admin._id), String(broker._id)].sort()) && /500/.test(String(told[0]?.message)), JSON.stringify(told.map((n: any) => [n.user_id, n.title, n.message])));
r = await approve(b1, { transactionId: "TXN-B1", amountMinor: 54496 });
check("finance's approval again: the same, nothing more", r.status === 200 && r.body?.data?.already === true && (await txOf(b1)).status === "PENDING" && (await credits(b1)).length === 0, show(r));
r = await patchAs(plainToken, b1, { status: "APPROVED", approved_by_name: "Plain Admin" });
check("an admin who is not a broker admin cannot approve a bonus", r.status === 403 && /broker admin/.test(JSON.stringify(r.body)), show(r));
r = await patchAs(plainToken, b1, { status: "REJECTED" });
check("nor reject it", r.status === 403, show(r));
r = await patchAs(mentorToken, b1, { status: "APPROVED" });
check("nor a mentor", r.status === 403, show(r));
r = await patchAs(brokerToken, b1, { status: "APPROVED", approved_by_name: "Broker Bo", transaction_id: "TXN-B1" });
check("the broker admin approves it: approved", r.status === 200 && r.body?.status === "APPROVED", show(r));
r = await approve(b1, { transactionId: "TXN-B1", amountMinor: 54496 });
check("finance's approval arriving after that changes nothing", r.status === 200 && (await txOf(b1)).approved_by_name === "Broker Bo", show(r));

const b2 = String((await bonus({ amount_usd: 300 })).body?.id ?? "");
await until(async () => (await stateOf(b2)) === "sent", 3000);
r = await reject(b2);
tb = await txOf(b2);
check("a bonus finance rejects is rejected here, with the reason", r.status === 200 && tb.status === "REJECTED" && tb.rejection_reason === "No such payment on the statement", show(r));

const credit = await txs.insertOne({
  type: "BONUS", status: "PENDING", bonus_credit: "sales_close", student_id: String(student._id), student_name: student.full_name,
  amount_usd: 500, mt5_login: "5550001", created_date: now, requested_at: now,
});
const creditId = String(credit.insertedId);
r = await patchAs(plainToken, creditId, { status: "APPROVED" });
check("a sales-close credit never goes to finance — and still only a broker admin or Super Admin approves it", r.status === 403, show(r));
r = await patchAs(adminToken, creditId, { status: "APPROVED", approved_by_name: "Super Admin", transaction_id: "CREDIT-1" });
check("the Super Admin approves it straight away", r.status === 200 && r.body?.status === "APPROVED", show(r));

mode = "refuse";
const b3 = String((await bonus({ amount_usd: 200 })).body?.id ?? "");
check("a bonus finance will not take is handed back", await until(async () => (await stateOf(b3)) === "refused", 3000), String(await stateOf(b3)));
mode = "up";
r = await patchAs(plainToken, b3, { status: "APPROVED" });
check("…and still only a broker admin or Super Admin decides it", r.status === 403, show(r));
r = await patchAs(brokerToken, b3, { status: "APPROVED", approved_by_name: "Broker Bo", transaction_id: "TXN-B3" });
check("…who can, straight away", r.status === 200 && r.body?.status === "APPROVED", show(r));

r = await call("POST", "/api/functions/createReferralRequest", {
  student_id: String(other._id), receiving_mentor_id: String(chief._id), receiving_mentor_name: chief.full_name, transaction_type: "BONUS",
  tags: ["Course"], requested_deposit_amount: 100, mt5_login: "", screenshot_url: "http://127.0.0.1/uploads/proof.png",
}, as(mentorToken));
check("a co-management bonus without the MT5 login: refused too", r.status === 400 && /MT5/.test(JSON.stringify(r.body)), show(r));

step("The browser's own calls answer as before");
r = await fn("creditCommission", { transaction_id: n1 });
check("creditCommission credits a deposit a broker admin approved here", r.status === 200 && r.body?.ok === true && r.body?.credited === 2, show(r));
r = await fn("creditCommission", { transaction_id: n1 });
check("and not twice", r.status === 200 && r.body?.skipped === true && r.body?.reason === "Already credited", show(r));
r = await fn("creditCommission", { transaction_id: new ObjectId().toString() });
check("an unknown transaction: 404", r.status === 404, show(r));
r = await fn("updateCoMentorContribution", { student_id: String(student._id), mentor_id: String(mentor._id) });
check("updateCoMentorContribution answers as it did", r.status === 200 && r.body?.success === true, show(r));
r = await fn("updateCoMentorContribution", { student_id: new ObjectId().toString(), mentor_id: "x" });
check("and 404s an unknown student", r.status === 404, show(r));

finance.stop(true);
await client.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
