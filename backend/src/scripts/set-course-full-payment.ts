import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ObjectId } from "mongodb";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";
import { applyBaseChanges, commissionBaseChanges, courseBaseUsd, describeChange, undoBaseChanges } from "../finance/commissionBase";

/**
 * One course payment made a Full payment at its own price (the user, 2026-11-09: Sidhin Thandilath, STU-2317, MSNR —
 * "the course price for this request AED 10,000, full payment done"). On the funding request: the course's price
 * (AED, as the plan), Full, what was paid now and till date (default: the price), balance 0, nothing on hold, and the
 * MT5 bonus the course's full bonus; the amount (AED, USD at 3.67) and its one payment. Commission not paid out yet
 * follows the new amount (a request still pending has none yet). Finance's copy is put right with its own script.
 *
 *   cd backend
 *   bun src/scripts/set-course-full-payment.ts --code=STU-2317 --product=MSNR --price-aed=10000                 shows it
 *   bun src/scripts/set-course-full-payment.ts --code=STU-2317 --product=MSNR --price-aed=10000 --apply         changes it
 *   bun src/scripts/set-course-full-payment.ts --undo=<file> --apply                                             puts it back
 *   --paid-aed=<n> when what was paid differs from the price; --id=<request> when two match.
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
    console.log(`From ${undo}: request ${saved.before._id} back as it was (${saved.before.course_payment?.kind}, ${aed(saved.before.course_payment?.paid_today_aed)} paid)`);
    if (apply) {
      const { _id, ...rest } = saved.before;
      await col("funding_transactions").replaceOne({ _id: new ObjectId(String(_id)) }, rest);
      if (Array.isArray(saved.commission)) await undoBaseChanges(saved.commission, (id) => (ObjectId.isValid(id) ? new ObjectId(id) : id));
      console.log("Put back.");
    }
    process.exit(0);
  }

  const code = option("code")?.trim().toUpperCase() ?? "", product = option("product")?.trim().toUpperCase() ?? "";
  const price = Number(option("price-aed")), pick = option("id")?.trim() ?? "";
  const paid = option("paid-aed") ? Number(option("paid-aed")) : price;
  if (!code || !product || !(price > 0) || !(paid > 0)) { console.error("Say which: --code=<STU code> --product=<course> --price-aed=<the course's price, AED>"); process.exit(1); }

  const studentIds = ((await col("students").find({ student_code: code }, { projection: { _id: 1 } }).toArray()) as any[]).map((s) => String(s._id));
  const found = ((await col("funding_transactions").find({
    student_id: { $in: studentIds }, type: "BONUS", "course_payment.product": { $regex: `^${product}$`, $options: "i" },
    status: { $nin: ["REJECTED", "CANCELLED"] }, ...(ObjectId.isValid(pick) ? { _id: new ObjectId(pick) } : {}),
  }).toArray()) as any[]);
  if (found.length !== 1) {
    console.error(found.length ? `${found.length} ${product} course payments for ${code} — add --id=<one of these>:` : `No ${product} course payment for ${code} (not rejected) — nothing done.`);
    for (const t of found) console.error(`  ${t._id} · ${t.status} · ${t.course_payment?.kind} · paid ${aed(t.course_payment?.paid_today_aed)} · ${t.requested_at ?? "—"}`);
    process.exit(1);
  }
  const t = found[0], cp = t.course_payment ?? {};
  if (Array.isArray(t.payments) && t.payments.length > 1) { console.error(`It was paid ${t.payments.length} ways — change it on the request instead; nothing done.`); process.exit(1); }
  const before = Number(cp.paid_before_aed) || 0;
  const total = cents(before + paid);
  const usdTyped = String(t.amount_currency ?? "AED").toUpperCase() === "USD";

  const set: Record<string, unknown> = {
    "course_payment.price": cents(price), "course_payment.price_currency": "AED", "course_payment.plan_aed": cents(price),
    "course_payment.kind": "full", "course_payment.paid_today_aed": cents(paid), "course_payment.paid_total_aed": total,
    "course_payment.balance_aed": Math.max(0, cents(price - total)), "course_payment.hold_aed": 0,
    "course_payment.short_aed": Math.max(0, cents(price - total)), "course_payment.over_aed": Math.max(0, cents(total - price)),
    "course_payment.bonus_usd": Number(cp.bonus_full_usd) || Number(cp.bonus_usd) || 0,
    "course_payment.price_set_by_script": new Date().toISOString(),
    amount_aed: cents(paid), amount_usd: cents(paid / AED_PER_USD), amount_original: usdTyped ? cents(paid / AED_PER_USD) : cents(paid),
    updated_date: new Date().toISOString(),
  };
  if (Array.isArray(t.payments) && t.payments.length === 1) set["payments.0.amount"] = String(t.payments[0].currency ?? t.amount_currency ?? "AED").toUpperCase() === "USD" ? cents(paid / AED_PER_USD) : cents(paid);

  console.log(`Request ${t._id} · ${t.status}${t.finance_approval?.decision ? ` · finance ${t.finance_approval.decision}` : ""}`);
  console.log(`  ${code} · ${cp.product} · MT5 ${t.mt5_login || "—"}`);
  console.log(`  price        ${cp.price_currency ?? ""} ${cp.price} (plan ${aed(cp.plan_aed)}) → ${aed(price)}`);
  console.log(`  payment      ${cp.kind} → full`);
  console.log(`  paid now     ${aed(cp.paid_today_aed)} → ${aed(paid)}`);
  console.log(`  paid to date ${aed(cp.paid_total_aed)} → ${aed(total)}`);
  console.log(`  balance      ${aed(cp.balance_aed)} → ${aed(set["course_payment.balance_aed"])}   on hold ${aed(cp.hold_aed)} → AED 0`);
  console.log(`  MT5 bonus    $${cp.bonus_usd} → $${set["course_payment.bonus_usd"]}`);
  console.log(`  amount       $${t.amount_usd} → $${set.amount_usd} (at ${AED_PER_USD})`);
  const credits = await commissionBaseChanges(String(t._id), courseBaseUsd(paid));
  if (credits.change.length || credits.paidOut.length) console.log("  commission:");
  else console.log("  commission:   none yet (credited when it is approved — on the new amount)");
  for (const c of credits.change) console.log(`    ${describeChange(c)}`);
  for (const c of credits.paidOut) console.log(`    PAID OUT ALREADY, left alone — tell finance: ${describeChange(c)}`);

  if (apply) {
    const file = join(homedir(), `set-course-full-payment-${t._id}-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify({ before: t, commission: credits.change.map((c) => ({ id: String(c.id), before: c.before })) }, null, 2));
    await col("funding_transactions").updateOne({ _id: t._id }, { $set: set });
    const changed = await applyBaseChanges(credits.change, "set-course-full-payment");
    if (changed) console.log(`${changed} commission credit(s) put on the new amount.`);
    await col("logs").insertOne({
      timestamp: new Date().toISOString(), user_name: "Script (set-course-full-payment)", user_role: "system",
      action_type: "set_course_full_payment", entity_type: "FundingTransaction", entity_id: String(t._id),
      details: JSON.stringify({ student: code, course: cp.product, price_aed: price, paid_aed: paid }), success: true,
    } as any);
    console.log(`\nChanged.\nUndo file: ${file}\n  bun src/scripts/set-course-full-payment.ts --undo=${file} --apply`);
  }
} finally {
  await closeDb();
}
