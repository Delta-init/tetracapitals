import { connectDb, closeDb, col } from "../db";
import { config } from "../config";
import { financeRecorded, queueWithdrawal } from "../finance/withdrawals";

/**
 * Course payments finance approved and this portal then rejected or cancelled before 2026-10-31 — when finance began
 * to be told (finance/withdrawals.ts): each is queued for finance to take its payment back off its invoice, as a
 * rejection does now. The running API sends them within a quarter of a minute (its finance worker) — so it must be on
 * the version with finance/withdrawals.ts, and finance's API on the one with /integrations/tetra-deposits/withdrawals.
 * One sent back to its CS (still PENDING) is not one of them.
 *
 *   cd backend
 *   bun src/scripts/withdraw-rejected-payments.ts                        shows them
 *   bun src/scripts/withdraw-rejected-payments.ts --write --expect N     queues them (N = the count shown)
 *   bun src/scripts/withdraw-rejected-payments.ts --status               where each queued one got to
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env).
 */

const write = process.argv.includes("--write");
const option = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? String(process.argv[i + 1] ?? "") : ""; };
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const aed = (n: unknown) => `AED ${Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

await connectDb();
console.log(`Database: ${host} / ${config.mongoDb}${write ? "" : "   (showing only — add --write to queue them)"}\n`);
try {
  if (process.argv.includes("--status")) {
    const all = (await col("finance_withdrawals").find({}).sort({ queued_at: -1 }).limit(200).toArray()) as any[];
    for (const w of all) console.log(`${String(w.queued_at).slice(0, 10)}  …${String(w.funding_id).slice(-6)}  ${String(w.student_name).slice(0, 26).padEnd(26)} ${aed(w.amount_aed).padStart(12)}  ${String(w.state).padEnd(8)} ${w.message || w.last_error || ""}`);
    console.log(`\n${all.length} withdrawal(s).`);
    process.exit(0);
  }
  const rejected = ((await col("funding_transactions").find({
    type: "BONUS", status: { $in: ["REJECTED", "CANCELLED"] }, bonus_credit: { $in: [null, ""] },
    "finance_approval.state": "decided", "finance_approval.decision": "approved",
  }).toArray()) as any[]).filter(financeRecorded);
  const sent = new Set(((await col("finance_withdrawals").find({ funding_id: { $in: rejected.map((t) => String(t._id)) } }, { projection: { funding_id: 1 } }).toArray()) as any[]).map((w) => String(w.funding_id)));
  const todo = rejected.filter((t) => !sent.has(String(t._id)));
  const users = new Map(((await col("users").find({}, { projection: { full_name: 1, email: 1 } }).toArray()) as any[]).map((u) => [String(u._id), u.full_name || u.email]));
  for (const t of todo) {
    console.log(`…${String(t._id).slice(-6)}  ${String(t.student_name ?? "").slice(0, 26).padEnd(26)} ${String(t.course_payment?.product ?? "").slice(0, 14).padEnd(14)} ${aed(t.course_payment?.paid_today_aed ?? t.amount_aed).padStart(12)}  `
      + `raised ${String(t.requested_at ?? t.created_date ?? "").slice(0, 10)} by ${users.get(String(t.requested_by_id)) ?? t.requested_by_name ?? "?"}  ${t.status}${t.rejection_reason ? ` — ${t.rejection_reason}` : ""}`);
  }
  console.log(`\n${todo.length} payment(s) finance approved that were rejected here and finance was never told.${sent.size ? ` (${sent.size} queued already.)` : ""}`);
  if (!write) {
    if (todo.length) console.log(`Nothing queued. To do it: bun src/scripts/withdraw-rejected-payments.ts --write --expect ${todo.length}`);
  } else {
    const expect = Number(option("--expect"));
    if (option("--expect") === "" || expect !== todo.length) {
      console.error(`--expect ${option("--expect") || "(missing)"} doesn't match the ${todo.length} shown — nothing queued.`);
      process.exit(1);
    }
    for (const t of todo) await queueWithdrawal(t, String(t.approved_by_name ?? t.rejected_by_name ?? ""), String(t.rejection_reason ?? "Rejected before finance was told of rejections"), t.status === "CANCELLED" ? "cancelled" : "rejected");
    console.log(`Queued ${todo.length}. The API sends them within a quarter of a minute — see where they got to with --status.`);
  }
} finally {
  await closeDb();
}
