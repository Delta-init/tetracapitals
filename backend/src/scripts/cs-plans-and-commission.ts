import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ObjectId } from "mongodb";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";
import { loadTeams } from "../students/teams";
import { creditCommissionFor } from "../functions/creditCommission";

/**
 * Every CS on a commission plan, and this month's missing commission credited (the user, 2026-10-13: "all cs plan will
 * be pool plan … backfill the commissions … only this month").
 *
 *   --plans      CSs and CS Managers with no plan get one: the "pool plan" — a Bangalore team's the Bangalore plan.
 *   --backfill   Every request approved this month (Dubai time) that has no commission credits gets them, from its
 *                initiator's plan, as approving it would have (functions/creditCommission.ts — once only).
 *
 *   cd backend
 *   bun src/scripts/cs-plans-and-commission.ts --plans                  shows the plans it would set
 *   bun src/scripts/cs-plans-and-commission.ts --plans --apply          sets them; an undo file first
 *   bun src/scripts/cs-plans-and-commission.ts --backfill               shows every credit it would make
 *   bun src/scripts/cs-plans-and-commission.ts --backfill --apply       makes them; an undo file first
 *   bun src/scripts/cs-plans-and-commission.ts --undo=<file> [--apply]  puts it back (plans unset / credits removed)
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env).
 */

const apply = process.argv.includes("--apply");
const has = (f: string) => process.argv.includes(f);
const undo = process.argv.find((a) => a.startsWith("--undo="))?.slice(7);
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const usd = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

await connectDb();
console.log(`Database: ${host} / ${config.mongoDb} — ${apply ? "WRITING" : "dry run, nothing is written"}\n`);

if (undo) {
  const saved = JSON.parse(readFileSync(undo, "utf8"));
  if (saved.kind === "plans") {
    for (const u of saved.users) console.log(`  ${u.name}: plan back to ${u.before || "none"}`);
    if (apply) for (const u of saved.users) {
      await col("users").updateOne({ _id: new ObjectId(u._id), commission_plan_id: u.after }, u.before ? { $set: { commission_plan_id: u.before } } : { $unset: { commission_plan_id: "" } });
    }
  } else {
    console.log(`  ${saved.credit_ids.length} credit(s) on ${saved.transaction_ids.length} request(s) to remove`);
    if (apply) {
      const r = await col("commission_credits").deleteMany(saved.credit_ids.length
        ? { _id: { $in: saved.credit_ids.map((id: string) => new ObjectId(id)) } } : { transaction_id: { $in: saved.transaction_ids } });
      console.log(`  removed ${r.deletedCount}`);
    }
  }
  console.log(apply ? "\nPut back." : "\nRun again with --apply to put it back.");
  await closeDb();
  process.exit(0);
}

if (has("--plans")) {
  const plans = (await col("commission_plans").find({ active: { $ne: false } }, { projection: { name: 1 } }).toArray()) as any[];
  const pool = plans.find((p) => /^pool plan$/i.test(String(p.name).trim()));
  const blr = plans.find((p) => /bang?a?lo?re/i.test(String(p.name)));
  if (!pool) throw new Error("No active plan named \"pool plan\"");
  const index = await loadTeams();
  const users = (await col("users").find({ app_role: { $in: ["cs", "cs_manager"] }, commission_plan_id: { $in: [null, ""] } }, { projection: { full_name: 1, app_role: 1, status: 1, all_teams_cs_manager: 1 } }).toArray()) as any[];
  const changes = users.map((u) => {
    const team = index.teamOf(String(u._id));
    // The CS Manager over every team (Doney) is no one team's: the pool plan.
    const plan = team?.location === "bangalore" && blr && u.all_teams_cs_manager !== true ? blr : pool;
    return { _id: String(u._id), name: u.full_name, role: u.app_role, status: u.status ?? "active", team: team?.name ?? "no team", location: team?.location ?? "dubai", before: "", after: String(plan._id), plan: plan.name };
  });
  for (const c of changes) console.log(`  ${c.role.padEnd(10)} ${String(c.name).padEnd(22)} ${c.status.padEnd(8)} ${String(c.team).padEnd(24)} ${c.location.padEnd(9)} → ${c.plan}`);
  console.log(`\n${changes.length} without a plan.`);
  if (apply && changes.length) {
    const file = join(homedir(), `cs-plans-undo-${stamp()}.json`);
    writeFileSync(file, JSON.stringify({ kind: "plans", users: changes }, null, 1));
    for (const c of changes) await col("users").updateOne({ _id: new ObjectId(c._id), commission_plan_id: { $in: [null, ""] } }, { $set: { commission_plan_id: c.after, updated_date: new Date().toISOString() } });
    console.log(`Set. Undo: --undo=${file}`);
  }
}

if (has("--backfill")) {
  // This month, in Dubai time.
  const now = new Date(Date.now() + 4 * 3_600_000);
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 4 * 3_600_000).toISOString();
  const txs = (await col("funding_transactions").find({
    type: { $in: ["BONUS", "DEPOSIT", "WITHDRAWAL"] }, status: "APPROVED", bonus_credit: { $in: [null, ""] }, approved_at: { $gte: from },
  }).sort({ approved_at: 1 }).toArray()) as any[];
  const credited = new Set((await col("commission_credits").distinct("transaction_id", { transaction_id: { $in: txs.map((t) => String(t._id)) } })).map(String));
  const todo = txs.filter((t) => !credited.has(String(t._id)));
  const names = new Map(((await col("users").find({}, { projection: { full_name: 1 } }).toArray()) as any[]).map((u) => [String(u._id), u.full_name]));
  const perPerson = new Map<string, number>();
  let skipped = 0;
  const work: string[] = [];
  for (const t of todo) {
    const r: any = await creditCommissionFor(String(t._id), { preview: true });
    const head = `  ${String(t.approved_at).slice(0, 10)} ${String(t.type).padEnd(10)} ${String(t.student_code ?? "").padEnd(9)} ${usd(Number(t.amount_usd) || 0).padStart(11)} by ${t.initiating_mentor_name ?? "—"}`;
    if (!r?.credits?.length) { skipped++; console.log(`${head}  — none: ${r?.reason ?? "nothing to pay"}`); continue; }
    work.push(String(t._id));
    console.log(`${head}\n      ${r.credits.map((c: any) => `${names.get(String(c.recipient_id)) ?? c.recipient_id} ${usd(c.commission_usd)}${c.is_pool ? " (pool)" : ""}`).join(" · ")}`);
    for (const c of r.credits) perPerson.set(String(c.recipient_id), (perPerson.get(String(c.recipient_id)) ?? 0) + (Number(c.commission_usd) || 0));
  }
  console.log(`\nApproved since ${from.slice(0, 10)} (Dubai): ${txs.length}; already credited ${credited.size}; to credit ${work.length}; nothing to pay ${skipped}.`);
  for (const [id, total] of [...perPerson].sort((a, b) => b[1] - a[1])) console.log(`  ${String(names.get(id) ?? id).padEnd(24)} ${usd(total)}`);
  if (apply && work.length) {
    const file = join(homedir(), `commission-backfill-undo-${stamp()}.json`);
    // The requests first — they had no credits, so every credit on them is this run's.
    writeFileSync(file, JSON.stringify({ kind: "credits", transaction_ids: work, credit_ids: [] }, null, 1));
    let made = 0;
    for (const id of work) { const r: any = await creditCommissionFor(id); made += Number(r?.credited ?? 0); }
    const ids = ((await col("commission_credits").find({ transaction_id: { $in: work } }, { projection: { _id: 1 } }).toArray()) as any[]).map((c) => String(c._id));
    writeFileSync(file, JSON.stringify({ kind: "credits", transaction_ids: work, credit_ids: ids }, null, 1));
    console.log(`\nCredited ${made} on ${work.length} request(s). Undo: --undo=${file}`);
  }
}
if (!has("--plans") && !has("--backfill")) console.log("Say --plans and/or --backfill.");
await closeDb();
