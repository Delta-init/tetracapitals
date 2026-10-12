import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ObjectId } from "mongodb";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";
import { recordHistory } from "../students/history";

/**
 * Course payments as finance received them (the user, 2026-10-12). A CS who typed the payment in USD had it turned into
 * AED at the fixed 3.67 — USD 500 → AED 1,835 — while the student paid AED 2,000: the request's Paid today, On hold and
 * Balance were off by that. Finance's deposit export says what was received; this puts it on the approved bonus.
 *
 * The export: finance's deposits as CSV or tab-separated, with its header row — "CRM Reference" (the request's
 * Transaction ID), "Payment Currency", "Amount", "Status". Only approved AED rows, matched to an APPROVED course-payment
 * bonus by Transaction ID, whose AED differs. Changed: amount_aed, and the course payment's paid today / total, on hold
 * (when it held the payment) and balance (plan − paid). The USD amount and the bonus are left as they are.
 *
 *   cd backend
 *   bun src/scripts/backfill-paid-from-finance.ts --file=deposits.csv            shows what it would change
 *   bun src/scripts/backfill-paid-from-finance.ts --file=deposits.csv --apply    changes it; an undo file first
 *   bun src/scripts/backfill-paid-from-finance.ts --undo=<file> [--apply]         puts the old figures back
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env).
 */

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const cents = (n: number) => Math.round(n * 100) / 100;
const aed = (n: unknown) => `AED ${(Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** A CSV or tab-separated line, quotes allowed. */
function cells(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

await connectDb();
console.log(`Database: ${host} / ${config.mongoDb} — ${apply ? "WRITING" : "dry run, nothing is written"}\n`);

const undo = option("undo");
if (undo) {
  const saved: any[] = JSON.parse(readFileSync(undo, "utf8")).docs;
  for (const d of saved) console.log(`  ${d.transaction_id}  ${d.student_code} ${d.student_name}  back to ${aed(d.amount_aed)} paid today`);
  if (apply) for (const d of saved) await col("funding_transactions").updateOne({ _id: new ObjectId(d._id) }, { $set: { amount_aed: d.amount_aed, course_payment: d.course_payment } });
  console.log(`\n${saved.length} request(s)${apply ? " put back" : " — run again with --apply to put them back"}.`);
  await closeDb();
  process.exit(0);
}

const file = option("file");
if (!file) { console.log("--file=<finance's deposits export> is required"); await closeDb(); process.exit(1); }
const lines = readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
const sep = lines[0].includes("\t") ? "\t" : ",";
const head = cells(lines[0], sep).map((h) => h.toLowerCase());
const at = (name: string) => head.indexOf(name);
const [iRef, iCur, iAmt, iStatus] = [at("crm reference"), at("payment currency"), at("amount"), at("status")];
if ([iRef, iCur, iAmt].some((i) => i < 0)) { console.log(`The header needs CRM Reference, Payment Currency and Amount — it has: ${head.join(", ")}`); await closeDb(); process.exit(1); }

const received = new Map<string, number>();
for (const l of lines.slice(1)) {
  const c = cells(l, sep);
  const ref = c[iRef], amount = Number(String(c[iAmt]).replace(/,/g, ""));
  if (!ref || c[iCur]?.toUpperCase() !== "AED" || !(amount > 0)) continue;
  if (iStatus >= 0 && c[iStatus] && c[iStatus].toLowerCase() !== "approved") continue;
  received.set(ref, cents((received.get(ref) ?? 0) + amount));
}

const txs = (await col("funding_transactions").find({
  transaction_id: { $in: [...received.keys()] }, type: "BONUS", status: "APPROVED", "course_payment.paid_today_aed": { $gt: 0 },
}).toArray()) as any[];

const changes: { tx: any; set: Record<string, any> }[] = [];
for (const tx of txs) {
  const got = received.get(String(tx.transaction_id))!;
  const cp = tx.course_payment;
  if (Math.abs((Number(cp.paid_today_aed) || 0) - got) < 0.01) continue;
  const before = Number(cp.paid_before_aed) || 0;
  const total = cents(before + got);
  const plan = Number(cp.plan_aed) || 0;
  const next = {
    ...cp,
    paid_today_aed: got,
    paid_total_aed: total,
    ...(Number(cp.hold_aed) > 0 ? { hold_aed: total } : {}),
    ...(plan > 0 ? { balance_aed: cents(Math.max(0, plan - total)) } : {}),
  };
  changes.push({ tx, set: { amount_aed: got, course_payment: next } });
  console.log(`  ${tx.transaction_id}  ${tx.student_code} ${tx.student_name}  (typed ${tx.amount_currency} ${tx.amount_original})`);
  console.log(`      paid today ${aed(cp.paid_today_aed)} → ${aed(got)} · on hold ${aed(cp.hold_aed)} → ${aed(next.hold_aed)} · balance ${aed(cp.balance_aed)} → ${aed(next.balance_aed)}`);
}
console.log(`\n${received.size} approved AED row(s) in the export; ${txs.length} matched an approved course-payment bonus; ${changes.length} to correct.`);

if (apply && changes.length) {
  const undoFile = join(homedir(), `paid-from-finance-undo-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(undoFile, JSON.stringify({ docs: changes.map(({ tx }) => ({ _id: String(tx._id), transaction_id: tx.transaction_id, student_code: tx.student_code, student_name: tx.student_name, amount_aed: tx.amount_aed, course_payment: tx.course_payment })) }, null, 1));
  const now = new Date().toISOString();
  for (const { tx, set } of changes) {
    await col("funding_transactions").updateOne({ _id: tx._id }, { $set: { ...set, updated_date: now } });
    if (tx.student_id) await recordHistory([{ student_id: String(tx.student_id), at: now, type: "funding_corrected", by_id: "", by_name: "Finance backfill",
      text: `Bonus ${tx.transaction_id}: paid ${aed(set.amount_aed)} as finance received it (was ${aed(tx.course_payment.paid_today_aed)}); balance ${aed(set.course_payment.balance_aed)}` } as any]);
  }
  console.log(`Corrected. Undo: --undo=${undoFile}`);
} else if (changes.length) console.log("Nothing was written. Run again with --apply to do it.");
await closeDb();
