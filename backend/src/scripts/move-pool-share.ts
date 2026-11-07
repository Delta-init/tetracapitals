/**
 * One pool member's share given to another (the user, 2026-11-07: "cut the Tony %"): Tony was still on Money Heist
 * for its first six October bonuses, so mujeebrahmanp's pool gave the Senior 1% half to him and half to arya; he works
 * for Bangalore, so arya gets the whole Senior 1% on those too.
 *
 * For each of `from`'s accruals in that pool and period not paid out yet (status "pooled"): `to`'s accrual on the same
 * bonus takes its % and amount (0.5% + 0.5% → 1%) and `from`'s is removed; when `to` has none on it, `from`'s becomes
 * theirs. Nothing already split is touched.
 *
 *   cd backend
 *   bun src/scripts/move-pool-share.ts                         shows what it would do
 *   bun src/scripts/move-pool-share.ts --apply                 does it; saves an undo file in your home folder
 *   bun src/scripts/move-pool-share.ts --undo=<file> [--apply] puts back what --apply did
 *   --from=Tony --to=arya --pool=mujeebrahmanp --period=2026-10   (the defaults)
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const FROM = option("from") ?? "Tony", TO = option("to") ?? "arya", POOL = option("pool") ?? "mujeebrahmanp", PERIOD = option("period") ?? "2026-10";
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const aed = (usd: number) => `AED ${(usd * 3.67).toFixed(2)}`;
const idOf = (id: string) => toObjectId(id) ?? id;

await connectDb();
try {
  console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}\n`);
  const undo = option("undo");
  if (undo) {
    const saved = await Bun.file(undo).json();
    for (const u of saved.updated) {
      const unset = Object.fromEntries((u.unset ?? []).map((k: string) => [k, ""]));
      if (apply) await col("commission_credits").updateOne({ _id: idOf(u.id) as any }, { $set: u.before, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    }
    for (const d of saved.removed) {
      const { _id, ...rest } = d;
      if (apply) await col("commission_credits").insertOne({ _id: idOf(_id), ...rest } as any);
    }
    console.log(`${saved.updated.length} changed and ${saved.removed.length} removed accrual(s) ${apply ? "put back" : "would be put back — add --apply"}.`);
  } else {
    if (!/^\d{4}-\d{2}$/.test(PERIOD)) throw new Error("--period is YYYY-MM");
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pooled = (await col("commission_credits").find({
      is_pool: true, status: "pooled", pool_group_name: new RegExp(`^${esc(POOL)}\\b`, "i"),
      $or: [{ requested_at: { $regex: `^${PERIOD}` } }, { requested_at: { $exists: false }, created_date: { $regex: `^${PERIOD}` } }],
    }).toArray()) as any[];
    const mine = pooled.filter((c) => String(c.recipient_name ?? "").trim().toLowerCase() === FROM.toLowerCase());
    const theirs = pooled.filter((c) => String(c.recipient_name ?? "").trim().toLowerCase() === TO.toLowerCase());
    if (!theirs.length) throw new Error(`Nobody called "${TO}" in ${POOL}'s pool for ${PERIOD} — give --to=`);
    const toId = String(theirs[0].recipient_id), toName = String(theirs[0].recipient_name);
    console.log(`${POOL}'s pool, ${PERIOD}: ${mine.length} accrual(s) of ${FROM} not paid out yet → ${toName}\n`);
    const log = { database: config.mongoDb, host, applied_at: now, updated: [] as any[], removed: [] as any[] };
    let moved = 0;
    for (const c of mine.sort((a, b) => String(a.requested_at).localeCompare(String(b.requested_at)))) {
      const t = theirs.find((x) => String(x.transaction_id) === String(c.transaction_id) && x.method === c.method);
      moved += Number(c.commission_usd) || 0;
      if (t) {
        const after = { percentage: (Number(t.percentage) || 0) + (Number(c.percentage) || 0), commission_usd: (Number(t.commission_usd) || 0) + (Number(c.commission_usd) || 0),
          moved_from_name: c.recipient_name, moved_at: now, updated_date: now };
        console.log(`  ${String(c.requested_at).slice(0, 10)} ${String(c.student_name).padEnd(28)} ${toName} ${t.percentage}% → ${after.percentage}%  ${aed(t.commission_usd)} → ${aed(after.commission_usd)}  (${FROM}'s ${c.percentage}% removed)`);
        log.updated.push({ id: String(t._id), before: { percentage: t.percentage, commission_usd: t.commission_usd, updated_date: t.updated_date },
          unset: ["moved_from_name", "moved_at"].filter((k) => !(k in t)) });
        log.removed.push({ ...c, _id: String(c._id) });
        if (apply) {
          await col("commission_credits").updateOne({ _id: t._id }, { $set: after });
          await col("commission_credits").deleteOne({ _id: c._id, status: "pooled" });
        }
      } else {
        console.log(`  ${String(c.requested_at).slice(0, 10)} ${String(c.student_name).padEnd(28)} ${FROM}'s ${c.percentage}% (${aed(c.commission_usd)}) becomes ${toName}'s`);
        log.updated.push({ id: String(c._id), before: { recipient_id: c.recipient_id, recipient_name: c.recipient_name, updated_date: c.updated_date },
          unset: ["moved_from_name", "moved_at"].filter((k) => !(k in c)) });
        if (apply) await col("commission_credits").updateOne({ _id: c._id }, { $set: { recipient_id: toId, recipient_name: toName, moved_from_name: c.recipient_name, moved_at: now, updated_date: now } });
      }
    }
    console.log(`\n${FROM}: −${aed(moved)} · ${toName}: +${aed(moved)} (the pool's total doesn't change)`);
    if (!mine.length) console.log("Nothing to move.");
    else if (apply) {
      const file = join(homedir(), `move-pool-share-undo-${now.replace(/[:.]/g, "-")}.json`);
      await Bun.write(file, JSON.stringify(log));
      console.log(`\nDone.\nUndo file: ${file}\n  bun src/scripts/move-pool-share.ts --undo=${file} --apply`);
    } else console.log("\nNothing was written. Run again with --apply to do it.");
  }
} finally {
  await closeDb();
}
