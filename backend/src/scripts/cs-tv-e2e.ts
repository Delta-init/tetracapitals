/**
 * The open CS board (functions/csTv.ts), end to end against the API: this month's board as before, and a month gone
 * by (?month=YYYY-MM, the Root Manager TV's month switch, 2026-11-01) — what each CS collected in it, nothing for
 * today, no latest payments; a month to come or a month that isn't one gives this month's.
 *
 * The amounts added for the TV (functions/csTvExtras.ts), as Root's "CS TV amounts" page adds them through
 * /api/v1/service/cs-tv-amounts (2026-11-14): Bangalore's CSs only; one shown on the Dubai board puts that CS among
 * Dubai's with only what was added (never their own board's payments), told apart by nothing; on both boards; changed,
 * removed; an amount from before `screens` on its CS's own board; ?real=1 without any of them.
 *
 * Somebody added by name (2026-11-14, /api/v1/service/cs-tv-people): no account here, picked like the team's CSs, a
 * row on a board only while an amount added for them shows there, under the team they were put under; taken away
 * again with their amounts.
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

// ── The amounts added for the TV, from Root ──────────────────────────────────────────────────────────────────────
const SECRET = process.env.ROOT_ERP_SECRET ?? "";
const svc = async (method: "GET" | "POST", path: string, body?: unknown, secret = SECRET) => {
  const res = await fetch(`${API}/api/v1/service${path}`, { method, headers: { "content-type": "application/json", "x-portal-secret": secret }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};
const boardOf = async (location: "dubai" | "bangalore", q = "") => ((await (await fetch(`${API}/api/public/cs-tv?location=${location}${q}`)).json().catch(() => ({}))) as any);

// Bangalore: a team led by Lena, with Bela its CS — who collected 700 of her own today.
const lena = new ObjectId(), bela = new ObjectId();
await db.collection("users").insertMany([
  { _id: lena, full_name: "Lena Lead", email: "lena@e2e.local", app_role: "chief_mentor", status: "active", team_name: "Team Bangalore", team_location: "bangalore" },
  { _id: bela, full_name: "Bela CS", email: "bela@e2e.local", app_role: "cs", status: "active", up_head_id: String(lena) },
] as any[]);
await db.collection("funding_transactions").insertOne(pay(bela, 700, now.toISOString(), "MSNR") as any);
// Two amounts from before an amount said its boards: each on its CS's own board.
const oldAsha = new ObjectId(), oldBela = new ObjectId();
await db.collection("cs_tv_extras").insertMany([
  { _id: oldAsha, location: "dubai", cs_id: String(asha), cs_name: "Asha CS", aed: 300, product: "DGMP", at: now.toISOString(), created_by_name: "Super Admin", created_date: now.toISOString() },
  { _id: oldBela, location: "bangalore", cs_id: String(bela), cs_name: "Bela CS", aed: 400, product: "MSNR", at: now.toISOString(), created_by_name: "Super Admin", created_date: now.toISOString() },
] as any[]);

let s = await svc("GET", "/cs-tv-amounts", undefined, "not-the-secret");
check("Root's calls: a wrong secret is refused", s.status === 401, show(s.body));
s = await svc("GET", "/cs-tv-amounts");
check("the list: Bangalore's CSs to pick from — Bela, not Dubai's", s.status === 200 && s.body.data?.location === "bangalore" && (s.body.data?.cs ?? []).map((c: any) => c.name).join() === "Bela CS" && s.body.data.cs[0].team === "Team Bangalore", show(s.body));
check("…with Bela's earlier amount, shown on Bangalore's board; Asha's isn't Root's", (s.body.data?.extras ?? []).length === 1 && s.body.data.extras[0].show_on === "bangalore" && s.body.data.extras[0].aed === 400, show(s.body.data?.extras));

s = await svc("POST", "/cs-tv-amounts", { cs_id: String(asha), aed: 5000, product: "DGMP", show_on: "dubai", by: "Root Admin" });
check("adding for a Dubai CS: refused, in words", s.status === 400 && /Bangalore/.test(s.body.error?.message ?? ""), show(s.body));
for (const [label, bad] of [["no amount", { aed: 0 }], ["a board that isn't one", { show_on: "mars" }], ["a time still to come", { at: new Date(Date.now() + 3_600_000).toISOString() }], ["no course", { product: " " }]] as const) {
  const res = await svc("POST", "/cs-tv-amounts", Object.assign({ cs_id: String(bela), aed: 9000, product: "MSNR", show_on: "dubai", by: "Root Admin" }, bad));
  check(`adding with ${label}: refused`, res.status === 400 && !!res.body.error?.message, show(res.body));
}
s = await svc("POST", "/cs-tv-amounts", { cs_id: String(bela), aed: 9000, product: "MSNR", show_on: "dubai", by: "Root Admin" });
const added = String(s.body.data?.id ?? "");
check("adding 9,000 for Bela, on the Dubai board", s.status === 200 && /^[a-f\d]{24}$/.test(added), show(s.body));

let d = await boardOf("dubai");
check("the Dubai board: Bela first with 9,000 — only what was added, not her own 700", d.cs?.[0]?.name === "Bela CS" && d.cs[0].month_aed === 9000 && d.cs[0].today_aed === 9000 && d.cs[0].payments === 1 && d.cs[0].rank === 1 && d.cs[0].team === "Team Bangalore", show(d.cs));
check("…Asha with her payment and her earlier amount (800), the total 9,800", by(d, "Asha CS")?.month_aed === 800 && d.totals?.month_aed === 9800 && d.totals?.payments === 3, show(d.totals));
check("…her team among Dubai's teams", (d.teams ?? []).some((t: any) => t.team === "Team Bangalore" && t.month_aed === 9000 && t.cs_count === 1), show(d.teams));
check("…the amount among the latest payments, like any other", (d.recent ?? []).some((p: any) => p.id === added && p.cs === "Bela CS" && p.aed === 9000 && p.product === "MSNR" && !("cs_id" in p)), show(d.recent));
check("…and nothing tells her row from Asha's", Object.keys(d.cs[0]).sort().join() === Object.keys(by(d, "Asha CS")).sort().join() && !/extra|guest|added|screens/i.test(JSON.stringify(d)), show(Object.keys(d.cs[0])));
let b = await boardOf("bangalore");
check("Bangalore's board: Bela's own 700 and her earlier amount (1,100) — not the 9,000", by(b, "Bela CS")?.month_aed === 1100 && b.totals?.month_aed === 1100 && !by(b, "Asha CS"), show(b.cs));

d = await boardOf("dubai", "&real=1");
check("?real=1: what was collected — no Bela, Asha's 500, no added amount among the latest", !by(d, "Bela CS") && by(d, "Asha CS")?.month_aed === 500 && d.totals?.month_aed === 500 && (d.recent ?? []).length === 1 && (d.teams ?? []).every((t: any) => t.team !== "Team Bangalore"), show(d));
b = await boardOf("bangalore", "&real=1");
check("…Bangalore's real board: Bela's 700", by(b, "Bela CS")?.month_aed === 700, show(b.cs));
d = await boardOf("dubai");
check("…and the TV's own board still has them", d.cs?.[0]?.name === "Bela CS" && d.totals?.month_aed === 9800, show(d.totals));

s = await svc("POST", "/cs-tv-amounts/update", { id: added, show_on: "both", aed: 12000, by: "Root Admin" });
check("changing it: 12,000, on both boards", s.status === 200, show(s.body));
d = await boardOf("dubai"); b = await boardOf("bangalore");
check("…Dubai's shows 12,000, Bangalore's 13,100", by(d, "Bela CS")?.month_aed === 12000 && by(b, "Bela CS")?.month_aed === 13100, `${show(by(d, "Bela CS"))} ${show(by(b, "Bela CS"))}`);
s = await svc("GET", `/cs-tv-amounts?month=${thisMonth}`);
const mine = (s.body.data?.extras ?? []).find((e: any) => e.id === added);
check("the list: it says both boards, and who added it", mine?.show_on === "both" && mine?.aed === 12000 && mine?.added_by === "Root Admin (Root)" && s.body.data?.total_aed === 12400, show(s.body.data?.extras));
s = await svc("POST", "/cs-tv-amounts/update", { id: added, aed: -5, by: "Root Admin" });
check("changing it to no amount: refused", s.status === 400, show(s.body));
s = await svc("POST", "/cs-tv-amounts/update", { id: String(oldAsha), aed: 1, by: "Root Admin" });
check("a Dubai CS's amount isn't Root's to change", s.status === 404, show(s.body));
s = await svc("POST", "/cs-tv-amounts/remove", { id: String(oldAsha) });
check("…or to remove", s.status === 404 && (await db.collection("cs_tv_extras").countDocuments({ _id: oldAsha })) === 1, show(s.body));

s = await svc("POST", "/cs-tv-amounts", { cs_id: String(bela), aed: 4000, product: "DQMP", show_on: "dubai", at: midLast, by: "Root Admin" });
check("an amount dated last month", s.status === 200, show(s.body));
d = await boardOf("dubai", `&month=${lastMonth}`);
check("…on last month's Dubai board: Bela 4,000 beside Ben's 2,000 and Asha's 1,000", d.cs?.[0]?.name === "Bela CS" && d.cs[0].month_aed === 4000 && d.totals?.month_aed === 7000 && (d.recent ?? []).length === 0, show(d.cs));
d = await boardOf("dubai", `&month=${lastMonth}&real=1`);
check("…and not on its real one", !by(d, "Bela CS") && d.totals?.month_aed === 3000, show(d.totals));

s = await svc("POST", "/cs-tv-amounts/remove", { id: added });
check("removing it", s.status === 200 && s.body.data?.removed === true, show(s.body));
d = await boardOf("dubai"); b = await boardOf("bangalore");
check("…Bela is off the Dubai board, and back to 1,100 on Bangalore's", !by(d, "Bela CS") && d.totals?.month_aed === 800 && by(b, "Bela CS")?.month_aed === 1100, `${show(d.totals)} ${show(by(b, "Bela CS"))}`);
s = await svc("POST", "/cs-tv-amounts/remove", { id: added });
check("removing it again: already gone", s.status === 404, show(s.body));

// ── Somebody added by name: no account here ──────────────────────────────────────────────────────────────────────
const usersBefore = await db.collection("users").countDocuments({});
for (const [label, bad] of [["no name", { name: " " }], ["the name of a CS already there", { name: "bela  cs" }], ["a team that isn't Bangalore's", { name: "Nila Guest", team_id: String(asha) }], ["an email that isn't one", { name: "Nila Guest", email: "nila-at-hrms" }]] as const) {
  const res = await svc("POST", "/cs-tv-people", { by: "Root Admin", ...bad });
  check(`adding somebody by name with ${label}: refused`, res.status === 400 && !!res.body.error?.message, show(res.body));
}
s = await svc("POST", "/cs-tv-people", { name: "  Nila   Guest ", by: "Root Admin" });
const nila = String(s.body.data?.id ?? "");
check("adding Nila by name: kept, under Bangalore's one team", s.status === 200 && /^[a-f\d]{24}$/.test(nila), show(s.body));
s = await svc("POST", "/cs-tv-people", { name: "nila guest", by: "Root Admin" });
check("…and not a second time, however it is typed", s.status === 400 && /already added/.test(s.body.error?.message ?? ""), show(s.body));
check("…nobody's account was made", (await db.collection("users").countDocuments({})) === usersBefore);
s = await svc("GET", "/cs-tv-amounts");
check("the list: Nila to pick beside Bela, marked as added by name, with the team to show her under", (s.body.data?.cs ?? []).map((c: any) => `${c.name}:${c.tv_only}:${c.team}`).join() === "Bela CS:false:Team Bangalore,Nila Guest:true:Team Bangalore"
  && (s.body.data?.people ?? []).length === 1 && s.body.data.people[0].name === "Nila Guest" && s.body.data.people[0].added_by === "Root Admin (Root)" && !("email" in s.body.data.people[0])
  && JSON.stringify(s.body.data?.teams) === JSON.stringify([{ id: String(lena), name: "Team Bangalore" }]), show(s.body.data));
d = await boardOf("dubai"); b = await boardOf("bangalore");
check("with no amount she is on no board", !by(d, "Nila Guest") && !by(b, "Nila Guest"), show(d.cs));

s = await svc("POST", "/cs-tv-amounts", { cs_id: nila, aed: 20000, product: "MSNR", show_on: "dubai", by: "Root Admin" });
const nilaAmount = String(s.body.data?.id ?? "");
check("an amount for her, on the Dubai board", s.status === 200, show(s.body));
d = await boardOf("dubai"); b = await boardOf("bangalore");
check("the Dubai board: Nila first with 20,000, in Team Bangalore", d.cs?.[0]?.name === "Nila Guest" && d.cs[0].id === nila && d.cs[0].month_aed === 20000 && d.cs[0].payments === 1 && d.cs[0].team === "Team Bangalore" && d.totals?.month_aed === 20800, show(d.cs));
check("…her team among the teams, her amount among the latest", (d.teams ?? []).some((t: any) => t.team === "Team Bangalore" && t.month_aed === 20000) && (d.recent ?? []).some((p: any) => p.id === nilaAmount && p.cs === "Nila Guest"), show(d.teams));
check("…and nothing tells her row from Asha's", Object.keys(d.cs[0]).sort().join() === Object.keys(by(d, "Asha CS")).sort().join() && !/tv_only|tv-only|guest@|invalid/i.test(JSON.stringify(d)), JSON.stringify(d.cs[0]));
check("…not on Bangalore's board, which wasn't asked for", !by(b, "Nila Guest") && b.totals?.month_aed === 1100, show(b.cs));
d = await boardOf("dubai", "&real=1");
check("…and not on the real board", !by(d, "Nila Guest") && d.totals?.month_aed === 500, show(d.totals));
s = await svc("POST", "/cs-tv-amounts/update", { id: nilaAmount, show_on: "both", by: "Root Admin" });
b = await boardOf("bangalore");
check("on both boards: Bangalore's has her too, with what was added", s.status === 200 && by(b, "Nila Guest")?.month_aed === 20000 && by(b, "Nila Guest")?.team === "Team Bangalore" && b.totals?.month_aed === 21100, show(b.cs));
s = await svc("GET", `/cs-tv-amounts?month=${thisMonth}`);
check("the month's list has her amount, under her name", (s.body.data?.extras ?? []).some((e: any) => e.id === nilaAmount && e.cs_name === "Nila Guest" && e.show_on === "both"), show(s.body.data?.extras));

s = await svc("POST", "/cs-tv-people/remove", { id: nila });
check("taking her away", s.status === 200 && s.body.data?.removed === true, show(s.body));
d = await boardOf("dubai"); b = await boardOf("bangalore");
check("…off both boards, her amounts gone with her", !by(d, "Nila Guest") && !by(b, "Nila Guest") && d.totals?.month_aed === 800 && (await db.collection("cs_tv_extras").countDocuments({ cs_id: nila })) === 0, show(d.totals));
s = await svc("POST", "/cs-tv-people/remove", { id: nila });
check("…and again: already gone", s.status === 404, show(s.body));
s = await svc("POST", "/cs-tv-amounts", { cs_id: nila, aed: 100, product: "MSNR", show_on: "dubai", by: "Root Admin" });
check("…no amount for somebody taken away", s.status === 400, show(s.body));

// Switched off: her amounts leave the other board with her, as anybody's do.
s = await svc("POST", "/cs-tv-amounts", { cs_id: String(bela), aed: 2500, product: "MSNR", show_on: "dubai", by: "Root Admin" });
await db.collection("users").updateOne({ _id: bela }, { $set: { status: "inactive" } });
const last = await svc("POST", "/cs-tv-amounts", { cs_id: String(bela), aed: 100, product: "MSNR", show_on: "dubai", by: "Root Admin" });
check("somebody switched off can't be given an amount", s.status === 200 && last.status === 400, show(last.body));
await svc("POST", "/cs-tv-amounts/remove", { id: "000000000000000000000000" });   // nothing removed — the board is still the kept one
await svc("POST", "/cs-tv-amounts/update", { id: String(s.body.data?.id), aed: 2600, by: "Root Admin" });   // a change: the board is made again
d = await boardOf("dubai");
check("…and is off the Dubai board, amounts and all", !by(d, "Bela CS") && d.totals?.month_aed === 800, show(d.cs));

await client.close();
console.log(`\n${fail ? "\x1b[31m" : "\x1b[32m"}${pass}/${pass + fail} checks passed\x1b[0m`);
process.exit(fail ? 1 : 0);
