/**
 * A course payment finance approved, then not counted here (the user, 2026-10-31: one AED 2,000 payment raised three
 * times — finance approved all three, a broker admin rejected two, finance kept all three):
 *
 *   1. The same payment isn't raised twice while the first stands (same student, course, amount, within a day).
 *   2. A broker admin rejecting one finance approved: finance is told to take its payment off — signed, with the
 *      organization it went to — and what finance answered is kept on the request.
 *   3. Finance down or deciding it again: tried again. Kept (a reconciled bank line) or refused: said so, not retried.
 *   4. Deleted (an admin, the master editor), cancelled, rejected by the master editor: told the same way.
 *   5. Not told: one finance rejected itself, one sent back to the CS (still PENDING), one never with finance.
 *   6. The clean-up script: an old rejection finance was never told of is listed, queued with --write, and sent.
 *
 * Run through ./test-finance-withdrawal.sh — a throwaway mongod, the API, and a stand-in finance served here.
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
const show = (r: Res) => `${r.status} ${JSON.stringify(r.body).slice(0, 240)}`;
async function until(fn: () => Promise<boolean>, ms = 6000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await Bun.sleep(100); }
  return false;
}

/* ── A stand-in finance: takes requests, and answers withdrawals as told. ── */
let wmode: "withdrawn" | "pending" | "kept" | "refuse" | "down" = "withdrawn";
const withdrawals: { body: any; org: string | null }[] = [];
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
    if (url.pathname !== "/api/v1/integrations/tetra-deposits/withdrawals") return Response.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
    withdrawals.push({ body, org: req.headers.get("x-delta-org") });
    if (wmode === "down") return Response.json({ error: { code: "INTERNAL", message: "Finance is having a moment" } }, { status: 503 });
    if (wmode === "refuse") return Response.json({ error: { code: "VALIDATION_ERROR", message: "externalId is CS Portal's request id" } }, { status: 422 });
    const message = wmode === "withdrawn" ? "AED 2,000.00 (RCT-00042) off IN-09999" : wmode === "kept" ? "Not taken off: reconciled" : "Being decided in finance again";
    return Response.json({ data: { outcome: wmode, message, removed: [] } });
  },
});

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({});
const txs = db.collection("funding_transactions");
const txOf = async (id: string) => (await txs.findOne({ _id: new ObjectId(id) })) as any;
const wOf = async (id: string) => (await db.collection("finance_withdrawals").findOne({ _id: id as any })) as any;

const hash = await bcrypt.hash("Password123!", 10);
const now = new Date().toISOString();
const person = (full_name: string, app_role: string) => ({
  _id: new ObjectId(), email: `${full_name.toLowerCase().replace(/\s+/g, ".")}@e2e-withdraw.test`, full_name, app_role, password_hash: hash, created_date: now, updated_date: now,
});
const admin = person("Super Admin", "super_admin");
const broker = person("Broker Bo", "broker_admin");
const mentor = person("Cara Cs", "junior_mentor");
await db.collection("users").insertMany([admin, broker, mentor]);
const student = {
  _id: new ObjectId(), full_name: "Abel Student", email: "abel@e2e-withdraw.test", student_code: "STU-9100", student_level: "LEVEL_1",
  status: "ACTIVE", primary_mentor_id: String(mentor._id), primary_mentor_name: mentor.full_name, team_name: "Team Money Heist", created_date: now,
};
await db.collection("students").insertOne(student);
await db.collection("mt5_accounts").insertOne({ _id: new ObjectId(), student_id: String(student._id), mt5_login: "5550001", platform: "MT5", created_date: now });

const login = async (u: any) => (await call("POST", "/api/auth/login", { email: u.email, password: "Password123!" })).body?.token as string;
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const [adminToken, brokerToken, mentorToken] = [await login(admin), await login(broker), await login(mentor)];
check("signed in", !!adminToken && !!brokerToken && !!mentorToken);
const patchAs = (token: string, id: string, data: Record<string, unknown>) => call("PATCH", `/api/entities/FundingTransaction/${id}`, data, as(token));
const cp = (aed: number, product = "DSLP Offer") => ({ product, kind: "partial", with_bonus: true, bonus_usd: 500, hold_aed: 0, balance_aed: 20000 - aed, paid_today_aed: aed, paid_before_aed: 0, paid_total_aed: aed, price: 20000, price_currency: "AED" });
const raise = (aed = 2000, over: Record<string, unknown> = {}) => call("POST", "/api/entities/FundingTransaction", {
  type: "BONUS", status: "PENDING", tags: ["Course"], student_id: String(student._id), student_name: student.full_name, student_code: student.student_code,
  amount_usd: Math.round(aed / 3.67 * 100) / 100, amount_original: aed, amount_currency: "AED", course_payment: cp(aed), payment_method: "Card", mt5_login: "5550001",
  screenshot_url: "http://127.0.0.1/uploads/proof.png", primary_mentor_id: String(mentor._id), primary_mentor_name: mentor.full_name,
  requested_by_id: String(mentor._id), requested_by_name: mentor.full_name, requested_at: new Date().toISOString(),
  initiating_mentor_id: String(mentor._id), initiating_mentor_name: mentor.full_name, ...over,
}, as(mentorToken));
const decide = (body: Record<string, unknown>) => call("POST", "/api/v1/integrations/finance/funding-decisions", body, { "x-finance-secret": DECISION_SECRET });
const financeApproves = async (id: string, aed = 2000) => {
  await until(async () => (await txOf(id))?.finance_approval?.state === "sent", 4000);
  return decide({ fundingId: id, financeId: "fin-x", decision: "approved", amountMinor: Math.round(aed / 3.67 * 100), transactionId: `TXN-${id.slice(-4)}`, paymentMethod: "Card", mt5Login: "5550001", decidedBy: { name: "Asha Accountant" }, decidedAt: new Date().toISOString() });
};
/** Raised and approved by finance — then out of the way of the repeat rule (a day old), so the next can be raised. */
const approvedByFinance = async (aed = 2000) => {
  const r = await raise(aed);
  const id = String(r.body?.id ?? "");
  await financeApproves(id, aed);
  await txs.updateOne({ _id: new ObjectId(id) }, { $set: { requested_at: "2026-01-01T00:00:00.000Z", created_date: "2026-01-01T00:00:00.000Z" } });
  return id;
};

/* ── 1. Raised twice ───────────────────────────────────────────────────── */
step("1. The same payment raised twice");
let r = await raise(2000);
const first = String(r.body?.id ?? "");
check("the first is raised", r.status === 200 && !!first, show(r));
r = await raise(2000);
check("the same course and amount again, while the first waits: refused, saying when and that it waits",
  r.status === 409 && /raised already — DSLP Offer, AED 2,000, .*waiting for approval/.test(JSON.stringify(r.body)), show(r));
r = await raise(2000, { course_payment: { ...cp(2000), product: "  dslp offer " } });
check("…whatever the course name's case or spacing", r.status === 409, show(r));
r = await raise(2500);
check("another amount is another payment: raised", r.status === 200, show(r));
const other = String(r.body?.id ?? "");
await financeApproves(first);
await patchAs(brokerToken, first, { status: "APPROVED", approved_by_name: "Broker Bo", transaction_id: "TXN-A1" });
r = await raise(2000);
check("refused while the first is approved, too", r.status === 409 && /approved\./.test(JSON.stringify(r.body)), show(r));
await txs.updateOne({ _id: new ObjectId(first) }, { $set: { requested_at: "2026-01-01T00:00:00.000Z", created_date: "2026-01-01T00:00:00.000Z" } });
r = await raise(2000);
check("a day later the same amount is a new payment: raised", r.status === 200, show(r));
const later = String(r.body?.id ?? "");
await txs.deleteMany({ _id: { $in: [new ObjectId(later), new ObjectId(other)] } });

/* ── 2. Rejected by a broker admin after finance approved ──────────────── */
step("2. Finance approved it; a broker admin rejects it as a repeat");
const a = await approvedByFinance();
const before = withdrawals.length;
r = await patchAs(brokerToken, a, { status: "REJECTED", rejection_reason: "Repeat of the same payment", approved_by_name: "Broker Bo" });
check("rejected here as usual", r.status === 200 && r.body?.status === "REJECTED", show(r));
check("finance is told at once, signed, for the organization it went to",
  await until(async () => withdrawals.length > before) && withdrawals[before]?.body?.externalId === a && withdrawals[before]?.org === ORG_ID && badSignatures === 0,
  JSON.stringify(withdrawals[before]));
check("…with who rejected it and why", withdrawals[before]?.body?.byName === "Broker Bo" && withdrawals[before]?.body?.reason === "Repeat of the same payment", JSON.stringify(withdrawals[before]?.body));
check("finance's answer is kept: done, what came off", await until(async () => (await wOf(a))?.state === "done")
  && (await txOf(a))?.finance_withdrawal?.state === "done" && /off IN-09999/.test((await txOf(a))?.finance_withdrawal?.message ?? ""), JSON.stringify(await wOf(a)));
const sentOnce = withdrawals.length;
await patchAs(brokerToken, a, { notes: "checked" });
await Bun.sleep(1500);
check("edited after that: not sent again", withdrawals.length === sentOnce, String(withdrawals.length - sentOnce));

/* ── 3. Down, pending, kept, refused ───────────────────────────────────── */
step("3. Finance down, deciding it again, keeping it, refusing");
wmode = "down";
const b = await approvedByFinance();
await patchAs(brokerToken, b, { status: "REJECTED", rejection_reason: "Repeat" });
check("finance down: kept to try again, with why", await until(async () => ((await wOf(b))?.attempts ?? 0) >= 1 && (await wOf(b))?.state === "queued" && /moment/.test((await wOf(b))?.last_error ?? "")), JSON.stringify(await wOf(b)));
wmode = "pending";
await db.collection("finance_withdrawals").updateOne({ _id: b as any }, { $set: { next_attempt_at: new Date(0).toISOString() } });
check("finance deciding it again: kept to try again", await until(async () => (await wOf(b))?.attempts >= 2 && (await wOf(b))?.state === "queued" && /decided in finance again/.test((await wOf(b))?.last_error ?? ""), 20000), JSON.stringify(await wOf(b)));
wmode = "withdrawn";
await db.collection("finance_withdrawals").updateOne({ _id: b as any }, { $set: { next_attempt_at: new Date(0).toISOString() } });
check("then taken: done", await until(async () => (await wOf(b))?.state === "done", 20000), JSON.stringify(await wOf(b)));
wmode = "kept";
const c = await approvedByFinance();
await patchAs(brokerToken, c, { status: "REJECTED", rejection_reason: "Repeat" });
check("finance keeps it (reconciled): said so, not tried again", await until(async () => (await wOf(c))?.state === "kept") && (await txOf(c))?.finance_withdrawal?.state === "kept"
  && /reconciled/.test((await txOf(c))?.finance_withdrawal?.message ?? ""), JSON.stringify(await wOf(c)));
wmode = "refuse";
const d = await approvedByFinance();
await patchAs(brokerToken, d, { status: "REJECTED", rejection_reason: "Repeat" });
check("finance refuses the message: refused, not tried again", await until(async () => (await wOf(d))?.state === "refused"), JSON.stringify(await wOf(d)));
wmode = "withdrawn";

/* ── 4. Deleted, cancelled, the master editor ──────────────────────────── */
step("4. Deleted, cancelled, or rejected through the master editor");
const e = await approvedByFinance();
r = await call("DELETE", `/api/entities/FundingTransaction/${e}`, undefined, as(adminToken));
check("deleted by an admin: finance is told", r.status === 200 && await until(async () => (await wOf(e))?.state === "done") && (await wOf(e))?.why === "deleted", `${show(r)} ${JSON.stringify(await wOf(e))}`);
const f = await approvedByFinance();
r = await call("POST", "/api/functions/masterEditTransaction", { id: f, patch: { status: "REJECTED", rejection_reason: "Duplicate" } }, as(adminToken));
check("rejected through the master editor: told", r.status === 200 && await until(async () => (await wOf(f))?.state === "done"), `${show(r)} ${JSON.stringify(await wOf(f))}`);
const g = await approvedByFinance();
r = await call("POST", "/api/functions/masterDeleteTransaction", { id: g }, as(adminToken));
check("deleted through the master editor: told", r.status === 200 && await until(async () => (await wOf(g))?.state === "done"), `${show(r)} ${JSON.stringify(await wOf(g))}`);
const h = await approvedByFinance();
await txs.updateOne({ _id: new ObjectId(h) }, { $set: { status: "APPROVED" } });
r = await call("POST", "/api/functions/masterBulkEditTransactions", { ids: [h], patch: { status: "REJECTED" } }, as(adminToken));
check("rejected in the bulk editor — even after it was approved: told", r.status === 200 && await until(async () => (await wOf(h))?.state === "done"), `${show(r)} ${JSON.stringify(await wOf(h))}`);
const k = await approvedByFinance();
await patchAs(adminToken, k, { status: "CANCELLED" });
check("cancelled: told", await until(async () => (await wOf(k))?.why === "cancelled" && (await wOf(k))?.state === "done"), JSON.stringify(await wOf(k)));

/* ── 5. Not told ───────────────────────────────────────────────────────── */
step("5. Nothing for finance to take off");
const quiet = withdrawals.length;
const m = String((await raise(2000)).body?.id ?? "");
await until(async () => (await txOf(m))?.finance_approval?.state === "sent", 4000);
await decide({ fundingId: m, decision: "rejected", reason: "No such payment", decidedBy: { name: "Asha Accountant" } });
await txs.updateOne({ _id: new ObjectId(m) }, { $set: { requested_at: "2026-01-01T00:00:00.000Z", created_date: "2026-01-01T00:00:00.000Z" } });
check("finance rejected it itself: rejected here, nothing sent", (await txOf(m))?.status === "REJECTED" && !(await wOf(m)), JSON.stringify((await txOf(m))?.finance_approval));
const s = await approvedByFinance();
r = await call("POST", "/api/functions/sendFundingBack", { id: s, fields: ["mt5"], note: "Wrong MT5" }, as(brokerToken));
const sentBack = await txOf(s);
check("sent back to the CS (still PENDING): nothing sent", sentBack?.status === "PENDING" && !(await wOf(s)), `${show(r)} ${sentBack?.status}`);
const plain = await txs.insertOne({ type: "DEPOSIT", status: "PENDING", student_id: String(student._id), amount_usd: 100, created_date: now });
await patchAs(brokerToken, String(plain.insertedId), { status: "REJECTED", rejection_reason: "x" });
await Bun.sleep(1500);
check("a deposit that never went to finance: nothing sent", withdrawals.length === quiet && !(await wOf(String(plain.insertedId))), String(withdrawals.length - quiet));

/* ── 6. The clean-up script ────────────────────────────────────────────── */
step("6. The clean-up script: rejections from before finance was told");
const old = await approvedByFinance();
// As before this: rejected here, finance never told.
await txs.updateOne({ _id: new ObjectId(old) }, { $set: { status: "REJECTED", rejection_reason: "Repeat (old)", approved_by_name: "Broker Bo" } });
const run = async (...args: string[]) => {
  const p = Bun.spawn(["bun", "--no-env-file", "src/scripts/withdraw-rejected-payments.ts", ...args], { stdout: "pipe", stderr: "pipe", env: process.env });
  const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
  return { code: await p.exited, out };
};
let out = await run();
check("the dry run lists it — and not the ones finance was told of already", out.code === 0 && out.out.includes(`…${old.slice(-6)}`) && /\n1 payment\(s\)/.test(out.out) && !out.out.includes(`…${a.slice(-6)}`), out.out);
out = await run("--write", "--expect", "3");
check("--expect that doesn't match queues nothing", out.code !== 0 && !(await wOf(old)), out.out);
out = await run("--write", "--expect", "1");
check("--write queues it, and the API sends it", out.code === 0 && await until(async () => (await wOf(old))?.state === "done", 20000)
  && withdrawals.some((w) => w.body.externalId === old && w.body.reason === "Repeat (old)"), `${out.out} ${JSON.stringify(await wOf(old))}`);
out = await run();
check("run again: nothing left", /\n0 payment\(s\)/.test(out.out), out.out);
out = await run("--status");
check("--status shows where each got to", out.out.includes(`…${old.slice(-6)}`) && /done/.test(out.out), out.out);

console.log(`\n${pass}/${pass + fail} checks passed`);
finance.stop(true);
await client.close();
process.exit(fail ? 1 : 0);
