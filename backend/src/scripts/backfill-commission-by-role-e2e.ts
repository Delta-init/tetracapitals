/**
 * scripts/backfill-commission-by-role.ts on made-up staff: old step-rule lines re-credited by role, dates kept;
 * a transaction with a paid line left alone; the dry run writes nothing; running again changes nothing; the undo
 * puts the old lines back. Run through ./test-commission-by-role.sh. Refuses anything but a scratch database.
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
const lv = (label: string, percentage: number, pool = false) => ({ label, percentage, pool });
const plan = { _id: new ObjectId(), name: "Role plan", active: true, bonus_with_levels: [lv("CS", 2), lv("CS Manager", 1), lv("Junior", 1, true), lv("Senior", 1, true), lv("Chief", 4)] };
await db.collection("commission_plans").insertOne(plan as any);
const u = (name: string, app_role: string, up?: ObjectId, extra: any = {}) => ({ _id: new ObjectId(), full_name: name, email: `${name}@e2e.test`, app_role, status: "active", up_head_id: up ? String(up) : "", commission_plan_id: String(plan._id), ...extra });
const chief = u("Chief A", "chief_mentor"), cs = u("CS A", "cs", chief._id), doney = u("Doney", "cs_manager", undefined, { all_teams_cs_manager: true });
await db.collection("users").insertMany([chief, cs, doney] as any[]);
const OLD = "2026-10-01T09:00:00.000Z";
const seed = async (status2: string) => {
  const _id = new ObjectId();
  await db.collection("funding_transactions").insertOne({ _id, type: "BONUS", status: "APPROVED", amount_usd: 1000, initiating_mentor_id: String(cs._id), student_name: `Stu ${status2}` } as any);
  const base = { transaction_id: String(_id), transaction_type: "BONUS", full_amount: 1000, student_name: `Stu ${status2}`, created_date: OLD, is_pool: false };
  await db.collection("commission_credits").insertMany([
    { ...base, level: 1, recipient_id: String(cs._id), recipient_name: "CS A", percentage: 2, commission_usd: 20, status: "accrued" },
    { ...base, level: 2, recipient_id: String(chief._id), recipient_name: "Chief A", percentage: 1, commission_usd: 10, status: status2 },
  ] as any[]);
  return String(_id);
};
const unpaidTx = await seed("accrued"), paidTx = await seed("released");
const lines = async (tx: string) => ((await db.collection("commission_credits").find({ transaction_id: tx }).sort({ level: 1 }).toArray()) as any[]).map((c) => `L${c.level} ${c.recipient_name} ${c.commission_usd}`).join(", ");
const run = async (...args: string[]) => {
  const p = Bun.spawn(["bun", "--no-env-file", "src/scripts/backfill-commission-by-role.ts", ...args], { stdout: "pipe", stderr: "pipe", env: process.env });
  const out = await new Response(p.stdout).text() + await new Response(p.stderr).text(); await p.exited; return out;
};

let out = await run();
check("dry run lists the change", /1 to change/.test(out) && /now: L1 CS A 2% \$20\.00 · L2 Doney 1% \$10\.00 · L5 Chief A 4% \$40\.00/.test(out), out);
check("…and the paid one, left alone", /1 with paid lines/.test(out) && /Stu released/.test(out));
check("…writing nothing", (await lines(unpaidTx)) === "L1 CS A 20, L2 Chief A 10");
out = await run("--apply");
check("--apply re-credits it by role", (await lines(unpaidTx)) === "L1 CS A 20, L2 Doney 10, L5 Chief A 40", await lines(unpaidTx));
check("…keeping the old date", (await db.collection("commission_credits").countDocuments({ transaction_id: unpaidTx, created_date: OLD })) === 3);
check("…the paid one untouched", (await lines(paidTx)) === "L1 CS A 20, L2 Chief A 10");
check("running again changes nothing", /0 to change/.test(await run("--apply")));
const undoFile = out.match(/Undo file: (\S+)/)?.[1] ?? "";
await run(`--undo=${undoFile}`, "--apply");
check("the undo puts the old lines back", (await lines(unpaidTx)) === "L1 CS A 20, L2 Chief A 10", await lines(unpaidTx));
(await import("node:fs")).rmSync(undoFile, { force: true });
await db.dropDatabase(); await client.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
