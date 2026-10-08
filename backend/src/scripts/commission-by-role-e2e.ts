/**
 * Commission levels paid by role (functions/creditCommission.ts), on made-up staff:
 *   - levels go by the CS's TEAM (everyone under the same Chief), not their own Up Head line: a CS straight under the
 *     Chief still pays the team's Junior and Senior (pooled under the Chief); two Seniors share the Senior level;
 *   - the CS Manager over every team takes the CS Manager level; a team without a Junior pays that level to nobody;
 *   - a CS on no team: their level and the CS Manager's only;
 *   - a team's own CS Manager is used, not the one over every team;
 *   - a plan with other position names keeps the old step-by-step rule.
 * Run through ./test-commission-by-role.sh. Refuses anything but a scratch database on 127.0.0.1.
 */
import { MongoClient, ObjectId } from "mongodb";

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
const client = await new MongoClient(uri).connect();
const db = client.db(dbName);
const lv = (label: string, percentage: number, pool = false) => ({ label, percentage, pool });
const byRole = { _id: new ObjectId(), name: "Role plan", active: true,
  bonus_with_levels: [lv("CS", 2), lv("CS Manager", 1), lv("Junior", 1, true), lv("Senior", 1, true), lv("Chief", 4)] };
const oldStyle = { _id: new ObjectId(), name: "Step plan", active: true, bonus_with_levels: [lv("Level 1", 2), lv("Level 2", 1)] };
await db.collection("commission_plans").insertMany([byRole, oldStyle] as any[]);
const u = (name: string, app_role: string, up?: ObjectId, extra: any = {}) => ({ _id: new ObjectId(), full_name: name, email: `${name}@e2e.test`, app_role, status: "active", up_head_id: up ? String(up) : "", commission_plan_id: String(byRole._id), ...extra });
const chief = u("Chief A", "chief_mentor");
const senior = u("Senior A", "senior_mentor", chief._id);
const junior = u("Junior A", "junior_mentor", senior._id);
const senior2 = u("Senior A2", "senior_mentor", chief._id);
const csDirect = u("CS direct", "cs", chief._id);
const csAlone = u("CS alone", "cs");
const csFull = u("CS full", "cs", junior._id);
const doney = u("Doney", "cs_manager", undefined, { all_teams_cs_manager: true });
const chiefB = u("Chief B", "chief_mentor");
const ownMgr = u("Own manager", "cs_manager", chiefB._id);
const csB = u("CS B", "cs", ownMgr._id);
const csOld = u("CS old plan", "cs", chief._id, { commission_plan_id: String(oldStyle._id) });
await db.collection("users").insertMany([chief, senior, junior, senior2, csAlone, csDirect, csFull, doney, chiefB, ownMgr, csB, csOld] as any[]);

const { connectDb, closeDb } = await import("../db");
const { creditCommissionFor } = await import("../functions/creditCommission");
await connectDb();
const tx = async (by: any) => {
  const _id = new ObjectId();
  await db.collection("funding_transactions").insertOne({ _id, type: "BONUS", status: "APPROVED", amount_usd: 1000, initiating_mentor_id: String(by._id), initiating_mentor_name: by.full_name, student_name: "Student E2E" } as any);
  await creditCommissionFor(String(_id));
  return (await db.collection("commission_credits").find({ transaction_id: String(_id) }).sort({ level: 1 }).toArray()) as any[];
};
const sum = (cs: any[]) => cs.map((c) => `L${c.level} ${c.recipient_name} ${c.commission_usd}${c.is_pool ? " pool" : ""}`).join(", ");

const TEAM_A = "L2 Doney 10, L3 Junior A 10 pool, L4 Senior A 5 pool, L4 Senior A2 5 pool, L5 Chief A 40";
console.log("\n\x1b[1mCS straight under a Chief\x1b[0m");
let c = await tx(csDirect);
check("the team's Junior and Seniors are paid though not in the CS's line", sum(c) === `L1 CS direct 20, ${TEAM_A}`, sum(c));
check("…two Seniors share the Senior 1%", c.filter((x) => x.level === 4).every((x) => x.percentage === 0.5));
check("…the pool is the Chief's", c.filter((x) => x.is_pool).every((x) => x.pool_group_id === String(chief._id)));

console.log("\n\x1b[1mA CS under the Junior\x1b[0m");
c = await tx(csFull);
check("the same team, the same split", sum(c) === `L1 CS full 20, ${TEAM_A}`, sum(c));

console.log("\n\x1b[1mA CS on no team\x1b[0m");
c = await tx(csAlone);
check("their level and the CS Manager's only", sum(c) === "L1 CS alone 20, L2 Doney 10", sum(c));

console.log("\n\x1b[1mA team with its own CS Manager\x1b[0m");
c = await tx(csB);
check("their own manager takes it, not Doney; no Junior or Senior on the team: nobody", sum(c) === "L1 CS B 20, L2 Own manager 10, L5 Chief B 40", sum(c));

console.log("\n\x1b[1mA plan named otherwise\x1b[0m");
c = await tx(csOld);
check("old rule: Level 2 is the Up Head", sum(c) === "L1 CS old plan 20, L2 Chief A 10", sum(c));

await closeDb(); await client.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
