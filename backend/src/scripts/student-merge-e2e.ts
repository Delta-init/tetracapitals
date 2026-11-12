/**
 * Merging two student records into one (students/merge.ts, functions/studentMerge.ts; the user, 2026-11-12), end to
 * end against the API on a scratch database:
 *   1. finding: the same phone / email, a CS Manager only their reach, a CS none; "Not a duplicate" hides and shows;
 *   2. preview: both sides, what moves and how much, a suggestion — nothing changed;
 *   3. refused: a CS, a CS Manager outside their reach, the wrong confirmation, the same student twice;
 *   4. the merge: every place moves (ids as text and as ObjectIds, codes, lists inside documents, a list holding both
 *      once), commission credits keep their recipient, the kept record takes what it lacks and both lists, the CS
 *      picked (the app's change of CS: team, history) with the other kept as Common, the closed one gone and its code,
 *      email, LMS account and finance invoice still found — by finance and the LMS — on the kept one; a place nobody
 *      listed is reported as a leftover;
 *   5. one merge at a time; merged once only;
 *   6. undo: every record back exactly; a field changed since is left and reported;
 *   7. a merge that stops part-way is marked so and undone cleanly;
 *   8. History: a Super Admin every merge, a CS Manager their own.
 * Run through ./test-student-merge.sh (throwaway mongod, the API — no .env). Scratch database only.
 */
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "";
const dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) {
  console.error(`Refusing to run: needs a scratch e2e database on 127.0.0.1, got ${uri} / ${dbName}`);
  process.exit(1);
}
const API = `http://127.0.0.1:${process.env.E2E_API_PORT}`;
let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
const show = (v: unknown) => JSON.stringify(v).slice(0, 500);
async function fn(name: string, body: unknown, token?: string): Promise<{ status: number; body: any }> {
  const r = await fetch(`${API}/api/functions/${name}`, {
    method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body ?? {}),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function integration(path: string, body: unknown, header: Record<string, string>) {
  const r = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json", ...header }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) as any };
}
async function login(email: string): Promise<string> {
  const r = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "Password123!" }) });
  const token = ((await r.json().catch(() => ({}))) as any).token;
  if (!token) throw new Error(`could not sign in as ${email}: ${r.status}`);
  return token;
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
for (const c of await db.listCollections().toArray()) if (c.name !== "commission_roles") await db.collection(c.name).deleteMany({});

step("Setting up");
const hash = await bcrypt.hash("Password123!", 10);
const now = new Date().toISOString();
const person = (full_name: string, app_role: string, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), email: `${full_name.toLowerCase().replace(/\s+/g, ".")}@e2e-merge.test`, full_name, app_role,
  password_hash: hash, status: "active", created_date: now, updated_date: now, ...extra,
});
const admin = person("Super Admin", "super_admin");
const manager = person("Mona Manager", "cs_manager");
const cs1 = person("Cee One", "cs", { up_head_id: String(manager._id) });
const cs2 = person("Cee Two", "cs", { up_head_id: String(manager._id) });
const outsider = person("Otto Outside", "cs");
await db.collection("users").insertMany([admin, manager, cs1, cs2, outsider] as any[]);
await db.collection("teams").insertMany([
  { _id: new ObjectId(), name: "Team One", leader_id: String(cs1._id), member_ids: [String(cs1._id)], status: "active" },
  { _id: new ObjectId(), name: "Team Two", leader_id: String(cs2._id), member_ids: [String(cs2._id)], status: "active" },
] as any[]);
const stu = (code: string, cs: any, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), student_code: code, full_name: `Aisha Khan`, email: `${code.toLowerCase()}@e2e-merge.test`, phone: "+971 50 123 4567",
  primary_mentor_id: String(cs._id), primary_mentor_name: cs.full_name, team_id: "", team_name: "", assignment_status: "assigned",
  status: "ACTIVE", created_date: now, updated_date: now, ...extra,
});
const K = stu("STU-0101", cs1, {
  created_date: "2026-01-01T00:00:00.000Z", first_assignee_id: String(cs1._id), first_assignee_name: "Cee One", first_assigned_at: "2026-01-01T00:00:00.000Z", assigned_at: "2026-01-01T00:00:00.000Z", tags: ["Gold"], lms_user_id: "aaaaaaaaaaaaaaaaaaaaaaa1", finance_invoice_id: "inv-k", finance_invoice_number: "IN-K",
  course_fees: [{ invoice_id: "inv-k", course: "DSLP" }], net_deposit_usd: 100, notes: "Kept's note",
});
const C = stu("STU-0102", cs2, {
  email: "Aisha.Second@e2e-merge.test", phone: "0501234567", created_date: "2026-03-01T00:00:00.000Z", tags: ["Gold", "VIP"], lms_user_id: "aaaaaaaaaaaaaaaaaaaaaaa2",
  finance_invoice_id: "inv-c", finance_invoice_number: "IN-C", course_fees: [{ invoice_id: "inv-c", course: "MBT" }], net_deposit_usd: 50.5,
  onboarded: true, onboarded_at: "2026-03-02T00:00:00.000Z", onboarded_by_name: "Cee Two", enrolment_status: "closed", country: "UAE", notes: "Closed's note",
});
const family = stu("STU-0103", outsider, { full_name: "Bilal Khan", phone: "+971501234567", email: "bilal@e2e-merge.test" });
const other = stu("STU-0104", cs1, { full_name: "Other Person", phone: "+971559999999", email: "other@e2e-merge.test" });
await db.collection("students").insertMany([K, C, family, other] as any[]);
const KID = String(K._id), CID = String(C._id);

// Records filed under the closed one — every shape the data has.
const seed = async (name: string, docs: any[]) => { const ids = docs.map(() => new ObjectId()); await db.collection(name).insertMany(docs.map((d, i) => ({ _id: ids[i], ...d }))); return ids; };
const [dep] = await seed("funding_transactions", [{ student_id: CID, student_code: "STU-0102", type: "DEPOSIT", status: "APPROVED", amount_usd: 500 }]);
await seed("funding_transactions", [{ student_id: CID, student_code: "STU-0102", type: "DEPOSIT", status: "APPROVED", amount_usd: 300 }]);
const [credit] = await seed("commission_credits", [{ student_id: CID, recipient_id: String(cs2._id), commission_usd: 25 }]);
const [mt5] = await seed("mt5_accounts", [{ student_id: CID, student_code: "STU-0102", mt5_login: "9001" }]);
const [hist] = await seed("student_history", [{ student_id: CID, at: now, type: "created", text: "made" }]);
const [rem] = await seed("followup_reminders", [{ key: "r1", items: [{ student_id: CID, student_code: "STU-0102" }, { student_id: String(other._id), student_code: "STU-0104" }] }]);
const [outcome] = await seed("meeting_outcomes", [{ student_ids: [KID, CID], reminders: [{ student_id: CID }] }]);
const [wa] = await seed("whatsapp_messages", [{ student_ids: [CID], text: "hi" }]);
const [act] = await seed("lms_activity", [{ student_id: CID, student: { id: CID, code: "STU-0102" } }]);
const [logDoc] = await seed("logs", [{ entity_type: "Student", entity_id: new ObjectId(CID) }]);
const [call] = await seed("student_calls", [{ key: "call-1", student_id: CID, student_code: "STU-0102", started_at: now }]);
const [kHist] = await seed("student_history", [{ student_id: KID, at: now, type: "created", text: "kept made" }]);
const [mystery] = await seed("mystery_new_feature", [{ owner: { student: CID } }]);
const snapshot = async () => {
  const out: Record<string, any> = {};
  for (const n of ["funding_transactions", "commission_credits", "mt5_accounts", "student_history", "followup_reminders", "meeting_outcomes", "whatsapp_messages", "lms_activity", "logs", "student_calls", "mystery_new_feature"]) {
    out[n] = await db.collection(n).find({}).sort({ _id: 1 }).toArray();
  }
  out.students = await db.collection("students").find({ _id: { $in: [K._id, C._id] } }).sort({ _id: 1 }).toArray();
  return JSON.stringify(out);
};
const before = await snapshot();

const tAdmin = await login(admin.email), tManager = await login(manager.email), tCs = await login(cs1.email), tOutsider = await login(outsider.email);

/* ── 1 ── */
step("1. Finding students recorded twice");
let r = await fn("findDuplicateStudents", {}, tAdmin);
const group = (r.body.groups ?? []).find((g: any) => g.students.some((s: any) => s.id === KID));
check("a Super Admin sees the same-phone group: both records, and the family member on that phone", r.status === 200 && group?.students.length === 3
  && group.by.includes("phone") && group.students.some((s: any) => s.code === "STU-0103"), show(r.body));
check("…and nothing for a student alone on their number", !(r.body.groups ?? []).some((g: any) => g.students.some((s: any) => s.code === "STU-0104")));
r = await fn("findDuplicateStudents", {}, tManager);
check("a CS Manager: not a group with a student outside their reach (the family member's CS is not theirs)", r.status === 200 && !(r.body.groups ?? []).some((g: any) => g.key === group?.key), show(r.body));
check("a CS: refused", (await fn("findDuplicateStudents", {}, tCs)).status === 403);
r = await fn("dismissDuplicateGroup", { key: group?.key }, tAdmin);
check("\"Not a duplicate\" hides the group…", r.status === 200 && !((await fn("findDuplicateStudents", {}, tAdmin)).body.groups ?? []).some((g: any) => g.key === group?.key));
check("…shown again on asking", ((await fn("findDuplicateStudents", { includeDismissed: true }, tAdmin)).body.groups ?? []).some((g: any) => g.key === group?.key && g.dismissed));
await fn("dismissDuplicateGroup", { key: group?.key, undo: true }, tAdmin);
check("…and back after \"Show again\"", ((await fn("findDuplicateStudents", {}, tAdmin)).body.groups ?? []).some((g: any) => g.key === group?.key));

/* ── 2 ── */
step("2. Preview — nothing changed");
r = await fn("previewStudentMerge", { keepId: KID, closeId: CID }, tManager);
const pv = r.body;
check("both sides with their CS, deposits and LMS account", r.status === 200 && pv.kept?.cs?.name === "Cee One" && pv.closed?.cs?.name === "Cee Two"
  && pv.closed.deposits === 2 && pv.kept.lms && pv.closed.lms, show(pv));
const moveOf = (label: string) => (pv.moves ?? []).find((m: any) => m.label.startsWith(label))?.count;
check("what moves, per place", moveOf("Deposits") === 2 && moveOf("MT5") === 1 && moveOf("History") === 1 && moveOf("Follow-up reminder") === 1
  && moveOf("Meeting outcomes") === 1 && moveOf("Commission credits") === 1 && moveOf("Activity log") === 1, show(pv.moves));
check("what the kept one takes from it", ["country"].every((f) => pv.takes.includes(f)) && pv.takes.includes("tags") && pv.takes.includes("course_fees"), show(pv.takes));
check("a suggestion: keep the one with deposits; its CS, who worked them", pv.suggestion?.keepId === CID && pv.suggestion?.csFrom === "closed", show(pv.suggestion));
check("nothing changed by the preview", (await snapshot()) === before);

/* ── 3 ── */
step("3. Refused");
const mergeBody = { keepId: KID, closeId: CID, csFrom: "closed", otherCsAsCommon: true, confirm: "STU-0102" };
check("a CS: refused", (await fn("mergeStudents", mergeBody, tCs)).status === 403);
check("a CS Manager, a student outside their reach: refused", (await fn("mergeStudents", { ...mergeBody, closeId: String(family._id), confirm: "STU-0103" }, tManager)).status === 403);
check("the wrong confirmation: refused", (await fn("mergeStudents", { ...mergeBody, confirm: "STU-0101" }, tManager)).status === 400);
check("the same student twice: refused", (await fn("mergeStudents", { ...mergeBody, closeId: KID, confirm: "STU-0101" }, tManager)).status === 400);
check("…and still nothing changed", (await snapshot()) === before);

/* ── 4 ── */
step("4. The merge (by the CS Manager): the closed record's CS kept, the other as Common");
r = await fn("mergeStudents", mergeBody, tManager);
const res = r.body;
check("merged: 200, what moved", r.status === 200 && res.kept?.code === "STU-0101" && res.closed?.code === "STU-0102" && (res.moved ?? []).length >= 9, show(res));
const one = async (n: string, id: ObjectId) => db.collection(n).findOne({ _id: id }) as Promise<any>;
check("deposits: student id and code are the kept record's", (await db.collection("funding_transactions").countDocuments({ student_id: KID, student_code: "STU-0101" })) === 2
  && (await one("funding_transactions", dep!)).student_id === KID);
const cr = await one("commission_credits", credit!);
check("commission credited stays with whoever earned it (recipient unchanged), now on the kept record", cr.student_id === KID && cr.recipient_id === String(cs2._id), show(cr));
check("MT5 account, history, calls moved", (await one("mt5_accounts", mt5!)).student_code === "STU-0101" && (await one("student_history", hist!)).student_id === KID
  && (await one("student_calls", call!)).student_code === "STU-0101");
const fr = await one("followup_reminders", rem!);
check("inside a list of items: this student's entry changed, the other student's left alone",
  fr.items[0].student_id === KID && fr.items[0].student_code === "STU-0101" && fr.items[1].student_id === String(other._id), show(fr.items));
const mo = await one("meeting_outcomes", outcome!);
check("a list holding both: the kept one once; nested entries moved", mo.student_ids.length === 1 && mo.student_ids[0] === KID && mo.reminders[0].student_id === KID, show(mo));
check("WhatsApp, LMS activity (nested id and code)", (await one("whatsapp_messages", wa!)).student_ids[0] === KID
  && (await one("lms_activity", act!)).student.id === KID && (await one("lms_activity", act!)).student.code === "STU-0101" && (await one("lms_activity", act!)).student_id === KID);
const lg = await one("logs", logDoc!);
check("an id stored as an ObjectId stays an ObjectId", lg.entity_id instanceof ObjectId && lg.entity_id.toHexString() === KID, show(lg));
check("a place nobody listed is reported as a leftover", (res.leftovers ?? []).some((x: any) => x.col === "mystery_new_feature" && x.path === "owner.student"), show(res.leftovers));
check("the closed record is gone from Students", !(await db.collection("students").findOne({ _id: C._id })));
const k = await db.collection("students").findOne({ _id: K._id }) as any;
check("the CS picked: Cee Two, with Team Two — the app's change of CS", k.primary_mentor_id === String(cs2._id) && k.primary_mentor_name === "Cee Two", show({ cs: k.primary_mentor_name, team: k.team_name }));
check("…the other CS kept as a Common CS", (k.common_cs ?? []).some((c: any) => c.id === String(cs1._id)) && !(k.common_cs ?? []).some((c: any) => c.id === String(cs2._id)), show(k.common_cs));
check("lists put together: tags once each, both course fees", JSON.stringify(k.tags) === JSON.stringify(["Gold", "VIP"]) && k.course_fees.length === 2, show({ tags: k.tags, fees: k.course_fees }));
check("what it lacked taken (country); its own kept (email, code, created)", k.country === "UAE" && k.email === K.email && k.student_code === "STU-0101" && k.created_date === K.created_date);
check("onboarded on the closed one, enrolment Closed: carried over", k.onboarded === true && k.onboarded_at === "2026-03-02T00:00:00.000Z" && k.enrolment_status === "closed");
check("deposit totals added; both notes", k.net_deposit_usd === 150.5 && /Kept's note/.test(k.notes) && /From STU-0102: Closed's note/.test(k.notes), show({ n: k.net_deposit_usd, notes: k.notes }));
check("the closed one's identity kept: code, email, LMS account, finance invoice", JSON.stringify(k.other_codes) === '["STU-0102"]' && JSON.stringify(k.other_emails) === '["aisha.second@e2e-merge.test"]'
  && k.lms_user_id === "aaaaaaaaaaaaaaaaaaaaaaa1" && JSON.stringify(k.other_lms_user_ids) === '["aaaaaaaaaaaaaaaaaaaaaaa2"]'
  && k.finance_invoice_id === "inv-k" && JSON.stringify(k.other_finance_invoice_ids) === '["inv-c"]', show(k));
const kh = await db.collection("student_history").find({ student_id: KID }).toArray() as any[];
check("history on the kept record: the CS change and the merge", kh.some((h) => h.type === "mentor_changed" && /Cee Two/.test(h.text)) && kh.some((h) => h.type === "merged" && /STU-0102/.test(h.text) && /Common/.test(h.text)), show(kh.map((h) => h.text)));
// Finance and the LMS, asking about the closed record, land on the kept one.
const lookup = await integration("/api/v1/integrations/finance/students/lookup", { codes: ["STU-0102"], emails: ["aisha.second@e2e-merge.test"] }, { "x-finance-secret": process.env.FINANCE_S2S_SECRET! });
check("finance asking for STU-0102 or its email: the kept record (STU-0101, its CS)", lookup.status === 200 && (lookup.body.data?.students ?? lookup.body.students ?? []).every((s: any) => s.code === "STU-0101" && s.cs === "Cee Two"), show(lookup.body));
const lcs = await integration("/api/v1/integrations/lms/student-cs", { lmsUserId: "aaaaaaaaaaaaaaaaaaaaaaa2", email: "aisha.second@e2e-merge.test" }, { "x-lms-secret": process.env.LMS_S2S_SECRET! });
check("the LMS asking by the closed record's LMS account: the kept record and its CS", lcs.status === 200 && (lcs.body.data ?? lcs.body).found === true && (lcs.body.data ?? lcs.body).code === "STU-0101" && (lcs.body.data ?? lcs.body).cs === "Cee Two", show(lcs.body));
const lcs2 = await integration("/api/v1/integrations/lms/student-cs", { email: "aisha.second@e2e-merge.test" }, { "x-lms-secret": process.env.LMS_S2S_SECRET! });
check("…and by its email alone", (lcs2.body.data ?? lcs2.body).code === "STU-0101", show(lcs2.body));
const mergeId = res.mergeId;

/* ── 5 ── */
step("5. Once only");
check("merging the closed record again: it is not here any more", (await fn("mergeStudents", mergeBody, tAdmin)).status === 404);

/* ── 6 ── */
step("6. Undo");
// A field changed after the merge is left as it is.
await db.collection("students").updateOne({ _id: K._id }, { $set: { country: "Qatar" } });
r = await fn("undoStudentMerge", { mergeId }, tManager);
check("undone: 200; the field changed since is left and reported", r.status === 200 && (r.body.leftAsIs ?? []).some((x: any) => x.field === "country"), show(r.body));
await db.collection("students").updateOne({ _id: K._id }, { $unset: { country: "" } });
const after = JSON.parse(await snapshot()), was = JSON.parse(before);
// lms_cs_sent: what the LMS was last told of the student's CS — written by the test's own LMS lookup after the merge.
const strip = (x: any) => JSON.stringify(x, (key, v) => (key === "lms_cs_sent" ? undefined : v));
const differ = Object.keys(was).filter((n) => n !== "student_history" && strip(after[n]) !== strip(was[n]));
/** Which fields of which documents differ — for a failure to say exactly what. */
const fieldDiff = (a: any[], b: any[]) => a.flatMap((d, i) => [...new Set([...Object.keys(d), ...Object.keys(b[i] ?? {})])]
  .filter((f) => strip(d[f]) !== strip(b[i]?.[f])).map((f) => `${d.student_code ?? d._id}.${f}: ${strip(d[f])} → ${strip(b[i]?.[f])}`));
check("every record exactly as before (history keeps the merge's lines)", !differ.length, differ.map((n) => `${n}: ${fieldDiff(was[n], after[n]).join("; ")}`).join(" | "));
check("the closed record is back in Students", !!(await db.collection("students").findOne({ _id: C._id })));
check("…its history lines back on it, and the kept record's own", (await one("student_history", hist!)).student_id === CID && (await one("student_history", kHist!)).student_id === KID);
check("undoing again: refused", (await fn("undoStudentMerge", { mergeId }, tAdmin)).status === 409);

/* ── 7 ── */
step("7. A merge that stops part-way");
// The database refuses the history move: the merge stops there.
await db.command({ collMod: "student_history", validator: { $expr: { $ne: ["$student_id", KID] } }, validationAction: "error", validationLevel: "strict" });
r = await fn("mergeStudents", { ...mergeBody, csFrom: "kept", otherCsAsCommon: false }, tAdmin);
const failed: any = await db.collection("student_merges").findOne({}, { sort: { at: -1 } });
check("stopped: 500, saying so; recorded as failed, with the error", r.status === 500 && /part-way/.test(r.body?.error ?? "") && failed?.status === "failed" && !!failed.error, show({ r: r.body, status: failed?.status }));
check("…the closed record still in Students (it stopped before)", !!(await db.collection("students").findOne({ _id: C._id })));
await db.command({ collMod: "student_history", validator: {}, validationLevel: "off" });
r = await fn("undoStudentMerge", { mergeId: String(failed._id) }, tAdmin);
const after2 = JSON.parse(await snapshot());
const differ2 = Object.keys(was).filter((n) => n !== "student_history" && strip(after2[n]) !== strip(was[n]));
check("undone: everything back as it was", r.status === 200 && !differ2.length, differ2.map((n) => `${n}: ${fieldDiff(was[n], after2[n]).join("; ")}`).join(" | "));

/* ── 8 ── */
step("8. History");
r = await fn("getStudentMerges", {}, tAdmin);
check("a Super Admin: every merge — the undone one and the failed one", r.status === 200 && r.body.total === 2 && r.body.merges.every((m: any) => m.status === "undone"), show(r.body.merges?.map((m: any) => m.status)));
r = await fn("getStudentMerges", {}, tManager);
check("a CS Manager: their own", r.status === 200 && r.body.total === 1 && r.body.merges[0].by === "Mona Manager", show(r.body));
check("a CS: refused", (await fn("getStudentMerges", {}, tCs)).status === 403);
// One at a time: a merge already running holds the student.
await db.collection("student_merges").insertOne({ status: "running", lock_keys: [KID, CID], at: new Date().toISOString() });
check("one merge of a student at a time: a second is refused while one runs", (await fn("mergeStudents", mergeBody, tAdmin)).status === 409);
await db.collection("student_merges").deleteOne({ status: "running" });
void tOutsider; void mystery;

console.log(`\n${pass} passed, ${fail} failed`);
await client.close();
process.exit(fail ? 1 : 0);
