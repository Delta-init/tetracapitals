/**
 * The open CS board (functions/csTv.ts), end to end against the API: this month's board as before, and a month gone
 * by (?month=YYYY-MM, the Root Manager TV's month switch, 2026-11-01) — what each CS collected in it, nothing for
 * today, no latest payments; a month to come or a month that isn't one gives this month's.
 * Run through ./test-cs-tv.sh (throwaway mongod, the API — no .env). Scratch database only.
 */
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "";
const dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) {
  console.error(`Refusing to run: needs a scratch e2e database on 127.0.0.1, got ${uri} / ${dbName}`);
  process.exit(1);
}
const API = `http://127.0.0.1:${process.env.E2E_API_PORT}`;
let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => { if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); } else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); } };
const show = (v: unknown) => JSON.stringify(v).slice(0, 400);

const client = await new MongoClient(uri).connect();
const db = client.db(dbName);
const now = new Date();
const dubai = new Date(now.getTime() + 4 * 3_600_000);
const thisMonth = dubai.toISOString().slice(0, 7);
const lastStart = new Date(Date.UTC(dubai.getUTCFullYear(), dubai.getUTCMonth() - 1, 1));
const lastMonth = lastStart.toISOString().slice(0, 7);
const twoAgo = new Date(Date.UTC(dubai.getUTCFullYear(), dubai.getUTCMonth() - 2, 15, 8)).toISOString();
const midLast = new Date(Date.UTC(lastStart.getUTCFullYear(), lastStart.getUTCMonth(), 15, 8)).toISOString();
const nextMonth = new Date(Date.UTC(dubai.getUTCFullYear(), dubai.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);

const asha = new ObjectId(), ben = new ObjectId();
await db.collection("users").insertMany([
  { _id: asha, full_name: "Asha CS", email: "asha@e2e.local", app_role: "cs", status: "active" },
  { _id: ben, full_name: "Ben CS", email: "ben@e2e.local", app_role: "cs", status: "active" },
] as any[]);
const pay = (who: ObjectId, aed: number, at: string, product = "DGMP") => ({
  type: "BONUS", status: "APPROVED", bonus_credit: null, initiating_mentor_id: String(who), requested_by_id: String(who),
  course_payment: { product, kind: "full", paid_today_aed: aed }, amount_aed: aed, approved_at: at,
});
await db.collection("funding_transactions").insertMany([
  pay(asha, 500, now.toISOString()),          // today
  pay(asha, 1000, midLast),                   // last month
  pay(ben, 2000, midLast, "DQMP"),            // last month
  pay(ben, 700, twoAgo),                      // two months ago: in neither
  { ...pay(ben, 999, midLast), bonus_credit: "sales" },  // a sales-close credit: never a payment
] as any[]);

const board = async (q = "") => { const r = await fetch(`${API}/api/public/cs-tv?location=dubai${q}`); return { status: r.status, body: (await r.json().catch(() => ({}))) as any }; };
const by = (b: any, name: string) => (b.cs ?? []).find((p: any) => p.name === name);

let r = await board();
check("this month: named, Asha's 500 today, Ben nothing", r.status === 200 && r.body.month === thisMonth && by(r.body, "Asha CS")?.month_aed === 500 && by(r.body, "Asha CS")?.today_aed === 500
  && by(r.body, "Ben CS")?.month_aed === 0 && r.body.totals?.month_aed === 500, show(r.body));
check("…with today's payment as the latest", (r.body.recent ?? []).length === 1 && r.body.recent[0].aed === 500 && !("cs_id" in r.body.recent[0]), show(r.body.recent));

r = await board(`&month=${lastMonth}`);
check("?month=<last month>: that month named — Asha 1,000, Ben 2,000, ranked, total 3,000", r.status === 200 && r.body.month === lastMonth && by(r.body, "Asha CS")?.month_aed === 1000
  && by(r.body, "Ben CS")?.month_aed === 2000 && r.body.cs?.[0]?.name === "Ben CS" && r.body.totals?.month_aed === 3000 && r.body.totals?.payments === 2, show(r.body));
check("…nothing for today, no latest payments", r.body.totals?.today_aed === 0 && (r.body.cs ?? []).every((p: any) => p.today_aed === 0) && (r.body.recent ?? []).length === 0, show(r.body.recent));
check("…the teams added up the same", (r.body.teams ?? []).reduce((s: number, t: any) => s + t.month_aed, 0) === 3000, show(r.body.teams));

r = await board(`&month=${nextMonth}`);
check("a month to come: this month's board", r.body.month === thisMonth && r.body.totals?.month_aed === 500, show(r.body.month));
r = await board("&month=2026-13");
check("a month that isn't one: this month's board", r.body.month === thisMonth, show(r.body.month));

await client.close();
console.log(`\n${fail ? "\x1b[31m" : "\x1b[32m"}${pass}/${pass + fail} checks passed\x1b[0m`);
process.exit(fail ? 1 : 0);
