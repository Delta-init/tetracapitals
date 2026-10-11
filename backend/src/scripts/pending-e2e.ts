/**
 * The Root portal's Pending page call (GET /api/v1/service/pending, portal/pending.ts), end to end against the API:
 *   - each kind's total is what the sidebar (getNavCounts) shows a Super Admin — or, for the numbers only their owner
 *     sees (new students, payment links ready / turned down), what those people's sidebars show added up;
 *   - each person's counts are what their own sidebar shows them: the student's CS and a CS they are Common with,
 *     who asked for a payment link; MT5 bonuses and payment link requests listed in full against every active holder;
 *   - not onboarded's overdue (6 hours or more, from finance); inactive people kept but marked, no students, sorted;
 *   - the shared secret: 401 without it or with a wrong one.
 * Run through ./test-pending.sh (throwaway mongod, the API — no .env). Scratch database only.
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
const SECRET = process.env.ROOT_ERP_SECRET ?? "";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
const same = (label: string, got: unknown, want: unknown) =>
  check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
async function call(method: string, path: string, headers: Record<string, string> = {}, body?: unknown, token?: string) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
}
async function login(email: string): Promise<string> {
  const r = await call("POST", "/api/auth/login", {}, { email, password: "Password123!" });
  if (!r.body.token) throw new Error(`could not sign in as ${email}: ${r.status}`);
  return r.body.token;
}
const pending = (headers: Record<string, string> = { "x-portal-secret": SECRET }) => call("GET", "/api/v1/service/pending", headers);
const navCounts = async (token: string) => (await call("POST", "/api/functions/getNavCounts", {}, {}, token)).body;

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
await db.dropDatabase();

step("Setting up");
const hash = await bcrypt.hash("Password123!", 10);
const nowMs = Date.now();
const ago = (h: number) => new Date(nowMs - h * 3_600_000).toISOString();
const now = ago(0);
// The sidebar's "today": business time, UTC+5:30 (students/followups.ts).
const dayOf = (offsetDays: number) => new Date(nowMs + 330 * 60_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const today = dayOf(0), yesterday = dayOf(-1), tomorrow = dayOf(1);

const person = (full_name: string, email: string, app_role: string, status = "active") => ({
  _id: new ObjectId(), email, full_name, app_role, password_hash: hash, commission_rate: 4, status, created_date: now, updated_date: now,
});
const boss = person("Super Admin", "boss@e2e-pending.test", "super_admin");
const bossOff = person("Old Super Admin", "oldboss@e2e-pending.test", "super_admin", "inactive");
// Stored mixed-case on purpose: the answer gives emails lowercase.
const broker = person("Broker Admin", "Broker@E2E-Pending.test", "broker_admin");
const cs1 = person("Cee One", "cs1@e2e-pending.test", "cs");
const cs2 = person("Cee Two", "cs2@e2e-pending.test", "cs");
const csOff = person("Cee Gone", "csgone@e2e-pending.test", "cs", "inactive");
const mentor = person("Junior Mentor", "mentor@e2e-pending.test", "junior_mentor");
const wasCs = person("Was A CS", "wascs@e2e-pending.test", "junior_mentor");
await db.collection("users").insertMany([boss, bossOff, broker, cs1, cs2, csOff, mentor, wasCs] as any[]);
await db.collection("commission_roles").insertOne({ role_key: "cs", name: "CS", data_scope: "own", active: true } as any);
const id = (u: any) => String(u._id);

let n = 0;
const student = (name: string, cs: any | null, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), student_code: `STU-${String(++n).padStart(4, "0")}`, full_name: name, status: "ACTIVE", created_date: ago(1), onboarded: true,
  ...(cs ? { primary_mentor_id: id(cs), primary_mentor_name: cs.full_name } : {}),
  ...extra,
});
// Not onboarded, from finance, 10 hours ago (late) — CS One, and Common with CS Two.
const s1 = student("Late Common", cs1, { onboarded: false, finance_invoice_id: "inv-1", created_date: ago(10), common_cs: [{ id: id(cs2), name: cs2.full_name }] });
// Given to CS One, not opened yet.
const s2 = student("New For One", cs1, { new_for_id: id(cs1), new_since: now });
// Not onboarded, not from finance, an hour ago — CS Two.
const s3 = student("Fresh Two", cs2, { onboarded: false });
// Given to the mentor, their own student.
const s4 = student("New For Mentor", mentor, { new_for_id: id(mentor), new_since: now });
// Given to CS One once, CS Two's now: nobody's new student any more.
const s5 = student("Moved On", cs2, { new_for_id: id(cs1) });
// Nobody's yet: not onboarded, from finance, late — counted, waiting on nobody.
const s6 = student("No CS", null, { onboarded: false, finance_invoice_id: "inv-6", created_date: ago(8) });
// The inactive CS's student.
const s7 = student("Gone CS Student", csOff);
// Not onboarded but from before the Not onboarded page began: not counted.
const s8 = student("Before Start", cs1, { onboarded: false, created_date: "2026-09-01T00:00:00.000Z" });
// Inactive and not onboarded: not counted.
const s9 = student("Inactive", cs1, { onboarded: false, status: "INACTIVE" });
await db.collection("students").insertMany([s1, s2, s3, s4, s5, s6, s7, s8, s9] as any[]);
const sid = (s: any) => String(s._id);

const fu = (s: any, next_followup_date: string, stage = "Contacted") => ({
  _id: new ObjectId(), student_id: sid(s), student_name: s.full_name, target_outcome: "Other", stage, next_followup_date, created_date: now,
});
await db.collection("student_followups").insertMany([
  fu(s1, today), fu(s6, today), // due today: CS One + CS Two (Common); nobody
  fu(s2, yesterday), fu(s3, yesterday), fu(s7, yesterday), // overdue: CS One, CS Two, the inactive CS
  fu(s2, yesterday, "Converted"), fu(s3, today, "Lost"), // closed: not counted
  fu(s4, tomorrow), fu(s4, ""), // on track, no date: not counted
] as any[]);

const done = (key: string, s: any, extra: Record<string, unknown> = {}) => ({
  _id: key, student_id: sid(s), student_name: s.full_name, class: { title: "Live class" }, ended_at: ago(2), notify_at: ago(2), notified_at: ago(2), created_date: ago(2), ...extra,
});
await db.collection("class_completions").insertMany([
  done("c1", s2), done("c3", s1), // waiting for a call: CS One; CS One + CS Two
  done("c2", s3), // called since (a follow-up log below): settled, not counted
  done("c4", s4, { notified_at: undefined }), // not told yet: not counted
  done("c5", s3, { called_at: ago(1), called_via: "3CX call" }), // called: not counted
] as any[]);
await db.collection("class_completions").updateOne({ _id: "c4" } as any, { $unset: { notified_at: "" } });
await db.collection("student_followup_events").insertOne({ student_id: sid(s3), kind: "logged", at: ago(1), by_name: cs2.full_name } as any);

const bonus = (extra: Record<string, unknown>) => ({
  _id: new ObjectId(), type: "BONUS", status: "PENDING", student_id: sid(s2), amount_usd: 100, requested_at: now, created_date: now, ...extra,
});
await db.collection("funding_transactions").insertMany([
  bonus({}), bonus({ finance_approval: { state: "decided", decision: "approved" } }), // decidable: 2
  bonus({ finance_approval: { state: "sent" } }), // finance still has it
  bonus({ status: "APPROVED" }), bonus({ type: "DEPOSIT" }),
] as any[]);

const link = (by: any, status: string, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), student_id: sid(s2), requested_by_id: id(by), requested_by_name: by.full_name, platform: "Tabby", amount: 100, status, created_at: now, ...extra,
});
await db.collection("payment_link_requests").insertMany([
  link(cs1, "pending"), link(cs2, "pending"), // waiting for a Super Admin: 2
  link(cs1, "approved"), link(cs1, "approved", { cs_seen_at: now }), // ready, unseen: CS One 1
  link(cs2, "rejected"), link(cs2, "rejected", { cs_seen_at: now }), // turned down, unseen: CS Two 1
  link(wasCs, "approved"), // asked while a CS, not one now: on nobody's sidebar
  link(cs1, "cancelled"),
] as any[]);

step("Case 1 — the shared secret");
check("no secret → 401", (await pending({})).status === 401);
check("a wrong secret → 401", (await pending({ "x-portal-secret": "not-the-secret" })).status === 401);
check("a secret of the right length but wrong → 401", (await pending({ "x-portal-secret": SECRET.replace(/.$/, "x") })).status === 401);
const r = await pending();
check("the secret → 200, success", r.status === 200 && r.body.success === true, JSON.stringify(r.body).slice(0, 200));
const data = r.body.data ?? {};
const kinds: any[] = data.kinds ?? [];
const people: any[] = data.people ?? [];
const kind = (k: string) => kinds.find((x) => x.key === k) ?? {};
const who = (u: any) => people.find((p) => p.id === id(u));

step("Case 2 — the kinds, in sidebar order");
same("keys in sidebar order", kinds.map((k) => k.key), [
  "new_students", "not_onboarded", "followups_today", "overdue_followups", "class_completions_open",
  "bonus_approvals_pending", "payment_links_pending", "payment_links_ready", "payment_links_turned_down",
]);
same("labels as the sidebar names them", kinds.slice(0, 6).map((k) => k.label), ["Students", "Not onboarded", "Follow-ups", "Overdue follow-ups", "Class Completions", "MT5 Bonus Approvals"]);
check("payment link kinds are labelled Payment Links", kinds.slice(6).every((k) => String(k.label).startsWith("Payment Links")));
same("shared: MT5 bonuses and payment link requests only", kinds.filter((k) => k.shared === true).map((k) => k.key), ["bonus_approvals_pending", "payment_links_pending"]);
same("overdue: on Not onboarded only", kinds.filter((k) => "overdue" in k).map((k) => k.key), ["not_onboarded"]);
check("no kind key ends in _overdue", kinds.every((k) => !String(k.key).endsWith("_overdue")));

step("Case 3 — totals equal the sidebar's");
const [tBoss, tCs1, tCs2, tMentor, tWasCs] = await Promise.all([boss, cs1, cs2, mentor, wasCs].map((u) => login(u.email)));
const navBoss = await navCounts(tBoss);
const navCs1 = await navCounts(tCs1), navCs2 = await navCounts(tCs2), navMentor = await navCounts(tMentor), navWasCs = await navCounts(tWasCs);
same("Not onboarded = a Super Admin's sidebar (3)", [kind("not_onboarded").total, navBoss.not_onboarded], [3, 3]);
same("Not onboarded overdue = the sidebar's 6-hour count (2)", [kind("not_onboarded").overdue, navBoss.not_onboarded_late], [2, 2]);
same("Follow-ups due today = a Super Admin's sidebar (2)", [kind("followups_today").total, navBoss.followups_today], [2, 2]);
same("Overdue follow-ups = a Super Admin's sidebar (3)", [kind("overdue_followups").total, navBoss.followups_overdue], [3, 3]);
same("Class Completions = a Super Admin's sidebar (2, the called one settled)", [kind("class_completions_open").total, navBoss.class_completions_open], [2, 2]);
same("MT5 Bonus Approvals = a Super Admin's sidebar (2)", [kind("bonus_approvals_pending").total, navBoss.bonus_approvals_pending], [2, 2]);
same("Payment link requests = a Super Admin's sidebar (2)", [kind("payment_links_pending").total, navBoss.payment_links_pending], [2, 2]);
same("Students (new) = everyone's own sidebars added up (2)",
  [kind("new_students").total, navBoss.new_students + navCs1.new_students + navCs2.new_students + navMentor.new_students + navWasCs.new_students], [2, 2]);
same("Payment links ready = the CSs' sidebars added up (1; not who is no longer a CS)",
  [kind("payment_links_ready").total, navCs1.payment_links_ready + navCs2.payment_links_ready + navWasCs.payment_links_ready], [1, 1]);
same("Payment links turned down = the CSs' sidebars added up (1)",
  [kind("payment_links_turned_down").total, navCs1.payment_links_turned_down + navCs2.payment_links_turned_down], [1, 1]);

step("Case 4 — each person: what their own sidebar shows them");
const KEY_OF_NAV: Record<string, string> = {
  new_students: "new_students", not_onboarded: "not_onboarded", not_onboarded_late: "not_onboarded_overdue",
  followups_today: "followups_today", followups_overdue: "overdue_followups", class_completions_open: "class_completions_open",
  bonus_approvals_pending: "bonus_approvals_pending", payment_links_pending: "payment_links_pending",
  payment_links_ready: "payment_links_ready", payment_links_turned_down: "payment_links_turned_down",
};
for (const [u, nav] of [[cs1, navCs1], [cs2, navCs2], [mentor, navMentor]] as const) {
  const counts = who(u)?.counts ?? {};
  for (const [navKey, key] of Object.entries(KEY_OF_NAV)) {
    if ((nav[navKey] ?? 0) !== (counts[key] ?? 0)) { check(`${u.full_name}: ${key} = their sidebar`, false, `pending ${counts[key] ?? 0}, sidebar ${nav[navKey]}`); }
  }
  check(`${u.full_name}: every count = their own sidebar's`, Object.entries(KEY_OF_NAV).every(([nk, k]) => (nav[nk] ?? 0) === (counts[k] ?? 0)));
}
same("CS One", who(cs1)?.counts, {
  new_students: 1, not_onboarded: 1, not_onboarded_overdue: 1, followups_today: 1, overdue_followups: 1, class_completions_open: 2, payment_links_ready: 1,
});
same("CS One's total leaves out the overdue count (7)", who(cs1)?.total, 7);
same("CS Two — Common with CS One's late student too", who(cs2)?.counts, {
  not_onboarded: 2, not_onboarded_overdue: 1, followups_today: 1, overdue_followups: 1, class_completions_open: 1, payment_links_turned_down: 1,
});
same("CS Two's total (6)", who(cs2)?.total, 6);
same("the mentor: their new student only", [who(mentor)?.counts, who(mentor)?.total], [{ new_students: 1 }, 1]);

step("Case 5 — shared kinds, in full against every active holder");
same("the Super Admin: all bonuses and all payment link requests", [who(boss)?.counts, who(boss)?.total], [{ bonus_approvals_pending: 2, payment_links_pending: 2 }, 4]);
same("the broker admin: all bonuses, no payment links", [who(broker)?.counts, who(broker)?.total], [{ bonus_approvals_pending: 2 }, 2]);
check("the inactive Super Admin carries none — not listed", !who(bossOff));
check("whoever is no longer a CS: their unseen ready link counts for nobody — not listed", !who(wasCs));

step("Case 6 — who is listed, and how");
same("the inactive CS: listed with their overdue follow-up, marked inactive", [who(csOff)?.active, who(csOff)?.counts, who(csOff)?.total], [false, { overdue_followups: 1 }, 1]);
check("everyone else listed is active", people.filter((p) => p.id !== id(csOff)).every((p) => p.active === true));
same("emails lowercase", who(broker)?.email, "broker@e2e-pending.test");
same("names", who(cs1)?.name, "Cee One");
const studentIds = new Set([s1, s2, s3, s4, s5, s6, s7, s8, s9].map(sid));
const userIds = new Set([boss, bossOff, broker, cs1, cs2, csOff, mentor, wasCs].map(id));
check("only staff: every person is a user, never a student", people.every((p) => userIds.has(p.id) && !studentIds.has(p.id)));
check("nobody with nothing waiting", people.every((p) => p.total > 0));
same("sorted by total, largest first", people.map((p) => p.total), [...people.map((p) => p.total)].sort((a, b) => b - a));
same("in order", people.map((p) => p.name), ["Cee One", "Cee Two", "Super Admin", "Broker Admin", "Cee Gone", "Junior Mentor"]);
check("each total = its counts without *_overdue", people.every((p) =>
  p.total === Object.entries(p.counts as Record<string, number>).filter(([k]) => !k.endsWith("_overdue")).reduce((s, [, v]) => s + v, 0)));
check("nothing unattributed is pinned on anyone: the CS-less student's follow-up / not onboarded count only in totals",
  people.reduce((s, p) => s + (p.counts.followups_today ?? 0), 0) === 2 /* CS One + CS Two for s1 */ && kind("followups_today").total === 2);

step("Case 7 — read-only for the portal");
check("other routes still answer: GET /roles", (await call("GET", "/api/v1/service/roles", { "x-portal-secret": SECRET })).status === 200);
check("POST /pending is not a route", (await call("POST", "/api/v1/service/pending", { "x-portal-secret": SECRET }, {})).status === 404);

console.log(`\n${pass} passed, ${fail} failed`);
await client.close();
process.exit(fail ? 1 : 0);
