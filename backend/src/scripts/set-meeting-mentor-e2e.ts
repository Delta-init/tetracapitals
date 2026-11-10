/**
 * scripts/set-meeting-mentor.ts, then backfill-meeting-mentor.ts, on made-up staff in a throwaway mongod (the user,
 * 2026-11-10: "backfill the meeting done by … its commission go also"):
 *   - the dry run shows each change and writes nothing; a line that is wrong (not a mentor, no such email or request)
 *     refuses the whole run;
 *   - --apply puts the mentor on each request, keeps what it named before, and leaves an undo file; one already right
 *     is left alone;
 *   - the backfill then pays a Senior who held the meeting their Meeting mentor %; a Chief named gets nothing more; a
 *     request that named a Senior before but had no credit gets it too; running it again adds nothing;
 *   - --undo puts the requests back as they were.
 * Run through ./test-set-meeting-mentor.sh (HOME is the throwaway folder, for the undo files).
 */
import { MongoClient, ObjectId } from "mongodb";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const uri = process.env.MONGO_URI ?? "", dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) {
  console.error(`Refusing to run: needs a scratch e2e database on 127.0.0.1, got ${uri} / ${dbName}`);
  process.exit(1);
}
let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
const client = await new MongoClient(uri).connect();
const db = client.db(dbName);
for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({});

const lv = (label: string, percentage: number, pool = false) => ({ label, percentage, pool });
const plan = { _id: new ObjectId(), name: "Role plan", active: true,
  bonus_with_levels: [lv("CS", 2), lv("CS Manager", 1), lv("Junior", 1, true), lv("Senior", 1, true), lv("Chief", 4)] };
await db.collection("commission_plans").insertOne(plan as any);
const u = (name: string, app_role: string, up?: ObjectId, extra: any = {}) => ({ _id: new ObjectId(), full_name: name, email: `${name.toLowerCase().replace(/ /g, ".")}@e2e.test`, app_role, status: "active", up_head_id: up ? String(up) : "", commission_plan_id: String(plan._id), ...extra });
const chief = u("Chief A", "chief_mentor");
const senior = u("Senior A", "senior_mentor", chief._id);
const junior = u("Junior A", "junior_mentor", senior._id);
const cs = u("Cee Ess", "cs", junior._id);
const csNamedLikeMentor = u("Senior A CS", "cs", chief._id);
const doney = u("Doney", "cs_manager", undefined, { all_teams_cs_manager: true });
await db.collection("users").insertMany([chief, senior, junior, cs, csNamedLikeMentor, doney] as any[]);

const { connectDb, closeDb } = await import("../db");
const { creditCommissionFor } = await import("../functions/creditCommission");
await connectDb();
const bonus = async (name: string, extra: Record<string, unknown> = {}) => {
  const _id = new ObjectId();
  await db.collection("funding_transactions").insertOne({
    _id, type: "BONUS", status: "APPROVED", amount_usd: 1000, student_name: name, txn_id: `MB-${name}`, requested_at: "2026-11-05T08:00:00.000Z",
    initiating_mentor_id: String(cs._id), initiating_mentor_name: cs.full_name, primary_mentor_id: String(cs._id), primary_mentor_name: cs.full_name,
  } as any);
  await creditCommissionFor(String(_id));
  if (Object.keys(extra).length) await db.collection("funding_transactions").updateOne({ _id }, { $set: extra });
  return String(_id);
};
const credits = (id: string) => db.collection("commission_credits").find({ transaction_id: id }).sort({ level: 1 }).toArray() as Promise<any[]>;
const tx = (id: string) => db.collection("funding_transactions").findOne({ _id: new ObjectId(id) }) as Promise<any>;
// T1: nobody named — the Senior held it. T2: nobody named — a Chief held it. T3: named a Senior after it was
// credited (no Meeting mentor credit) — already right here. T4: names the Chief; the sheet says the Senior.
const T1 = await bonus("one"), T2 = await bonus("two");
const T3 = await bonus("three", { meeting_mentor_id: String(senior._id), meeting_mentor_name: senior.full_name });
const T4 = await bonus("four", { meeting_mentor_id: String(chief._id), meeting_mentor_name: chief.full_name });
await closeDb();

const run = (...args: string[]) => {
  const p = Bun.spawnSync(["bun", "--no-env-file", ...args], { env: process.env, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
};
const set = (...extra: string[]) => run("src/scripts/set-meeting-mentor.ts", `--set=${T1}=${senior.email}`, `--set=${T2}=${chief.email.toUpperCase()}`, `--set=${T3}=${senior.email}`, `--set=${T4}=${senior.email}`, ...extra);

step("Before");
check("no Meeting mentor credit anywhere; the Junior/Senior levels paid nobody", (await db.collection("commission_credits").countDocuments({ position: "Meeting mentor" })) === 0
  && (await db.collection("commission_credits").countDocuments({ position: { $in: ["Junior", "Senior"] } })) === 0
  && (await credits(T1)).map((c) => c.position).join() === "CS,CS Manager,Chief", (await credits(T1)).map((c) => c.position).join());

step("Dry run");
let r = set();
check("lists the three changes and the one already right, writes nothing", r.code === 0 && /3 request\(s\) to change, 1 already right/.test(r.out)
  && !(await tx(T1)).meeting_mentor_id && (await tx(T4)).meeting_mentor_id === String(chief._id), r.out);
check("says a Chief gets no Meeting mentor commission", /Chief A · chief_mentor\s+\(a Chief: no Meeting mentor commission\)/.test(r.out), r.out);
check("gives the commission command for the month", /backfill-meeting-mentor\.ts --month=2026-11/.test(r.out), r.out);

step("A wrong line refuses the whole run");
r = run("src/scripts/set-meeting-mentor.ts", `--set=${T1}=${senior.email}`, `--set=${T2}=${csNamedLikeMentor.email}`, "--apply");
check("not a mentor (a CS): refused, nothing written", r.code === 1 && /not a mentor/.test(r.out) && !(await tx(T1)).meeting_mentor_id, r.out);
r = run("src/scripts/set-meeting-mentor.ts", `--set=${T1}=nobody@e2e.test`, `--set=${new ObjectId()}=${senior.email}`, "--set=garbage", "--apply");
check("no such email / request / not id=email: each said, nothing written", r.code === 1 && /no staff member has/.test(r.out) && /no such funding request/.test(r.out) && /<request id>=<staff email>/.test(r.out) && !(await tx(T1)).meeting_mentor_id, r.out);

step("--apply");
r = set("--apply");
const t1 = await tx(T1), t2 = await tx(T2), t3 = await tx(T3), t4 = await tx(T4);
check("T1: the Senior named", r.code === 0 && t1.meeting_mentor_id === String(senior._id) && t1.meeting_mentor_name === senior.full_name && t1.meeting_mentor_none === false, r.out);
check("T2: the Chief named (email matched whatever its case)", t2.meeting_mentor_id === String(chief._id));
check("T3: left alone", t3.meeting_mentor_id === String(senior._id) && !t3.meeting_mentor_backfill);
check("T4: the Chief → the Senior, what it named before kept", t4.meeting_mentor_id === String(senior._id) && t4.meeting_mentor_backfill?.from?.id === String(chief._id) && t4.meeting_mentor_backfill?.from?.name === chief.full_name);
const home = process.env.HOME!;
const undoFile = readdirSync(home).find((f) => f.startsWith("set-meeting-mentor-undo-"));
check("an undo file in the home folder", !!undoFile, readdirSync(home).join(", "));

step("The commission: backfill-meeting-mentor.ts");
r = run("src/scripts/backfill-meeting-mentor.ts", "--month=2026-11", "--apply");
const mm = async (id: string) => (await credits(id)).filter((c) => c.position === "Meeting mentor");
const m1 = await mm(T1), m2 = await mm(T2), m3 = await mm(T3), m4 = await mm(T4);
check("T1: the Senior's Meeting mentor credit, the 2% of the Junior + Senior levels", r.code === 0 && m1.length === 1 && m1[0].recipient_name === senior.full_name && m1[0].percentage === 2 && m1[0].commission_usd === 20, `${r.out}\n${JSON.stringify(m1)}`);
check("T2: a Chief — no Meeting mentor credit, their Chief 4% as it was", m2.length === 0 && (await credits(T2)).some((c) => c.position === "Chief" && c.recipient_name === chief.full_name && c.percentage === 4));
check("T3: named before, never credited — credited now", m3.length === 1 && m3[0].recipient_name === senior.full_name);
check("T4: the Senior now", m4.length === 1 && m4[0].recipient_name === senior.full_name);
check("CS, CS Manager and Chief credits untouched", (await credits(T1)).filter((c) => c.position !== "Meeting mentor").map((c) => `${c.position}:${c.commission_usd}`).join() === "CS:20,CS Manager:10,Chief:40", (await credits(T1)).map((c) => `${c.position}:${c.commission_usd}`).join());
r = run("src/scripts/backfill-meeting-mentor.ts", "--month=2026-11", "--apply");
check("again: nothing added", (await db.collection("commission_credits").countDocuments({ position: "Meeting mentor" })) === 3, r.out);

step("--undo");
r = run("src/scripts/set-meeting-mentor.ts", `--undo=${join(home, undoFile ?? "missing")}`, "--apply");
const u1 = await tx(T1), u3 = await tx(T3), u4 = await tx(T4);
check("T1 and T2 name nobody again, T4 the Chief again, T3 as it was", r.code === 0 && !u1.meeting_mentor_id && !u1.meeting_mentor_backfill && !(await tx(T2)).meeting_mentor_id
  && u4.meeting_mentor_id === String(chief._id) && !u4.meeting_mentor_backfill && u3.meeting_mentor_id === String(senior._id), `${r.out}\n${JSON.stringify(u1)}`);
check("…and says to undo the backfill too", /backfill-meeting-mentor\.ts --undo/.test(r.out), r.out);

await client.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
