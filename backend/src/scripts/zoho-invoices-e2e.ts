/**
 * Zoho Books invoices, end to end, on made-up data (no real customer in this repo):
 *
 *   - the import's dry run counts and writes nothing; --apply links by email (any case, spaces), then by phone (the
 *     last 9 digits), and leaves Not linked, with why: name only, email and phone on two students, a phone on
 *     several students, no match;
 *   - running it again adds and changes nothing; an invoice an admin linked by hand stays linked so;
 *   - who sees what: a CS only their own students' invoices, the Super Admin everyone's; Not linked only for a Super
 *     Admin / Admin; a student's invoices only for whoever may see the student;
 *   - an admin links and unlinks by hand; a CS cannot;
 *   - the undo file takes out what the import added.
 *
 * Run through ./test-zoho-invoices.sh. Refuses anything but a scratch database on 127.0.0.1.
 */
import { writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MongoClient, ObjectId } from "mongodb";
import { signJwt } from "../auth/jwt";

const uri = process.env.MONGO_URI ?? "";
const dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) {
  console.error(`Refusing to run: needs a scratch e2e database on 127.0.0.1, got ${uri} / ${dbName}`);
  process.exit(1);
}
const API = `http://127.0.0.1:${process.env.E2E_API_PORT}`;
const WORK = process.env.E2E_WORK ?? "";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);

const client = await new MongoClient(uri).connect();
const db = client.db(dbName);
const now = new Date().toISOString();
const user = (email: string, full_name: string, app_role: string) => ({ _id: new ObjectId(), email, full_name, app_role, status: "active", created_date: now });
const sa = user("sa@zoho-e2e.test", "Super Admin", "super_admin");
const cs1 = user("cs1@zoho-e2e.test", "CS One", "cs");
const cs2 = user("cs2@zoho-e2e.test", "CS Two", "cs");
// A mentor role with no data scope set: still only their own students' invoices.
const jm = user("jm@zoho-e2e.test", "Junior Mentor", "junior_mentor");
await db.collection("users").insertMany([sa, cs1, cs2, jm] as any[]);
// As on the live database: a CS sees their own students.
await db.collection("commission_roles").insertOne({ role_key: "cs", name: "CS", data_scope: "own", page_permissions: ["Students", "ZohoInvoices"], created_date: now } as any);
const student = (name: string, cs: any, email: string, phone: string) => ({ _id: new ObjectId(), full_name: name, email, phone, primary_mentor_id: String(cs._id), primary_mentor_name: cs.full_name, student_code: `STU-Z${Math.random().toString(36).slice(2, 6)}`, status: "active", created_date: now });
const s1 = student("Asha Email", cs1, "asha@example.test", "+971 50 000 0001");
const s2 = student("Binu Phone", cs1, "binu-other@example.test", "+971 50 111 1111");
const s3 = student("Chitra Other CS", cs2, "chitra@example.test", "+971 50 000 0003");
const s4 = student("Dev Shared A", cs2, "dev-a@example.test", "+971 55 222 2222");
const s5 = student("Dev Shared B", cs2, "dev-b@example.test", "00971552222222");
const s6 = student("Esha Email", cs2, "esha@example.test", "+971 50 000 0006");
const s7 = student("Farid Phone", cs2, "farid@example.test", "+971 56 333 3333");
const s8 = student("Zara Name Only", cs2, "zara@example.test", "+971 50 000 0008");
await db.collection("students").insertMany([s1, s2, s3, s4, s5, s6, s7, s8] as any[]);

const invoice = (id: string, number: string, date: string, status: string, total: number, balance: number, customer: any, items = ["Market Break-out Trading Program"]) =>
  ({ zoho_invoice_id: id, number, date, status, currency: "AED", total, balance, sales_person: "seller", customer: { zoho_id: `c-${id}`, ...customer }, items: items.map((name) => ({ name, quantity: 1, price: total, total })), file: "e2e" });
const rows = [
  invoice("1", "DMDT000001", "2024-03-01", "Closed", 5000, 0, { name: "Asha", email: "  ASHA@Example.test ", phone: "" }),
  invoice("2", "DMDT000002", "2025-02-01", "Closed", 3000, 0, { name: "Binu", email: "binu@elsewhere.test", phone: "+971-501111111" }),
  invoice("3", "DMDT000003", "2025-06-01", "Overdue", 4000, 1500, { name: "Chitra", email: "chitra@example.test", phone: "" }),
  invoice("4", "DMDT000004", "2025-07-01", "Closed", 1000, 0, { name: "Dev", email: "", phone: "+971 55 222 2222" }),
  invoice("5", "DMDT000005", "2026-01-01", "Closed", 2000, 0, { name: "Esha", email: "esha@example.test", phone: "+971563333333" }),
  invoice("6", "DMDT000006", "2026-02-01", "Closed", 2500, 0, { name: "Zara Name Only", email: "zara.other@example.test", phone: "+971 58 999 9999" }),
  invoice("7", "DMDT000007", "2026-03-01", "Closed", 900, 0, { name: "Nobody", email: "nobody@example.test", phone: "+971 58 888 8888" }),
  invoice("8", "DMDT000008", "2026-04-01", "Overdue", 6000, 2000, { name: "Asha", email: "asha@example.test", phone: "" }, ["Delta Wave Theory Program"]),
];
const file = join(WORK, "invoices.json");
writeFileSync(file, JSON.stringify(rows));

const script = async (...args: string[]) => {
  const p = Bun.spawn(["bun", "--no-env-file", "src/scripts/import-zoho-invoices.ts", ...args], { env: { ...process.env, HOME: WORK }, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text() + await new Response(p.stderr).text();
  await p.exited;
  return out;
};
const coll = db.collection("zoho_invoices");
const tokenOf = async (u: any) => signJwt({ sub: String(u._id), email: u.email, app_role: u.app_role, full_name: u.full_name });
const call = async (u: any, fn: string, body: unknown) => {
  const r = await fetch(`${API}/api/functions/${fn}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await tokenOf(u)}` }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) as any };
};

step("The import");
let out = await script(`--file=${file}`);
check("dry run says what it would do", /to add: 8/.test(out) && /Students with invoices: 3/.test(out), out.slice(-600));
check("…and writes nothing", (await coll.countDocuments()) === 0);
out = await script(`--file=${file}`, "--apply");
check("--apply adds the eight", /Done: 8 added, 0 updated/.test(out), out.slice(-400));
const by = async (n: string) => (await coll.findOne({ number: n })) as any;
check("by email, whatever the case and spaces", (await by("DMDT000001"))?.student_id === String(s1._id) && (await by("DMDT000001"))?.match === "email");
check("by phone (last 9 digits) when the email is nobody's", (await by("DMDT000002"))?.student_id === String(s2._id) && (await by("DMDT000002"))?.match === "phone");
check("a phone on two students: not linked", (await by("DMDT000004"))?.student_id === null && (await by("DMDT000004"))?.not_linked_why === "several students");
check("email one student's, phone another's: not linked", (await by("DMDT000005"))?.student_id === null && (await by("DMDT000005"))?.not_linked_why === "email and phone disagree");
check("only the name: not linked (the user)", (await by("DMDT000006"))?.not_linked_why === "name only");
check("nothing of theirs: not linked", (await by("DMDT000007"))?.not_linked_why === "no match");
check("paid = total less balance; the lines kept", (await by("DMDT000003"))?.paid === 2500 && (await by("DMDT000008"))?.items?.[0]?.name === "Delta Wave Theory Program");
check("the customer's email and phone kept", (await by("DMDT000002"))?.customer?.phone === "+971-501111111");

step("Who sees what");
let r = await call(cs1, "listZohoInvoices", { tab: "linked" });
check("a CS: only their own students' invoices", r.status === 200 && r.body.total === 3 && r.body.rows.every((x: any) => [String(s1._id), String(s2._id)].includes(x.student_id)), JSON.stringify(r.body).slice(0, 200));
check("…with the student's name, code and CS", r.body.rows.some((x: any) => x.student_name === "Asha Email" && x.cs_name === "CS One"));
check("…and the totals of what they see", r.body.totals.total === 14000 && r.body.totals.balance === 2000 && r.body.totals.overdue === 1, JSON.stringify(r.body.totals));
r = await call(cs2, "listZohoInvoices", { tab: "linked" });
check("the other CS: theirs only", r.body.total === 1 && r.body.rows[0].number === "DMDT000003");
r = await call(jm, "listZohoInvoices", { tab: "linked" });
check("a mentor role with no scope set: none of others' students", r.status === 200 && r.body.total === 0, JSON.stringify(r.body).slice(0, 160));
r = await call(sa, "listZohoInvoices", { tab: "linked" });
check("the Super Admin: every linked one", r.body.total === 4 && r.body.may_link === true);
r = await call(sa, "listZohoInvoices", { tab: "linked", status: "Overdue", year: "2026" });
check("filters: status and year", r.body.total === 1 && r.body.rows[0].number === "DMDT000008");
r = await call(sa, "listZohoInvoices", { tab: "linked", search: "binu" });
check("search finds by the student's name too", r.body.total === 1 && r.body.rows[0].number === "DMDT000002");
r = await call(sa, "listZohoInvoices", { tab: "linked", cs: String(cs1._id) });
check("the CS filter", r.body.total === 3);
r = await call(sa, "listZohoInvoices", { tab: "not_linked" });
check("Not linked for the Super Admin: the four", r.body.total === 4);
r = await call(cs1, "listZohoInvoices", { tab: "not_linked" });
check("…and not for a CS", r.status === 403);
r = await call(cs1, "getStudentZohoInvoices", { studentId: String(s1._id) });
check("a student's own invoices, newest first", r.status === 200 && r.body.invoices.map((x: any) => x.number).join() === "DMDT000008,DMDT000001" && r.body.totals.balance === 2000);
r = await call(cs1, "getStudentZohoInvoices", { studentId: String(s3._id) });
check("…not another CS's student's", r.status === 404);
r = await call(cs1, "getZohoInvoiceOptions", {});
check("the filters' choices: their years and courses, no Not linked count", JSON.stringify(r.body.years) === '["2026","2025","2024"]' && r.body.courses.length === 2 && r.body.not_linked === undefined, JSON.stringify(r.body));

step("Linking by hand");
const six = await by("DMDT000006");
r = await call(cs1, "linkZohoInvoice", { invoiceId: String(six._id), studentId: String(s8._id) });
check("a CS cannot link", r.status === 403);
r = await call(sa, "linkZohoInvoice", { invoiceId: String(six._id), studentId: String(s8._id) });
check("the Super Admin links one", r.status === 200 && (await by("DMDT000006"))?.student_id === String(s8._id) && (await by("DMDT000006"))?.match === "manual");
const one = await by("DMDT000001");
r = await call(sa, "linkZohoInvoice", { invoiceId: String(one._id), studentId: null });
check("…and takes one off a student", r.status === 200 && (await by("DMDT000001"))?.student_id === null);
const three = await by("DMDT000003");
r = await call(sa, "linkZohoInvoice", { invoiceId: String(three._id), studentId: String(s6._id) });
check("…and moves a linked one to another student", r.status === 200 && (await by("DMDT000003"))?.student_id === String(s6._id) && (await by("DMDT000003"))?.match === "manual");
r = await call(cs2, "getStudentZohoInvoices", { studentId: String(s3._id) });
check("…gone from the student it was on", r.status === 200 && r.body.invoices.length === 0);
out = await script(`--file=${file}`, "--apply");
check("running the import again: nothing added", /Done: 0 added/.test(out), out.slice(-300));
check("…the hand-made link stays", (await by("DMDT000006"))?.student_id === String(s8._id));
check("…and so does the one taken off by hand", (await by("DMDT000001"))?.student_id === null);
check("…and the one moved by hand", (await by("DMDT000003"))?.student_id === String(s6._id));

step("Undo");
const undoFile = readdirSync(WORK).filter((f) => f.startsWith("zoho-invoices-undo-")).sort()[0];
out = await script(`--undo=${join(WORK, undoFile)}`);
check("the undo's dry run says so and keeps them", /remove 8 added/.test(out) && (await coll.countDocuments()) === 8);
await script(`--undo=${join(WORK, undoFile)}`, "--apply");
check("…and --apply takes out what the import added", (await coll.countDocuments()) === 0);

await client.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
