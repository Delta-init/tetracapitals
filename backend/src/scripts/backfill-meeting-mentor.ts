import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EJSON } from "bson";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { creditCommissionFor, roleOfPosition } from "../functions/creditCommission";

/**
 * One month's bonus commission put on the meeting-mentor rule (the user, 2026-11-09: "backfill this month's commission
 * only"). Since f5cb568 a bonus on a plan paid by role no longer pays its Junior / Senior levels into the pool: the
 * Junior, Senior or Sub-junior Mentor who first held a meeting with the student before the payment gets that % as their
 * own ("Meeting mentor"), and nobody when no mentor met the student. Bonuses credited before the deploy still have the
 * old Junior / Senior accruals — this moves the month's ones over.
 *
 * For each bonus whose commission is dated in the month (requested_at, Dubai days):
 *   - its Junior / Senior / Sub-junior credits are removed — only while not paid out (pooled or accrued; a pool already
 *     split, or a credit released or paid, leaves that bonus as it is);
 *   - a Meeting mentor credit is added when a mentor met the student first (the same rule as creditCommission).
 * CS, CS Manager and Chief credits are not touched. Deposits are not touched. Running it again changes nothing.
 *
 *   cd backend
 *   bun src/scripts/backfill-meeting-mentor.ts                        dry run: what would change (this month)
 *   bun src/scripts/backfill-meeting-mentor.ts --apply                does it; an undo file in your home folder first
 *   bun src/scripts/backfill-meeting-mentor.ts --undo=<file> --apply  puts every one back
 *   --month=2026-11 (default: this month, Dubai)
 */

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const aed = (usd: number) => `AED ${(usd * 3.67).toFixed(2)}`;
const MENTOR_ROLES = new Set(["junior_mentor", "senior_mentor", "subjunior_mentor"]);
const UNPAID = new Set(["pooled", "accrued"]);

await connectDb();
console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}\n`);
try {
  const undo = option("undo");
  if (undo) {
    const u = EJSON.parse(readFileSync(undo, "utf8")) as any;
    const addedNow = await col("commission_credits").countDocuments({ backfill_run: u.run });
    console.log(`${u.removed.length} removed credit(s) ${apply ? "put back" : "would be put back"}, ${addedNow} Meeting mentor credit(s) ${apply ? "removed" : "would be removed"}${apply ? "." : " — add --apply"}`);
    if (apply) {
      await col("commission_credits").deleteMany({ backfill_run: u.run });
      for (const d of u.removed) await col("commission_credits").updateOne({ _id: d._id }, { $setOnInsert: d }, { upsert: true });
    }
  } else {
    const dubaiToday = new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 7);
    const month = option("month") ?? dubaiToday;
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("--month is YYYY-MM");
    const [y, m] = month.split("-").map(Number);
    const since = new Date(Date.UTC(y, m - 1, 1) - 4 * 3600_000).toISOString();
    const until = new Date(Date.UTC(y, m, 1) - 4 * 3600_000).toISOString();
    console.log(`Bonus commission dated ${month} (Dubai): ${since} → ${until}\n`);

    const credits = (await col("commission_credits").find({
      method: { $in: ["bonus_with", "bonus_without"] }, requested_at: { $gte: since, $lt: until },
    }).toArray()) as any[];
    const byTx = new Map<string, any[]>();
    for (const c of credits) byTx.set(String(c.transaction_id), [...(byTx.get(String(c.transaction_id)) ?? []), c]);

    const removed: any[] = [], added: any[] = [];
    let paidOut = 0, unchanged = 0, notCredited = 0;
    const perPerson = new Map<string, number>();
    const tally = (name: string, usd: number) => perPerson.set(name, (perPerson.get(name) ?? 0) + usd);

    for (const [txId, mine] of byTx) {
      if (mine.some((c) => c.position === "Meeting mentor")) { unchanged++; continue; }
      const preview: any = await creditCommissionFor(txId, { preview: true });
      if (!preview?.credits) { notCredited++; continue; }
      const meeting = preview.credits.find((c: any) => c.position === "Meeting mentor");
      // The levels the new rule no longer pays: a mentor role the preview leaves out.
      const stillPaid = new Set(preview.credits.map((c: any) => String(c.position ?? "")));
      const old = mine.filter((c) => MENTOR_ROLES.has(String(roleOfPosition(c.position))) && !stillPaid.has(String(c.position ?? "")));
      if (!old.length && !meeting) { unchanged++; continue; }
      if (old.some((c) => !UNPAID.has(String(c.status)))) { paidOut++; continue; }

      const who = `${mine[0].student_name ?? "?"} · ${mine[0].tag ?? ""} · ${mine[0].txn_id ?? txId}`;
      console.log(who);
      for (const c of old) { console.log(`   − ${c.position} ${c.recipient_name} ${c.percentage}% ${aed(c.commission_usd)}${c.is_pool ? " (pool)" : ""}`); tally(c.recipient_name, -c.commission_usd); }
      if (meeting) {
        console.log(`   + Meeting mentor ${meeting.recipient_name} ${meeting.percentage}% ${aed(meeting.commission_usd)}`);
        tally(meeting.recipient_name, meeting.commission_usd);
        // Dated as the bonus, so it counts in the same month as its other credits.
        added.push({ ...meeting, created_date: mine[0].created_date ?? meeting.created_date, backfilled_at: new Date().toISOString() });
      } else console.log(`   (no mentor met the student — no mentor paid)`);
      removed.push(...old);
    }

    console.log(`\n${byTx.size} bonus(es) in ${month}: ${removed.length} Junior/Senior credit(s) to remove, ${added.length} Meeting mentor credit(s) to add; ` +
      `${unchanged} already right, ${paidOut} left as they are (paid out or the pool already split), ${notCredited} no longer approved.`);
    if (perPerson.size) {
      console.log(`\nBy person:`);
      for (const [name, usd] of [...perPerson].sort((a, b) => a[1] - b[1])) console.log(`   ${name.padEnd(28)} ${usd >= 0 ? "+" : "−"}${aed(Math.abs(usd))}`);
    }

    if (apply && (removed.length || added.length)) {
      // The undo file first — everything this run adds carries its run id, so undo finds them.
      const run = `meeting-mentor-${month}-${new Date().toISOString()}`;
      const file = join(homedir(), `backfill-meeting-mentor-undo-${month}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      writeFileSync(file, EJSON.stringify({ database: config.mongoDb, host, month, run, removed }));
      if (added.length) await col("commission_credits").insertMany(added.map((c) => ({ ...c, backfill_run: run })));
      if (removed.length) await col("commission_credits").deleteMany({ _id: { $in: removed.map((c) => c._id) }, status: { $in: [...UNPAID] } });
      console.log(`\nDone.\nUndo file: ${file}\n  bun src/scripts/backfill-meeting-mentor.ts --undo=${file} --apply`);
    } else if (removed.length || added.length) console.log("\nNothing was written. Run again with --apply to do it.");
  }
} finally {
  await closeDb();
}
