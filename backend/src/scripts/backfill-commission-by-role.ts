/**
 * Commission already credited, worked out again by role (functions/creditCommission.ts, af2e9ed — the user,
 * 2026-10-08): each plan level to the person of that role above the CS — the CS Manager level to the team's own
 * CS Manager or the one over every team (Doney), the Chief's % to the Chief. Every transaction whose lines are all
 * still unpaid (accrued / pooled) and come out differently gets new lines in place of the old, keeping their dates.
 * A transaction with any line released or distributed is never touched — it is listed for you to look at.
 *
 *   cd backend
 *   bun src/scripts/backfill-commission-by-role.ts                       dry run: what would change
 *   bun src/scripts/backfill-commission-by-role.ts --apply               does it; an undo file first
 *   bun src/scripts/backfill-commission-by-role.ts --undo=<undo file> [--apply]   puts the old lines back
 *
 * Uses the API's database (MONGO_URI / MONGO_DB, from this folder's .env). Running it again changes nothing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EJSON } from "bson";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { creditCommissionFor } from "../functions/creditCommission";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const now = new Date().toISOString();
const UNPAID = ["accrued", "pooled"];
const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
const keyOf = (c: any) => `${c.level}|${c.recipient_id}|${c.percentage}|${c.is_pool ? 1 : 0}|${Math.round((c.commission_usd || 0) * 100)}`;
const same = (a: any[], b: any[]) => a.map(keyOf).sort().join(",") === b.map(keyOf).sort().join(",");
const line = (c: any) => `L${c.level} ${c.recipient_name} ${c.percentage}% ${money(c.commission_usd || 0)}${c.is_pool ? " (pool)" : ""}`;

async function backfill() {
  const all = (await col("commission_credits").find({}).toArray()) as any[];
  const byTx = new Map<string, any[]>();
  for (const c of all) { const k = String(c.transaction_id); (byTx.get(k) ?? byTx.set(k, []).get(k)!).push(c); }
  const changes: { txId: string; old: any[]; next: any[] }[] = [];
  const paid: string[] = [];
  let unchanged = 0, skipped = 0;
  for (const [txId, old] of byTx) {
    const r: any = await creditCommissionFor(txId, { preview: true });
    if (!r?.preview) { skipped++; continue; }
    const next: any[] = r.credits;
    if (same(old, next)) { unchanged++; continue; }
    if (old.some((c) => !UNPAID.includes(c.status))) { paid.push(`${old[0].student_name ?? "?"} · ${old[0].transaction_type} ${money(old[0].full_amount || 0)} · ${old.filter((c) => !UNPAID.includes(c.status)).map((c) => c.status).join("/")}`); continue; }
    const created = old.map((c) => c.created_date).filter(Boolean).sort()[0];
    for (const c of next) { if (created) c.created_date = created; c.recalculated_at = now; }
    changes.push({ txId, old, next });
  }
  console.log(`${host}/${config.mongoDb} — ${byTx.size} credited transactions: ${changes.length} to change, ${unchanged} already right, ${paid.length} with paid lines (left alone), ${skipped} not creditable now (left alone)\n`);
  for (const ch of changes) {
    const o = ch.old[0];
    console.log(`${o.student_name ?? "?"} · ${o.transaction_type} ${money(o.full_amount || 0)}${o.txn_id ? ` · Txn ${o.txn_id}` : ""}`);
    console.log(`   was: ${ch.old.sort((a, b) => a.level - b.level).map(line).join(" · ")}`);
    console.log(`   now: ${ch.next.map(line).join(" · ")}`);
  }
  if (paid.length) console.log(`\nLeft alone — already paid out in part:\n   ${paid.join("\n   ")}`);
  if (!changes.length) return console.log("\nNothing to change.");
  if (!apply) return console.log("\nDry run — add --apply to do it.");
  const undoFile = join(homedir(), `commission-by-role-undo-${now.replace(/[:.]/g, "-")}.json`);
  writeFileSync(undoFile, EJSON.stringify({ changes: changes.map((c) => ({ txId: c.txId, old: c.old })) }, { relaxed: false }));
  console.log(`\nUndo file: ${undoFile}`);
  for (const ch of changes) {
    await col("commission_credits").deleteMany({ transaction_id: ch.txId, status: { $in: UNPAID } });
    if (ch.next.length) await col("commission_credits").insertMany(ch.next);
  }
  console.log(`Done: ${changes.length} transactions re-credited.`);
}

async function undo(file: string) {
  const { changes } = EJSON.parse(readFileSync(file, "utf8")) as { changes: { txId: string; old: any[] }[] };
  console.log(`${host}/${config.mongoDb} — puts back the old lines of ${changes.length} transactions`);
  if (!apply) return console.log("Dry run — add --apply to do it.");
  for (const ch of changes) {
    await col("commission_credits").deleteMany({ transaction_id: ch.txId, recalculated_at: { $exists: true }, status: { $in: UNPAID } });
    if (!(await col("commission_credits").countDocuments({ transaction_id: ch.txId }))) await col("commission_credits").insertMany(ch.old);
    else console.log(`   ${ch.txId}: has other lines now — left as it is`);
  }
  console.log("Done.");
}

await connectDb();
try { const u = option("undo"); await (u ? undo(u) : backfill()); } finally { await closeDb(); }
