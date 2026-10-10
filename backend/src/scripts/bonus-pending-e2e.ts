/**
 * "Bonus pending" on the Students page and the student page (students/bonusPending.ts, the user 2026-10-10), on
 * made-up staff and students:
 *   - each list row carries its pending bonuses — the amount (USD) and where they wait: with finance (sent, or queued
 *     while the link is on), or waiting for a broker admin (finance approved it, a sales-close / course-upgrade bonus
 *     credit, one that never went to finance, one finance handed back, one queued with the link off);
 *   - several: the count, the total and the earliest stage; approved / rejected bonuses and pending deposits don't count;
 *   - the "Bonus pending" filter returns only those students, combines with another filter and with the tabs, and the
 *     total follows it; the export (all) carries it too;
 *   - scope: a CS sees only their own students, in the list and on the student page;
 *   - a bonus promised at the sales close (course_fees) and not sent to be credited yet: "needs call + MT5" — in USD
 *     at 3.67, never counted twice once sent, the earliest stage; the filter by each stage.
 * Read-only: nothing in funding_transactions or students changes.
 * Run through ./test-bonus-pending.sh. Refuses anything but a scratch database on 127.0.0.1.
 */
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "", dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) { console.error("Refusing to run"); process.exit(1); }
let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); } else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const client = await new MongoClient(uri).connect();
const db = client.db(dbName);
await db.dropDatabase();

// The finance link on (made-up — nothing is sent: no worker runs here), read by config when it is first imported.
Object.assign(process.env, {
  FINANCE_API_URL: "http://127.0.0.1:9", FINANCE_CLIENT_ID: "bonus-pending-e2e", FINANCE_INTEGRATION_SECRET: "bonus-pending-e2e-secret-0123456789", FINANCE_ORG_ID: "org-e2e",
});
const { connectDb, closeDb } = await import("../db");
const { config } = await import("../config");
const { financeFundingConfigured } = await import("../finance/funding");
const { listStudents, getStudentBonusPending } = await import("../functions/studentsList");
await connectDb();
check("the finance link is on for the test", financeFundingConfigured());

const now = new Date().toISOString();
const u = (name: string, app_role: string) => ({ _id: new ObjectId(), full_name: name, email: `${name.toLowerCase()}@e2e.test`, app_role, status: "active", created_date: now });
const boss = u("Boss", "super_admin"), cs1 = u("Cee1", "cs"), cs2 = u("Cee2", "cs");
await db.collection("users").insertMany([boss, cs1, cs2] as any[]);
// A CS sees their own students (Role Management's "own").
await db.collection("commission_roles").insertOne({ role_key: "cs", name: "CS", data_scope: "own" } as any);
const as = (x: any) => ({ id: String(x._id), email: x.email, full_name: x.full_name, app_role: x.app_role }) as any;
const BOSS = as(boss), CS1 = as(cs1), CS2 = as(cs2);

let n = 0;
const student = (name: string, cs: any | null, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), student_code: `STU-${String(++n).padStart(4, "0")}`, full_name: name, email: `${name.toLowerCase().replace(/\s+/g, "")}@stu.test`,
  status: "ACTIVE", created_date: `2026-10-${String(n).padStart(2, "0")}T00:00:00.000Z`,
  ...(cs ? { primary_mentor_id: String(cs._id), primary_mentor_name: cs.full_name, assignment_status: "assigned" } : { assignment_status: "open_pool" }),
  ...extra,
});
const sSent = student("Sent Finance", cs1, { language: "English" });
const sApproved = student("Finance Approved", cs1, { language: "Tamil" });
const sCredit = student("Sales Credit", cs2, { language: "English" });
const sMixed = student("Mixed Two", cs1, { language: "English" });
const sDecided = student("Decided Only", cs2);
const sDeposit = student("Deposit Only", cs1);
const sHere = student("Decided Here", cs1);
const sNone = student("Nothing At All", cs1, { language: "English" });
const sPool = student("Open Pool Bonus", null);
await db.collection("students").insertMany([sSent, sApproved, sCredit, sMixed, sDecided, sDeposit, sHere, sNone, sPool] as any[]);

const tx = (s: any, amount_usd: number, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), type: "BONUS", status: "PENDING", student_id: String(s._id), student_name: s.full_name, student_code: s.student_code,
  primary_mentor_id: s.primary_mentor_id ?? "", amount_currency: "USD", amount_original: amount_usd, amount_usd, mt5_login: "7001001",
  requested_at: now, created_date: now, updated_date: now, tags: [], ...extra,
});
const txs = [
  tx(sSent, 500, { finance_approval: { state: "sent" } }),
  tx(sApproved, 1000, { finance_approval: { state: "decided", decision: "approved" } }),
  tx(sCredit, 300, { bonus_credit: "sales_close", sales_close: { invoice_id: "inv-1" } }),
  // Mixed: one queued for finance (with finance while the link is on), and a course-upgrade credit — the oldest first.
  tx(sMixed, 200, { finance_approval: { state: "queued" }, requested_at: "2026-10-03T08:00:00.000Z" }),
  tx(sMixed, 100.5, { bonus_credit: "course_upgrade", requested_at: "2026-10-01T08:00:00.000Z" }),
  // Decided: neither counts.
  tx(sDecided, 700, { status: "APPROVED", approved_at: now, transaction_id: "TX-1" }),
  tx(sDecided, 800, { status: "REJECTED", rejection_reason: "No receipt", finance_approval: { state: "decided", decision: "rejected" } }),
  // A pending deposit is no bonus.
  tx(sDeposit, 900, { type: "DEPOSIT" }),
  // Decided here: never went to finance, and one finance handed back.
  tx(sHere, 50, {}),
  tx(sHere, 25, { finance_approval: { state: "refused", reason: "malformed" } }),
  tx(sPool, 75, { finance_approval: { state: "sent" } }),
];
await db.collection("funding_transactions").insertMany(txs as any[]);
const before = JSON.stringify(await db.collection("funding_transactions").find().sort({ _id: 1 }).toArray()) + JSON.stringify(await db.collection("students").find().sort({ _id: 1 }).toArray());

const list = async (who: any, body: Record<string, unknown>) => {
  const res = await listStudents(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), who);
  return { status: res.status, body: (await res.json()) as any };
};
const names = (rows: any[] | undefined) => (rows ?? []).map((r: any) => r.full_name).sort().join(", ");
const rowOf = (rows: any[], s: any) => rows.find((r: any) => r.id === String(s._id));

console.log("\n\x1b[1mEach row says what is pending and where\x1b[0m");
let r = await list(BOSS, { tab: "all" });
const rows = r.body.rows as any[];
check("the list answers, everyone on it", r.status === 200 && r.body.total === 9, `${r.status} ${r.body.total}`);
const bp = (s: any) => rowOf(rows, s)?.bonus_pending;
check("sent to finance: $500, with finance", bp(sSent)?.count === 1 && bp(sSent)?.total_usd === 500 && bp(sSent)?.stage === "with_finance", JSON.stringify(bp(sSent)));
check("finance approved it: $1,000, waiting for a broker admin", bp(sApproved)?.count === 1 && bp(sApproved)?.total_usd === 1000 && bp(sApproved)?.stage === "waiting_broker", JSON.stringify(bp(sApproved)));
check("a sales-close bonus credit: $300, waiting for a broker admin", bp(sCredit)?.total_usd === 300 && bp(sCredit)?.stage === "waiting_broker" && bp(sCredit)?.waiting_broker?.count === 1);
const m = bp(sMixed);
check("two pending: their count and total ($300.50), the earliest stage (with finance)", m?.count === 2 && m?.total_usd === 300.5 && m?.stage === "with_finance", JSON.stringify(m));
check("…how many are where: 1 with finance ($200), 1 waiting for a broker admin ($100.50)",
  m?.with_finance?.count === 1 && m?.with_finance?.total_usd === 200 && m?.waiting_broker?.count === 1 && m?.waiting_broker?.total_usd === 100.5, JSON.stringify(m));
check("…since the oldest of them was requested", m?.since === "2026-10-01T08:00:00.000Z", m?.since);
check("never went to finance + handed back: 2, $75, waiting for a broker admin", bp(sHere)?.count === 2 && bp(sHere)?.total_usd === 75 && bp(sHere)?.stage === "waiting_broker" && bp(sHere)?.with_finance?.count === 0, JSON.stringify(bp(sHere)));
check("approved and rejected bonuses don't count", bp(sDecided) === null, JSON.stringify(bp(sDecided)));
check("a pending deposit doesn't count", bp(sDeposit) === null);
check("nothing at all: null", bp(sNone) === null);

console.log("\n\x1b[1mThe Bonus pending filter\x1b[0m");
r = await list(BOSS, { tab: "all", filters: { bonus: "pending" } });
check("only the students with a pending bonus — the total follows",
  names(r.body.rows) === names([sSent, sApproved, sCredit, sMixed, sHere, sPool].map((s) => ({ full_name: s.full_name }))) && r.body.total === 6, `${r.body.total}: ${names(r.body.rows)}`);
check("…and the server says it applied it", r.body.bonus_filter === "pending");
r = await list(BOSS, { tab: "all", filters: { bonus: "pending", language: "English" } });
check("with another filter (English): only theirs", names(r.body.rows) === "Mixed Two, Sales Credit, Sent Finance" && r.body.total === 3, `${r.body.total}: ${names(r.body.rows)}`);
r = await list(BOSS, { tab: "open_pool", filters: { bonus: "pending" } });
check("with a tab (Delta Open Students): only the open-pool one", names(r.body.rows) === "Open Pool Bonus" && r.body.total === 1, `${r.body.total}: ${names(r.body.rows)}`);
r = await list(BOSS, { tab: "all", filters: { bonus: "anything-else" } });
check("an unknown value filters nothing, and isn't echoed", r.body.total === 9 && r.body.bonus_filter === undefined);
r = await list(BOSS, { tab: "all", all: true, filters: { bonus: "pending" } });
check("the export (every match): the same six, each row with its bonus", r.body.total === 6 && r.body.rows.length === 6 && r.body.rows.every((x: any) => x.bonus_pending?.count > 0));

console.log("\n\x1b[1mScope — a CS sees only their own\x1b[0m");
r = await list(CS1, { tab: "my", filters: { bonus: "pending" } });
check("CS 1, My Students + Bonus pending: their four, not CS 2's credit nor the open-pool one",
  names(r.body.rows) === "Decided Here, Finance Approved, Mixed Two, Sent Finance" && r.body.total === 4, `${r.body.total}: ${names(r.body.rows)}`);
r = await list(CS1, { tab: "my", filters: { bonus: "pending", language: "English" } });
check("…with English too: two", names(r.body.rows) === "Mixed Two, Sent Finance" && r.body.total === 2, `${r.body.total}: ${names(r.body.rows)}`);
r = await list(CS2, { tab: "my", filters: { bonus: "pending" } });
check("CS 2: their sales-close credit only", names(r.body.rows) === "Sales Credit" && r.body.total === 1, `${r.body.total}: ${names(r.body.rows)}`);
r = await list(CS1, { tab: "all", filters: { bonus: "pending" } });
check("a CS has no All Students tab: 403", r.status === 403, `${r.status}`);

console.log("\n\x1b[1mThe student page\x1b[0m");
const page = async (who: any, s: any) => {
  const res = await getStudentBonusPending(new Request("http://x", { method: "POST", body: JSON.stringify({ studentId: String(s?._id ?? s) }) }), who);
  return { status: res.status, body: (await res.json()) as any };
};
let p = await page(BOSS, sMixed);
check("the student page: the same as the row", p.status === 200 && JSON.stringify(p.body.bonus_pending) === JSON.stringify(m), JSON.stringify(p.body));
p = await page(BOSS, sDecided);
check("…none: null", p.status === 200 && p.body.bonus_pending === null);
p = await page(CS1, sSent);
check("their CS sees it", p.status === 200 && p.body.bonus_pending?.stage === "with_finance");
p = await page(CS1, sCredit);
check("another CS's student: 403", p.status === 403, `${p.status}`);
p = await page(BOSS, new ObjectId());
check("no such student: 404", p.status === 404, `${p.status}`);
p = await page(BOSS, "not-an-id");
check("no id: 400", p.status === 400, `${p.status}`);

console.log("\n\x1b[1mThe finance link switched off\x1b[0m");
const saved = config.financeApiUrl;
(config as any).financeApiUrl = "";
r = await list(BOSS, { tab: "all", filters: { bonus: "pending" } });
const off = rowOf(r.body.rows, sMixed)?.bonus_pending;
check("a queued one never reached finance: waiting for a broker admin; one sent is still with finance",
  off?.stage === "waiting_broker" && off?.with_finance?.count === 0 && off?.waiting_broker?.count === 2 && rowOf(r.body.rows, sSent)?.bonus_pending?.stage === "with_finance", JSON.stringify(off));
(config as any).financeApiUrl = saved;

console.log("\n\x1b[1mRead-only\x1b[0m");
const after = JSON.stringify(await db.collection("funding_transactions").find().sort({ _id: 1 }).toArray()) + JSON.stringify(await db.collection("students").find().sort({ _id: 1 }).toArray());
check("no funding request or student changed", after === before);

/* ── A bonus promised at the sales close, not sent to be credited yet (the user, 2026-10-10): "Needs call + MT5" ── */
console.log("\n\x1b[1mPromised at the sales close, not sent yet\x1b[0m");
const fee = (invoice_id: string, bonus_minor: number, extra: Record<string, unknown> = {}) => ({
  invoice_id, invoice_number: `IN-${invoice_id}`, course: "DSLP", currency: "AED", fee_minor: 1000000, paid_minor: 1000000, balance_minor: 0,
  bonus_given: bonus_minor > 0, bonus_minor, recorded_at: "2026-10-05T10:00:00.000Z", ...extra,
});
const sClose = student("Close Bonus", cs1, { course_fees: [fee("inv-9", 100000)] });                         // AED 1,000 — not sent
const sCloseUsd = student("Close Usd", cs2, { course_fees: [fee("inv-10", 50000, { bonus_currency: "USD" })] }); // $500 — not sent
const sCloseNone = student("Close No Bonus", cs1, { course_fees: [fee("inv-11", 0)] });                        // no bonus given
await db.collection("students").insertMany([sClose, sCloseUsd, sCloseNone] as any[]);
// Sales Credit's own close bonus (inv-1) already went as a credit — it stays waiting for a broker admin, not twice.
await db.collection("students").updateOne({ _id: sCredit._id }, { $set: { course_fees: [fee("inv-1", 110100)] } });
// Mixed Two: one close bonus sent, a second (inv-12) not — the earliest stage is now "needs call".
await db.collection("students").updateOne({ _id: sMixed._id }, { $set: { course_fees: [fee("inv-12", 36700)] } });
const before2 = JSON.stringify(await db.collection("funding_transactions").find().sort({ _id: 1 }).toArray()) + JSON.stringify(await db.collection("students").find().sort({ _id: 1 }).toArray());

r = await list(BOSS, { tab: "all" });
const bp2 = (s: any) => rowOf(r.body.rows, s)?.bonus_pending;
check("AED 1,000 not sent: needs a call + MT5, in USD at 3.67", bp2(sClose)?.stage === "needs_call" && bp2(sClose)?.total_usd === 272.48 && bp2(sClose)?.needs_call?.count === 1, JSON.stringify(bp2(sClose)));
check("…a USD one as it is", bp2(sCloseUsd)?.total_usd === 500 && bp2(sCloseUsd)?.stage === "needs_call", JSON.stringify(bp2(sCloseUsd)));
check("no bonus given at the close: nothing", bp2(sCloseNone) === null, JSON.stringify(bp2(sCloseNone)));
check("one already sent as a credit isn't counted again", bp2(sCredit)?.count === 1 && bp2(sCredit)?.stage === "waiting_broker" && bp2(sCredit)?.needs_call?.count === 0, JSON.stringify(bp2(sCredit)));
check("sent and not sent together: three, the earliest stage first", bp2(sMixed)?.count === 3 && bp2(sMixed)?.stage === "needs_call" && bp2(sMixed)?.total_usd === 400.5, JSON.stringify(bp2(sMixed)));

r = await list(BOSS, { tab: "all", filters: { bonus: "needs_call" } });
check("filter Needs call + MT5: only those with one not sent", names(r.body.rows) === "Close Bonus, Close Usd, Mixed Two" && r.body.bonus_filter === "needs_call", names(r.body.rows));
r = await list(BOSS, { tab: "all", filters: { bonus: "with_finance" } });
check("filter With finance", names(r.body.rows) === "Mixed Two, Open Pool Bonus, Sent Finance", names(r.body.rows));
r = await list(BOSS, { tab: "all", filters: { bonus: "waiting_broker" } });
check("filter Waiting for broker admin", names(r.body.rows) === "Decided Here, Finance Approved, Mixed Two, Sales Credit", names(r.body.rows));
r = await list(BOSS, { tab: "all", filters: { bonus: "pending" } });
check("Bonus pending — any: the new ones too", ["Close Bonus", "Close Usd", "Sent Finance"].every((x) => names(r.body.rows).includes(x)) && !names(r.body.rows).includes("Close No Bonus"), names(r.body.rows));
r = await list(CS2, { tab: "my", filters: { bonus: "needs_call" } });
check("a CS: only their own", names(r.body.rows) === "Close Usd", names(r.body.rows));
const closePage = await getStudentBonusPending(new Request("http://x", { method: "POST", body: JSON.stringify({ studentId: String(sClose._id) }) }), CS1);
check("the student page says it too", (await closePage.json() as any).bonus_pending?.stage === "needs_call");
const after2 = JSON.stringify(await db.collection("funding_transactions").find().sort({ _id: 1 }).toArray()) + JSON.stringify(await db.collection("students").find().sort({ _id: 1 }).toArray());
check("still read-only", after2 === before2);

console.log(`\n${pass} passed, ${fail} failed`);
await closeDb();
await client.close();
process.exit(fail ? 1 : 0);
