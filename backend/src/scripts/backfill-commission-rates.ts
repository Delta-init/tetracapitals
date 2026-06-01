/**
 * Back-fill per-mentor `commission_rate` on the User documents.
 *
 * The Base44 User export wasn't shared, so the importer synthesized User rows
 * from foreign-key references and defaulted every commission_rate to 4. The
 * historical CommissionLedger export DID preserve each mentor's rate at
 * quarter-close time, so we copy the latest non-null rate from there.
 *
 * Run after `bun run src/scripts/import-base44.ts` so the ledger collection is populated.
 */
import { ObjectId } from "mongodb";
import { connectDb, closeDb, col } from "../db";

async function main() {
  await connectDb();
  const ledgers = await col("commission_ledgers")
    .find({}, { projection: { mentor_id: 1, commission_rate: 1, created_date: 1 } })
    .sort({ created_date: -1 })
    .toArray();

  // Pick the most recent commission_rate per mentor_id
  const latest: Record<string, number> = {};
  for (const l of ledgers as any[]) {
    if (!l.mentor_id || latest[l.mentor_id] !== undefined) continue;
    const rate = Number(l.commission_rate);
    if (Number.isFinite(rate) && rate > 0) latest[l.mentor_id] = rate;
  }
  console.log(`[backfill] found commission_rate for ${Object.keys(latest).length} mentor(s) from ${ledgers.length} ledger row(s)`);

  let updated = 0;
  for (const [mentorId, rate] of Object.entries(latest)) {
    if (!ObjectId.isValid(mentorId)) continue;
    const res = await col("users").updateOne(
      { _id: new ObjectId(mentorId) },
      { $set: { commission_rate: rate, updated_date: new Date().toISOString() } },
    );
    if (res.matchedCount) updated++;
  }
  console.log(`[backfill] updated ${updated} user(s)`);

  // Also: if Manual adjustments mention an upline_commission_percentage anywhere,
  // we'd back-fill that too. None of the exports carry that field, so we leave it 0.

  const sample = await col("users")
    .find({ commission_rate: { $ne: 4 } }, { projection: { full_name: 1, app_role: 1, commission_rate: 1 } })
    .toArray();
  console.log("\n[backfill] mentors now on non-default rates:");
  for (const u of sample as any[]) {
    console.log(`  ${(u.full_name || "(unnamed)").padEnd(24)} ${u.app_role.padEnd(18)} ${u.commission_rate}%`);
  }

  await closeDb();
}

main().catch((e) => { console.error(e); process.exit(1); });
