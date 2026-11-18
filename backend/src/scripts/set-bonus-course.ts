import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ObjectId } from "mongodb";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";
import { DEFAULT_PRICE_LIST } from "../courses/priceList";
import { recordHistory } from "../students/history";

/**
 * A course payment raised under the wrong course (the user, 2026-11-18: Arun Sudarsanan, STU-4185 — his second DSLP
 * Offer payment raised as "DSLP" with nothing paid before, so this portal counted a second AED 20,000 course and
 * finance made a second invoice; "he is enrolled for the DSLP Offer"). The request is put on the course it pays
 * towards: that course's name, price and plan (from its earlier request), what was paid before it (its earlier
 * approved requests) and so what is paid to date and left. The amount, what is on hold, the MT5 bonus and commission
 * stay as they are. Finance's invoice is put right with its own script (move-course-payment).
 *
 * --merge-course=<CODE>: the student's CSE courses (Courses & fees) too — that course's line taken out and what it
 * says was paid added to the course's own line (refused while an upgrade is under way, as the page refuses).
 *
 *   cd backend
 *   bun src/scripts/set-bonus-course.ts --txn=MB-000697 --to="DSLP Offer" --merge-course=DSLP_PRO           shows it
 *   bun src/scripts/set-bonus-course.ts --txn=MB-000697 --to="DSLP Offer" --merge-course=DSLP_PRO --apply   changes it
 *   bun src/scripts/set-bonus-course.ts --undo=<file> --apply                                                puts it back
 *   --id=<request id> in place of --txn for a request with no transaction id.
 */

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const cents = (n: number) => Math.round(n * 100) / 100;
const aed = (n: unknown) => `AED ${Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

await connectDb();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
console.log(`Database: ${host} / ${config.mongoDb}${apply ? "" : "   (showing only — add --apply to change it)"}\n`);
try {
  const undo = option("undo");
  if (undo) {
    const saved = JSON.parse(readFileSync(undo, "utf8"));
    console.log(`From ${undo}: request ${saved.before._id} back on ${saved.before.course_payment?.product}${saved.courses ? ", and the student's courses as they were" : ""}`);
    if (apply) {
      const { _id, ...rest } = saved.before;
      await col("funding_transactions").replaceOne({ _id: new ObjectId(String(_id)) }, rest);
      if (saved.courses) {
        const { _id: cid, ...c } = saved.courses;
        await col("student_courses").replaceOne({ _id: new ObjectId(String(cid)) }, c);
      }
      console.log("Put back.");
    }
    process.exit(0);
  }

  const txn = option("txn")?.trim() ?? "", pick = option("id")?.trim() ?? "", to = option("to")?.trim() ?? "";
  const merge = option("merge-course")?.trim().toUpperCase() ?? "";
  if ((!txn && !ObjectId.isValid(pick)) || !to) { console.error('Say which: --txn=<MB-…> (or --id=<request>) --to="<the course it pays towards>"'); process.exit(1); }

  const found = (await col("funding_transactions").find({
    type: "BONUS", ...(txn ? { transaction_id: txn } : { _id: new ObjectId(pick) }),
  }).toArray()) as any[];
  if (found.length !== 1) { console.error(found.length ? `${found.length} requests have ${txn} — use --id=<one of them>` : "No such request — nothing done."); process.exit(1); }
  const t = found[0], cp = t.course_payment ?? {};
  if (!cp.product) { console.error("It is not a course payment — nothing done."); process.exit(1); }
  if (["REJECTED", "CANCELLED"].includes(String(t.status))) { console.error(`It is ${t.status} — nothing done.`); process.exit(1); }

  // The course's earlier requests (not turned down): its name, price and plan, and what was paid before this one.
  const at = String(t.requested_at ?? t.created_date ?? "");
  const earlier = ((await col("funding_transactions").find({
    student_id: t.student_id, type: "BONUS", _id: { $ne: t._id }, status: { $nin: ["REJECTED", "CANCELLED"] },
    "course_payment.product": { $regex: `^${esc(to)}$`, $options: "i" },
  }).toArray()) as any[]).filter((x) => String(x.requested_at ?? x.created_date ?? "") < at)
    .sort((a, b) => String(b.requested_at ?? b.created_date ?? "").localeCompare(String(a.requested_at ?? a.created_date ?? "")));
  if (!earlier.length) { console.error(`No earlier ${to} payment for this student — nothing to put it with; nothing done.`); process.exit(1); }
  const source = earlier[0], scp = source.course_payment ?? {};
  const plan = Number(scp.plan_aed) || 0;
  if (!(plan > 0)) { console.error(`The earlier ${to} payment (${source._id}) has no plan — nothing done.`); process.exit(1); }
  const paidBefore = cents(earlier.reduce((s, x) => s + (Number(x.course_payment?.paid_today_aed) || 0), 0));
  const paidTotal = cents(paidBefore + (Number(cp.paid_today_aed) || 0));
  const balance = Math.max(0, cents(plan - paidTotal));

  const set: Record<string, unknown> = {
    "course_payment.product": scp.product, "course_payment.price": scp.price, "course_payment.price_currency": scp.price_currency ?? "AED",
    "course_payment.plan_aed": plan, "course_payment.paid_before_aed": paidBefore, "course_payment.paid_total_aed": paidTotal,
    "course_payment.balance_aed": balance, "course_payment.short_aed": balance, "course_payment.over_aed": Math.max(0, cents(paidTotal - plan)),
    "course_payment.course_set_by_script": new Date().toISOString(), updated_date: new Date().toISOString(),
  };
  const student: any = await col("students").findOne({ _id: ObjectId.isValid(String(t.student_id)) ? new ObjectId(String(t.student_id)) : (t.student_id as any) });
  console.log(`Request ${t._id} · ${t.transaction_id || "no transaction id"} · ${t.status} · ${student?.student_code ?? ""} ${t.student_name ?? student?.full_name ?? ""}`);
  console.log(`  course       ${cp.product} → ${scp.product}   (as ${earlier.length} earlier request${earlier.length === 1 ? "" : "s"}: ${earlier.map((x) => `${x.transaction_id || x._id} ${aed(x.course_payment?.paid_today_aed)}`).join(", ")})`);
  console.log(`  price        ${cp.price_currency ?? ""} ${cp.price ?? "—"} → ${scp.price_currency ?? "AED"} ${scp.price ?? "—"}   plan ${aed(cp.plan_aed)} → ${aed(plan)}`);
  console.log(`  paid before  ${aed(cp.paid_before_aed)} → ${aed(paidBefore)}`);
  console.log(`  paid now     ${aed(cp.paid_today_aed)} (unchanged)   on hold ${aed(cp.hold_aed)} (unchanged)`);
  console.log(`  paid to date ${aed(cp.paid_total_aed)} → ${aed(paidTotal)}`);
  console.log(`  balance      ${aed(cp.balance_aed)} → ${aed(balance)}`);
  console.log(`  MT5 bonus    $${cp.bonus_usd ?? 0} (unchanged)   commission unchanged`);

  // The CSE courses: the wrong course's line folded into the course's own.
  let coursesBefore: any = null, ownedAfter: any[] | null = null;
  if (merge) {
    const target = DEFAULT_PRICE_LIST.find((c) => c.name.toLowerCase() === String(scp.product).toLowerCase());
    if (!target) { console.error(`${scp.product} is not on the CSE price list — leave --merge-course out; nothing done.`); process.exit(1); }
    if (!DEFAULT_PRICE_LIST.some((c) => c.code === merge)) { console.error(`--merge-course: ${merge} is not a course code (${DEFAULT_PRICE_LIST.map((c) => c.code).join(", ")}); nothing done.`); process.exit(1); }
    coursesBefore = await col("student_courses").findOne({ student_id: String(t.student_id) });
    const owned: any[] = coursesBefore?.owned ?? [];
    const wrong = owned.find((o) => o.code === merge);
    if (await col("course_upgrades").countDocuments({ student_id: String(t.student_id), status: { $ne: "cancelled" } })) {
      console.error("An upgrade has been started for this student — their courses can no longer be changed; nothing done."); process.exit(1);
    }
    const nameOf = (code: string) => DEFAULT_PRICE_LIST.find((c) => c.code === code)?.name ?? code;
    const show = (list: any[]) => list.map((o) => `${nameOf(o.code)} ${aed(o.paid_aed)}`).join(", ") || "none";
    if (!wrong) console.log(`  CSE courses  ${show(owned)} — no ${nameOf(merge)} line, left as they are`);
    else {
      const own = owned.find((o) => o.code === target.code);
      ownedAfter = owned.filter((o) => o.code !== merge && o.code !== target.code)
        .concat([{ code: target.code, plan: own?.plan ?? wrong.plan ?? "installments", paid_aed: cents((Number(own?.paid_aed) || 0) + (Number(wrong.paid_aed) || 0)) }]);
      console.log(`  CSE courses  ${show(owned)} → ${show(ownedAfter)}`);
    }
  }

  if (apply) {
    const file = join(homedir(), `set-bonus-course-${t._id}-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify({ before: t, ...(ownedAfter && coursesBefore ? { courses: coursesBefore } : {}) }, null, 2));
    const back = JSON.parse(readFileSync(file, "utf8"));
    if (String(back?.before?._id) !== String(t._id)) { console.error(`The backup ${file} did not read back whole — nothing changed.`); process.exit(1); }
    await col("funding_transactions").updateOne({ _id: t._id }, { $set: set });
    const now = new Date().toISOString();
    const lines = [`Course payment ${t.transaction_id || t._id} put on ${scp.product} (was ${cp.product}): ${aed(paidTotal)} paid to date, ${aed(balance)} left`];
    if (ownedAfter && coursesBefore) {
      await col("student_courses").updateOne({ _id: coursesBefore._id }, { $set: { owned: ownedAfter, entered_by_name: "Script (set-bonus-course)", entered_at: now } });
      lines.push(`Courses entered: ${ownedAfter.map((o) => `${DEFAULT_PRICE_LIST.find((c) => c.code === o.code)?.name ?? o.code} (AED ${Number(o.paid_aed).toLocaleString("en-US")})`).join(", ")}`);
    }
    await recordHistory(lines.map((text) => ({ student_id: String(t.student_id), at: now, type: "course_upgrade", by_id: "", by_name: "Script (set-bonus-course)", text })) as any);
    await col("logs").insertOne({
      timestamp: now, user_name: "Script (set-bonus-course)", user_role: "system", action_type: "set_bonus_course", entity_type: "FundingTransaction",
      entity_id: String(t._id), details: JSON.stringify({ from: cp.product, to: scp.product, paid_before_aed: paidBefore, balance_aed: balance, courses: ownedAfter }), success: true,
    } as any);
    console.log(`\nChanged.\nUndo file: ${file}\n  bun src/scripts/set-bonus-course.ts --undo=${file} --apply`);
  }
} finally {
  await closeDb();
}
