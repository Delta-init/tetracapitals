/**
 * A bonus request's amount changed by hand (the user, 2026-11-08: Aisha Shana, STU-5244 — sales-close bonus MB-000629
 * approved at $600, to be $500). On the funding request: amount_usd, amount_aed (at 3.67) and amount_original (in the
 * request's own currency), with a line added to its notes. Only a bonus with no commission on it — one with commission
 * is refused (fix-course-payment-amount.ts puts those right). Nothing in MT5 is changed: what was credited there is
 * for the broker admin to adjust. The promise on finance's course fee is not changed either.
 *
 *   cd backend
 *   bun src/scripts/set-bonus-amount.ts --txn=MB-000629 --usd=500            shows it
 *   bun src/scripts/set-bonus-amount.ts --txn=MB-000629 --usd=500 --apply    changes it; undo file in your home folder
 *   bun src/scripts/set-bonus-amount.ts --id=<request id> --usd=500 [--apply]
 *   bun src/scripts/set-bonus-amount.ts --undo=<file> [--apply]               puts it back
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";

const AED_PER_USD = 3.67;
const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const cents = (n: number) => Math.round(n * 100) / 100;
const FIELDS = ["amount_usd", "amount_aed", "amount_original", "notes", "updated_date"] as const;

await connectDb();
try {
  console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}\n`);
  const undo = option("undo");
  if (undo) {
    const saved = await Bun.file(undo).json();
    const t: any = await col("funding_transactions").findOne({ _id: (toObjectId(saved.id) ?? saved.id) as any });
    if (!t) throw new Error(`Request ${saved.id} not found`);
    console.log(`${t.transaction_id ?? saved.id} · ${t.student_name}: $${t.amount_usd} → back to $${saved.before.amount_usd}`);
    if (apply) {
      const unset = Object.fromEntries(FIELDS.filter((f) => !(f in saved.before)).map((f) => [f, ""]));
      await col("funding_transactions").updateOne({ _id: t._id }, { $set: saved.before, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
      console.log("Put back.");
    } else console.log("Add --apply to put it back.");
  } else {
    const usd = Number(option("usd"));
    if (!(usd > 0)) throw new Error("Give the new amount: --usd=500");
    const id = option("id"), txn = option("txn");
    if (!id && !txn) throw new Error("Give the request: --txn=MB-000629 or --id=<request id>");
    const found = (await col("funding_transactions").find(id ? { _id: (toObjectId(id) ?? id) as any } : { transaction_id: txn }).toArray()) as any[];
    if (found.length !== 1) throw new Error(`${found.length} requests match — give --id=`);
    const t = found[0];
    if (t.type !== "BONUS") throw new Error(`${t.transaction_id ?? t._id} is a ${t.type}, not a bonus`);
    const credits = await col("commission_credits").countDocuments({ transaction_id: String(t._id) });
    if (credits) throw new Error(`${t.transaction_id ?? t._id} has ${credits} commission credit(s) — not changed here`);

    const currency = String(t.amount_currency || "USD");
    const aed = cents(usd * AED_PER_USD);
    const now = new Date().toISOString();
    const set = {
      amount_usd: usd, amount_aed: aed, amount_original: currency === "USD" ? usd : aed, updated_date: now,
      notes: [t.notes, `Amount changed from $${t.amount_usd} to $${usd} (${now.slice(0, 10)}).`].filter(Boolean).join("\n"),
    };
    console.log(`${t.transaction_id ?? t._id} · ${t.student_name} (${t.student_code}) · ${t.status} · MT5 ${t.mt5_login || "—"} · request ${t._id}`);
    console.log(`  $${t.amount_usd} (AED ${t.amount_aed}) → $${usd} (AED ${aed})`);
    if (t.status === "APPROVED") console.log(`  Approved already: MT5 ${t.mt5_login || ""} is not changed by this — the broker admin adjusts it there.`);
    if (Math.abs((Number(t.amount_usd) || 0) - usd) < 0.005) console.log("\nAlready that amount — nothing to do.");
    else if (!apply) console.log("\nNothing was written. Run again with --apply to do it.");
    else {
      const before = Object.fromEntries(FIELDS.filter((f) => f in t).map((f) => [f, t[f]]));
      const file = join(homedir(), `set-bonus-amount-undo-${t.transaction_id ?? t._id}-${now.replace(/[:.]/g, "-")}.json`);
      await Bun.write(file, JSON.stringify({ database: config.mongoDb, host, id: String(t._id), before }, null, 2));
      await col("funding_transactions").updateOne({ _id: t._id }, { $set: set });
      await col("logs").insertOne({
        timestamp: now, user_name: "Script (set-bonus-amount)", user_role: "system",
        action_type: "set_bonus_amount", entity_type: "FundingTransaction", entity_id: String(t._id),
        details: JSON.stringify({ student: t.student_code, transaction: t.transaction_id, from_usd: t.amount_usd, to_usd: usd }),
        success: true,
      } as any);
      console.log(`\nChanged.\nUndo file: ${file}\n  bun src/scripts/set-bonus-amount.ts --undo=${file} --apply`);
    }
  }
} finally {
  await closeDb();
}
