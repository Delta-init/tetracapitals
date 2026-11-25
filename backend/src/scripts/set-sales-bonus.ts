import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";

/**
 * Changes the bonus promised at a sales close (the user, 2026-11-25: Sudheesh's $500 → $1,200). Two places:
 *   - the student's course fee for that invoice (course_fees[].bonus_minor, as finance sent it — a resend never
 *     overwrites it, finance/students.ts), so the fees and MT5 tabs show the new amount;
 *   - the Bonus request raised for that invoice (bonus_credit "sales_close"), any status: amount_usd / amount_original /
 *     amount_aed, and a line on its notes. A sales-close bonus pays no commission, so no credits change.
 * Nothing is done in MT5 or in Finance's own invoice.
 *
 *   cd backend
 *   bun src/scripts/set-sales-bonus.ts --code=STU-5247 --invoice=IN-00318 --usd=1200            dry run
 *   bun src/scripts/set-sales-bonus.ts --code=STU-5247 --invoice=IN-00318 --usd=1200 --apply    does it; an undo file first
 *   bun src/scripts/set-sales-bonus.ts --undo=<file> [--apply]                                  puts it back
 */

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const AED_PER_USD = 3.67;
const usdText = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

async function run() {
  const code = option("code")?.trim().toUpperCase(), invoice = option("invoice")?.trim().toUpperCase(), usd = Number(option("usd"));
  if (!code || !invoice || !(usd > 0)) throw new Error("Give --code=<STU code> --invoice=<invoice number> --usd=<new bonus in USD>");
  const students = (await col("students").find({ student_code: { $regex: `^\\s*${code}\\s*$`, $options: "i" }, "course_fees.invoice_number": { $regex: `^\\s*${invoice}\\s*$`, $options: "i" } }).toArray()) as any[];
  if (students.length !== 1) throw new Error(`${students.length} students have code ${code} with invoice ${invoice} — need exactly one`);
  const s = students[0];
  const i = (s.course_fees as any[]).findIndex((f) => String(f.invoice_number ?? "").trim().toUpperCase() === invoice);
  const fee = s.course_fees[i];
  if (fee.bonus_given !== true) throw new Error(`Invoice ${invoice}: no bonus was given at the close`);
  const cur = String(fee.bonus_currency ?? fee.currency ?? "").toUpperCase();
  if (cur !== "USD") throw new Error(`Invoice ${invoice}: the bonus is in ${cur || "no currency"}, not USD`);
  const requests = (await col("funding_transactions").find({ student_id: String(s._id), bonus_credit: "sales_close", "sales_close.invoice_id": String(fee.invoice_id) }).toArray()) as any[];
  if (requests.some((r) => r.bonus_part)) throw new Error(`The bonus went in halves (${requests.map((r) => `${r.bonus_part} $${r.amount_usd}`).join(", ")}) — change them by hand`);

  console.log(`\n${s.student_code} ${String(s.full_name ?? "").trim()} (${s.primary_mentor_name ?? "no CS"}) — ${fee.course}, invoice ${fee.invoice_number}`);
  console.log(`  Promised bonus: ${usdText((Number(fee.bonus_minor) || 0) / 100)} → ${usdText(usd)}`);
  for (const r of requests) console.log(`  Request ${r._id} (${r.status}, ${r.transaction_id ?? "no txn"}): ${usdText(Number(r.amount_usd) || 0)} → ${usdText(usd)}`);
  if (!requests.length) console.log("  No Bonus request raised for it yet — only the promised bonus changes.");
  if (!apply) { console.log("\nNothing was written. Run again with --apply to do it."); return; }

  const undoPath = join(homedir(), `set-sales-bonus-undo-${now.replace(/[:.]/g, "-")}.json`);
  await Bun.write(undoPath, JSON.stringify({ database: config.mongoDb, host, applied_at: now, student_id: String(s._id), invoice_id: String(fee.invoice_id),
    bonus_minor: fee.bonus_minor, requests: requests.map((r) => ({ id: String(r._id), amount_usd: r.amount_usd, amount_original: r.amount_original, amount_aed: r.amount_aed, notes: r.notes })) }, null, 1));
  await col("students").updateOne({ _id: s._id, "course_fees.invoice_id": fee.invoice_id }, { $set: { "course_fees.$.bonus_minor": Math.round(usd * 100), updated_date: now } });
  for (const r of requests) {
    const line = `Bonus changed from ${usdText(Number(r.amount_usd) || 0)} to ${usdText(usd)} on ${now.slice(0, 10)}.`;
    await col("funding_transactions").updateOne({ _id: r._id }, { $set: { amount_usd: usd, amount_original: usd, amount_aed: Math.round(usd * AED_PER_USD * 100) / 100, notes: `${String(r.notes ?? "").trim()}\n${line}`.trim(), updated_date: now } });
  }
  console.log(`\nDone.\nUndo file: ${undoPath}\n  bun src/scripts/set-sales-bonus.ts --undo=${undoPath}          (shows what it would put back)`);
}

async function undo(file: string) {
  const saved = JSON.parse(await Bun.file(file).text());
  if (saved.database !== config.mongoDb || saved.host !== host) throw new Error(`That undo file is for "${saved.database}" on ${saved.host}, not this database.`);
  console.log(`\nUndo of ${saved.applied_at}: the promised bonus back to ${usdText(saved.bonus_minor / 100)}, ${saved.requests.length} request(s) back${apply ? "" : " — add --apply"}`);
  if (!apply) return;
  await col("students").updateOne({ _id: toObjectId(saved.student_id) as any, "course_fees.invoice_id": saved.invoice_id }, { $set: { "course_fees.$.bonus_minor": saved.bonus_minor } });
  for (const r of saved.requests) await col("funding_transactions").updateOne({ _id: toObjectId(r.id) as any }, { $set: { amount_usd: r.amount_usd, amount_original: r.amount_original, amount_aed: r.amount_aed, notes: r.notes } });
  console.log("Put back.");
}

await connectDb();
console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}`);
try {
  const undoFile = option("undo");
  if (undoFile) await undo(undoFile);
  else await run();
} catch (err) {
  console.log(`\nStopped: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
