/**
 * Balance payments (the user, 2026-10-11; 2026-10-13), end to end against the API and a stand-in finance:
 *   - fee updates from finance: applied, the same again changes nothing, an older one ignored, an unknown invoice 404,
 *     a wrong secret 401, a malformed one 400;
 *   - the Balance payments page (2026-10-13): only courses paid in parts HERE — a CS-tracker row, a Bonus course payment
 *     made in parts, an open course upgrade — never a sales close finance sent; scope, filters, search; the sidebar
 *     badge 0 (nothing here has a due date);
 *   - recording the next payment on a sales close: 410 — it is recorded in that sales CRM now;
 *   - the CS reminders module (no longer started) at 10:00 UAE: 3, 2, 1 days before, the day, overdue — once each, not when paid or void, not a
 *     test CS, a failed email retried (time-travelled by passing "now"; emails captured, none sent).
 * Run through ./test-balance-payments.sh (throwaway mongod, the API — no .env). Scratch database only.
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
const SECRET = process.env.FINANCE_S2S_SECRET!;
let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
const show = (v: unknown) => JSON.stringify(v).slice(0, 400);
async function until(fn: () => Promise<boolean>, ms = 8000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await Bun.sleep(150); }
  return false;
}
async function fn(name: string, body: unknown, token?: string): Promise<{ status: number; body: any }> {
  const r = await fetch(`${API}/api/functions/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function finance(path: string, body: unknown, secret = SECRET): Promise<{ status: number; body: any }> {
  const r = await fetch(`${API}/api/v1/integrations/finance/${path}`, {
    method: "POST", headers: { "content-type": "application/json", "x-finance-secret": secret }, body: JSON.stringify(body),
  });
  const j: any = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}
async function login(email: string): Promise<string> {
  const r = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "Password123!" }) });
  const token = ((await r.json().catch(() => ({}))) as any).token;
  if (!token) throw new Error(`could not sign in as ${email}: ${r.status}`);
  return token;
}
const uaeDay = (now = Date.now()) => new Date(now + 4 * 3_600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/* ── A stand-in finance: checks each signature as finance's service-auth does, and answers as told. ── */
const INBOUND_SECRET = process.env.FINANCE_INTEGRATION_SECRET!;
// Only "up" since 2026-10-13 (nothing is sent to finance from this page now); kept to show a refusal would surface.
let mode = "up" as "up" | "down" | "refuse";
const received: any[] = [];
const fake = Bun.serve({
  port: Number(process.env.E2E_FAKE_FINANCE_PORT),
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== "/api/v1/integrations/tetra-deposits") return Response.json({ error: { message: "Not found" } }, { status: 404 });
    const raw = await req.text();
    const ts = req.headers.get("x-delta-timestamp") ?? "", nonce = req.headers.get("x-delta-nonce") ?? "";
    const expected = createHmac("sha256", INBOUND_SECRET).update(["POST", url.pathname, ts, nonce, createHash("sha256").update(raw).digest("hex")].join("\n")).digest("hex");
    if (req.headers.get("x-delta-signature") !== expected) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
    if (mode === "down") return Response.json({ error: { message: "Finance is having a moment" } }, { status: 503 });
    if (mode === "refuse") return Response.json({ error: { code: "VALIDATION_ERROR", message: "More than the balance of the invoice" } }, { status: 422 });
    const body = JSON.parse(raw);
    received.push(body);
    return Response.json({ data: { id: `fin-${received.length}`, status: "pending", externalId: body.externalId } });
  },
});

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
for (const c of await db.listCollections().toArray()) if (c.name !== "commission_roles") await db.collection(c.name).deleteMany({});
const studentOf = async (s: any) => (await db.collection("students").findOne({ _id: s._id })) as any;
const feeOf = async (s: any, inv: string) => (await studentOf(s))?.course_fees?.find((f: any) => f.invoice_id === inv);

step("Setting up");
const hash = await bcrypt.hash("Password123!", 10);
const now = new Date().toISOString();
const today = uaeDay();
const person = (full_name: string, app_role: string, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), email: `${full_name.toLowerCase().replace(/\s+/g, ".")}@e2e-balance.test`, full_name, app_role,
  password_hash: hash, status: "active", created_date: now, updated_date: now, ...extra,
});
const admin = person("Super Admin", "super_admin");
const chief = person("Chief Cara", "chief_mentor");
const cs1 = person("Cee One", "cs", { up_head_id: String(chief._id) });
const cs2 = person("Cee Two", "cs");
const testCs = person("Tess Test", "cs", { email: "tess@deltatest.dev" });
await db.collection("users").insertMany([admin, chief, cs1, cs2, testCs] as any[]);
const fee = (inv: string, extra: Record<string, unknown> = {}) => ({
  invoice_id: inv, invoice_number: `IN-${inv}`, course: "DSLP", language: "", sales_crm: "delta", academy: "dubai", currency: "AED",
  fee_minor: 1_000_000, paid_minor: 400_000, balance_minor: 600_000, bonus_given: false, bonus_minor: 0, receipt_url: "", receipt_name: "", recorded_at: now, ...extra,
});
const stu = (code: string, cs: any, fees: any[], extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), student_code: code, full_name: `Student ${code}`, email: `${code.toLowerCase()}@e2e-balance.test`, phone: "+971500000000",
  primary_mentor_id: String(cs._id), primary_mentor_name: cs.full_name, status: "ACTIVE", created_date: now, course_fees: fees, ...extra,
});
const sA = stu("STU-A", cs1, [fee("INV-A")]);
const sB = stu("STU-B", cs1, [fee("INV-B", { currency: "INR", fee_minor: 5_000_000, paid_minor: 1_000_000, balance_minor: 4_000_000 })]);
const sC = stu("STU-C", cs2, [fee("INV-C")]);
const sD = stu("STU-D", cs1, [{ ...fee("tracker:CS:4"), source: "cs_tracker", next_due_on: addDays(today, 1) }]);
const sE = stu("STU-E", cs1, [fee("INV-E", { paid_minor: 1_000_000, balance_minor: 0 })]);
await db.collection("students").insertMany([sA, sB, sC, sD, sE] as any[]);
const tAdmin = await login(admin.email), tChief = await login(chief.email), tCs1 = await login(cs1.email), tCs2 = await login(cs2.email);

/* ── Case 1 — fee updates from finance ───────────────────────────────────── */
step("Case 1 — fee updates from finance");
const update = (inv: string, extra: Record<string, unknown> = {}) => ({
  invoiceId: inv, invoiceNumber: `IN-${inv}`, email: "x@e2e-balance.test", course: "DSLP", currency: "AED",
  totalMinor: 1_000_000, paidMinor: 500_000, balanceMinor: 500_000, status: "partial", nextDueOn: addDays(today, 2),
  payments: [{ amountMinor: 400_000, paidOn: addDays(today, -40), method: "Card" }, { amountMinor: 100_000, paidOn: addDays(today, -27), method: "Cash" }],
  updatedAt: "2026-10-11T08:00:00.000Z", ...extra,
});
let r = await finance("fee-updates", update("INV-A"), "wrong-secret");
check("a wrong secret: 401", r.status === 401, show(r));
r = await finance("fee-updates", update("INV-NOPE"));
check("an invoice no student here has: 404 UNKNOWN_INVOICE", r.status === 404 && r.body.error?.code === "UNKNOWN_INVOICE", show(r));
r = await finance("fee-updates", update("INV-A", { status: "weird" }));
check("a malformed one (status not known, no updatedAt, a bad date): 400", r.status === 400
  && (await finance("fee-updates", update("INV-A", { updatedAt: "" }))).status === 400
  && (await finance("fee-updates", update("INV-A", { nextDueOn: "2026-13-45" }))).status === 400, show(r));
r = await finance("fee-updates", update("INV-A"));
let f = await feeOf(sA, "INV-A");
check("applied: paid, balance, status, next due, payments, updated_at on the invoice's entry", r.status === 200 && r.body.data?.applied === true
  && f.paid_minor === 500_000 && f.balance_minor === 500_000 && f.status === "partial" && f.next_due_on === addDays(today, 2)
  && f.payments?.length === 2 && f.payments[1].paid_on === addDays(today, -27) && f.updated_at === "2026-10-11T08:00:00.000Z"
  && f.course === "DSLP" && f.receipt_url === "" , show({ r, f }));
const histA = async () => db.collection("student_history").countDocuments({ student_id: String(sA._id), type: "course_fees" });
check("…said in their history", (await histA()) === 1);
r = await finance("fee-updates", update("INV-A"));
check("the same update again: 200, nothing changes, no second history line", r.status === 200 && r.body.data?.applied === false && r.body.data?.already === true && (await histA()) === 1, show(r));
r = await finance("fee-updates", update("INV-A", { paidMinor: 100, balanceMinor: 999_900, updatedAt: "2026-10-11T07:00:00.000Z" }));
f = await feeOf(sA, "INV-A");
check("an older update is ignored — never overwrites the newer", r.status === 200 && r.body.data?.ignored === "older" && f.paid_minor === 500_000, show({ r, f: f.paid_minor }));
r = await finance("fee-updates", update("INV-B", { currency: "INR", totalMinor: 5_000_000, paidMinor: 1_000_000, balanceMinor: 4_000_000, nextDueOn: addDays(today, -1), payments: [{ amountMinor: 1_000_000, paidOn: addDays(today, -30), method: "Card" }] }));
await finance("fee-updates", update("INV-C", { nextDueOn: addDays(today, 10) }));
await finance("fee-updates", update("INV-E", { paidMinor: 1_000_000, balanceMinor: 0, status: "paid", nextDueOn: null }));
check("…and the others: INV-B overdue (INR), INV-C later, INV-E paid", r.status === 200 && (await feeOf(sB, "INV-B")).next_due_on === addDays(today, -1)
  && (await feeOf(sE, "INV-E")).status === "paid");

/* ── Case 2 — the page: TC's own part-payments only (2026-10-13) ───────────── */
step("Case 2 — the Balance payments page: courses paid in parts here, never a sales close");
// A Bonus course payment made in parts (DSLP: 18,370 planned, 6,000 + 2,000 paid), a full one (MBT), a turned-down part.
const ft = (sid: any, product: string, kind: string, plan: number, paid: number, status = "APPROVED") => ({
  _id: new ObjectId(), type: "BONUS", status, student_id: String(sid), requested_at: now, created_date: now,
  course_payment: { product, kind, plan_aed: plan, paid_today_aed: paid },
});
await db.collection("funding_transactions").insertMany([
  ft(sC._id, "DSLP", "partial", 18_370, 6_000), ft(sC._id, "DSLP", "partial", 18_370, 2_000, "PENDING"),
  ft(sC._id, "DSLP", "partial", 18_370, 5_000, "REJECTED"),
  ft(sE._id, "MBT", "full", 2_250, 2_250),
] as any[]);
// A course upgrade still being paid (10,000 due, 4,000 approved, 1,000 waiting).
const up = { _id: new ObjectId(), student_id: String(sB._id), status: "open", course: "DQMP", quote: { plan: "full", dueAed: 10_000, steps: 0, bonusUsd: 0, noBonusAed: 0 } };
await db.collection("course_upgrades").insertOne(up as any);
await db.collection("course_payments").insertMany([
  { upgrade_id: String(up._id), status: "approved", amount_aed: 4_000, approved_amount_aed: 4_000 },
  { upgrade_id: String(up._id), status: "pending", amount_aed: 1_000 },
] as any[]);
r = await fn("getBalancePayments", {}, tCs1);
const keyOf = (rows: any[]) => rows.map((x) => `${x.student_code}:${x.source}`).sort().join(",");
check("a CS: the CS-tracker row and the upgrade — never a sales close finance sent (STU-A, STU-B's invoice), nor one paid in full",
  r.status === 200 && keyOf(r.body.rows) === "STU-B:upgrade,STU-D:tracker", show(r.body));
const trk = r.body.rows?.find((x: any) => x.source === "tracker");
const upg = r.body.rows?.find((x: any) => x.source === "upgrade");
check("the tracker row: course, total, paid, balance as the tracker has them, labelled", trk?.course === "DSLP" && trk.total_minor === 1_000_000
  && trk.paid_minor === 400_000 && trk.balance_minor === 600_000 && trk.currency === "AED" && trk.source_label === "CS enrolment tracker" && trk.can_record === true, show(trk));
check("the upgrade: what finance approved counts, a waiting payment doesn't", upg?.course && upg.total_minor === 1_000_000 && upg.paid_minor === 400_000
  && upg.balance_minor === 600_000 && upg.source_label === "Course upgrade", show(upg));
r = await fn("getBalancePayments", {}, tCs2);
const bon = r.body.rows?.[0];
check("another CS: their bonus course paid in parts — waiting parts count, a turned-down one doesn't; a full one never listed",
  r.body.rows?.length === 1 && bon.source === "bonus" && bon.course === "DSLP" && bon.total_minor === 1_837_000 && bon.paid_minor === 800_000
  && bon.balance_minor === 1_037_000 && bon.source_label === "Bonus course payment", show(r.body));
check("counts by kind; filters; search", (await fn("getBalancePayments", {}, tAdmin)).body.counts?.all === 3
  && keyOf((await fn("getBalancePayments", { filter: "tracker" }, tAdmin)).body.rows) === "STU-D:tracker"
  && keyOf((await fn("getBalancePayments", { filter: "bonus" }, tAdmin)).body.rows) === "STU-C:bonus"
  && keyOf((await fn("getBalancePayments", { q: "stu-b" }, tAdmin)).body.rows) === "STU-B:upgrade");
check("their Chief Mentor: the downline's, read only", keyOf((await fn("getBalancePayments", {}, tChief)).body.rows) === "STU-B:upgrade,STU-D:tracker"
  && (await fn("getBalancePayments", {}, tChief)).body.rows.every((x: any) => x.can_record === false));
check("a Super Admin: everyone's, the biggest balance first (a tie by name)", (await fn("getBalancePayments", {}, tAdmin)).body.rows.map((x: any) => x.student_code).join() === "STU-C,STU-B,STU-D");
const navCount = async (t: string) => (await fn("getNavCounts", {}, t)).body.balance_due;
check("the sidebar badge: nothing due here any more — 0 for everyone", (await navCount(tCs1)) === 0 && (await navCount(tAdmin)) === 0);
check("no session: 401", (await fn("getBalancePayments", {})).status === 401);

/* ── Case 3 — a sales close's payment is recorded in its CRM now ─────────── */
step("Case 3 — Record next payment: no longer here for a sales close");
r = await fn("recordBalancePayment", { studentId: String(sA._id), invoiceId: "INV-A", amountMinor: 100_000, method: "Card", paidOn: today, receiptUrl: "https://files.example.test/r.png" }, tCs1);
check("410, saying it is recorded in the sales CRM now", r.status === 410 && /sales CRM/.test(r.body?.error ?? r.body?.message ?? JSON.stringify(r.body)), show(r));
check("…nothing queued for finance", (await db.collection("enrolment_payments").countDocuments({})) === 0 && received.length === 0);

/* ── Case 4 — the CS reminders at 10:00 UAE ──────────────────────────────── */
step("Case 4 — CS reminders (the module; no longer started by the API since 2026-10-13): once each");
const { connectDb } = await import("../db");
const { runBalanceReminders, retryBalanceReminders, balanceReminderTick } = await import("../students/balanceReminders");
await connectDb();
await db.collection("students").deleteMany({});
await db.collection("notifications").deleteMany({});
const D = "2026-11-02";
const at10 = (d: string, mins = 0) => Date.parse(`${d}T06:00:00Z`) + mins * 60_000;   // 10:00 UAE
const due = (inv: string, nextDueOn: string, extra: Record<string, unknown> = {}) => fee(inv, { status: "partial", next_due_on: nextDueOn, balance_minor: 300_000, ...extra });
const r1 = stu("STU-R1", cs1, [due("R1", addDays(D, 3))]);
const r2 = stu("STU-R2", cs1, [due("R2", addDays(D, 1))]);
const r3 = stu("STU-R3", cs1, [due("R3", addDays(D, -2))]);
const r4 = stu("STU-R4", cs1, [due("R4", addDays(D, 2), { balance_minor: 0, status: "paid" })]);
const r5 = stu("STU-R5", cs1, [due("R5", addDays(D, 2), { status: "void" })]);
const r6 = stu("STU-R6", cs2, [due("R6", addDays(D, 10))]);
const r7 = stu("STU-R7", testCs, [due("R7", addDays(D, 1))]);
const r8 = stu("STU-R8", cs1, [{ ...due("tracker:X:1", addDays(D, 1)), source: "cs_tracker" }]);
await db.collection("students").insertMany([r1, r2, r3, r4, r5, r6, r7, r8] as any[]);
const mails: any[] = [];
const capture = async (m: any) => { mails.push(m); return { ok: true as const, messageId: `<m${mails.length}@e2e>`, accepted: [m.to], response: "250 OK" }; };
let sum = await runBalanceReminders(at10(D), { send: capture });
check("day D: one email to the CS — 3 days (R1), 1 day (R2), overdue (R3); not paid, void, tracker, later, or a test CS's",
  mails.length === 1 && mails[0].to === cs1.email && sum.items === 3 && /STU-R1/.test(mails[0].text) && /STU-R2/.test(mails[0].text) && /STU-R3/.test(mails[0].text)
  && !/STU-R4|STU-R5|STU-R6|STU-R7|STU-R8/.test(mails[0].text) && /1 overdue, 2 due soon/.test(mails[0].subject), show({ sum, subject: mails[0]?.subject }));
check("…and the bell for the CS, nobody else", (await db.collection("notifications").countDocuments({ type: "balance_payments_due", user_id: String(cs1._id) })) === 1
  && (await db.collection("notifications").countDocuments({ type: "balance_payments_due" })) === 1);
sum = await runBalanceReminders(at10(D, 60), { send: capture });
check("run again the same day: nobody told twice", mails.length === 1 && sum.items === 0, show(sum));
sum = await runBalanceReminders(at10(addDays(D, 1)), { send: capture });
check("day D+1: R1 now 2 days, R2 due today — R3 overdue already told", mails.length === 2 && sum.items === 2 && /STU-R1/.test(mails[1].text) && /STU-R2/.test(mails[1].text) && !/STU-R3/.test(mails[1].text)
  && /due today/.test(mails[1].text), show(sum));
await db.collection("students").updateOne({ _id: r1._id }, { $set: { "course_fees.0.balance_minor": 0, "course_fees.0.status": "paid" } });
sum = await runBalanceReminders(at10(addDays(D, 2)), { send: capture });
check("day D+2: R1 paid in full — not told; R2 now overdue — told once", mails.length === 3 && sum.items === 1 && /STU-R2/.test(mails[2].text) && !/STU-R1/.test(mails[2].text) && /overdue/.test(mails[2].text), show(sum));
// A payment moves the due date: the new one is told again.
await db.collection("students").updateOne({ _id: r3._id }, { $set: { "course_fees.0.next_due_on": addDays(D, 4) } });
const failing = async () => ({ ok: false as const, error: "Connection refused" });
sum = await runBalanceReminders(at10(addDays(D, 3)), { send: failing });
const failed: any = await db.collection("balance_reminders").findOne({ date: addDays(D, 3) });
check("day D+3: R3's new due date (1 day) is told; the email fails — recorded failed", sum.failed === 1 && failed?.status === "failed" && failed.items?.[0]?.student_code === "STU-R3", show(sum));
check("…retried later that day, sent", (await retryBalanceReminders(at10(addDays(D, 3), 31), { send: capture })) === 1 && mails.length === 4 && /STU-R3/.test(mails[3].text)
  && ((await db.collection("balance_reminders").findOne({ _id: failed._id })) as any)?.status === "sent");
check("before 10:00 UAE the tick does nothing", (await balanceReminderTick(Date.parse(`${addDays(D, 4)}T04:00:00Z`), { send: capture })) === null);
const ticked = await balanceReminderTick(at10(addDays(D, 4), 5), { send: capture });
check("from 10:00 the tick runs the day once", ticked?.date === addDays(D, 4) && (await balanceReminderTick(at10(addDays(D, 4), 10), { send: capture })) === null, show(ticked));

console.log(`\n${pass} passed, ${fail} failed`);
fake.stop(true);
await client.close();
process.exit(fail ? 1 : 0);
