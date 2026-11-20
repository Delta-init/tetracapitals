/**
 * DUBAI-STUD (the user, 2026-11-20), on made-up staff and students:
 *   - finance's `dubaiStudent` with a Bangalore sale: a new student goes to a Dubai team in Dubai's round, stored
 *     `location` dubai and `dubai_student`, the course's fees still Bangalore's (INR); its history says so;
 *   - only for a Bangalore sale; without it, Bangalore as before;
 *   - a student already here (by email or the same invoice) is not moved, only flagged — once;
 *   - money: a DUBAI-STUD's bonus is Bangalore's (finance org, deciders) though their team is Dubai's; others as before;
 *   - a client can't set `dubai_student`; the student page's "came from" says DUBAI-STUD;
 *   - scripts/dubai-students.ts: dry run writes nothing; --write flags them, moves a Bangalore team's student to a
 *     Dubai team in turn (Open Students and Dubai-team ones: the flag only), an id fitting nobody is said and left, one
 *     fitting two stops it; --undo puts them back.
 * Run through ./test-dubai-students.sh. Refuses anything but a scratch database on 127.0.0.1.
 */
import { MongoClient, ObjectId } from "mongodb";
import { spawnSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const uri = process.env.MONGO_URI ?? "", dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) { console.error("Refusing to run"); process.exit(1); }
const WORK = process.env.E2E_WORK ?? "";
if (!WORK) { console.error("E2E_WORK is not set"); process.exit(1); }
let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); } else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const client = await new MongoClient(uri).connect();
const db = client.db(dbName);
await db.dropDatabase();
let t = 0;
const u = (name: string, app_role: string, up?: ObjectId, extra: any = {}) => ({ _id: new ObjectId(), full_name: name, email: `${name.toLowerCase()}@e2e.test`, app_role, status: "active", up_head_id: up ? String(up) : "", created_date: `2026-01-${String(++t).padStart(2, "0")}`, ...extra });
const chiefA = u("ChiefA", "chief_mentor", undefined, { team_name: "Dubai A" }), a1 = u("A1", "cs", chiefA._id), a2 = u("A2", "cs", chiefA._id);
const chiefB = u("ChiefB", "chief_mentor", undefined, { team_name: "Dubai B", team_location: "dubai" }), b1 = u("B1", "cs", chiefB._id);
const chiefC = u("ChiefC", "chief_mentor", undefined, { team_name: "Bangalore C", team_location: "bangalore" }), c1 = u("C1", "cs", chiefC._id), c2 = u("C2", "cs", chiefC._id);
const boss = u("Boss", "super_admin");
const brokerDubai = u("BrokerDubai", "broker_admin", undefined, { team_location: "dubai" });
const brokerBlr = u("BrokerBlr", "broker_admin", undefined, { team_location: "bangalore" });
await db.collection("users").insertMany([chiefA, a1, a2, chiefB, b1, chiefC, c1, c2, boss, brokerDubai, brokerBlr] as any[]);
const dubaiCs = new Set([a1, a2, b1].map((x) => String(x._id)));
const blrCs = new Set([c1, c2].map((x) => String(x._id)));

const FINANCE_SECRET = "dubai-students-e2e-finance-secret-0123456789";
process.env.FINANCE_S2S_SECRET = FINANCE_SECRET;
const { connectDb, closeDb } = await import("../db");
const { handleFinanceStudents } = await import("../finance/students");
const B = await import("../finance/bonusLocation");
const L = await import("../lib/location");
const { prepareStudentUpdate } = await import("../students/history");
const { getStudentHistory } = await import("../functions/getStudentHistory");
await connectDb();
const BOSS = { id: String(boss._id), email: boss.email, full_name: "Boss", app_role: "super_admin" } as any;
const counter = (id: string) => db.collection("counters").findOne({ _id: id as any }) as Promise<any>;

let f = 0;
const fromFinance = async (over: Record<string, unknown>) => {
  const i = ++f;
  const body = {
    invoiceId: new ObjectId().toString(), invoiceNumber: `IN-E${i}`, email: `fin${i}@stu.test`, name: `Finance ${i}`, course: "Forex Mastery", lmsUserId: new ObjectId().toString(),
    feeSummary: { feeMinor: 5_000_000, paidMinor: 5_000_000, balanceMinor: 0, currency: "INR", bonus: { given: false } },
    ...over,
  };
  const res = await handleFinanceStudents(new Request("http://x/api/v1/integrations/finance/students", { method: "POST", headers: { "content-type": "application/json", "x-finance-secret": FINANCE_SECRET }, body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any, invoiceId: body.invoiceId, student: (await db.collection("students").findOne({ $or: [{ finance_invoice_id: body.invoiceId }, { email: body.email }] })) as any };
};
const history = async (s: any, type: string) => (await db.collection("student_history").find({ student_id: String(s?._id), type }).toArray()) as any[];

console.log("\n\x1b[1mFrom finance: a DUBAI-STUD\x1b[0m");
const blrTurnBefore = (await counter("finance_student_team_turn:bangalore"))?.last_key;
let fr = await fromFinance({ crm: "delta", academy: "bangalore", dubaiStudent: true });
const ds = fr.student;
check("a Sales CRM close for Bangalore, DUBAI-STUD: made, given to a Dubai team's CS", fr.status === 200 && fr.body?.data?.created === true && dubaiCs.has(String(ds?.primary_mentor_id)), JSON.stringify(fr.body));
check("…stored location dubai and dubai_student", ds?.location === "dubai" && ds?.dubai_student === true);
check("…the course's fees still the Bangalore sale's, in rupees", ds?.course_fees?.[0]?.academy === "bangalore" && ds?.course_fees?.[0]?.currency === "INR");
check("…in Dubai's round; Bangalore's round untouched", !!(await counter("finance_student_team_turn"))?.last_key && (await counter("finance_student_team_turn:bangalore"))?.last_key === blrTurnBefore);
const arrived = String((await history(ds, "arrived"))[0]?.text ?? "");
check("…its history says DUBAI-STUD, for the Bangalore academy", /for the Bangalore academy \(DUBAI-STUD: served by a Dubai team/.test(arrived), arrived);
fr = await fromFinance({ crm: "remote", academy: "bangalore", dubaiStudent: true });
check("a Remote CRM close for Bangalore, DUBAI-STUD: a Dubai team too", dubaiCs.has(String(fr.student?.primary_mentor_id)) && fr.student?.dubai_student === true);
fr = await fromFinance({ crm: "delta", academy: "dubai", dubaiStudent: true });
check("dubaiStudent with a Dubai sale: a plain Dubai student, no flag", dubaiCs.has(String(fr.student?.primary_mentor_id)) && fr.student?.dubai_student === undefined && fr.student?.location === "dubai");
fr = await fromFinance({ crm: "delta", academy: "bangalore" });
const plainBlr = fr.student;
check("a Bangalore sale without it: a Bangalore team, as before", blrCs.has(String(plainBlr?.primary_mentor_id)) && plainBlr?.location === "bangalore" && plainBlr?.dubai_student === undefined);
fr = await fromFinance({ crm: "delta", academy: "bangalore", dubaiStudent: "yes" });
check("only `true` counts", blrCs.has(String(fr.student?.primary_mentor_id)) && fr.student?.dubai_student === undefined);

console.log("\n\x1b[1mA student already here\x1b[0m");
fr = await fromFinance({ crm: "delta", academy: "bangalore", dubaiStudent: true, email: plainBlr.email });
let again: any = await db.collection("students").findOne({ _id: plainBlr._id });
check("by email: not moved — still their Bangalore CS", fr.body?.data?.created === false && String(again?.primary_mentor_id) === String(plainBlr.primary_mentor_id) && again?.location === "bangalore");
check("…flagged DUBAI-STUD, said once in their history", again?.dubai_student === true && (await history(plainBlr, "details_changed")).filter((h) => /DUBAI-STUD/.test(h.text)).length === 1);
await fromFinance({ crm: "delta", academy: "bangalore", dubaiStudent: true, email: plainBlr.email });
check("…a second such close adds no second line", (await history(plainBlr, "details_changed")).filter((h) => /DUBAI-STUD/.test(h.text)).length === 1);
fr = await fromFinance({ crm: "delta", academy: "bangalore" });
const sameInv = fr.student;
await handleFinanceStudents(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", "x-finance-secret": FINANCE_SECRET },
  body: JSON.stringify({ invoiceId: fr.invoiceId, invoiceNumber: "IN-AGAIN", email: sameInv.email, crm: "delta", academy: "bangalore", dubaiStudent: true }) }));
again = await db.collection("students").findOne({ _id: sameInv._id });
check("the same invoice again with it: flagged, not moved", again?.dubai_student === true && String(again?.primary_mentor_id) === String(sameInv.primary_mentor_id));

console.log("\n\x1b[1mTheir money stays in the Bangalore books\x1b[0m");
const dubaiPlain = (await db.collection("students").findOne({ location: "dubai", dubai_student: { $exists: false } })) as any;
check("a DUBAI-STUD's bonus: Bangalore, though on a Dubai team", (await B.bonusLocationOf({ type: "BONUS", student_id: String(ds._id) })) === "bangalore");
check("…a Dubai student's: Dubai; a Bangalore one's: Bangalore", (await B.bonusLocationOf({ type: "BONUS", student_id: String(dubaiPlain._id) })) === "dubai"
  && (await B.bonusLocationOf({ type: "BONUS", student_id: String(fr.student._id) })) === "bangalore");
const where = await B.studentLocations([ds._id, dubaiPlain._id]);
check("studentLocations (MT5 Approvals, the nav and Root pending counts) agree", where.get(String(ds._id)) === "bangalore" && where.get(String(dubaiPlain._id)) === "dubai");
const deciders = await B.bonusDeciderIds("bangalore");
check("…decided by Bangalore's broker admin and the Super Admin, not Dubai's", deciders.includes(String(brokerBlr._id)) && deciders.includes(String(boss._id)) && !deciders.includes(String(brokerDubai._id)));
const tx = { type: "BONUS", student_id: String(ds._id) };
check("…a Dubai broker admin is refused it, Bangalore's is not", /Bangalore team's bonus/.test(String(await B.bonusLocationRefusal(tx, String(brokerDubai._id), "broker_admin")))
  && (await B.bonusLocationRefusal(tx, String(brokerBlr._id), "broker_admin")) === null);
const rows = [{ _id: 1, type: "BONUS", student_id: String(ds._id) }, { _id: 2, type: "BONUS", student_id: String(dubaiPlain._id) }];
const forDubai = await B.forBrokerLocation(rows, { id: String(brokerDubai._id), app_role: "broker_admin" });
const forBlr = await B.forBrokerLocation(rows, { id: String(brokerBlr._id), app_role: "broker_admin" });
check("…MT5 Approvals: on Bangalore's list, off Dubai's", forDubai.map((r) => r._id).join() === "2" && forBlr.map((r) => r._id).join() === "1");
check("where they are served is still Dubai (Students list, TVs, dashboards)", L.currentLocationOf(ds, () => "dubai") === "dubai" && L.moneyLocationOf(ds, () => "dubai") === "bangalore");

console.log("\n\x1b[1mNot a client's to set; the student page says so\x1b[0m");
const data: Record<string, any> = { dubai_student: true, phone: "123" };
await prepareStudentUpdate(dubaiPlain, data, BOSS);
check("an edit can't set dubai_student", !("dubai_student" in data) && data.phone === "123");
const h: any = await (await getStudentHistory(new Request("http://x", { method: "POST", body: JSON.stringify({ studentId: String(ds._id) }) }), BOSS)).json();
const cameFrom = h?.cameFrom ?? h?.data?.cameFrom;
check("came from: …, Bangalore academy — DUBAI-STUD", /DUBAI-STUD/.test(String(cameFrom?.academy ?? "")), JSON.stringify(cameFrom));

console.log("\n\x1b[1mscripts/dubai-students.ts — the backfill\x1b[0m");
const now = new Date().toISOString();
const seed = (name: string, cs: any, chief: any, extra: any = {}) => ({
  _id: new ObjectId(), student_code: `STU-9${String(++t).padStart(3, "0")}`, full_name: name, email: `${name.toLowerCase().replace(/\W+/g, "")}@stu.test`,
  primary_mentor_id: cs ? String(cs._id) : "", primary_mentor_name: cs?.full_name ?? "", assignment_status: cs ? "assigned" : "open_pool",
  team_id: chief ? String(chief._id) : "", team_name: chief?.team_name ?? "", location: "bangalore", status: "ACTIVE",
  finance_invoice_id: new ObjectId().toString(), first_assignee_id: cs ? String(cs._id) : "", assigned_at: now, created_date: now, updated_date: now, ...extra,
});
const onBlr = seed("Backfill Blr", c1, chiefC), onBlr2 = seed("Backfill Blr Two", c2, chiefC), inPool = seed("Backfill Pool", null, null),
  onDubai = seed("Backfill Dubai", a1, chiefA), done = seed("Backfill Done", b1, chiefB, { dubai_student: true, location: "dubai" });
const merged = seed("Backfill Merged", c1, chiefC);
const mergedInvoice = new ObjectId().toString();
(merged as any).other_finance_invoice_ids = [mergedInvoice];
const twin1 = seed("Twin One", c1, chiefC), twin2 = seed("Twin Two", c2, chiefC, { finance_invoice_id: twin1.finance_invoice_id });
await db.collection("students").insertMany([onBlr, onBlr2, inPool, onDubai, done, merged, twin1, twin2] as any[]);
const nobody = new ObjectId().toString();
const ids = [onBlr, onBlr2, inPool, onDubai, done].map((s) => s.finance_invoice_id).concat(mergedInvoice, nobody);
const SCRIPT = resolve(import.meta.dir, "dubai-students.ts");
const runScript = (...args: string[]) => {
  const r = spawnSync("bun", ["--no-env-file", SCRIPT, ...args], { cwd: WORK, env: { ...process.env, MONGO_URI: uri, MONGO_DB: dbName }, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const snapshot = async () => JSON.stringify(await db.collection("students").find({}, { projection: { updated_date: 0 } }).sort({ _id: 1 }).toArray());
const before = await snapshot();
const turnBefore = (await counter("finance_student_team_turn"))?.last_key;

let r = runScript(`--invoice-ids=${ids.join(",")}`);
check("dry run: says who and what, writes nothing", r.code === 0 && /6 student\(s\) found · 5 to change · 3 to move/.test(r.out) && (await snapshot()) === before && (await counter("finance_student_team_turn"))?.last_key === turnBefore, r.out);
check("…an id that fits nobody is said", r.out.includes(`Not here (no student has the invoice — nothing to do for them): ${nobody}`), r.out);
check("…the one already done is said", /STU-9\d+\s+Backfill Done.*already DUBAI-STUD/.test(r.out), r.out);

r = runScript(`--invoice-ids=${twin1.finance_invoice_id},${onBlr.finance_invoice_id}`, "--write");
check("an id two students share: stopped, nothing written", r.code === 1 && /2 students have this invoice/.test(r.out) && (await snapshot()) === before, r.out);
r = runScript("--invoice-ids=not-an-id");
check("something that isn't an id: stopped", r.code === 1 && /Not finance invoice ids/.test(r.out));

r = runScript("--invoice-ids", ids.join(","), "--write");
const get = async (s: any) => (await db.collection("students").findOne({ _id: s._id })) as any;
const [nb, nb2, np, nd, nm] = await Promise.all([get(onBlr), get(onBlr2), get(inPool), get(onDubai), get(merged)]);
check("--write: done", r.code === 0 && /Done: 5 student\(s\) changed, 3 given to a Dubai team/.test(r.out), r.out);
check("…Bangalore team's students: a Dubai team's CS now, the team from the CS", [nb, nb2, nm].every((s) => dubaiCs.has(String(s.primary_mentor_id)) && [String(chiefA._id), String(chiefB._id)].includes(String(s.team_id))),
  JSON.stringify([nb, nb2, nm].map((s) => [s.primary_mentor_name, s.team_name])));
check("…in Dubai's round, one turn each", (await counter("finance_student_team_turn"))?.last_key !== turnBefore);
check("…flagged, location dubai; who received them first kept", [nb, nb2, nm].every((s) => s.dubai_student === true && s.location === "dubai") && nb.first_assignee_id === String(c1._id));
check("…Open Students and a Dubai team's: flag and location only", np.dubai_student === true && np.location === "dubai" && !np.primary_mentor_id && nd.dubai_student === true && String(nd.primary_mentor_id) === String(a1._id));
const hist = (await db.collection("student_history").find({ student_id: String(onBlr._id), via: "dubai-students" }).toArray()) as any[];
check("…their history: the move and DUBAI-STUD", hist.some((x) => x.type === "mentor_changed" && /team Bangalore C → Dubai/.test(x.text)) && hist.some((x) => /DUBAI-STUD/.test(x.text)), JSON.stringify(hist.map((x) => [x.type, x.text])));
check("…the new CS told (new for them), never the student", String(nb.new_for_id ?? "") === String(nb.primary_mentor_id));
check("…money now Bangalore's for them all", (await B.studentLocations([nb._id, np._id, nd._id])).get(String(nd._id)) === "bangalore");
const undoDir = join(WORK, "backups", "dubai-students");
const undoFile = existsSync(undoDir) ? join(undoDir, readdirSync(undoDir)[0] ?? "") : "";
check("…an undo file in backups/dubai-students/", !!undoFile && existsSync(undoFile) && r.out.includes(undoFile), r.out);
r = runScript(`--invoice-ids=${ids.join(",")}`);
check("run again: everything already done", r.code === 0 && /0 to change/.test(r.out), r.out);

r = runScript(`--undo=${undoFile}`);
check("--undo (dry): would put 5 back, writes nothing", r.code === 0 && /5 student\(s\) would be put back/.test(r.out) && (await get(onBlr)).dubai_student === true, r.out);
r = runScript(`--undo=${undoFile}`, "--write");
const [ub, up, ud, um] = await Promise.all([get(onBlr), get(inPool), get(onDubai), get(merged)]);
check("--undo --write: back with their Bangalore CS and team, unflagged", r.code === 0 && String(ub.primary_mentor_id) === String(c1._id) && String(ub.team_id) === String(chiefC._id) && ub.location === "bangalore" && ub.dubai_student === undefined && String(um.primary_mentor_id) === String(c1._id), r.out);
check("…the others too; the history lines gone", up.dubai_student === undefined && up.location === "bangalore" && ud.dubai_student === undefined && (await db.collection("student_history").countDocuments({ via: "dubai-students" })) === 0);

await new Promise((res) => setTimeout(res, 300));   // the "new student" notices sent in the background
await closeDb(); await db.dropDatabase(); await client.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
