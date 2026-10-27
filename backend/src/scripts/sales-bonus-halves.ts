/**
 * The sales-close bonus in halves (the user, 2026-10-27: "minimum 2k+ partial payment … he gets 500 USD … if he pays
 * full he gets full"), for the requests raised before it — e.g. IN-00116, AED 2,750 of 5,500 paid, one $1,000 request
 * nobody can approve while the course owes.
 *
 * For every student with a sales-close bonus request, what functions/studentFollowups.ts settleSalesBonusHalves does
 * on each fee update from finance:
 *   - part paid (AED 2,000+), a pending request for the whole bonus → it becomes the first half (half the amount);
 *   - paid in full, a first half still pending → the whole bonus again;
 *   - paid in full, a first half approved → the rest goes to MT5 Approvals.
 * Decided requests for the whole bonus are never touched.
 *
 * Prints what it would do, unless --write. Uses MONGO_URI / MONGO_DB (this folder's .env, as the API):
 *
 *   cd backend
 *   bun src/scripts/sales-bonus-halves.ts            # what it would do
 *   bun src/scripts/sales-bonus-halves.ts --write    # do it
 */
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";
import { settleSalesBonusHalves, type HalvesChange } from "../functions/studentFollowups";

const write = process.argv.includes("--write");
await connectDb();

const ids = (await col("funding_transactions").distinct("student_id", { bonus_credit: "sales_close", status: { $in: ["PENDING", "APPROVED"] } }))
  .map((id) => toObjectId(String(id))).filter(Boolean);
const students = (await col("students").find({ _id: { $in: ids as any[] } }).toArray()) as any[];

const WHAT: Record<HalvesChange["change"], string> = {
  split: "split — first half to approve now",
  merged: "one request again — paid in full",
  rest_raised: "the rest sent for credit — paid in full",
};
const money = (c: HalvesChange) => (c.currency === "USD" ? `$${c.amount.toLocaleString("en-US")}` : `${c.currency} ${c.amount.toLocaleString("en-US")}`);
let n = 0;
for (const s of students) {
  for (const c of await settleSalesBonusHalves(s, { dryRun: !write })) {
    n++;
    console.log(`${s.student_code ?? ""} ${s.full_name ?? ""} · ${c.invoice_number || c.course}: ${WHAT[c.change]} (${money(c)}) · request ${c.request_id}`);
  }
}
console.log(`\n${students.length} student(s) with a sales-close bonus request; ${n} ${write ? "changed" : "to change — run again with --write to do it"}`);
await closeDb();
