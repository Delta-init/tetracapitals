import { readFileSync, writeFileSync } from "node:fs";
import { ObjectId } from "mongodb";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";

/**
 * A bonus's course payment typed with the wrong amount, put right (the user, 2026-10-30: Vinod, STU-4900, MSNR —
 * "6000 paid", not the AED 5,505 on the request). On the funding request: what was paid now (course_payment
 * .paid_today_aed, and paid till date), the amount typed (amount_original / amount_aed / amount_usd at 3.67), the one
 * payment's amount, and the balance left (moved by the same difference). The MT5 bonus is not changed. Finance is
 * put right with its own script (finance-delta apps/api/src/scripts/fix-course-payment-amount.ts), which also tells
 * the portal the invoice's new paid and balance.
 *
 *   cd backend
 *   bun src/scripts/fix-course-payment-amount.ts --code=STU-4900 --product=MSNR --aed=6000              shows it
 *   bun src/scripts/fix-course-payment-amount.ts --code=STU-4900 --product=MSNR --aed=6000 --apply      changes it
 *   bun src/scripts/fix-course-payment-amount.ts --undo=<file> --apply                                   puts it back
 * Two requests match → it lists them; add --id=<one of them>.
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env).
 */

const AED_PER_USD = 3.67;
const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const cents = (n: number) => Math.round(n * 100) / 100;
const aed = (n: unknown) => `AED ${Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

await connectDb();
console.log(`Database: ${host} / ${config.mongoDb}${apply ? "" : "   (showing only — add --apply to change it)"}\n`);
try {
  const undo = option("undo");
  if (undo) {
    const saved = JSON.parse(readFileSync(undo, "utf8"));
    console.log(`From ${undo}: request ${saved.before._id} back to ${aed(saved.before.course_payment?.paid_today_aed)} paid`);
    if (apply) {
      const { _id, ...rest } = saved.before;
      await col("funding_transactions").replaceOne({ _id: new ObjectId(String(_id)) }, rest);
      console.log("Put back.");
    }
    process.exit(0);
  }

  const code = option("code")?.trim().toUpperCase() ?? "", product = option("product")?.trim().toUpperCase() ?? "";
  const newAed = Number(option("aed")), pick = option("id")?.trim() ?? "";
  if (!code || !product || !(newAed > 0)) { console.error("Say which: --code=<STU code> --product=<course> --aed=<amount paid, AED>"); process.exit(1); }

  const studentIds = ((await col("students").find({ student_code: code }, { projection: { _id: 1 } }).toArray()) as any[]).map((s) => String(s._id));
  const found = ((await col("funding_transactions").find({
    student_id: { $in: studentIds }, type: "BONUS", "course_payment.product": { $regex: `^${product}$`, $options: "i" },
    status: { $ne: "REJECTED" }, ...(ObjectId.isValid(pick) ? { _id: new ObjectId(pick) } : {}),
  }).toArray()) as any[]);
  if (found.length !== 1) {
    console.error(found.length ? `${found.length} ${product} course payments for ${code} — add --id=<one of these>:` : `No ${product} course payment for ${code} — nothing done.`);
    for (const t of found) console.error(`  ${t._id} · ${t.status} · paid ${aed(t.course_payment?.paid_today_aed)} · ${t.requested_at ?? t.created_date ?? "—"}`);
    process.exit(1);
  }
  const t = found[0], cp = t.course_payment ?? {};
  const oldAed = Number(cp.paid_today_aed) || Number(t.amount_aed) || 0;
  const diff = cents(newAed - oldAed);
  if (Array.isArray(t.payments) && t.payments.length > 1) { console.error(`It was paid ${t.payments.length} ways — change it on the request instead; nothing done.`); process.exit(1); }
  if (t.amount_currency && !["AED", "USD"].includes(String(t.amount_currency).toUpperCase())) { console.error(`It was typed in ${t.amount_currency} — not handled here; nothing done.`); process.exit(1); }

  const set: Record<string, unknown> = {
    "course_payment.paid_today_aed": cents(newAed),
    amount_aed: cents(newAed),
    amount_usd: cents(newAed / AED_PER_USD),
    amount_original: String(t.amount_currency ?? "AED").toUpperCase() === "USD" ? cents(newAed / AED_PER_USD) : cents(newAed),
    updated_date: new Date().toISOString(),
  };
  if (cp.paid_total_aed != null) set["course_payment.paid_total_aed"] = cents(Number(cp.paid_total_aed) + diff);
  if (cp.balance_aed != null) set["course_payment.balance_aed"] = Math.max(0, cents(Number(cp.balance_aed) - diff));
  if (Array.isArray(t.payments) && t.payments.length === 1) set["payments.0.amount"] = String(t.payments[0].currency ?? t.amount_currency ?? "AED").toUpperCase() === "USD" ? cents(newAed / AED_PER_USD) : cents(newAed);

  console.log(`Request ${t._id} · ${t.status}${t.finance_approval?.status ? ` · finance ${t.finance_approval.status}` : ""}`);
  console.log(`  ${code} · ${cp.product} ${cp.kind} · MT5 ${t.mt5_login || "—"} · MT5 bonus $${cp.bonus_usd ?? "—"} (unchanged)`);
  console.log(`  paid now     ${aed(oldAed)} → ${aed(newAed)}`);
  if (cp.paid_total_aed != null) console.log(`  paid to date ${aed(cp.paid_total_aed)} → ${aed(set["course_payment.paid_total_aed"])}`);
  if (cp.balance_aed != null) console.log(`  balance      ${aed(cp.balance_aed)} → ${aed(set["course_payment.balance_aed"])}`);
  console.log(`  amount       $${t.amount_usd} → $${set.amount_usd} (at ${AED_PER_USD})`);
  if (!diff) { console.log("\nAlready that amount — nothing to do."); process.exit(0); }

  if (apply) {
    const file = `fix-course-payment-${t._id}-${Date.now()}.json`;
    writeFileSync(file, JSON.stringify({ before: t }, null, 2));
    console.log(`\nUndo file: ${file}`);
    await col("funding_transactions").updateOne({ _id: t._id }, { $set: set });
    await col("logs").insertOne({
      timestamp: new Date().toISOString(), user_name: "Script (fix-course-payment-amount)", user_role: "system",
      action_type: "fix_course_payment_amount", entity_type: "FundingTransaction", entity_id: String(t._id),
      details: JSON.stringify({ student: code, course: cp.product, from_aed: oldAed, to_aed: newAed }),
      success: true,
    } as any);
    console.log("Changed.");
  }
} finally {
  await closeDb();
}
