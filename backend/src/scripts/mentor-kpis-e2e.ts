/**
 * My KPIs (functions/mentorKpis.ts, 2026-11-09), against a stand-in Root on made-up people:
 *   a mentor sees their own month (never someone else's); a Chief their team (their downline, A–Z, no ranking), a CS
 *   Manager their location's mentors, an admin everyone; a CS none; a correction asked for someone within reach goes
 *   to Root with who asked, anyone else's is refused; Root closed → "not open yet", not an error.
 * Run through ./test-mentor-kpis.sh (throwaway mongod, a fake Root — no .env). Scratch database only.
 */
import http from "node:http";
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "";
const dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+$/.test(uri) || !/e2e/.test(dbName)) { console.error("Refusing: scratch database only"); process.exit(1); }
const SECRET = process.env.ROOT_ERP_SECRET ?? "";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"} ${label}\x1b[0m${ok ? "" : ` — ${detail}`}`); };
const j = (v: unknown) => JSON.stringify(v).slice(0, 400);

/* The stand-in Root: what it was asked, and its answers. */
let rootOpen = true;
const asked: { method: string; path: string; secret: string; body: any }[] = [];
const fake = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const u = new URL(req.url ?? "/", "http://x");
    const body = raw ? JSON.parse(raw) : null;
    asked.push({ method: req.method ?? "", path: u.pathname + u.search, secret: String(req.headers["x-portal-secret"] ?? ""), body });
    const send = (s: number, b: unknown) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
    if (req.headers["x-portal-secret"] !== SECRET) return send(401, { success: false, message: "Invalid service credential" });
    if (!rootOpen) return send(409, { success: false, message: "Mentor KPIs aren't open to the CS Portal yet" });
    if (u.pathname === "/api/v1/service/mentor-kpis/mentor") {
      const email = u.searchParams.get("email");
      if (email === "ghost@e2e.test") return send(404, { success: false, message: "No such mentor in CS Portal's mentor report for that month" });
      return send(200, { success: true, data: { month: u.searchParams.get("month"), mentor: { email, score: 81.5 }, observationUntil: "2027-01-08T00:00:00.000Z" } });
    }
    if (u.pathname === "/api/v1/service/mentor-kpis/scores") {
      const emails = String(u.searchParams.get("emails") ?? "").split(",").filter(Boolean);
      return send(200, { success: true, data: { month: u.searchParams.get("month"), mentors: emails.map((e) => ({ email: e, score: 70 })) } });
    }
    if (u.pathname === "/api/v1/service/mentor-kpis/corrections" && req.method === "POST") {
      return send(201, { success: true, data: { id: "c1", status: "pending", ...body } });
    }
    send(404, { success: false, message: "Not found" });
  });
});
await new Promise<void>((ok) => fake.listen(Number(process.env.E2E_FAKE_ROOT_PORT), "127.0.0.1", ok));

const client = await new MongoClient(uri).connect();
const db = client.db(dbName);
await db.dropDatabase();
const person = (full_name: string, email: string, app_role: string, extra: Record<string, unknown> = {}) =>
  ({ _id: new ObjectId(), email, full_name, app_role, status: "active", ...extra });
const admin = person("Ada Admin", "ada@e2e.test", "super_admin");
const chief = person("Chief Cara", "cara@e2e.test", "chief_mentor");
const senior = person("Senior Sam", "sam@e2e.test", "senior_mentor");
const junior = person("Junior Jo", "Jo@E2E.test", "junior_mentor");
const other = person("Other Oz", "oz@e2e.test", "junior_mentor");
const gone = person("Gone Gil", "gil@e2e.test", "junior_mentor", { status: "inactive" });
const cs = person("Cee Cs", "cee@e2e.test", "cs");
(senior as any).up_head_id = chief._id;
(junior as any).up_head_id = senior._id;
(gone as any).up_head_id = chief._id;
await db.collection("users").insertMany([admin, chief, senior, junior, other, gone, cs] as any[]);

const { connectDb, closeDb } = await import("../db");
const F = await import("../functions/mentorKpis");
await connectDb();
const asUser = (u: any) => ({ id: String(u._id), email: u.email, full_name: u.full_name, app_role: u.app_role }) as any;
const call = async (fn: any, user: any, body: any = {}) => {
  const r: Response = await fn(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), asUser(user));
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};
const last = () => asked[asked.length - 1]!;

console.log("\n\x1b[1mA mentor's own\x1b[0m");
let r = await call(F.getMyKpis, junior, { month: "2026-10" });
check("a junior: their own month, asked of Root by their address (lower case) with the shared secret",
  r.status === 200 && r.body.mentor?.email === "jo@e2e.test" && last().path === "/api/v1/service/mentor-kpis/mentor?email=jo%40e2e.test&month=2026-10" && last().secret === SECRET, j({ r, a: last() }));
r = await call(F.getMyKpis, junior, { month: "nonsense" });
check("…a month that isn't one: this month", /month=\d{4}-\d{2}$/.test(last().path) && r.status === 200);
check("a CS has no KPIs of their own (403)", (await call(F.getMyKpis, cs)).status === 403);
check("a junior can't open someone else's (403), nor ask for their correction", (await call(F.getMentorKpis, junior, { email: "oz@e2e.test" })).status === 403
  && (await call(F.requestKpiCorrection, junior, { email: "oz@e2e.test", month: "2026-10", metric: "classes_held", action: "leave_out", reason: "x" })).status === 403);
check("…and has no team view (403)", (await call(F.getTeamKpis, junior)).status === 403);

console.log("\n\x1b[1mA Chief's team, an admin's everyone\x1b[0m");
r = await call(F.getTeamKpis, chief, { month: "2026-10" });
const teamAsked = new URL(`http://x${last().path}`).searchParams.get("emails")!.split(",").sort();
check("a Chief: their team down the line (Sam, and Jo below him) and themselves — not Oz, not inactive Gil, not the CS",
  r.status === 200 && JSON.stringify(teamAsked) === JSON.stringify(["cara@e2e.test", "jo@e2e.test", "sam@e2e.test"]), j(teamAsked));
check("…opens one of them, not someone outside", (await call(F.getMentorKpis, chief, { email: "JO@e2e.test", month: "2026-10" })).status === 200
  && (await call(F.getMentorKpis, chief, { email: "oz@e2e.test" })).status === 403);
r = await call(F.getTeamKpis, admin, { month: "2026-10" });
const all = new URL(`http://x${last().path}`).searchParams.get("emails")!.split(",").sort();
check("an admin: every active mentor", JSON.stringify(all) === JSON.stringify(["cara@e2e.test", "jo@e2e.test", "oz@e2e.test", "sam@e2e.test"]), j(all));

console.log("\n\x1b[1mAsking for a correction\x1b[0m");
r = await call(F.requestKpiCorrection, chief, { email: "jo@e2e.test", month: "2026-10", metric: "classes_held", action: "set_value", value: 42, reason: "Two cover classes missed", evidence: "LMS list" });
check("a Chief for their junior: sent to Root with who asked", r.status === 200 && last().method === "POST" && last().body?.raisedBy?.email === "cara@e2e.test"
  && last().body?.raisedBy?.name === "Chief Cara" && last().body?.value === 42 && last().body?.email === "jo@e2e.test", j(last().body));
check("a mentor for themselves", (await call(F.requestKpiCorrection, junior, { email: "jo@e2e.test", month: "2026-10", metric: "on_time_start", action: "leave_out", reason: "Join links down" })).status === 200
  && last().body?.value === null);
check("no reason, no value or a bad month → 400",
  (await call(F.requestKpiCorrection, junior, { email: "jo@e2e.test", month: "2026-10", metric: "classes_held", action: "set_value", value: 3, reason: "" })).status === 400
  && (await call(F.requestKpiCorrection, junior, { email: "jo@e2e.test", month: "2026-10", metric: "classes_held", action: "set_value", reason: "x" })).status === 400
  && (await call(F.requestKpiCorrection, junior, { email: "jo@e2e.test", month: "Oct", metric: "classes_held", action: "leave_out", reason: "x" })).status === 400);

console.log("\n\x1b[1mRoot's answers\x1b[0m");
r = await call(F.getMentorKpis, admin, { email: "jo@e2e.test" });
check("found", r.body.mentor?.score === 81.5);
await db.collection("users").insertOne(person("Ghost", "ghost@e2e.test", "junior_mentor") as any);
r = await call(F.getMentorKpis, admin, { email: "ghost@e2e.test", month: "2026-10" });
check("not in that month's report: says so (not an error)", r.status === 200 && r.body.missing === true, j(r));
rootOpen = false;
r = await call(F.getMyKpis, junior, { month: "2026-10" });
check("Root not opened yet: 'not open yet', not an error", r.status === 200 && r.body.closed === true, j(r));

fake.close();
await closeDb();
await client.close();
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
