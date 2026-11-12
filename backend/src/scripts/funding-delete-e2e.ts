/**
 * Deleting a pending or rejected funding request (the user, 2026-11-12), here and from Delta Finance:
 *
 *   1. Who: a Super Admin any, a CS Manager, a CS their own students' only; others refused. A reason, always.
 *      Approved: refused (a Super Admin's master editor, as before).
 *   2. With finance, still deciding: finance takes its copy off first — signed, the right organization — then it goes.
 *      Finance decided it a moment earlier, finance down, an older finance: not deleted, said why, left as it was.
 *   3. Finance rejected it: deleted at once; finance told on the withdrawals queue, retried until it answers.
 *   4. Never with finance: deleted, finance not called.
 *   5. Kept whole (deleted_funding_requests), a line on the student's history and in the logs.
 *   6. Deleted in finance (POST /integrations/finance/funding-deleted): pending or rejected goes; approved stays;
 *      unknown and twice answered; a bad secret refused.
 *
 * Run through ./test-funding-delete.sh — a throwaway mongod, the API, and a stand-in finance served here.
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

/* ── A stand-in finance: takes requests, and answers removals as told. ── */
let mode: "removed" | "decided" | "down" | "old" | "refuse" = "removed";
const removals: { body: any; org: string | null }[] = [];
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
    removals.push({ body, org: req.headers.get("x-delta-org") });
    if (mode === "down") return Response.json({ error: { code: "INTERNAL", message: "Finance is having a moment" } }, { status: 503 });
    if (mode === "refuse") return Response.json({ error: { code: "VALIDATION_ERROR", message: "externalId is CS Portal's request id" } }, { status: 422 });
    if (mode === "old") return Response.json({ data: { outcome: "pending", message: "It is being decided in finance again — tried later", removed: [] } });
    if (mode === "decided") return Response.json({ data: { outcome: "decided", message: "Delta Finance approved it already — it stays", removed: [] } });
    return Response.json({ data: { outcome: "removed", message: "Taken off Delta Finance (it was pending)", removed: [] } });
  },
});

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({});
const txs = db.collection("funding_transactions");
const txOf = async (id: string) => (await txs.findOne({ _id: new ObjectId(id) })) as any;
const archived = async (id: string) => (await db.collection("deleted_funding_requests").findOne({ _id: new ObjectId(id) })) as any;
const historyOf = async (sid: string) => (await db.collection("student_history").find({ student_id: sid, type: "funding_deleted" }).toArray()) as any[];

const hash = await bcrypt.hash("Password123!", 10);
const now = new Date().toISOString();
const person = (full_name: string, app_role: string) => ({
  _id: new ObjectId(), email: `${full_name.toLowerCase().replace(/\s+/g, ".")}@e2e-fdel.test`, full_name, app_role, password_hash: hash, created_date: now, updated_date: now,
});
const admin = person("Super Admin", "super_admin");
const broker = person("Broker Bo", "broker_admin");
const cs = person("Cara Cs", "cs");
const otherCs = person("Omar Cs", "cs");
const manager = person("Mona Manager", "cs_manager");
await db.collection("users").insertMany([admin, broker, cs, otherCs, manager]);
const studentOf = (code: string, who: any) => ({
  _id: new ObjectId(), full_name: `Student ${code}`, email: `${code.toLowerCase()}@e2e-fdel.test`, student_code: code, student_level: "LEVEL_1",
  status: "ACTIVE", primary_mentor_id: String(who._id), primary_mentor_name: who.full_name, team_name: "Team Money Heist", created_date: now,
});
const mine = studentOf("STU-9201", cs);
const theirs = studentOf("STU-9202", otherCs);
const common = { ...studentOf("STU-9203", otherCs), common_cs: [{ id: String(cs._id), name: cs.full_name }] };
await db.collection("students").insertMany([mine, theirs, common]);

const login = async (u: any) => (await call("POST", "/api/auth/login", { email: u.email, password: "Password123!" })).body?.token as string;
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const [adminT, brokerT, csT, otherT, managerT] = [await login(admin), await login(broker), await login(cs), await login(otherCs), await login(manager)];
check("signed in", [adminT, brokerT, csT, otherT, managerT].every(Boolean));
const del = (token: string, id: string, reason = "Raised twice by mistake") => call("POST", "/api/functions/deleteFundingRequest", { id, reason }, as(token));

/** A request as it stands — inserted directly, in whatever state the case needs. */
const put = async (student: any, over: Record<string, any> = {}) => {
  const _id = new ObjectId();
  await txs.insertOne({
    _id, type: "BONUS", status: "PENDING", student_id: String(student._id), student_name: student.full_name, student_code: student.student_code,
    amount_usd: 545, amount_original: 2000, amount_currency: "AED", primary_mentor_id: student.primary_mentor_id, primary_mentor_name: student.primary_mentor_name,
    requested_by_id: student.primary_mentor_id, requested_at: now, created_date: now, ...over,
  } as any);
  return String(_id);
};
const sent = { state: "sent", sent_at: now, org: "delta_hq", request_id: "fin-0" };

/* ── 1. Who ──────────────────────────────────────────────────────────── */
step("1. Who deletes, and what");
let a = await put(mine, { type: "DEPOSIT" });
let r = await del(brokerT, a);
check("a broker admin: refused", r.status === 403, show(r));
r = await del(csT, a, " x ");
check("no real reason: refused", r.status === 400, show(r));
const b = await put(theirs, { type: "DEPOSIT" });
r = await del(csT, b);
check("a CS, another CS's student: not found", r.status === 404 && !!(await txOf(b)), show(r));
const c = await put(common, { type: "DEPOSIT" });
r = await del(csT, c);
check("a CS who is the student's Common CS: deleted", r.status === 200 && !(await txOf(c)), show(r));
r = await del(csT, a);
check("a CS, their own student's pending deposit: deleted, finance not involved", r.status === 200 && r.body?.finance === "none" && !(await txOf(a)), show(r));
const appr = await put(mine, { type: "DEPOSIT", status: "APPROVED" });
r = await del(adminT, appr);
check("approved: refused, even for a Super Admin", r.status === 409 && /only a pending or rejected/i.test(JSON.stringify(r.body)) && !!(await txOf(appr)), show(r));
const rej = await put(theirs, { type: "DEPOSIT", status: "REJECTED", rejection_reason: "Wrong MT5" });
r = await del(managerT, rej);
check("a CS Manager, a rejected deposit of any CS on their location: deleted", r.status === 200 && !(await txOf(rej)), show(r));
r = await del(otherT, b);
check("the other CS, their own: deleted", r.status === 200, show(r));
check("finance was not called for any of these", removals.length === 0, JSON.stringify(removals));

/* ── 2. Still with finance ───────────────────────────────────────────── */
step("2. With Delta Finance, still being decided");
const w1 = await put(mine, { finance_approval: { ...sent } });
r = await del(csT, w1, "Wrong amount");
const got = removals.at(-1);
check("finance asked first: signed, its organization, the request, who and why, as a deletion",
  r.status === 200 && r.body?.finance === "removed" && got?.org === ORG_ID && got?.body.externalId === w1 && got?.body.deleted === true
  && got?.body.byName === "Cara Cs" && got?.body.reason === "Wrong amount" && badSignatures === 0, `${show(r)} ${JSON.stringify(got)}`);
check("…then gone here", !(await txOf(w1)));
const arch = await archived(w1);
check("kept whole, with who, why and from where", arch?.doc?.amount_usd === 545 && arch?.by_name === "Cara Cs" && arch?.reason === "Wrong amount" && arch?.from === "cs_portal" && arch?.doc?.finance_approval?.state === "sent", JSON.stringify(arch));
const hist = await historyOf(String(mine._id));
check("a line on the student's history", hist.some((h) => /Cara Cs deleted a pending bonus request of 545 USD: Wrong amount/.test(h.text)), JSON.stringify(hist.map((h) => h.text)));
check("…and in the logs", !!(await db.collection("logs").findOne({ action_type: "delete_funding_request", entity_id: w1 })));

for (const [m, status, re, label] of [
  ["decided", 409, /approved it already/, "finance decided it a moment earlier"],
  ["down", 503, /could not be reached/, "finance down"],
  ["old", 503, /cannot take a pending request off yet/, "an older finance"],
  ["refuse", 409, /would not take it off/, "finance refuses the message"],
] as const) {
  mode = m;
  const id = await put(mine, { finance_approval: { ...sent } });
  r = await del(adminT, id);
  const tx = await txOf(id);
  check(`${label}: not deleted, said why, left with finance as it was`, r.status === status && re.test(JSON.stringify(r.body)) && tx?.status === "PENDING" && tx?.finance_approval?.state === "sent" && !tx?.finance_approval?.removing_from && !(await archived(id)), `${show(r)} ${JSON.stringify(tx?.finance_approval)}`);
}
mode = "removed";
const bang = await put(mine, { finance_approval: { ...sent, org: "bangalore" } });
r = await del(adminT, bang);
check("a Bangalore bonus: asked of Bangalore's finance", r.status === 200 && removals.at(-1)?.org === process.env.FINANCE_ORG_ID_BANGALORE, `${show(r)} ${removals.at(-1)?.org}`);

// Raised for real: sent by the worker, then deleted.
const raised = await call("POST", "/api/entities/FundingTransaction", {
  type: "BONUS", status: "PENDING", tags: ["Course"], student_id: String(mine._id), student_name: mine.full_name, student_code: mine.student_code,
  amount_usd: 300, amount_original: 1101, amount_currency: "AED", payment_method: "Card", mt5_login: "5550002",
  course_payment: { product: "DSLP Offer", kind: "partial", with_bonus: true, bonus_usd: 300, hold_aed: 0, balance_aed: 18899, paid_today_aed: 1101, paid_before_aed: 0, paid_total_aed: 1101, price: 20000, price_currency: "AED" },
  screenshot_url: "http://127.0.0.1/uploads/proof.png", primary_mentor_id: String(cs._id), primary_mentor_name: cs.full_name,
  requested_by_id: String(cs._id), requested_by_name: cs.full_name, requested_at: new Date().toISOString(),
  meeting_mentor_none: true,
}, as(csT));
const rid = String(raised.body?.id ?? "");
check("a bonus raised by the CS goes to finance", raised.status === 200 && await until(async () => (await txOf(rid))?.finance_approval?.state === "sent"), show(raised));
r = await del(csT, rid);
check("…and deleted by them: off finance, then gone", r.status === 200 && r.body?.finance === "removed" && !(await txOf(rid)) && removals.at(-1)?.body.externalId === rid, show(r));
r = await call("POST", "/api/v1/integrations/finance/funding-decisions", { fundingId: rid, financeId: "fin-x", decision: "approved", amountMinor: 30000, decidedBy: { name: "Asha" }, decidedAt: now }, { "x-finance-secret": DECISION_SECRET });
check("a late decision for it is answered as gone, not applied", r.status === 410 && !(await txOf(rid)), show(r));

/* ── 3. Finance rejected it ──────────────────────────────────────────── */
step("3. Rejected by Delta Finance");
mode = "down";
const fr = await put(mine, { status: "REJECTED", rejection_reason: "No receipt", finance_approval: { ...sent, state: "decided", decision: "rejected" } });
r = await del(csT, fr);
check("deleted at once, finance's copy queued", r.status === 200 && r.body?.finance === "queued" && !(await txOf(fr)), show(r));
const wOf = async (id: string) => (await db.collection("finance_withdrawals").findOne({ _id: id as any })) as any;
check("…finance down: waiting, tried again", await until(async () => (await wOf(fr))?.attempts >= 1 && (await wOf(fr))?.state === "queued"), JSON.stringify(await wOf(fr)));
mode = "removed";
await db.collection("finance_withdrawals").updateOne({ _id: fr as any }, { $set: { next_attempt_at: new Date().toISOString() } });
check("…finance back: taken off there, as a deletion", await until(async () => (await wOf(fr))?.state === "done", 25000)
  && removals.some((x) => x.body.externalId === fr && x.body.deleted === true), JSON.stringify(await wOf(fr)));

/* ── 4. From Delta Finance ───────────────────────────────────────────── */
step("4. Deleted in Delta Finance");
const fin = (body: Record<string, unknown>, secret = DECISION_SECRET) => call("POST", "/api/v1/integrations/finance/funding-deleted", body, { "x-finance-secret": secret });
const f1 = await put(mine, { finance_approval: { ...sent } });
r = await fin({ fundingId: f1, byName: "Maya Manager", reason: "Duplicate" }, "wrong-secret");
check("a bad secret: refused", r.status === 401 && !!(await txOf(f1)), show(r));
r = await fin({ fundingId: f1, byName: "Maya Manager", reason: "Duplicate" });
check("a pending one: deleted here too", r.status === 200 && r.body?.data?.outcome === "deleted" && !(await txOf(f1)), show(r));
const fa = await archived(f1);
check("…kept whole, as finance's doing", fa?.from === "finance" && fa?.by_name === "Maya Manager (Delta Finance)" && fa?.reason === "Duplicate", JSON.stringify(fa));
check("…on the student's history", (await historyOf(String(mine._id))).some((h) => /Maya Manager \(Delta Finance\) deleted a pending bonus .* in Delta Finance: Duplicate/.test(h.text)));
r = await fin({ fundingId: f1, byName: "Maya Manager", reason: "Duplicate" });
check("told twice: already", r.status === 200 && r.body?.data?.outcome === "already", show(r));
const f2 = await put(mine, { status: "REJECTED", rejection_reason: "x", finance_approval: { ...sent, state: "decided", decision: "rejected" } });
r = await fin({ fundingId: f2, byName: "Maya Manager", reason: "Old" });
check("a rejected one: deleted", r.body?.data?.outcome === "deleted" && !(await txOf(f2)), show(r));
const f3 = await put(mine, { status: "APPROVED" });
r = await fin({ fundingId: f3, byName: "Maya Manager", reason: "Old" });
check("an approved one: kept, and finance told so", r.body?.data?.outcome === "kept" && !!(await txOf(f3)), show(r));
r = await fin({ fundingId: new ObjectId().toHexString(), byName: "Maya Manager", reason: "Old" });
check("one never here: unknown", r.body?.data?.outcome === "unknown", show(r));
r = await fin({ fundingId: "nope" });
check("no id: refused", r.status === 400, show(r));

console.log(`\n${pass}/${pass + fail} checks passed`);
finance.stop(true);
await client.close();
process.exit(fail ? 1 : 0);
