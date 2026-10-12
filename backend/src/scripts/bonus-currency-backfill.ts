/**
 * A sales CRM's bonus with no currency is a US-dollar bonus (the user, 2026-10-12).
 *
 * Closes queued in a sales CRM before it sent the bonus as USD reached finance
 * with no currency, and finance passed the bonus on here in the INVOICE's
 * currency: a student's course fees say "AED 500" for what was $500 (or, from
 * before finance said any currency, nothing — read as the fee's). The amounts
 * were always meant as US dollars; nothing is converted, only the label is set.
 *
 * From the list finance's own script writes (finance apps/api/src/scripts/
 * bonus-currency-backfill.ts → backups/bonus-currency/crm-usd-bonus-invoices-*.json:
 * every sales-CRM invoice whose bonus is USD):
 *
 *   - students.course_fees[] of those invoices, bonus given, not labelled USD
 *     → bonus_currency "USD";
 *   - an invoice the list gives a corrected amount (finance's --amount: a close whose
 *     salesperson typed the AED equivalent — IN-00098's 1,836.50 was $500, the user,
 *     2026-10-12) → its course fee's bonus_minor, and its pending credit, take that amount;
 *   - the sales-close bonus credit already raised for one of them
 *     (funding_transactions, bonus_credit "sales_close") in the old currency:
 *     PENDING → relabelled USD, amount_usd = the amount promised (it was that
 *     amount ÷ 3.67), amount_aed and the note to match; one already decided
 *     (APPROVED / REJECTED) is listed, never changed — a broker admin credited
 *     or refused the converted amount, and what to do about it is a person's call.
 *
 * Reads and prints only, unless --write. Before writing it saves an undo file.
 * Safe to run again: what is already USD is left alone. Uses MONGO_URI /
 * MONGO_DB (this folder's .env, as the API) unless --uri / --db say otherwise:
 *
 *   cd backend
 *   bun src/scripts/bonus-currency-backfill.ts --invoices <finance list .json>            # what it would do
 *   bun src/scripts/bonus-currency-backfill.ts --invoices <finance list .json> --write    # do it
 *   bun src/scripts/bonus-currency-backfill.ts --undo backups/bonus-currency/undo-<time>.json
 *
 *   --out <dir>   where the undo file goes (default ./backups/bonus-currency)
 */
import fs from "node:fs";
import path from "node:path";
import { MongoClient, ObjectId, type Collection, type Db } from "mongodb";

export const CRM_BONUS_CURRENCY = "USD";
/** As functions/studentFollowups.ts raises a sales-close credit. */
const AED_PER_USD = 3.67;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** A collection that can only be read — what a dry run is given, so it cannot write by mistake. */
export function readOnly(c: Collection): Collection {
  const allowed = new Set(["find", "findOne", "countDocuments", "collectionName"]);
  return new Proxy(c, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && !allowed.has(prop)) throw new Error(`Dry run: ${prop} is not allowed on ${target.collectionName}`);
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

type Cols = { students: Collection; funding: Collection };

export interface FeeTarget {
  studentId: string; studentCode: string; invoiceId: string; invoiceNumber: string; amount: number; feeCurrency: string; before?: string;
  /** Corrected (finance's --amount): the minor units it had, and the ones it gets. */
  minorBefore?: number; newMinor?: number;
}
export interface CreditTarget {
  _id: string; studentCode: string; invoiceId: string; invoiceNumber: string; status: string; amount: number;
  /** The promised amount it is corrected to (finance's --amount), in dollars. */
  newAmount?: number;
  before: { amount_currency?: string; amount_original?: number; amount_usd?: number; amount_aed?: number; notes?: string; updated_date?: string };
}
export interface Plan { fees: FeeTarget[]; credits: CreditTarget[]; decided: CreditTarget[] }

/** The money as the credit's note says it: "$500", or "AED 500". */
const moneyText = (currency: string, amount: number) => (currency === "USD" ? `$${amount.toLocaleString("en-US")}` : `${currency} ${amount.toLocaleString("en-US")}`);

export async function planBonusCurrency(cols: Cols, invoiceIds: string[], amounts: Record<string, number> = {}): Promise<Plan> {
  const ids = [...new Set(invoiceIds.map(String).filter(Boolean))];
  const fixOf = (inv: string) => (Number(amounts[inv]) > 0 ? Math.round(Number(amounts[inv])) : undefined);
  if (!ids.length) return { fees: [], credits: [], decided: [] };
  const students = await cols.students
    .find({ course_fees: { $elemMatch: { invoice_id: { $in: ids }, bonus_given: true } } }, { projection: { student_code: 1, course_fees: 1 } })
    .sort({ _id: 1 })
    .toArray();
  const wanted = new Set(ids);
  const fees: FeeTarget[] = [];
  for (const s of students) {
    for (const f of (s.course_fees ?? []) as any[]) {
      if (!f || !wanted.has(String(f.invoice_id)) || f.bonus_given !== true || !(Number(f.bonus_minor) > 0)) continue;
      const own = String(f.bonus_currency ?? "").trim().toUpperCase();
      const fix = fixOf(String(f.invoice_id));
      const wrongAmount = fix !== undefined && Math.round(Number(f.bonus_minor)) !== fix;
      if (own === CRM_BONUS_CURRENCY && !wrongAmount) continue;
      fees.push({
        studentId: String(s._id), studentCode: String(s.student_code ?? ""), invoiceId: String(f.invoice_id), invoiceNumber: String(f.invoice_number ?? ""),
        amount: (wrongAmount ? fix! : Math.round(Number(f.bonus_minor))) / 100, feeCurrency: String(f.currency ?? ""), ...(f.bonus_currency !== undefined ? { before: f.bonus_currency } : {}),
        ...(wrongAmount ? { minorBefore: Math.round(Number(f.bonus_minor)), newMinor: fix } : {}),
      });
    }
  }
  const txs = await cols.funding
    .find({ bonus_credit: "sales_close", "sales_close.invoice_id": { $in: ids } })
    .sort({ _id: 1 })
    .toArray();
  const credits: CreditTarget[] = [];
  const decided: CreditTarget[] = [];
  for (const t of txs as any[]) {
    const fix = fixOf(String(t.sales_close?.invoice_id ?? ""));
    const newAmount = fix !== undefined && Math.round((Number(t.amount_original) || 0) * 100) !== fix ? fix / 100 : undefined;
    if (t.amount_currency === CRM_BONUS_CURRENCY && newAmount === undefined) continue;
    const row: CreditTarget = {
      _id: String(t._id), studentCode: String(t.student_code ?? ""), invoiceId: String(t.sales_close?.invoice_id ?? ""), invoiceNumber: String(t.sales_close?.invoice_number ?? ""),
      status: String(t.status ?? ""), amount: Number(t.amount_original) || 0, ...(newAmount !== undefined ? { newAmount } : {}),
      before: { amount_currency: t.amount_currency, amount_original: t.amount_original, amount_usd: t.amount_usd, amount_aed: t.amount_aed, notes: t.notes, updated_date: t.updated_date },
    };
    (row.status === "PENDING" ? credits : decided).push(row);
  }
  return { fees, credits, decided };
}

export async function applyBonusCurrency(cols: Cols, plan: Plan, now = new Date().toISOString()): Promise<{ fees: number; credits: number }> {
  let fees = 0, credits = 0;
  for (const f of plan.fees) {
    const res = await cols.students.updateOne(
      { _id: new ObjectId(f.studentId) },
      { $set: { "course_fees.$[f].bonus_currency": CRM_BONUS_CURRENCY, ...(f.newMinor !== undefined ? { "course_fees.$[f].bonus_minor": f.newMinor } : {}) } },
      { arrayFilters: [{ "f.invoice_id": f.invoiceId, "f.bonus_given": true,
        ...(f.newMinor !== undefined ? { "f.bonus_minor": f.minorBefore } : { "f.bonus_currency": { $ne: CRM_BONUS_CURRENCY } }) }] },
    );
    fees += res.modifiedCount;
  }
  for (const c of plan.credits) {
    const was = String(c.before.amount_currency ?? "");
    const amount = c.newAmount ?? c.amount;
    const notes = typeof c.before.notes === "string" ? c.before.notes.replace(moneyText(was, c.amount), moneyText(CRM_BONUS_CURRENCY, amount)) : c.before.notes;
    // Only while it still waits, in the currency it had.
    const res = await cols.funding.updateOne(
      { _id: new ObjectId(c._id), status: "PENDING", bonus_credit: "sales_close", amount_currency: c.before.amount_currency ?? null },
      {
        $set: {
          amount_currency: CRM_BONUS_CURRENCY, amount_original: amount, amount_usd: amount, amount_aed: round2(amount * AED_PER_USD),
          ...(notes !== undefined ? { notes } : {}), updated_date: now,
        },
      },
    );
    credits += res.modifiedCount;
  }
  return { fees, credits };
}

export interface UndoFile { kind: "tc-bonus-currency"; at: string; fees: FeeTarget[]; credits: CreditTarget[] }

export async function undoBonusCurrency(cols: Cols, undo: UndoFile): Promise<{ fees: number; credits: number }> {
  if (undo.kind !== "tc-bonus-currency") throw new Error("Not a Tetra Commission bonus-currency undo file");
  let fees = 0, credits = 0;
  for (const f of undo.fees) {
    const set: Record<string, unknown> = {
      ...(f.before !== undefined ? { "course_fees.$[f].bonus_currency": f.before } : {}),
      ...(f.minorBefore !== undefined ? { "course_fees.$[f].bonus_minor": f.minorBefore } : {}),
    };
    const res = await cols.students.updateOne(
      { _id: new ObjectId(f.studentId) },
      { ...(f.before === undefined ? { $unset: { "course_fees.$[f].bonus_currency": "" } } : {}), ...(Object.keys(set).length ? { $set: set } : {}) },
      { arrayFilters: [{ "f.invoice_id": f.invoiceId, "f.bonus_currency": CRM_BONUS_CURRENCY }] },
    );
    fees += res.modifiedCount;
  }
  for (const c of undo.credits) {
    const set: Record<string, unknown> = {};
    const unset: Record<string, ""> = {};
    for (const k of ["amount_currency", "amount_original", "amount_usd", "amount_aed", "notes", "updated_date"] as const) {
      if (k === "amount_original" && !("amount_original" in c.before)) continue; // an undo file from before it was kept
      if (c.before[k] === undefined) unset[k] = ""; else set[k] = c.before[k];
    }
    // Only one still waiting: a decision made since is not undone.
    const res = await cols.funding.updateOne(
      { _id: new ObjectId(c._id), status: "PENDING", amount_currency: CRM_BONUS_CURRENCY },
      { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    );
    credits += res.modifiedCount;
  }
  return { fees, credits };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.main) {
  const write = process.argv.includes("--write");
  const undoPath = arg("--undo");
  const listPath = arg("--invoices");
  const outDir = path.resolve(arg("--out") ?? "backups/bonus-currency");
  const uri = arg("--uri") ?? process.env.MONGO_URI ?? "";
  const dbName = arg("--db") ?? process.env.MONGO_DB ?? "";
  if (!uri || !dbName) { console.error("No database: set MONGO_URI and MONGO_DB, or pass --uri and --db"); process.exit(1); }
  if (!undoPath && !listPath) { console.error("Pass --invoices <the list finance's bonus-currency-backfill wrote>"); process.exit(1); }
  const hasCreds = /^mongodb(\+srv)?:\/\/[^/@]+@/.test(uri);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000, ...(hasCreds ? { authSource: "admin" } : {}) });
  await client.connect();
  try {
    const db: Db = client.db(dbName);
    const raw: Cols = { students: db.collection("students"), funding: db.collection("funding_transactions") };
    const mutating = write || Boolean(undoPath);
    const cols: Cols = mutating ? raw : { students: readOnly(raw.students), funding: readOnly(raw.funding) };
    const host = uri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
    console.log(`Database "${dbName}" on ${host}${mutating ? "" : "  — dry run, read only"}\n`);
    if (undoPath) {
      const done = await undoBonusCurrency(cols, JSON.parse(fs.readFileSync(undoPath, "utf8")));
      console.log(`Undone: ${done.fees} course fee bonus label(s), ${done.credits} pending sales-close credit(s) put back.`);
    } else {
      const list = JSON.parse(fs.readFileSync(listPath!, "utf8"));
      const invoiceIds: string[] = (list.invoices ?? []).map((i: any) => String(i.invoiceId ?? ""));
      const amounts: Record<string, number> = Object.fromEntries((list.invoices ?? []).filter((i: any) => Number(i.amountMinor) > 0).map((i: any) => [String(i.invoiceId), Number(i.amountMinor)]));
      console.log(`${invoiceIds.length} sales-CRM invoice(s) with a USD bonus in finance's list${Object.keys(amounts).length ? `, ${Object.keys(amounts).length} with a corrected amount` : ""}\n`);
      const plan = await planBonusCurrency(cols, invoiceIds, amounts);
      console.log("Course fees (students.course_fees):");
      console.log(`  ${"Student".padEnd(10)} ${"Invoice".padEnd(12)} ${"Bonus".padEnd(10)} labelled`);
      for (const f of plan.fees) console.log(`  ${f.studentCode.padEnd(10)} ${f.invoiceNumber.padEnd(12)} ${moneyText("USD", f.amount).padEnd(10)} ${f.before ?? `— (read as the fee's ${f.feeCurrency})`} → USD${f.newMinor !== undefined ? `, amount corrected from ${(f.minorBefore! / 100).toLocaleString("en-US")}` : ""}`);
      console.log(`\nSales-close bonus credits (funding_transactions) raised in the old currency:`);
      for (const c of [...plan.credits, ...plan.decided]) {
        console.log(`  ${c.studentCode.padEnd(10)} ${c.invoiceNumber.padEnd(12)} ${c.status.padEnd(9)} promised ${moneyText("USD", c.newAmount ?? c.amount)}, raised as ${moneyText(String(c.before.amount_currency ?? "?"), c.amount)} = $${c.before.amount_usd}${c.status === "PENDING" ? (write ? "  → relabelled USD" : "  → would be relabelled USD") : "  — decided, left alone"}`);
      }
      console.log(`\n${plan.fees.length} course fee bonus(es) ${write ? "to label" : "would be labelled"} USD`);
      console.log(`${plan.credits.length} pending sales-close credit(s) ${write ? "to correct" : "would be corrected"} to the promised USD amount`);
      console.log(`${plan.decided.length} decided sales-close credit(s) in the old currency — left alone, for a person to look at`);
      if (write) {
        if (plan.fees.length || plan.credits.length) {
          fs.mkdirSync(outDir, { recursive: true });
          const undoFile = path.join(outDir, `undo-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
          const undo: UndoFile = { kind: "tc-bonus-currency", at: new Date().toISOString(), fees: plan.fees, credits: plan.credits };
          fs.writeFileSync(undoFile, JSON.stringify(undo, null, 2));
          console.log(`Undo file: ${undoFile}`);
          const done = await applyBonusCurrency(cols, plan);
          console.log(`Done: ${done.fees} course fee bonus(es) labelled USD, ${done.credits} pending credit(s) corrected.`);
        } else console.log("Nothing to change.");
      } else console.log("Nothing written. Run again with --write to do it.");
    }
  } finally {
    await client.close();
  }
}
