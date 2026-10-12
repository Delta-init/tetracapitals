import { writeFileSync } from "node:fs";
import { ObjectId } from "mongodb";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";

/**
 * Automatic sales-close bonuses raised from the CS enrolment tracker (the user, 2026-10-12) — read only.
 *
 * The tracker's "Bonus Credited (USD)" was imported onto each student as a course fee's bonus (invoice
 * "tracker:<TAB>:<row>"). Until 2026-10-12 the portal took it for a bonus promised at a sales close and, when the CS
 * logged a connected call with the MT5, raised it again as a Bonus credit on MT5 Approvals — a bonus already
 * credited. This lists every one of those, whatever its status, with the student's own bonus requests beside it:
 *   PENDING   — reject it on MT5 Approvals (already credited);
 *   APPROVED  — credited a second time: take it back in MT5;
 *   REJECTED  — nothing to do.
 * And the students whose tracker bonus raised nothing (yet) — nothing to do; from now on it never will.
 *
 *   cd backend
 *   bun src/scripts/tracker-bonus-check.ts                     the list
 *   bun src/scripts/tracker-bonus-check.ts --csv=tracker.csv   also saved as a CSV
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env). Writes nothing.
 */

const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const day = (v: unknown) => (v ? new Date(String(v)).toISOString().slice(0, 10) : "");
const usd = (n: number) => `$${(Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

await connectDb();
console.log(`Database: ${host} / ${config.mongoDb} — read only\n`);

const credits = (await col("funding_transactions")
  .find({ type: "BONUS", bonus_credit: "sales_close", "sales_close.invoice_id": /^tracker:/ })
  .sort({ requested_at: 1 }).toArray()) as any[];
const sIds = [...new Set(credits.map((t) => String(t.student_id ?? "")).filter((id) => ObjectId.isValid(id)))].map((id) => new ObjectId(id));
const students = new Map(((await col("students").find({ _id: { $in: sIds } }, { projection: { full_name: 1, student_code: 1, primary_mentor_name: 1 } }).toArray()) as any[]).map((s) => [String(s._id), s]));
// The student's own bonus requests (the funding form) — what was asked and paid that way.
const own = (await col("funding_transactions")
  .find({ type: "BONUS", student_id: { $in: sIds.map(String) }, bonus_credit: { $in: [null, ""] } }, { projection: { student_id: 1, status: 1, amount_usd: 1, requested_at: 1 } })
  .toArray()) as any[];
const ownOf = (sid: string) => own.filter((t) => String(t.student_id) === sid);

type Row = { status: string; raised: string; student: string; code: string; cs: string; tracker: string; credit: number; formApproved: number; formOther: string; action: string };
const rows: Row[] = credits.map((t) => {
  const sid = String(t.student_id ?? "");
  const s = students.get(sid);
  const mine = ownOf(sid);
  const approved = mine.filter((x) => x.status === "APPROVED").reduce((a, x) => a + (Number(x.amount_usd) || 0), 0);
  const others = mine.filter((x) => x.status !== "APPROVED").map((x) => `${x.status} ${usd(x.amount_usd)} ${day(x.requested_at)}`).join("; ");
  return {
    status: t.status, raised: day(t.requested_at), student: String(s?.full_name ?? t.student_name ?? ""), code: String(s?.student_code ?? t.student_code ?? ""),
    cs: String(s?.primary_mentor_name ?? t.primary_mentor_name ?? ""), tracker: String(t.sales_close?.invoice_id ?? "").replace(/^tracker:/, ""),
    credit: Number(t.amount_usd) || 0, formApproved: approved, formOther: others,
    action: t.status === "PENDING" ? "REJECT on MT5 Approvals — already credited" : t.status === "APPROVED" ? "CREDITED TWICE — take it back in MT5" : "nothing to do",
  };
});

console.log("Status    Raised      Student                      Code      CS                   Tracker      Auto credit  Form bonuses approved  Action");
for (const r of rows) {
  console.log([r.status.padEnd(9), r.raised.padEnd(11), r.student.slice(0, 28).padEnd(28), r.code.padEnd(9), r.cs.slice(0, 20).padEnd(20), r.tracker.padEnd(12),
    usd(r.credit).padStart(11), usd(r.formApproved).padStart(22), " " + r.action].join(" "));
  if (r.formOther) console.log(`${" ".repeat(60)}other form bonuses: ${r.formOther}`);
}
const sum = (st: string) => rows.filter((r) => r.status === st);
console.log(`\n${rows.length} automatic bonus(es) raised from the tracker:`);
console.log(`  ${sum("PENDING").length} pending  — ${usd(sum("PENDING").reduce((a, r) => a + r.credit, 0))} to reject`);
console.log(`  ${sum("APPROVED").length} approved — ${usd(sum("APPROVED").reduce((a, r) => a + r.credit, 0))} credited a second time`);
console.log(`  ${sum("REJECTED").length} rejected`);
const withTracker = await col("students").countDocuments({ course_fees: { $elemMatch: { source: "cs_tracker", bonus_given: true, bonus_minor: { $gt: 0 } } } });
console.log(`\n${withTracker} student(s) have a tracker bonus — from now on none of them raises an automatic bonus.`);

const csv = option("csv");
if (csv) {
  const cell = (v: unknown) => { const x = String(v ?? ""); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  writeFileSync(csv, [["Status", "Raised", "Student", "Code", "CS", "Tracker tab/row", "Automatic credit USD", "Form bonuses approved USD", "Other form bonuses", "Action"].join(","),
    ...rows.map((r) => [r.status, r.raised, r.student, r.code, r.cs, r.tracker, r.credit, r.formApproved, r.formOther, r.action].map(cell).join(","))].join("\n"));
  console.log(`\nSaved: ${csv}`);
}
await closeDb();
