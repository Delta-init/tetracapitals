/**
 * Course payments whose commission is on another amount than the student paid (the user, 2026-11-07: Praveen, STU-2991
 * — his 7 Oct payment was put right from AED 2,000 to AED 1,835 on 31 Oct and its commission stayed on 2,000). Every
 * approved course payment is checked: its credits not paid out yet go on the AED paid, at 3.67, each at its own %.
 * One paid out already is only listed. fix-course-payment-amount.ts now does this itself when it corrects an amount.
 *
 *   cd backend
 *   bun src/scripts/fix-commission-base.ts                          shows what it would change
 *   bun src/scripts/fix-commission-base.ts --apply                  changes it; saves an undo file in your home folder
 *   bun src/scripts/fix-commission-base.ts --id=<request id>        just that request
 *   bun src/scripts/fix-commission-base.ts --undo=<file> [--apply]  puts back what --apply did
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";
import { applyBaseChanges, commissionBaseChanges, courseBaseUsd, describeChange, undoBaseChanges, type BaseChange } from "../finance/commissionBase";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];

await connectDb();
try {
  console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}\n`);
  const undo = option("undo");
  if (undo) {
    const saved = await Bun.file(undo).json();
    if (apply) await undoBaseChanges(saved.changes, (id) => toObjectId(id) ?? id);
    console.log(`${saved.changes.length} credit(s) ${apply ? "put back" : "would be put back — add --apply"}.`);
  } else {
    const id = option("id");
    const txs = (await col("funding_transactions").find({
      type: "BONUS", status: "APPROVED", "course_payment.paid_today_aed": { $gt: 0 }, ...(id ? { _id: (toObjectId(id) ?? id) as any } : {}),
    }).sort({ requested_at: 1 }).toArray()) as any[];
    const all: BaseChange[] = [];
    let paidOut = 0;
    for (const t of txs) {
      const paidAed = Number(t.course_payment.paid_today_aed);
      const { change, paidOut: done } = await commissionBaseChanges(String(t._id), courseBaseUsd(paidAed));
      if (!change.length && !done.length) continue;
      const student: any = t.student_id ? await col("students").findOne({ _id: (toObjectId(String(t.student_id)) ?? t.student_id) as any }, { projection: { full_name: 1, student_code: 1 } }) : null;
      console.log(`${String(t.requested_at ?? t.created_date).slice(0, 10)} · ${student?.full_name ?? "—"} (${student?.student_code ?? "—"}) · ${t.course_payment.product ?? ""} · paid AED ${paidAed} · request ${t._id}`);
      for (const c of change) console.log(`  ${describeChange(c)}`);
      for (const c of done) console.log(`  PAID OUT ALREADY, left alone: ${describeChange(c)}`);
      all.push(...change);
      paidOut += done.length;
      console.log();
    }
    const diffAed = all.reduce((t, c) => t + (c.after.commission_usd - c.before.commission_usd), 0) * 3.67;
    console.log(`${all.length} credit(s) to put right (commission ${diffAed >= 0 ? "+" : ""}AED ${diffAed.toFixed(2)} in all)${paidOut ? ` · ${paidOut} paid out already, left alone` : ""}.`);
    if (all.length && apply) {
      const file = join(homedir(), `fix-commission-base-undo-${now.replace(/[:.]/g, "-")}.json`);
      await Bun.write(file, JSON.stringify({ database: config.mongoDb, host, applied_at: now, changes: all.map((c) => ({ id: String(c.id), before: c.before })) }));
      const n = await applyBaseChanges(all, "fix-commission-base");
      console.log(`\nDone: ${n} credit(s) changed.\nUndo file: ${file}\n  bun src/scripts/fix-commission-base.ts --undo=${file} --apply`);
    } else if (all.length) console.log("\nNothing was written. Run again with --apply to do it.");
  }
} finally {
  await closeDb();
}
