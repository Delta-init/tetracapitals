import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ObjectId } from "mongodb";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";
import { suggestionsFor } from "../students/zohoSuggest";

/**
 * Links the Not linked Zoho invoices whose suggested student is Strong or Likely (the user, 2026-10-13: "likely also";
 * students/zohoSuggest.ts) — Strong: the same email (one student has it), or an email typo with the same name; Likely:
 * an email typo alone or with the phone, or the same phone and name — linked only when the first names agree too (the
 * rest are listed, left for the Invoices page). Kept as match "suggested" — the import running
 * again leaves it, as it does a link made by hand. Weak ones stay for an admin on the Invoices page.
 *
 *   cd backend
 *   bun src/scripts/link-zoho-suggested.ts                 shows what it would link
 *   bun src/scripts/link-zoho-suggested.ts --apply         links them; an undo file first
 *   bun src/scripts/link-zoho-suggested.ts --undo=<file> [--apply]   back to Not linked
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env).
 */

const apply = process.argv.includes("--apply");
const undo = process.argv.find((a) => a.startsWith("--undo="))?.slice(7);
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];

await connectDb();
console.log(`Database: ${host} / ${config.mongoDb} — ${apply ? "WRITING" : "dry run, nothing is written"}\n`);

if (undo) {
  const saved: any[] = JSON.parse(readFileSync(undo, "utf8")).invoices;
  let back = 0;
  for (const s of saved) {
    console.log(`  ${s.number}  back to Not linked (${s.not_linked_why})`);
    if (apply) {
      const r = await col("zoho_invoices").updateOne({ _id: new ObjectId(s._id), match: "suggested", student_id: s.linked_to },
        { $set: { student_id: null, match: s.match ?? null, not_linked_why: s.not_linked_why }, $unset: { linked_by_id: "", linked_by_name: "", linked_at: "", suggested_how: "" } });
      back += r.modifiedCount;
    }
  }
  console.log(`\n${saved.length} invoice(s)${apply ? `; ${back} put back (one changed by hand since is left)` : " — run again with --apply"}.`);
  await closeDb();
  process.exit(0);
}

const invoices = (await col("zoho_invoices").find({ student_id: null }).sort({ date: -1 }).toArray()) as any[];
const plan: { inv: any; s: any }[] = [], held: { inv: any; s: any }[] = [];
for (const inv of invoices) {
  const best = (await suggestionsFor(inv.customer ?? {}))[0];
  // Likely: only when the first names agree too — an email one letter off is sometimes a relative's.
  if (best?.strength === "strong" || (best?.strength === "likely" && best.name_agrees)) plan.push({ inv, s: best });
  else if (best?.strength === "likely") held.push({ inv, s: best });
}
for (const { inv, s } of plan) {
  console.log(`  ${inv.number}  ${String(inv.date ?? "").slice(0, 10)}  ${String(inv.customer?.name ?? "").trim()} <${inv.customer?.email ?? ""}>`);
  console.log(`      → [${s.strength.toUpperCase()}] ${s.student_code} ${s.full_name} <${s.email}> · ${s.cs || "no CS"} · ${s.how.join(" + ")}`);
}
for (const { inv, s } of held) console.log(`  (left — names differ) ${inv.number} ${String(inv.customer?.name ?? "").trim()} <${inv.customer?.email ?? ""}> ≠ ${s.student_code} ${s.full_name} <${s.email}>`);
console.log(`\n${invoices.length} not linked; ${plan.length} with a Strong or Likely suggestion (${plan.filter((p) => p.s.strength === "strong").length} Strong, ${plan.filter((p) => p.s.strength === "likely").length} Likely).`);

if (apply && plan.length) {
  const file = join(homedir(), `zoho-suggested-link-undo-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ invoices: plan.map(({ inv, s }) => ({ _id: String(inv._id), number: inv.number, match: inv.match ?? null, not_linked_why: inv.not_linked_why ?? "", linked_to: s.student_id })) }, null, 1));
  const now = new Date().toISOString();
  let linked = 0;
  for (const { inv, s } of plan) {
    const r = await col("zoho_invoices").updateOne({ _id: inv._id, student_id: null }, {
      $set: { student_id: s.student_id, match: "suggested", not_linked_why: "", suggested_how: s.how, linked_by_id: "", linked_by_name: `Suggested match (${s.strength === "strong" ? "Strong" : "Likely"})`, linked_at: now },
    });
    linked += r.modifiedCount;
  }
  console.log(`Linked ${linked}. Undo: --undo=${file}`);
} else if (plan.length) console.log("Nothing was written. Run again with --apply to link them.");
await closeDb();
