import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";
import { recordHistory } from "../students/history";

/**
 * A course's sale moved to the sales CRM that really made it (the user, 2026-11-24: "this student enrolment by Aparna
 * from Draw, so change it on the finance" — closed again in the Sales CRM by somebody else). Finance's invoice and both
 * CRMs are moved by their own scripts (finance move-enrolment-crm.ts, Root move-close-to-draw.ts); here only what this
 * portal was told at the close:
 *
 *   - the course's row (course_fees, by its invoice number): its sales_crm;
 *   - the student's sales_crm — when no other course of theirs came from the old CRM;
 *   - who closed them (closed_by): the old CRM's closer taken off — when no other course of theirs came from that CRM —
 *     and the new one put on, so the right Sales account sees the student.
 * The money, the CS, the team, the bonus and every request stay as they are. A history line on the student says it.
 *
 *   cd backend
 *   bun src/scripts/set-sales-crm.ts --invoice=IN-00456 --crm=draw --closed-by-email=<email> --closed-by-name="<name>"            shows it
 *   bun src/scripts/set-sales-crm.ts … --apply                                                                                  changes it
 *   bun src/scripts/set-sales-crm.ts --undo=<file> --apply                                                                      puts it back
 */

const CRMS: Record<string, string> = { delta: "Sales CRM", remote: "Remote CRM", draw: "Draw", banglore: "Banglore CRM" };
const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();

await connectDb();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
console.log(`Database: ${host} / ${config.mongoDb}${apply ? "" : "   (showing only — add --apply to change it)"}\n`);
let failed = false;
try {
  const undo = option("undo");
  if (undo) {
    const saved = JSON.parse(readFileSync(undo, "utf8"));
    const s: any = await col("students").findOne({ student_code: saved.student_code });
    if (!s) throw new Error(`No student ${saved.student_code}`);
    console.log(`${saved.student_code}: back to ${saved.sales_crm ?? "(none)"}, closed by ${(saved.closed_by ?? []).map((c: any) => c.name).join(", ") || "nobody"}, ${saved.invoice_number} from ${saved.row_sales_crm ?? "(none)"}`);
    if (apply) {
      await col("students").updateOne({ _id: s._id }, {
        $set: { closed_by: saved.closed_by ?? [], "course_fees.$[row].sales_crm": saved.row_sales_crm, ...(saved.sales_crm == null ? {} : { sales_crm: saved.sales_crm }) },
        ...(saved.sales_crm == null ? { $unset: { sales_crm: "" } } : {}),
      } as any, { arrayFilters: [{ "row.invoice_number": saved.invoice_number }] });
      await recordHistory([{ student_id: String(s._id), at: new Date().toISOString(), type: "enrolment_changed", by_id: "", by_name: "Script (set-sales-crm)", text: `Sales CRM put back: ${saved.invoice_number} from ${CRMS[saved.row_sales_crm] ?? saved.row_sales_crm}` }]);
      console.log("Put back.");
    } else console.log("Add --apply to put it back.");
  } else {
    const invoice = String(option("invoice") ?? "").trim().toUpperCase();
    const crm = lower(option("crm"));
    const email = lower(option("closed-by-email"));
    const name = String(option("closed-by-name") ?? "").trim();
    if (!/^IN-\d+$/.test(invoice)) throw new Error("Give --invoice=IN-00001");
    if (!CRMS[crm]) throw new Error(`--crm: one of ${Object.keys(CRMS).join(", ")}`);
    if (!/^\S+@\S+\.\S+$/.test(email) || !name) throw new Error("Give --closed-by-email=<email> and --closed-by-name=\"<name>\"");

    const found = (await col("students").find({ "course_fees.invoice_number": invoice }).toArray()) as any[];
    if (found.length !== 1) throw new Error(found.length ? `${found.length} students have ${invoice} — not changed` : `No student has ${invoice}`);
    const s = found[0];
    const rows: any[] = s.course_fees ?? [];
    const row = rows.find((r) => r.invoice_number === invoice);
    const from = lower(row?.sales_crm);
    if (from === crm) throw new Error(`${s.student_code}'s ${invoice} already came from ${CRMS[crm]} — nothing to change`);
    const othersFromOld = rows.filter((r) => r.invoice_number !== invoice && lower(r.sales_crm) === from).length;
    const closers: any[] = s.closed_by ?? [];
    const keptClosers = othersFromOld ? closers : closers.filter((c) => lower(c.crm) !== from);
    const closedBy = keptClosers.some((c) => lower(c.email) === email && lower(c.crm) === crm) ? keptClosers : [...keptClosers, { email, name, crm }];
    const studentCrm = lower(s.sales_crm) === from && !othersFromOld ? crm : s.sales_crm ?? null;

    console.log(`${s.student_code} ${s.full_name} · ${invoice} · ${row?.course ?? ""}`);
    console.log(`  the course's sales CRM:  ${CRMS[from] ?? from ?? "(none)"} → ${CRMS[crm]}`);
    console.log(`  the student's sales CRM: ${CRMS[lower(s.sales_crm)] ?? s.sales_crm ?? "(none)"} → ${CRMS[lower(studentCrm)] ?? studentCrm ?? "(none)"}${othersFromOld ? `  (kept: ${othersFromOld} other course(s) came from it)` : ""}`);
    console.log(`  closed by:               ${closers.map((c) => `${c.name} (${CRMS[c.crm] ?? c.crm})`).join(", ") || "nobody"} → ${closedBy.map((c: any) => `${c.name} (${CRMS[c.crm] ?? c.crm})`).join(", ")}`);
    console.log(`  unchanged: the fee, payments, bonus, CS and team, every request`);

    if (apply) {
      const at = new Date().toISOString();
      const file = join(homedir(), `set-sales-crm-undo-${s.student_code}-${at.replace(/[:.]/g, "-")}.json`);
      const saved = { student_code: s.student_code, invoice_number: invoice, sales_crm: s.sales_crm ?? null, closed_by: closers, row_sales_crm: row?.sales_crm ?? null };
      writeFileSync(file, JSON.stringify(saved, null, 2));
      if (JSON.parse(readFileSync(file, "utf8")).student_code !== s.student_code) throw new Error(`The undo file ${file} didn't read back — nothing changed`);
      await col("students").updateOne({ _id: s._id }, {
        $set: { closed_by: closedBy, "course_fees.$[row].sales_crm": crm, ...(studentCrm == null ? {} : { sales_crm: studentCrm }) },
      } as any, { arrayFilters: [{ "row.invoice_number": invoice }] });
      await recordHistory([{
        student_id: String(s._id), at, type: "enrolment_changed", by_id: "", by_name: "Script (set-sales-crm)",
        text: `${invoice} was ${CRMS[crm]}'s sale, closed by ${name} — moved from ${CRMS[from] ?? from} (${closers.filter((c) => lower(c.crm) === from).map((c) => c.name).join(", ") || "nobody"})`,
      }]);
      await col("logs").insertOne({
        timestamp: at, user_name: "Script (set-sales-crm)", user_role: "system", action_type: "set_sales_crm", entity_type: "Student",
        entity_id: String(s._id), details: JSON.stringify({ invoice, from, to: crm, closed_by: closedBy }), success: true,
      } as any);
      console.log(`\nChanged.\nUndo file: ${file}\n  bun src/scripts/set-sales-crm.ts --undo=${file} --apply`);
    }
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  failed = true;
} finally {
  await closeDb();
}
process.exit(failed ? 1 : 0);
