import { writeFileSync, readFileSync } from "node:fs";
import { ObjectId } from "mongodb";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";

/**
 * Takes back one funding request made as a test (the user, 2026-10-12) — and what approving it wrote:
 *   - the funding request itself (a course balance worked out from it goes with it);
 *   - the commission credits made from it (commission_credits.transaction_id);
 *   - the MT5 account it saved for the student — only when this request saved it ("funding request") and no other
 *     request of theirs names that login;
 *   - the note of an automatic LMS opening for its course (students.course_lms_sync), if there is one.
 * Kept: the audit log (`logs`). Nothing is changed in MT5 or in the LMS — a bonus credited in MT5 is taken back there.
 *
 * The request is found only when the student, its transaction ID and its amount (USD) all match:
 *   cd backend
 *   bun src/scripts/revert-funding-request.ts --student=<id> --txn=<transaction id> --usd=<amount>            shows it
 *   bun src/scripts/revert-funding-request.ts --student=<id> --txn=<transaction id> --usd=<amount> --apply    removes it
 *                                                                        (a full copy saved in an undo file first)
 * …or, for one never approved (no transaction ID — e.g. sent back, 2026-10-27), by the student's code, its MT5 login
 * and its amount (USD; a course-payment bonus by its MT5 bonus):
 *   bun src/scripts/revert-funding-request.ts --code=STU-2834 --mt5=919709 --usd=12000 --type=BONUS [--apply]
 * (--type DEPOSIT | WITHDRAWAL | BONUS narrows it when two match); --id=<request id> picks one of those it lists.
 *   bun src/scripts/revert-funding-request.ts --undo=<file> [--apply]    puts back everything that file holds
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env).
 */

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const productKey = (name: unknown) => String(name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

await connectDb();
console.log(`Database: ${host} / ${config.mongoDb}${apply ? "" : "   (showing only — add --apply to change it)"}\n`);

const undoFile = option("undo");
if (undoFile) {
  const saved = JSON.parse(readFileSync(undoFile, "utf8"));
  const revive = (d: any) => ({ ...d, _id: new ObjectId(String(d._id)) });
  console.log(`From ${undoFile}: the request, ${saved.credits.length} commission credit(s), ${saved.mt5 ? "the MT5 account" : "no MT5 account"}${saved.lmsSync ? ", the LMS note" : ""}`);
  if (apply) {
    await col("funding_transactions").insertOne(revive(saved.request));
    if (saved.credits.length) await col("commission_credits").insertMany(saved.credits.map(revive));
    if (saved.mt5) await col("mt5_accounts").insertOne(revive(saved.mt5));
    if (saved.lmsSync) await col("students").updateOne({ _id: new ObjectId(saved.request.student_id) }, { $set: { [`course_lms_sync.${saved.lmsSync.key}`]: saved.lmsSync.value } });
    console.log("Put back.");
  }
  await closeDb();
  process.exit(0);
}

const code = option("code")?.trim().toUpperCase() ?? "", mt5Login = option("mt5")?.trim() ?? "", type = option("type")?.trim().toUpperCase() ?? "", pickId = option("id")?.trim() ?? "";
let student = option("student") ?? "";
const txn = option("txn") ?? "", usd = Number(option("usd"));
const amountOf = (t: any) => [Number(t.amount_usd) || 0, Number(t.course_payment?.bonus_usd) || 0];
let request: any;
if (code) {
  // By the student's code, the MT5 login and the amount — exactly one request, or nothing is done.
  if (!mt5Login || !Number.isFinite(usd)) { console.error("Say which request: --code=<STU code> --mt5=<MT5 login> --usd=<amount in USD>"); process.exit(1); }
  const studentIds = ((await col("students").find({ student_code: code }, { projection: { _id: 1 } }).toArray()) as any[]).map((x) => String(x._id));
  if (!studentIds.length) { console.error(`No student ${code} — nothing done.`); process.exit(1); }
  const found = ((await col("funding_transactions").find({ student_id: { $in: studentIds }, mt5_login: { $in: [mt5Login, Number(mt5Login)] }, ...(type ? { type } : {}), ...(ObjectId.isValid(pickId) ? { _id: new ObjectId(pickId) } : {}) }).toArray()) as any[])
    .filter((t) => amountOf(t).some((a) => Math.abs(a - usd) < 0.01));
  if (found.length !== 1) {
    console.error(found.length ? `${found.length} requests for ${code}, MT5 ${mt5Login}, $${usd} — not one; nothing done:` : `No request for ${code}, MT5 ${mt5Login}, $${usd} — nothing done.`);
    for (const t of found) console.error(`  ${t._id} · ${t.type} · ${t.status} · ${t.requested_at ?? t.created_date ?? "—"}`);
    if (found.length > 1) console.error(type ? "Add --id=<one of these> to say which." : "Add --type=DEPOSIT, WITHDRAWAL or BONUS, or --id=<one of these>, to say which.");
    process.exit(1);
  }
  request = found[0];
  student = String(request.student_id);
} else {
  if (!ObjectId.isValid(student) || !txn || !Number.isFinite(usd)) {
    console.error("Say which request: --student=<student id> --txn=<transaction id> --usd=<amount in USD>, or --code=<STU code> --mt5=<MT5 login> --usd=<amount>");
    process.exit(1);
  }
  const found = (await col("funding_transactions").find({ student_id: student, transaction_id: txn }).toArray()) as any[];
  request = found.find((t) => Math.abs((Number(t.amount_usd) || 0) - usd) < 0.01);
  if (found.length !== 1 || !request) {
    console.error(found.length ? `Found ${found.length} request(s) with that student and transaction ID, but not exactly one for $${usd} — nothing done.` : "No request with that student and transaction ID — nothing done.");
    process.exit(1);
  }
}
const s: any = await col("students").findOne({ _id: new ObjectId(student) }, { projection: { full_name: 1, student_code: 1, course_lms_sync: 1 } });
const id = String(request._id);
console.log(`Request ${id}`);
console.log(`  ${s?.full_name ?? "?"} (${s?.student_code ?? "?"}) · ${request.type} · ${request.status} · $${request.amount_usd}${request.course_payment?.bonus_usd ? ` (MT5 bonus $${request.course_payment.bonus_usd})` : ""}${request.sent_back ? " · sent back" : ""}${request.amount_currency && request.amount_currency !== "USD" ? ` (${request.amount_currency} ${request.amount_original})` : ""}`);
console.log(`  MT5 ${request.mt5_login || "—"} · ${request.course_payment ? `${request.course_payment.product} ${request.course_payment.kind}` : (request.tags ?? []).join(", ")} · by ${request.requested_by_name ?? request.initiating_mentor_name ?? "?"} on ${request.requested_at ?? request.created_date}`);

const credits = (await col("commission_credits").find({ transaction_id: id }).toArray()) as any[];
console.log(`\nCommission credits from it: ${credits.length}`);
for (const c of credits) console.log(`  ${c.recipient_name ?? c.recipient_id ?? "pool"} · $${c.commission_usd} · ${c.method}${c.is_pool ? " (pool)" : ""} · ${c.status ?? ""}`);

let mt5: any = null;
if (request.mt5_login) {
  const row: any = await col("mt5_accounts").findOne({ student_id: student, mt5_login: String(request.mt5_login) });
  const others = await col("funding_transactions").countDocuments({ student_id: student, mt5_login: request.mt5_login, _id: { $ne: request._id } });
  if (row && row.source === "funding request" && !others) mt5 = row;
  console.log(`\nMT5 ${request.mt5_login}: ${!row ? "not saved on the student" : mt5 ? "saved by this request — removed" : `kept (${row.source !== "funding request" ? `saved from ${row.source || "elsewhere"}` : `${others} other request(s) use it`})`}`);
}

const key = productKey(request.course_payment?.product);
const lmsSync = key && s?.course_lms_sync?.[key] ? { key, value: s.course_lms_sync[key] } : null;
console.log(`LMS opening note: ${lmsSync ? `${request.course_payment.product} — removed (modules opened in the LMS stay open; change them there)` : "none"}`);
if (request.type === "BONUS" && request.status === "APPROVED") console.log("\n⚠ It was approved: if the bonus was credited in MT5, take it back in MT5 by hand.");

if (apply) {
  const file = `revert-funding-request-${id}-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify({ request, credits, mt5, lmsSync }, null, 2));
  console.log(`\nUndo file: ${file}`);
  await col("funding_transactions").deleteOne({ _id: request._id });
  if (credits.length) await col("commission_credits").deleteMany({ _id: { $in: credits.map((c) => c._id) } });
  if (mt5) await col("mt5_accounts").deleteOne({ _id: mt5._id });
  if (lmsSync) await col("students").updateOne({ _id: new ObjectId(student) }, { $unset: { [`course_lms_sync.${key}`]: "" } });
  console.log("Removed.");
}
await closeDb();
