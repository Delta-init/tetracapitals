/**
 * scripts/set-sales-crm.ts against a scratch database: a course sold through the Sales CRM, moved to Draw — the course
 * row's and the student's sales CRM, who closed them (the old CRM's closer off, the new one on), a history line and a
 * log; the money, CS and team untouched; a student with another course from the old CRM keeping its top-level CRM and
 * that closer; the dry run and a second run changing nothing; undo putting it back.
 * Run through ./test-set-sales-crm.sh (throwaway mongod; nothing reads a .env).
 */
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "", dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+/.test(uri) || !/e2e/i.test(dbName)) { console.error(`Refusing: a scratch e2e database on 127.0.0.1 only (${uri} / ${dbName})`); process.exit(1); }
let failures = 0, checks = 0;
const check = (label: string, ok: boolean, detail = "") => { checks++; if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`); else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); } };
const j = (v: unknown) => String(JSON.stringify(v)).slice(0, 500);

const client = await new MongoClient(uri).connect();
const db = client.db(dbName);
await db.dropDatabase();
const home = mkdtempSync(join(tmpdir(), "set-sales-crm-e2e-"));
const run = async (...args: string[]) => {
  const p = Bun.spawn(["bun", "--no-env-file", "src/scripts/set-sales-crm.ts", ...args], { env: { ...process.env, HOME: home, MONGO_URI: uri, MONGO_DB: dbName }, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out: out + err };
};
const fee = (o: Record<string, unknown>) => ({ course: "MARKET BREAK-OUT TRADING PROGRAM", sales_crm: "delta", academy: "dubai", currency: "AED", fee_minor: 225000, paid_minor: 225000, balance_minor: 0, bonus_given: true, bonus_minor: 50000, status: "paid", ...o });
const one = new ObjectId(), two = new ObjectId();
await db.collection("students").insertMany([
  { _id: one, student_code: "STU-5334", full_name: "Student One", sales_crm: "delta", primary_mentor_name: "CS One", team_name: "Team A",
    closed_by: [{ email: "rep.sales@e2e.local", name: "Rep Sales", crm: "delta" }], course_fees: [fee({ invoice_id: "i1", invoice_number: "IN-00456" })] },
  { _id: two, student_code: "STU-5335", full_name: "Student Two", sales_crm: "delta",
    closed_by: [{ email: "rep.sales@e2e.local", name: "Rep Sales", crm: "delta" }], course_fees: [fee({ invoice_id: "i2", invoice_number: "IN-00500" }), fee({ invoice_id: "i3", invoice_number: "IN-00501" })] },
]);
const args = ["--invoice=IN-00456", "--crm=draw", "--closed-by-email=Rep.Draw@e2e.local", "--closed-by-name=Rep Draw"];
const st = (id: ObjectId) => db.collection("students").findOne({ _id: id }) as Promise<any>;
const before = j(await st(one));

let r = await run(...args);
check("shows it: the course and the student Sales CRM → Draw, Rep Sales → Rep Draw", r.code === 0 && /Sales CRM → Draw/.test(r.out) && /the student's sales CRM: Sales CRM → Draw/.test(r.out) && /Rep Sales \(Sales CRM\) → Rep Draw \(Draw\)/.test(r.out) && /showing only/.test(r.out), r.out);
check("…changes nothing", j(await st(one)) === before);

r = await run(...args, "--apply");
const s = await st(one);
check("applied: the course row, the student, who closed them", r.code === 0 && s.course_fees[0].sales_crm === "draw" && s.sales_crm === "draw"
  && j(s.closed_by) === j([{ email: "rep.draw@e2e.local", name: "Rep Draw", crm: "draw" }]), j([s.sales_crm, s.closed_by, s.course_fees[0].sales_crm]));
check("…the money, bonus, CS and team untouched", s.course_fees[0].fee_minor === 225000 && s.course_fees[0].paid_minor === 225000 && s.course_fees[0].bonus_minor === 50000 && s.primary_mentor_name === "CS One" && s.team_name === "Team A");
const h = await db.collection("student_history").findOne({ student_id: String(one) });
check("…a history line and a log", /IN-00456 was Draw's sale, closed by Rep Draw — moved from Sales CRM \(Rep Sales\)/.test(h?.text ?? "") && (await db.collection("logs").countDocuments({ action_type: "set_sales_crm" })) === 1, j(h));
check("…an undo file in the home folder", readdirSync(home).some((f) => f.startsWith("set-sales-crm-undo-STU-5334")));
r = await run(...args, "--apply");
check("again: nothing to change", r.code === 1 && /already came from Draw/.test(r.out), r.out);

r = await run("--invoice=IN-00500", "--crm=draw", "--closed-by-email=rep.draw@e2e.local", "--closed-by-name=Rep Draw", "--apply");
const t = await st(two);
check("another course still from the Sales CRM: its top-level CRM and that closer kept, the new closer added", r.code === 0 && t.sales_crm === "delta" && t.course_fees[0].sales_crm === "draw" && t.course_fees[1].sales_crm === "delta"
  && t.closed_by.length === 2 && t.closed_by.some((c: any) => c.crm === "delta") && t.closed_by.some((c: any) => c.crm === "draw"), j(t));

r = await run("--invoice=IN-09999", "--crm=draw", "--closed-by-email=rep.draw@e2e.local", "--closed-by-name=Rep Draw");
check("an invoice nobody has: refused", r.code === 1 && /No student has IN-09999/.test(r.out), r.out);
r = await run("--invoice=IN-00456", "--crm=nowhere", "--closed-by-email=rep.draw@e2e.local", "--closed-by-name=Rep Draw");
check("an unknown CRM: refused", r.code === 1 && /--crm: one of/.test(r.out), r.out);

const file = join(home, readdirSync(home).find((f) => f.startsWith("set-sales-crm-undo-STU-5334"))!);
r = await run(`--undo=${file}`);
check("undo shown first, nothing changed", r.code === 0 && /back to delta/.test(r.out) && (await st(one)).sales_crm === "draw", r.out);
r = await run(`--undo=${file}`, "--apply");
const back = await st(one);
check("undo applied: as it was", r.code === 0 && back.sales_crm === "delta" && back.course_fees[0].sales_crm === "delta" && j(back.closed_by) === j([{ email: "rep.sales@e2e.local", name: "Rep Sales", crm: "delta" }]), j(back));

await client.close();
console.log(`\n${failures ? "\x1b[31m" : "\x1b[32m"}${checks - failures}/${checks} checks passed\x1b[0m`);
process.exit(failures ? 1 : 0);
