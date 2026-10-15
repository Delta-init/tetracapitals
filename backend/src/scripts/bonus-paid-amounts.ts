/**
 * Two things for bonuses Delta finance approved before 2026-10-15 (the user):
 *
 * 1. The payment typed over with the bonus. Finance approves a bonus's payment — what the student paid, in dollars —
 *    and a broker admin then credits its MT5 bonus and approves it here. Until 2026-10-15 the broker admin's box let
 *    them change that payment, and J Vijay's (STU-5000) $1,500 was typed over with the $1,000 bonus. Now it can't be
 *    changed (finance/funding.ts financeLock). This puts back each such payment to what finance approved: a bonus
 *    finance approved at the amount asked (no `requested_amount_usd`), that amount being the one the audit line
 *    written as finance approved it kept (logs, accounts_approve_bonus). Not its AED at 3.67 — a payment typed in
 *    dollars may carry another AED (STU-2991: $500 with AED 2,000). One with no such line is left alone and listed.
 *    Commission is not touched: it was worked out from the course payment's AED, never this.
 *
 * 2. --list-bangalore: the Bangalore teams' bonuses that went to finance's Delta HQ, before they went to Bangalore
 *    (2026-10-15) — their ids, for finance's move-bangalore-bonuses.ts --ids. Reads only.
 *
 * Reads and prints only, unless --write; before writing it saves an undo file. MONGO_URI / MONGO_DB (this folder's
 * .env, as the API) unless --uri / --db say otherwise:
 *
 *   bun src/scripts/bonus-paid-amounts.ts                    # the payments it would put back
 *   bun src/scripts/bonus-paid-amounts.ts --write            # put them back
 *   bun src/scripts/bonus-paid-amounts.ts --undo backups/bonus-paid-amounts/undo-<time>.json
 *   bun src/scripts/bonus-paid-amounts.ts --list-bangalore   # ids for finance's move
 */
import fs from "node:fs";
import path from "node:path";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { currentLocationOf, locationOf } from "../lib/location";

const cents = (n: number) => Math.round(n * 100) / 100;

export interface PaidFix { id: string; student: string; code: string; status: string; amountUsd: number; paidUsd: number; bonusUsd: number }

/** What finance approved, in dollars, as the audit line written then kept it — null when there is none. */
function financeApprovedUsd(log: any): number | null {
  try {
    const usd = Number(JSON.parse(String(log?.new_value ?? "{}"))?.amount_usd);
    return Number.isFinite(usd) && usd > 0 ? cents(usd) : null;
  } catch { return null; }
}

/**
 * Bonuses finance approved at the amount asked whose dollars are no longer what it approved (`fixes`), and those
 * with no record of what it approved (`noRecord`, left alone).
 */
export async function planPaidFixes(db: Db): Promise<{ fixes: PaidFix[]; noRecord: PaidFix[] }> {
  const rows = (await db.collection("funding_transactions").find({
    type: "BONUS", "finance_approval.decision": "approved", requested_amount_usd: { $in: [null] },
  }).toArray()) as any[];
  const logs = (await db.collection("logs").find(
    { action_type: "accounts_approve_bonus", entity_id: { $in: rows.map((t) => String(t._id)) } },
    { projection: { entity_id: 1, new_value: 1 } },
  ).toArray()) as any[];
  const approvedOf = new Map(logs.map((l) => [String(l.entity_id), financeApprovedUsd(l)]));
  const fixes: PaidFix[] = [], noRecord: PaidFix[] = [];
  for (const t of rows) {
    const approved = approvedOf.get(String(t._id)) ?? null;
    const base = {
      id: String(t._id), student: String(t.student_name ?? ""), code: String(t.student_code ?? ""), status: String(t.status),
      amountUsd: Number(t.amount_usd) || 0, bonusUsd: Number(t.course_payment?.bonus_usd) || 0,
    };
    if (approved === null) { noRecord.push({ ...base, paidUsd: base.amountUsd }); continue; }
    if (Math.abs(base.amountUsd - approved) >= 0.01) fixes.push({ ...base, paidUsd: approved });
  }
  return { fixes, noRecord };
}

export async function applyPaidFixes(db: Db, fixes: PaidFix[]): Promise<number> {
  let n = 0;
  const now = new Date().toISOString();
  for (const f of fixes) {
    // Only while it still reads as planned: a change made since is left alone.
    const res = await db.collection("funding_transactions").updateOne(
      { _id: new ObjectId(f.id), amount_usd: f.amountUsd },
      { $set: { amount_usd: f.paidUsd, updated_date: now, paid_amount_restored: { from: f.amountUsd, at: now } } },
    );
    if (!res.modifiedCount) continue;
    n++;
    await db.collection("logs").insertOne({
      timestamp: now, user_id: null, user_email: null, user_name: "bonus-paid-amounts script", user_role: "system",
      action_type: "restore_bonus_paid_amount", entity_type: "FundingTransaction", entity_id: f.id,
      details: JSON.stringify({ message: `Payment put back to $${f.paidUsd} (the amount Delta Finance approved) — it had been changed to $${f.amountUsd}` }),
      old_value: JSON.stringify({ amount_usd: f.amountUsd }), new_value: JSON.stringify({ amount_usd: f.paidUsd }), ip_address: null, success: true, created_date: now,
    } as any);
  }
  return n;
}

export async function undoPaidFixes(db: Db, fixes: PaidFix[]): Promise<number> {
  let n = 0;
  for (const f of fixes) {
    const res = await db.collection("funding_transactions").updateOne(
      { _id: new ObjectId(f.id), amount_usd: f.paidUsd },
      { $set: { amount_usd: f.amountUsd }, $unset: { paid_amount_restored: "" } },
    );
    n += res.modifiedCount;
  }
  return n;
}

/** Bangalore teams' bonuses finance has in Delta HQ: sent before they went to Bangalore. */
export async function bangaloreBonusesInHq(db: Db): Promise<{ id: string; student: string; code: string; status: string }[]> {
  const rows = (await db.collection("funding_transactions").find({
    type: "BONUS", "finance_approval.state": { $in: ["sent", "decided"] }, "finance_approval.org": { $ne: "bangalore" },
  }, { projection: { student_id: 1, student_name: 1, student_code: 1, status: 1 } }).toArray()) as any[];
  const ids = [...new Set(rows.map((r) => String(r.student_id ?? "")).filter((s) => ObjectId.isValid(s)))].map((s) => new ObjectId(s));
  const students = (await db.collection("students").find({ _id: { $in: ids } }, { projection: { team_id: 1, location: 1 } }).toArray()) as any[];
  const leaderIds = [...new Set(students.map((s) => String(s.team_id ?? "")).filter((s) => ObjectId.isValid(s)))].map((s) => new ObjectId(s));
  const leaders = new Map(((await db.collection("users").find({ _id: { $in: leaderIds } }, { projection: { team_location: 1 } }).toArray()) as any[]).map((u) => [String(u._id), locationOf(u.team_location)]));
  const where = new Map(students.map((s) => [String(s._id), currentLocationOf(s, (id) => leaders.get(id))]));
  return rows.filter((r) => where.get(String(r.student_id ?? "")) === "bangalore")
    .map((r) => ({ id: String(r._id), student: String(r.student_name ?? ""), code: String(r.student_code ?? ""), status: String(r.status) }));
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.main) {
  const write = process.argv.includes("--write");
  const undoPath = arg("--undo");
  const uri = arg("--uri") ?? process.env.MONGO_URI ?? "";
  const dbName = arg("--db") ?? process.env.MONGO_DB ?? "";
  if (!uri || !dbName) { console.error("No database: set MONGO_URI and MONGO_DB, or pass --uri and --db"); process.exit(1); }
  const hasCreds = /^mongodb(\+srv)?:\/\/[^/@]+@/.test(uri);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000, ...(hasCreds ? { authSource: "admin" } : {}) });
  await client.connect();
  try {
    const db = client.db(dbName);
    const host = uri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
    console.log(`Database "${dbName}" on ${host}${write || undoPath ? "" : "  — dry run, read only"}\n`);
    if (process.argv.includes("--list-bangalore")) {
      const list = await bangaloreBonusesInHq(db);
      for (const r of list) console.log(`  ${r.code.padEnd(10)} ${r.student.slice(0, 28).padEnd(28)} ${r.status.padEnd(9)} ${r.id}`);
      console.log(`\n${list.length} Bangalore team bonus(es) finance has in Delta HQ. For finance's move-bangalore-bonuses.ts:\n  --ids ${list.map((r) => r.id).join(",")}`);
    } else if (undoPath) {
      const undo = JSON.parse(fs.readFileSync(undoPath, "utf8"));
      if (undo.kind !== "tc-bonus-paid-amounts") throw new Error("Not a bonus-paid-amounts undo file");
      console.log(`Undone: ${await undoPaidFixes(db, undo.fixes)} payment(s) put back as they were.`);
    } else {
      const { fixes, noRecord } = await planPaidFixes(db);
      for (const f of fixes) {
        console.log(`  ${f.code.padEnd(10)} ${f.student.slice(0, 28).padEnd(28)} ${f.status.padEnd(9)} $${f.amountUsd.toLocaleString("en-US")} → $${f.paidUsd.toLocaleString("en-US")} paid${f.bonusUsd ? ` (its MT5 bonus is $${f.bonusUsd.toLocaleString("en-US")})` : ""}`);
      }
      console.log(`\n${fixes.length} bonus payment(s) ${write ? "to put back" : "would be put back"} to what finance approved`);
      if (noRecord.length) console.log(`${noRecord.length} finance-approved bonus(es) with no record of the amount it approved — left alone: ${noRecord.map((f) => f.code || f.id).join(", ")}`);
      if (write && fixes.length) {
        const outDir = path.resolve(arg("--out") ?? "backups/bonus-paid-amounts");
        fs.mkdirSync(outDir, { recursive: true });
        const undoFile = path.join(outDir, `undo-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
        fs.writeFileSync(undoFile, JSON.stringify({ kind: "tc-bonus-paid-amounts", at: new Date().toISOString(), fixes }, null, 2));
        console.log(`Undo file: ${undoFile}`);
        console.log(`Done: ${await applyPaidFixes(db, fixes)} put back.`);
      } else if (!write) console.log("Nothing written. Run again with --write to do it.");
    }
  } finally {
    await client.close();
  }
}
