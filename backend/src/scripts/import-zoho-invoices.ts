/**
 * Zoho Books invoices, Jan 2024 – Jun 2026 (the user, 2026-10-07): the five exports made one file —
 * ~/zoho-invoices/zoho-invoices-2024-2026.json, an invoice each with its lines (made outside the repo: it holds the
 * customers' emails and phones). Kept in `zoho_invoices`, one document per Zoho invoice, and linked to the student
 * they are for — shown on the student's page (Courses & fees) and the Invoices page (functions/zohoInvoices.ts).
 *
 * How an invoice finds its student — by its Zoho customer's contact:
 *   email   the customer's email is one student's (case and spaces ignored)
 *   phone   no student has the email; the last 9 digits of the phone are one student's
 * Anything else stays Not linked, with why — for an admin to link by hand on the Invoices page:
 *   name only                  only the name is a student's (the user: not linked)
 *   email and phone disagree   the email is one student's, the phone another's
 *   several students           the email or phone is on more than one student
 *   no match                   nothing of theirs is in the portal
 *
 *   cd backend
 *   bun src/scripts/import-zoho-invoices.ts --file=<…/zoho-invoices-2024-2026.json>            dry run: the counts
 *   bun src/scripts/import-zoho-invoices.ts --file=<…> --apply                                  does it; an undo file first
 *   bun src/scripts/import-zoho-invoices.ts --undo=<undo file> [--apply]                        puts it back
 *
 * Running it again (or with newer exports) updates each invoice by its Zoho id — never a second copy — and never
 * moves an invoice an admin linked by hand. Writes only `zoho_invoices`. Uses the API's database (MONGO_URI /
 * MONGO_DB, from this folder's .env).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EJSON } from "bson";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const COLL = "zoho_invoices";
const BATCH = "zoho-books-2024-2026";

const email = (v: unknown) => String(v ?? "").trim().toLowerCase();
const phone = (v: unknown) => { const d = String(v ?? "").replace(/\D/g, ""); return d.length >= 8 ? d.slice(-9) : ""; };
const name = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
const money = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;

type Match = { student_id: string | null; match: "email" | "phone" | null; not_linked_why: string };

async function undo(file: string) {
  const saved = EJSON.parse(readFileSync(file, "utf8")) as { inserted: string[]; before: any[] };
  console.log(`Undo ${file} on ${host}/${config.mongoDb}: remove ${saved.inserted.length} added, put back ${saved.before.length} changed`);
  if (!apply) return console.log("Dry run — add --apply to do it.");
  if (saved.inserted.length) await col(COLL).deleteMany({ zoho_invoice_id: { $in: saved.inserted } });
  for (const doc of saved.before) await col(COLL).replaceOne({ _id: doc._id }, doc);
  console.log("Done.");
}

async function run(file: string) {
  const rows: any[] = JSON.parse(readFileSync(file, "utf8"));
  const students = (await col("students").find({}, { projection: { full_name: 1, email: 1, phone: 1 } }).toArray()) as any[];
  const index = (key: (s: any) => string) => {
    const m = new Map<string, string[]>();
    for (const s of students) { const k = key(s); if (k) m.set(k, [...(m.get(k) ?? []), String(s._id)]); }
    return m;
  };
  const byEmail = index((s) => email(s.email)), byPhone = index((s) => phone(s.phone)), byName = index((s) => name(s.full_name));
  const matchOf = (c: any): Match => {
    const e = byEmail.get(email(c.email)) ?? [];
    const p = byPhone.get(phone(c.phone)) ?? [];
    if (e.length > 1 || (!e.length && p.length > 1)) return { student_id: null, match: null, not_linked_why: "several students" };
    if (e.length === 1) {
      if (p.length === 1 && p[0] !== e[0]) return { student_id: null, match: null, not_linked_why: "email and phone disagree" };
      return { student_id: e[0], match: "email", not_linked_why: "" };
    }
    if (p.length === 1) return { student_id: p[0], match: "phone", not_linked_why: "" };
    if ((byName.get(name(c.name)) ?? []).length) return { student_id: null, match: null, not_linked_why: "name only" };
    return { student_id: null, match: null, not_linked_why: "no match" };
  };

  const existing = new Map(((await col(COLL).find({}).toArray()) as any[]).map((d) => [d.zoho_invoice_id, d]));
  const tally: Record<string, number> = {};
  const add = (k: string) => (tally[k] = (tally[k] ?? 0) + 1);
  const linkedStudents = new Set<string>();
  const inserts: any[] = [], updates: { before: any; set: any }[] = [];
  for (const r of rows) {
    const id = String(r.zoho_invoice_id ?? "").trim();
    if (!id) { add("skipped — no Zoho id"); continue; }
    const before = existing.get(id);
    const doc = {
      zoho_invoice_id: id,
      number: String(r.number ?? ""),
      date: String(r.date ?? "").slice(0, 10),
      status: String(r.status ?? ""),
      currency: String(r.currency || "AED").toUpperCase(),
      total: money(r.total),
      balance: money(r.balance),
      paid: money(money(r.total) - money(r.balance)),
      sales_person: String(r.sales_person ?? ""),
      customer: { zoho_id: String(r.customer?.zoho_id ?? ""), name: String(r.customer?.name ?? ""), email: String(r.customer?.email ?? ""), phone: String(r.customer?.phone ?? "") },
      items: (Array.isArray(r.items) ? r.items : []).map((i: any) => ({ name: String(i.name ?? ""), quantity: Number(i.quantity) || 0, price: money(i.price), total: money(i.total) })),
      source: { batch: BATCH, file: String(r.file ?? "") },
    };
    // An admin's link stays; otherwise the contact decides.
    const m: Match = before?.match === "manual"
      ? { student_id: before.student_id ?? null, match: "manual" as any, not_linked_why: before.not_linked_why ?? "" }
      : matchOf(doc.customer);
    add(m.student_id ? `linked by ${m.match}` : `not linked — ${m.not_linked_why}`);
    if (m.student_id) linkedStudents.add(m.student_id);
    const full = { ...doc, ...m };
    if (!before) inserts.push({ ...full, imported_at: now, updated_at: now });
    else {
      const changed = Object.entries(full).some(([k, v]) => JSON.stringify(before[k]) !== JSON.stringify(v));
      if (changed) updates.push({ before, set: { ...full, updated_at: now } });
      else add("(unchanged)");
    }
  }

  console.log(`Zoho invoices → ${host}/${config.mongoDb}.${COLL}: ${rows.length} in the file, ${students.length} students in the portal`);
  console.table(Object.entries(tally).sort().map(([what, invoices]) => ({ what, invoices })));
  console.log(`Students with invoices: ${linkedStudents.size} | to add: ${inserts.length} | to update: ${updates.length}`);
  if (!apply) return console.log("Dry run — add --apply to do it.");

  const undoFile = join(homedir(), `zoho-invoices-undo-${now.replace(/[:.]/g, "-")}.json`);
  writeFileSync(undoFile, EJSON.stringify({ inserted: inserts.map((d) => d.zoho_invoice_id), before: updates.map((u) => u.before) }, { relaxed: false }));
  console.log(`Undo file: ${undoFile}`);
  await col(COLL).createIndex({ zoho_invoice_id: 1 }, { unique: true });
  await col(COLL).createIndex({ student_id: 1, date: -1 });
  await col(COLL).createIndex({ date: -1 });
  for (let i = 0; i < inserts.length; i += 500) await col(COLL).insertMany(inserts.slice(i, i + 500));
  for (const u of updates) await col(COLL).updateOne({ _id: u.before._id }, { $set: u.set });
  console.log(`Done: ${inserts.length} added, ${updates.length} updated.`);
}

await connectDb();
try {
  const undoFile = option("undo");
  const file = option("file");
  if (undoFile) await undo(undoFile);
  else if (file) await run(file);
  else console.log("Give --file=<zoho-invoices json> (or --undo=<undo file>).");
} finally {
  await closeDb();
}
