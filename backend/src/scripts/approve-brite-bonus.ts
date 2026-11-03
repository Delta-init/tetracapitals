import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ObjectId } from "mongodb";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";
import { recordHistory } from "../students/history";

/**
 * BRITE SIBY OOMMEN's (STU-0941) rejected Bonus request of Sep 23 — raised by amjad, $2,189, DQMP — approved, with
 * Alice Antony as its CS and an MT5 bonus of $2,000 (the user, 2026-11-03). Its dates are kept as they are: requested
 * Sep 23, decided Sep 24 by aleena. No commission is credited (it would fall in this month) and nothing goes to the LMS
 * (nothing was paid) — the MT5 credit itself is a broker admin's, in MT5.
 *
 *   cd backend
 *   bun src/scripts/approve-brite-bonus.ts                        shows the request and what changes (nothing written)
 *   bun src/scripts/approve-brite-bonus.ts --apply                changes it; an undo file in ~ first
 *   bun src/scripts/approve-brite-bonus.ts --id=<request id>      when more than one request fits
 *   bun src/scripts/approve-brite-bonus.ts --undo=<file> [--apply] puts the request back as it was
 *
 * Uses the API's database (MONGO_URI / MONGO_DB, .env).
 */

const apply = process.argv.includes("--apply");
const option = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const undo = option("undo");
const BONUS_USD = 2000;
const VIA = "approve-brite-bonus";
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const stop = (msg: string) => { console.log(`Stopped: ${msg}`); process.exit(1); };

await connectDb();
console.log(`Database: ${host} / ${config.mongoDb} — ${apply ? "WRITING" : "dry run, nothing is written"}\n`);
try {
  if (undo) {
    const saved = JSON.parse(readFileSync(undo, "utf8"));
    const oid = new ObjectId(saved.before._id);
    console.log(`  ${saved.before.student_name}: back to ${saved.before.status}, CS ${saved.before.initiating_mentor_name ?? "—"}`);
    if (apply) {
      const { _id, ...rest } = saved.before;
      await col("funding_transactions").replaceOne({ _id: oid }, rest);
      await col("student_history").deleteMany({ via: VIA, student_id: String(saved.before.student_id) });
      console.log("  done");
    }
  } else {
    const student = (await col("students").findOne({ student_code: "STU-0941" }, { projection: { full_name: 1, email: 1 } })) as any;
    if (!student) stop("no student STU-0941");
    const id = option("id");
    const found = (await col("funding_transactions").find(id ? { _id: new ObjectId(id) } : {
      student_id: String(student._id), type: "BONUS", status: "REJECTED",
    }).toArray()) as any[];
    const fits = id ? found : found.filter((t) => String(t.requested_at ?? "").startsWith("2026-09-2"));
    if (fits.length !== 1) {
      console.log(`Requests that fit: ${fits.length} (rejected bonuses of ${student.full_name}: ${found.length})`);
      for (const t of found) console.log(`  --id=${t._id}  requested ${t.requested_at} · $${t.course_payment?.bonus_usd ?? t.amount_usd} · ${t.initiating_mentor_name ?? t.primary_mentor_name ?? ""}`);
      stop("give --id= for the one to approve");
    }
    const tx = fits[0];
    if (String(tx.student_id) !== String(student._id) || tx.type !== "BONUS") stop("that request isn't a bonus of STU-0941");
    if (tx.status === "APPROVED") stop("it is approved already");
    const alice = (await col("users").find({ app_role: "cs", status: { $ne: "inactive" }, full_name: /^alice antony$/i }).toArray()) as any[];
    if (alice.length !== 1) stop(`Alice Antony: ${alice.length} active CS accounts found`);
    const a = alice[0];
    const aliceName = String(a.full_name);

    const oldBonus = Number(tx.course_payment?.bonus_usd ?? tx.amount_usd) || 0;
    const set: Record<string, unknown> = {
      status: "APPROVED",
      initiating_mentor_id: String(a._id), initiating_mentor_name: aliceName,
      primary_mentor_id: String(a._id), primary_mentor_name: aliceName,
      earlier_rejection_reason: tx.rejection_reason ?? "",
      approved_by_script: { at: new Date().toISOString(), via: VIA, from_cs: tx.initiating_mentor_name ?? tx.primary_mentor_name ?? "", from_bonus_usd: oldBonus },
    };
    if ("requested_by_id" in tx) Object.assign(set, { requested_by_id: String(a._id), requested_by_name: aliceName });
    if (tx.course_payment) {
      set["course_payment.bonus_usd"] = BONUS_USD;
      if (tx.course_payment.requested_bonus_usd == null) set["course_payment.requested_bonus_usd"] = oldBonus;
      if (Number(tx.amount_usd) === oldBonus) set.amount_usd = BONUS_USD;
    } else set.amount_usd = BONUS_USD;

    console.log(`${tx.student_name} (${tx._id})`);
    console.log(`  requested ${tx.requested_at} · decided ${tx.approved_at ?? "—"} by ${tx.approved_by_name ?? "—"} — kept`);
    console.log(`  status   ${tx.status} → APPROVED${tx.rejection_reason ? `   (rejected: ${tx.rejection_reason} — kept as earlier_rejection_reason)` : ""}`);
    console.log(`  CS       ${tx.initiating_mentor_name ?? "—"} / primary ${tx.primary_mentor_name ?? "—"} → ${aliceName}`);
    console.log(`  MT5 bonus $${oldBonus} → $${BONUS_USD}   (amount_usd ${tx.amount_usd} → ${set.amount_usd ?? tx.amount_usd})`);
    console.log(`  course   ${tx.course_payment?.product ?? (tx.tags || []).join(", ")} · paid today AED ${tx.course_payment?.paid_today_aed ?? 0}`);
    if (tx.resubmitted_as) console.log(`  NOTE: it was corrected and sent again as ${tx.resubmitted_as} — look at that one too`);
    const others = (await col("funding_transactions").find({ student_id: String(student._id), type: "BONUS", status: { $in: ["APPROVED", "PENDING"] }, _id: { $ne: tx._id } },
      { projection: { status: 1, requested_at: 1, amount_usd: 1, "course_payment.bonus_usd": 1, "course_payment.product": 1 } }).toArray()) as any[];
    for (const o of others) console.log(`  NOTE: another bonus, ${o.status}: requested ${o.requested_at} · $${o.course_payment?.bonus_usd ?? o.amount_usd} ${o.course_payment?.product ?? ""} (${o._id})`);
    const commission = await col("commission_credits").countDocuments({ transaction_id: String(tx._id) });
    console.log(`  commission credits on it: ${commission} — none added`);

    if (apply) {
      const file = join(homedir(), `approve-brite-bonus-undo-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      writeFileSync(file, JSON.stringify({ before: tx }, null, 1));
      await col("funding_transactions").updateOne({ _id: tx._id, status: tx.status }, { $set: { ...set, updated_date: new Date().toISOString() }, $unset: { rejection_reason: "" } });
      await recordHistory([{
        student_id: String(student._id), at: new Date().toISOString(), type: "course_fees" as any, by_id: null, by_name: "Script",
        text: `Bonus request of ${String(tx.requested_at ?? "").slice(0, 10)} approved (was rejected), CS ${aliceName}, MT5 bonus $${BONUS_USD} (was $${oldBonus})`,
        from: oldBonus, to: BONUS_USD, via: VIA,
      }]);
      console.log(`\nDone. Undo: bun src/scripts/approve-brite-bonus.ts --undo=${file} --apply`);
    } else console.log("\nDry run. Add --apply to change it.");
  }
} finally {
  await closeDb();
}
