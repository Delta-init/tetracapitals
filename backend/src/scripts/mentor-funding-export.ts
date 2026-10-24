import { writeFileSync } from "node:fs";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";
import { BUILTIN_MENTOR_ROLES } from "../lib/roles";

/**
 * The mentors' deposits and funding activities, to a date (the user, 2026-10-24: "before Oct 13") — read only.
 *
 * For every mentor (Chief, Senior, Junior, Sub-junior Mentor, Assistance):
 *   - Requests: the deposits, withdrawals and bonuses they raised (or raised for their students), with the student,
 *     amount, status, course and the commission each earned;
 *   - Commission: every credit to them (their own and their pool shares), with its level, method and status;
 *   - Summary: per mentor, how many of each and the totals.
 * Dated by when the request was raised (requested_at, else created), Dubai days.
 *
 *   cd backend
 *   bun src/scripts/mentor-funding-export.ts --before=2026-10-13 [--from=2026-01-01] --out=<file.json>
 *   python3 src/scripts/sheets-to-xlsx.py <file.json> <file.xlsx>
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env). Writes nothing there.
 */

const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const before = option("before"), from = option("from"), out = option("out");
if (!isDay(before) || (from && !isDay(from)) || !out) {
  console.log("Give --before=YYYY-MM-DD [--from=YYYY-MM-DD] --out=<file.json>");
  process.exit(1);
}
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const dubai = (day: string) => new Date(`${day}T00:00:00+04:00`).toISOString();
const dubaiDay = (iso: unknown) => (iso ? new Date(new Date(String(iso)).getTime() + 4 * 3600_000).toISOString().slice(0, 10) : "");
const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const ROLE: Record<string, string> = { chief_mentor: "Chief Mentor", senior_mentor: "Senior Mentor", junior_mentor: "Junior Mentor", subjunior_mentor: "Sub-junior Mentor", assistance: "Assistance" };

await connectDb();
console.log(`${host}/${config.mongoDb} — read only`);
try {
  const range: Record<string, string> = { $lt: dubai(before!) };
  if (from) range.$gte = dubai(from);
  const when = { $or: [{ requested_at: range }, { requested_at: { $in: [null, ""] }, created_date: range }] };

  const mentors = (await col("users").find({ app_role: { $in: [...BUILTIN_MENTOR_ROLES] } }, { projection: { full_name: 1, email: 1, app_role: 1, status: 1 } }).toArray()) as any[];
  const ids = mentors.map((m) => String(m._id));
  const byId = new Map(mentors.map((m) => [String(m._id), m]));
  const nameOf = (id: unknown) => byId.get(String(id ?? ""))?.full_name ?? "";

  const txs = (await col("funding_transactions").find(
    { ...when, $and: [{ $or: [{ initiating_mentor_id: { $in: ids } }, { requested_by_id: { $in: ids } }, { primary_mentor_id: { $in: ids } }] }] },
    { projection: { type: 1, status: 1, student_name: 1, student_code: 1, amount_usd: 1, amount_aed: 1, amount_currency: 1, amount_original: 1, course_payment: 1, tags: 1, mt5_login: 1, transaction_id: 1, requested_at: 1, created_date: 1, initiating_mentor_id: 1, requested_by_id: 1, primary_mentor_id: 1, bonus_credit: 1, rejection_reason: 1 } },
  ).sort({ requested_at: 1, created_date: 1 }).toArray()) as any[];

  const credits = (await col("commission_credits").find(
    { recipient_id: { $in: ids }, ...when },
    { projection: { recipient_id: 1, level: 1, method: 1, transaction_type: 1, transaction_id: 1, student_name: 1, full_amount: 1, commission_usd: 1, is_pool: 1, pool_group_name: 1, status: 1, requested_at: 1, created_date: 1 } },
  ).sort({ requested_at: 1 }).toArray()) as any[];
  // Every credit a request earned, whoever got it — the requests' own commission column.
  const allForTx = (await col("commission_credits").find({ transaction_id: { $in: txs.map((t) => String(t._id)) } }, { projection: { transaction_id: 1, commission_usd: 1 } }).toArray()) as any[];
  const earned = new Map<string, number>();
  for (const c of allForTx) earned.set(String(c.transaction_id), (earned.get(String(c.transaction_id)) ?? 0) + (Number(c.commission_usd) || 0));

  const mentorOf = (t: any) => [t.initiating_mentor_id, t.requested_by_id, t.primary_mentor_id].map(String).find((id) => byId.has(id)) ?? "";
  const reqRows = txs.map((t) => {
    const m = byId.get(mentorOf(t));
    return [
      dubaiDay(t.requested_at || t.created_date), m?.full_name ?? "", ROLE[m?.app_role] ?? m?.app_role ?? "",
      t.student_name ?? "", t.student_code ?? "", t.bonus_credit ? "BONUS (sales-close credit)" : t.type ?? "", t.status ?? "",
      r2(t.amount_usd), r2(t.amount_aed || Number(t.amount_usd) * 3.67),
      t.amount_currency === "INR" ? r2(t.amount_original) : "",
      t.course_payment?.product ?? (Array.isArray(t.tags) ? t.tags.join(", ") : ""), t.course_payment?.kind ?? "",
      t.mt5_login ?? "", t.transaction_id ?? "", r2(earned.get(String(t._id))),
      nameOf(t.requested_by_id) && String(t.requested_by_id) !== mentorOf(t) ? nameOf(t.requested_by_id) : "",
      t.status === "REJECTED" ? t.rejection_reason ?? "" : "",
    ];
  });

  const creditRows = credits.map((c) => [
    dubaiDay(c.requested_at || c.created_date), nameOf(c.recipient_id), ROLE[byId.get(String(c.recipient_id))?.app_role] ?? "",
    c.student_name ?? "", c.transaction_type ?? "", c.method ?? "", c.level ?? "", c.is_pool ? `Pool share${c.pool_group_name ? ` (${c.pool_group_name})` : ""}` : "Own",
    r2(c.full_amount), r2(c.commission_usd), c.status ?? "",
  ]);

  const sum = new Map<string, any>();
  const of = (id: string) => sum.get(id) ?? sum.set(id, { dep: 0, depUsd: 0, wd: 0, wdUsd: 0, bon: 0, bonUsd: 0, approved: 0, pending: 0, rejected: 0, comm: 0, pool: 0 }).get(id);
  for (const t of txs) {
    const s = of(mentorOf(t));
    const usd = Number(t.amount_usd) || 0;
    if (t.type === "DEPOSIT") { s.dep++; s.depUsd += t.status === "APPROVED" ? usd : 0; }
    else if (t.type === "WITHDRAWAL") { s.wd++; s.wdUsd += t.status === "APPROVED" ? usd : 0; }
    else if (t.type === "BONUS") { s.bon++; s.bonUsd += t.status === "APPROVED" ? usd : 0; }
    if (t.status === "APPROVED") s.approved++; else if (t.status === "REJECTED") s.rejected++; else if (t.status === "PENDING") s.pending++;
  }
  for (const c of credits) { const s = of(String(c.recipient_id)); if (c.is_pool) s.pool += Number(c.commission_usd) || 0; else s.comm += Number(c.commission_usd) || 0; }
  const summaryRows = [...sum.entries()].filter(([id]) => byId.has(id)).map(([id, s]) => {
    const m = byId.get(id);
    return [m.full_name ?? "", ROLE[m.app_role] ?? m.app_role, m.status === "inactive" ? "Off" : "On",
      s.dep, r2(s.depUsd), s.wd, r2(s.wdUsd), s.bon, r2(s.bonUsd), s.approved, s.pending, s.rejected, r2(s.comm), r2(s.pool), r2(s.comm + s.pool)];
  }).sort((a, b) => Number(b[14]) - Number(a[14]) || String(a[0]).localeCompare(String(b[0])));

  const period = `${from ? `${from} to ` : "Up to "}${before} (before it)`;
  writeFileSync(out!, JSON.stringify({
    title: `Mentors' deposits and funding activities — ${period}`,
    notes: [`Looked up ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC from ${config.mongoDb}`, "Dated by when each request was raised (Dubai). Approved amounts only in the summary's USD totals.", "Mentors: Chief, Senior, Junior and Sub-junior Mentors and Assistance."],
    sheets: [
      { name: "Summary", columns: ["Mentor", "Role", "Account", "Deposits", "Deposits approved (USD)", "Withdrawals", "Withdrawals approved (USD)", "Bonuses", "Bonuses approved (USD)", "Approved", "Pending", "Rejected", "Own commission (USD)", "Pool shares (USD)", "Commission total (USD)"], rows: summaryRows },
      { name: "Requests", columns: ["Date", "Mentor", "Role", "Student", "Code", "Type", "Status", "Amount USD", "Amount AED", "Amount INR", "Course", "Full / Partial", "MT5", "Transaction ID", "Commission earned (all levels, USD)", "Raised by (another)", "Rejection reason"], rows: reqRows },
      { name: "Commission", columns: ["Date", "Mentor", "Role", "Student", "Type", "Method", "Level", "Own / pool", "Amount (USD)", "Commission (USD)", "Status"], rows: creditRows },
    ],
  }, null, 1));
  console.log(`${period}: ${summaryRows.length} mentors, ${reqRows.length} requests, ${creditRows.length} commission credits → ${out}`);
} finally {
  await closeDb();
}
