import { connectDb, closeDb, col } from "../db";
import { config } from "../config";
import { notify } from "../lib/notify";

/**
 * A pending sales-close MT5 bonus brought back to the broker admins and Super Admins (the user, 2026-10-31: a
 * student's second payment receipt reached the portal only after the 6-hour alert had gone). One notice,
 * the bell and their phone, as the portal's own bonus alerts (students/bonusVerifyAlerts.ts) — the request itself is
 * not changed.
 *
 *   cd backend
 *   bun src/scripts/bonus-notify-again.ts --code=<STU code>            shows who would be told
 *   bun src/scripts/bonus-notify-again.ts --code=<STU code> --write    tells them
 * Two pending bonuses for the student → it lists them; add --id=<one of them>.
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env).
 */

const write = process.argv.includes("--write");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const TEST_EMAIL = /@deltatest\.dev$/i;

await connectDb();
console.log(`Database: ${host} / ${config.mongoDb}${write ? "" : "   (showing only — add --write to tell them)"}\n`);
try {
  const code = option("code")?.trim().toUpperCase() ?? "", pick = option("id")?.trim() ?? "";
  if (!code) { console.error("Say which student: --code=<STU code>"); process.exit(1); }

  const students = (await col("students").find({ student_code: code }).toArray()) as any[];
  const found = ((await col("funding_transactions").find({
    student_id: { $in: students.map((s) => String(s._id)) }, type: "BONUS", bonus_credit: "sales_close", status: "PENDING",
  }).toArray()) as any[]).filter((t) => !pick || String(t._id) === pick);
  if (found.length !== 1) {
    console.error(found.length ? `${found.length} pending sales-close bonuses for ${code} — add --id=<one of these>:` : `No pending sales-close bonus for ${code} — nothing sent.`);
    for (const t of found) console.error(`  ${t._id} · $${t.amount_usd ?? "—"} · ${t.sales_close?.invoice_number ?? "—"} · ${t.requested_at ?? t.created_date ?? "—"}`);
    process.exit(1);
  }
  const t = found[0];
  const student = students.find((s) => String(s._id) === String(t.student_id));
  const invoice = t.sales_close?.invoice_number ? String(t.sales_close.invoice_number) : "";

  // The receipts the row shows for its invoice, each file once — what the admins are being told about.
  const fees = (student?.course_fees ?? []).filter((f: any) => !invoice || f.invoice_number === invoice);
  const urls = new Set<string>(fees.flatMap((f: any) => [
    f.receipt_url, ...(f.declared_payments ?? []).map((p: any) => p.receipt_url), ...(f.payments ?? []).map((p: any) => p.receipt_url),
  ]).filter((u: unknown) => /^https?:\/\//i.test(String(u ?? ""))));
  const methods = [...new Set<string>(fees.flatMap((f: any) => (f.payments ?? []).filter((p: any) => p.receipt_url).map((p: any) => String(p.method || "payment"))))];

  const people = ((await col("users")
    .find({ app_role: { $in: ["broker_admin", "super_admin"] }, status: { $ne: "inactive" } }, { projection: { full_name: 1, email: 1, app_role: 1, is_test: 1 } })
    .toArray()) as any[]).filter((u) => !u.is_test && !TEST_EMAIL.test(String(u.email ?? "")));

  const name = `${student?.full_name || t.student_name || "A student"}${code ? ` (${code})` : ""}`;
  const notice = {
    type: "bonus_verification",
    title: `MT5 bonus waiting: ${name}`,
    body: `${urls.size === 1 ? "Its receipt is" : urls.size === 2 ? "Both payment receipts are" : `All ${urls.size} payment receipts are`} now attached${methods.length ? ` (${methods.join(" + ")})` : ""}${invoice ? ` for ${invoice}` : ""} — $${Number(t.amount_usd ?? 0).toLocaleString("en-US")} promised at the sales close is waiting for approval.`,
    link: "/FundingRequests",
    tag: `bonus-${String(t._id)}`,
    renotify: true,
  };

  console.log(`Request ${t._id} · ${t.status} · $${t.amount_usd ?? "—"} · ${invoice || "no invoice"} · receipts ${urls.size}`);
  console.log(`\n  ${notice.title}\n  ${notice.body}\n`);
  console.log(`To ${people.length}:`);
  for (const u of people) console.log(`  ${u.full_name || "—"} · ${u.email} · ${u.app_role}`);

  if (write) {
    await notify(people.map((u) => String(u._id)), notice);
    console.log(`\nTold ${people.length} (bell + phone).`);
  }
} finally {
  await closeDb();
}
