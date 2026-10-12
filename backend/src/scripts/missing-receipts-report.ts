import { writeFileSync } from "node:fs";
import { ObjectId } from "mongodb";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";

/**
 * Which MT5 Approvals requests have no receipt, and why (the user, 2026-10-12). Reads only — nothing is written to
 * the database and nothing is sent anywhere.
 *
 * For every pending deposit, withdrawal and bonus (with --all, this month's approved and rejected ones too): where its
 * receipt would come from, whether there is one, and — when none — the reason:
 *   Sales close      it has none of its own; finance's receipt for its invoice
 *                      · "no invoice named"            the request names no finance invoice
 *                      · "invoice not on the student"  the student here doesn't carry that invoice (merged / imported)
 *                      · "none from finance yet"       finance sent no receipt for it — the finance backfill sends the
 *                                                      salesperson's, or none was uploaded at the close
 *   Course upgrade   its upgrade's payments
 *                      · "upgrade payment has no receipt"
 *   Direct from CS   one per payment, attached on the funding form
 *                      · "withdrawal — receipt optional" / "none attached"
 *
 *   cd backend
 *   bun src/scripts/missing-receipts-report.ts                     the pending ones without a receipt
 *   bun src/scripts/missing-receipts-report.ts --everything        every pending one, with or without
 *   bun src/scripts/missing-receipts-report.ts --all               this month's decided ones too
 *   bun src/scripts/missing-receipts-report.ts --csv=receipts.csv  also saved as a CSV
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env).
 */

const has = (flag: string) => process.argv.includes(flag);
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const isLink = (v: unknown) => /^https?:\/\//i.test(String(v ?? ""));
const day = (v: unknown) => (v ? new Date(String(v)).toISOString().slice(0, 10) : "");

await connectDb();
const monthStart = (() => { const u = new Date(Date.now() + 4 * 3_600_000); return new Date(Date.UTC(u.getUTCFullYear(), u.getUTCMonth(), 1) - 4 * 3_600_000).toISOString(); })();
const txs = (await col("funding_transactions").find({
  type: { $in: ["DEPOSIT", "WITHDRAWAL", "BONUS"] },
  $or: [{ status: "PENDING" }, ...(has("--all") ? [{ status: { $in: ["APPROVED", "REJECTED"] }, approved_at: { $gte: monthStart } }] : [])],
}).sort({ requested_at: 1 }).toArray()) as any[];

const sIds = [...new Set(txs.map((t) => String(t.student_id ?? "")).filter((id) => ObjectId.isValid(id)))].map((id) => new ObjectId(id));
const students = new Map(((await col("students").find({ _id: { $in: sIds } }, { projection: { full_name: 1, student_code: 1, primary_mentor_name: 1, course_fees: 1 } }).toArray()) as any[]).map((s) => [String(s._id), s]));
const upIds = [...new Set(txs.map((t) => String(t.course_upgrade?.upgrade_id ?? "")).filter(Boolean))];
const upReceipts = new Map<string, number>();
for (const p of (await col("course_payments").find({ upgrade_id: { $in: upIds } }, { projection: { upgrade_id: 1, receipt_url: 1 } }).toArray()) as any[]) {
  if (isLink(p.receipt_url)) upReceipts.set(String(p.upgrade_id), (upReceipts.get(String(p.upgrade_id)) ?? 0) + 1);
}

type Row = { requested: string; status: string; type: string; source: string; student: string; code: string; cs: string; usd: number; receipts: number; where: string; why: string };
const rows: Row[] = [];
for (const t of txs) {
  const s = students.get(String(t.student_id ?? ""));
  const source = t.type !== "BONUS" ? "Direct from CS portal" : t.bonus_credit === "sales_close" ? "Sales close" : t.bonus_credit === "course_upgrade" ? "Course upgrade" : "Direct from CS portal";
  const own = (Array.isArray(t.payments) && t.payments.length ? t.payments.filter((p: any) => isLink(p?.receipt_url)).length : isLink(t.screenshot_url) ? 1 : 0);
  let receipts = 0, where = "", why = "";
  if (source === "Course upgrade") {
    receipts = Math.max(upReceipts.get(String(t.course_upgrade?.upgrade_id ?? "")) ?? 0, own);
    where = "upgrade payments";
    if (!receipts) why = "upgrade payment has no receipt";
  } else if (source === "Sales close") {
    where = "finance (invoice)";
    const inv = String(t.sales_close?.invoice_number ?? "");
    const fee = (s?.course_fees ?? []).find((f: any) => (t.sales_close?.invoice_id && f.invoice_id === t.sales_close.invoice_id) || (inv && f.invoice_number === inv));
    receipts = own + (fee ? (isLink(fee.receipt_url) ? 1 : 0) + (fee.declared_payments ?? []).filter((p: any) => isLink(p?.receipt_url) && p.receipt_url !== fee.receipt_url).length : 0);
    if (!receipts) why = !inv && !t.sales_close?.invoice_id ? "no invoice named" : !fee ? "invoice not on the student" : "none from finance yet";
  } else {
    receipts = own;
    where = "attached on the form";
    if (!receipts) why = t.type === "WITHDRAWAL" ? "withdrawal — receipt optional" : "none attached";
  }
  if (!receipts || has("--everything")) {
    rows.push({
      requested: day(t.requested_at || t.created_date), status: t.status, type: t.type, source,
      student: String(s?.full_name ?? t.student_name ?? ""), code: String(s?.student_code ?? t.student_code ?? ""),
      cs: String(s?.primary_mentor_name ?? t.primary_mentor_name ?? ""), usd: Number(t.amount_usd) || 0, receipts, where, why,
    });
  }
}

console.log(`Database: ${host} / ${config.mongoDb} — read only\n`);
console.log(["Requested ", "Status  ", "Type      ", "From                  ", "Student                     ", "Code     ", "CS                  ", "  USD    ", "Rcpt", "Why"].join(" "));
for (const r of rows) {
  console.log([r.requested.padEnd(10), r.status.padEnd(8), r.type.padEnd(10), r.source.padEnd(22), r.student.slice(0, 28).padEnd(28), r.code.padEnd(9), r.cs.slice(0, 20).padEnd(20),
    r.usd.toFixed(0).padStart(8), String(r.receipts).padStart(4), r.why || "has receipt"].join(" "));
}
const byWhy = new Map<string, number>();
for (const r of rows) if (r.why) byWhy.set(`${r.source} — ${r.why}`, (byWhy.get(`${r.source} — ${r.why}`) ?? 0) + 1);
console.log(`\n${txs.length} request(s) looked at; ${rows.filter((r) => !r.receipts).length} without a receipt:`);
for (const [k, n] of [...byWhy].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);

const csv = option("csv");
if (csv) {
  const cell = (v: unknown) => { const x = String(v ?? ""); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  writeFileSync(csv, [["Requested", "Status", "Type", "From", "Student", "Code", "CS", "Amount USD", "Receipts", "Receipt from", "Why none"].join(","),
    ...rows.map((r) => [r.requested, r.status, r.type, r.source, r.student, r.code, r.cs, r.usd, r.receipts, r.where, r.why].map(cell).join(","))].join("\n"));
  console.log(`\nSaved: ${csv}`);
}
await closeDb();
