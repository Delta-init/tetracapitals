import { writeFileSync } from "node:fs";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";
import { productKey, lmsTargetsOfProducts } from "../courses/lmsMapping";

/**
 * Class completions and course payments — what to look at (the user, 2026-10-23: "sometimes it's not showing
 * correctly … check that the funding activities are correct for the course they got"). Read only.
 *
 * Class completions:
 *   - LMS classes whose student wasn't found here (by LMS id or email) in the last 30 days — and whether one is here now
 *     (they are matched again for 7 days by themselves now; older ones are listed to look at);
 *   - completions waiting for a call that are older than 60 days, or of a "not a student" (the sidebar counted the
 *     first, the page showed the second, before 2026-10-23);
 *   - completions cleared by a 3CX call nobody answered;
 *   - students on two records (the same email) with a completion waiting.
 * Course payments (Bonus requests with a course):
 *   - approved for another amount than the CS's, the course figures still the CS's (fixed for new approvals);
 *   - "Full" payments short of the price — they opened the whole course;
 *   - the same course paid in full twice — two MT5 bonuses, two commissions;
 *   - a course paid that opens no LMS course, or whose LMS course wasn't found / failed for the student;
 *   - approved payments with nothing opened in the LMS for them yet;
 *   - commission credited twice for one transaction, or credited for a request no longer approved.
 *
 *   cd backend
 *   bun src/scripts/class-and-course-audit.ts                 the lists
 *   bun src/scripts/class-and-course-audit.ts --json=a.json   also saved (outside the repo, please)
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env). Writes nothing there.
 */

const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const day = (v: unknown) => (v ? String(v).slice(0, 10) : "");
const aed = (n: unknown) => `AED ${(Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SHOW = 25;

await connectDb();
console.log(`${host}/${config.mongoDb} — read only\n`);
const report: Record<string, unknown[]> = {};
const section = (title: string, rows: any[], line: (r: any) => string) => {
  report[title] = rows;
  console.log(`■ ${title}: ${rows.length}`);
  for (const r of rows.slice(0, SHOW)) console.log(`   ${line(r)}`);
  if (rows.length > SHOW) console.log(`   … and ${rows.length - SHOW} more${option("json") ? " (in the file)" : " — add --json=<file> for all"}`);
  console.log("");
};

try {
  const now = Date.now();
  const since30 = new Date(now - 30 * 86_400_000).toISOString();
  const since60 = new Date(now - 60 * 86_400_000).toISOString();

  /* ── Class completions ── */
  const unmatched = (await col("lms_activity").find({ type: "class_attended", outcome: "not_a_student", at: { $gte: since30 } } as any).sort({ at: -1 }).toArray()) as any[];
  const unmatchedRows: any[] = [];
  for (const u of unmatched) {
    const email = String(u.lms_student?.email ?? "").trim().toLowerCase();
    const here: any = email.includes("@")
      ? await col("students").findOne({ $or: [{ lms_user_id: String(u.lms_student?.lmsUserId ?? "") }, { email: { $regex: `(^|[\\s,;<>/])${esc(email)}($|[\\s,;<>/])`, $options: "i" } }] }, { projection: { full_name: 1, student_code: 1 } })
      : null;
    unmatchedRows.push({ at: u.at, email, name: u.lms_student?.name, class: u.class?.title, here: here ? `${here.full_name} ${here.student_code ?? ""}`.trim() : "" });
  }
  section("LMS classes attended by someone not found here (30 days)", unmatchedRows,
    (r) => `${day(r.at)}  ${r.email}  ${r.name ?? ""} — ${r.class ?? ""}${r.here ? `  → here now: ${r.here} (matched again by itself within 7 days)` : "  → not here"}`);

  const stale = (await col("class_completions").find({ notified_at: { $exists: true }, called_at: { $exists: false }, ended_at: { $lt: since60 } } as any).toArray()) as any[];
  section("Completions waiting for a call, older than 60 days (counted in the sidebar before, never on the page)", stale,
    (r) => `${day(r.ended_at)}  ${r.student_name} ${r.student_code ?? ""} — ${r.class?.title ?? ""}`);

  const notStudents = new Set(((await col("students").find({ not_student: true }, { projection: { _id: 1 } }).toArray()) as any[]).map((s) => String(s._id)));
  const unflagged = (await col("class_completions").find({ student_id: { $in: [...notStudents] }, student_not_student: { $ne: true } } as any).toArray()) as any[];
  section("Completions of a 'not a student' without the mark (shown on the page before)", unflagged,
    (r) => `${day(r.ended_at)}  ${r.student_name} ${r.student_code ?? ""}`);

  const by3cx = (await col("class_completions").find({ called_via: "3CX call" } as any).toArray()) as any[];
  const unanswered: any[] = [];
  for (const c of by3cx) {
    const call: any = await col("student_calls").findOne({ student_id: c.student_id, started_at: c.called_at } as any, { projection: { answered: 1, direction: 1, user_name: 1 } });
    if (call && call.answered === false) unanswered.push({ ...c, direction: call.direction });
  }
  section("Completions cleared by a 3CX call nobody answered", unanswered,
    (r) => `${day(r.ended_at)}  ${r.student_name} ${r.student_code ?? ""} — ${r.direction === "in" ? "a missed incoming call" : "no answer"} at ${String(r.called_at).slice(0, 16)} by ${r.called_by || "?"}`);

  const waiting = (await col("class_completions").distinct("student_id", { called_at: { $exists: false } } as any)) as string[];
  const dupGroups = (await col("students").aggregate([
    { $match: { email: { $type: "string", $ne: "" } } },
    { $group: { _id: { $toLower: { $trim: { input: "$email" } } }, n: { $sum: 1 }, ids: { $push: { $toString: "$_id" } }, names: { $push: "$full_name" } } },
    { $match: { n: { $gt: 1 } } },
  ]).toArray()) as any[];
  const waitingSet = new Set(waiting);
  section("Same email on two student records, with a completion waiting (a call on the other record now clears it)", dupGroups.filter((g) => g.ids.some((id: string) => waitingSet.has(id))),
    (g) => `${g._id}: ${g.names.join(" / ")}`);

  /* ── Course payments ── */
  const paid = (await col("funding_transactions").find(
    { type: "BONUS", "course_payment.product": { $exists: true }, bonus_credit: { $in: [null, ""] } },
    { projection: { student_id: 1, student_name: 1, student_code: 1, status: 1, amount_usd: 1, amount_aed: 1, requested_amount_usd: 1, course_payment: 1, tags: 1, requested_at: 1, created_date: 1 } },
  ).toArray()) as any[];
  const standing = paid.filter((t) => !["REJECTED", "CANCELLED"].includes(t.status));
  const who = (t: any) => `${t.student_name ?? "?"} ${t.student_code ?? ""}`.trim();

  const changed = paid.filter((t) => t.status === "APPROVED" && t.requested_amount_usd != null && !t.course_payment?.requested_paid_today_aed
    && Math.abs((Number(t.amount_usd) || 0) * 3.67 - (Number(t.course_payment?.paid_today_aed) || 0)) > 2);
  section("Approved for another amount, the course figures still the CS's (commission and the LMS share went by the CS's)", changed,
    (t) => `${day(t.requested_at ?? t.created_date)}  ${who(t)} — ${t.course_payment.product}: finance $${t.amount_usd} (${aed(Number(t.amount_usd) * 3.67)}), the CS's ${aed(t.course_payment.paid_today_aed)}`);

  const shortFull = standing.filter((t) => t.course_payment?.kind === "full" && Number(t.course_payment?.short_aed) > 1);
  section("'Full' payments short of the price (they opened the whole course and the whole bonus)", shortFull,
    (t) => `${day(t.requested_at ?? t.created_date)}  ${who(t)} — ${t.course_payment.product}: ${aed(t.course_payment.paid_today_aed)}, ${aed(t.course_payment.short_aed)} short · ${t.status}`);

  const fullBy = new Map<string, any[]>();
  for (const t of standing) {
    if (t.course_payment?.kind !== "full" || Number(t.course_payment?.short_aed) > 1) continue;
    const k = `${t.student_id}|${productKey(t.course_payment.product)}`;
    fullBy.set(k, [...(fullBy.get(k) ?? []), t]);
  }
  const twice = [...fullBy.values()].filter((g) => g.length > 1);
  section("The same course paid in full twice (or more)", twice,
    (g) => `${who(g[0])} — ${g[0].course_payment.product}: ${g.map((t: any) => `${day(t.requested_at ?? t.created_date)} ${t.status} MT5 $${t.course_payment.bonus_usd ?? 0}`).join("; ")}`);

  const approved = paid.filter((t) => t.status === "APPROVED");
  const pairs = new Map<string, { t: any; products: string[] }>();
  for (const t of approved) {
    const k = `${t.student_id}|${productKey(t.course_payment.product)}`;
    const have = pairs.get(k) ?? { t, products: [] };
    have.products.push(t.course_payment.product, ...(Array.isArray(t.tags) ? t.tags : []));
    pairs.set(k, have);
  }
  const unmappedRows = [...pairs.values()].filter((p) => !lmsTargetsOfProducts(p.products).length);
  section("Courses paid that open no LMS course (no mapping for the product's name)", unmappedRows,
    (p) => `${who(p.t)} — ${p.t.course_payment.product}`);

  const ids = [...new Set(approved.map((t) => String(t.student_id)))];
  const states = new Map<string, any>(((await col("students").find({ $expr: { $in: [{ $toString: "$_id" }, ids] } }, { projection: { course_lms_sync: 1 } }).toArray()) as any[]).map((s) => [String(s._id), s.course_lms_sync ?? {}]));
  const notOpened: any[] = [], failed: any[] = [];
  for (const p of pairs.values()) {
    if (!lmsTargetsOfProducts(p.products).length) continue;
    const st = states.get(String(p.t.student_id))?.[productKey(p.t.course_payment.product)];
    if (!st) notOpened.push(p);
    else if (st.error || (Array.isArray(st.missing) && st.missing.length)) failed.push({ ...p, st });
  }
  section("Approved course payments with nothing opened in the LMS yet (the worker opens them every 5 minutes after the API deploy)", notOpened,
    (p) => `${who(p.t)} — ${p.t.course_payment.product}`);
  section("Course payments whose LMS course failed or wasn't in the student's academy", failed,
    (p) => `${who(p.t)} — ${p.t.course_payment.product}: ${p.st.error ?? `not found: ${p.st.missing.join(", ")}`}`);
  const msnrOld = [...pairs.values()].filter((p) => productKey(p.t.course_payment.product).startsWith("MSNR"))
    .filter((p) => { const st = states.get(String(p.t.student_id))?.[productKey(p.t.course_payment.product)]; return st && String(st.at ?? "") < "2026-10-18"; });
  section("MSNR paid and opened before 2026-10-18 (opened MMC; the MSNR course opens for them after the API deploy)", msnrOld,
    (p) => `${who(p.t)} — opened ${day(states.get(String(p.t.student_id))?.[productKey(p.t.course_payment.product)]?.at)}`);

  const dupCredits = (await col("commission_credits").aggregate([
    { $match: { transaction_type: "BONUS" } },
    { $group: { _id: { tx: "$transaction_id", level: "$level", to: "$recipient_id", pool: "$is_pool" }, n: { $sum: 1 }, name: { $first: "$recipient_name" }, student: { $first: "$student_name" } } },
    { $match: { n: { $gt: 1 } } },
  ]).toArray()) as any[];
  section("Commission credited twice for one bonus (same transaction, level and person)", dupCredits,
    (g) => `${g.student ?? "?"} — ${g.name ?? g._id.to} level ${g._id.level}: ${g.n} times (transaction ${g._id.tx})`);

  const creditedTx = (await col("commission_credits").distinct("transaction_id", { transaction_type: "BONUS" })) as string[];
  const notApproved = paid.filter((t) => t.status !== "APPROVED" && creditedTx.includes(String(t._id)));
  section("Commission credited for a request no longer approved", notApproved,
    (t) => `${who(t)} — ${t.course_payment.product}: ${t.status}`);

  const file = option("json");
  if (file) { writeFileSync(file, JSON.stringify(report, null, 1)); console.log(`Saved: ${file}`); }
} finally {
  await closeDb();
}
