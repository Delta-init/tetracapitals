import { writeFileSync } from "node:fs";
import { ObjectId } from "mongodb";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";
import { loadTeams } from "../students/teams";

/**
 * Everything about one student, to check them (the user, 2026-10-27) — read only, nothing is changed.
 *
 *   1. Their record: every student with this email (duplicates), and others with the same phone or name.
 *   2. CS and team: who they're with, their team and location, Common CS, who got them first, their moves.
 *   3. LMS: account, enrolment, courses, classes, class completions.
 *   4. Money: funding requests (deposits, withdrawals, bonuses), commission, course upgrades and payments,
 *      payment links, Zoho invoices.
 *   5. Activity: follow-ups and notes, 3CX calls, WhatsApp, emails, history.
 *
 *   cd backend
 *   bun src/scripts/student-check.ts --email=someone@gmail.com                    (or --code=STU-1234)
 *   bun src/scripts/student-check.ts --email=someone@gmail.com --out=~/check.json
 *   python3 src/scripts/sheets-to-xlsx.py ~/check.json ~/check.xlsx               (every row, one sheet per part)
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env).
 */

const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const email = option("email")?.trim().toLowerCase();
const code = option("code")?.trim().toUpperCase();
const out = option("out")?.replace(/^~(?=\/)/, process.env.HOME ?? "~");
if (!email && !code) { console.log("Give --email=<address> or --code=STU-1234 [--out=<file.json>]"); process.exit(1); }
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const day = (v: unknown) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 16).replace("T", " ") : "—");
const show = (v: unknown): string => (v == null || v === "" ? "—" : Array.isArray(v) ? (v.length ? v.map(show).join(", ") : "—") : typeof v === "object" && !(v instanceof Date) && !(v instanceof ObjectId) ? JSON.stringify(v) : String(v));
const last9 = (p: unknown) => String(p ?? "").replace(/\D/g, "").slice(-9);
const line = (label: string, v: unknown) => console.log(`  ${label.padEnd(24)} ${show(v)}`);
const head = (t: string) => console.log(`\n━━ ${t} ${"━".repeat(Math.max(0, 70 - t.length))}`);

/** A doc as one spreadsheet row: nested fields as JSON, dates as text. */
function flat(doc: any): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    row[k] = v == null ? "" : v instanceof Date ? v.toISOString() : v instanceof ObjectId ? String(v) : typeof v === "object" ? JSON.stringify(v) : v;
  }
  return row;
}
const sheets: { name: string; columns: string[]; rows: unknown[][] }[] = [];
function sheet(name: string, docs: any[]) {
  if (!docs.length) return;
  const rows = docs.map(flat);
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  sheets.push({ name, columns, rows: rows.map((r) => columns.map((c) => r[c] ?? "")) });
}

await connectDb();
console.log(`${host}/${config.mongoDb} — read only`);
try {
  // ── 1. The record ────────────────────────────────────────────────────────
  const found = (await col("students").find(email
    ? { email: { $regex: `(^|[\\s,;<])${escape(email)}($|[\\s,;>])`, $options: "i" } }
    : { student_code: code }).toArray()) as any[];
  if (!found.length) { console.log(`\nNo student with ${email ? `the email ${email}` : `the code ${code}`}.`); process.exit(0); }

  const teams = await loadTeams();
  const nameOf = (id: unknown) => (id ? String(teams.userById.get(String(id))?.full_name || teams.userById.get(String(id))?.email || id) : "—");
  head(`1. Record — ${found.length} student${found.length === 1 ? "" : "s"} with ${email || code}`);
  if (found.length > 1) console.log("  ⚠ More than one student has this email — duplicates.");
  for (const s of found) {
    console.log(`\n  ${s.full_name} · ${s.student_code ?? "no code"} · id ${s._id}`);
    line("Email", s.email); line("Phone", s.phone);
    line("Status", s.status); line("Enrolment", s.enrolment_status);
    line("Created", day(s.created_date)); line("Source", s.source || s.lead_source);
    line("Onboarded", s.onboarded ? `yes, ${day(s.onboarded_at)} by ${s.onboarded_by_name || "—"}${s.onboarded_via ? ` (${s.onboarded_via})` : ""}` : "no");
    line("Not a student", s.not_student ? `yes, ${day(s.not_student_at)}` : "no");
    line("Priority", s.priority); line("Categories", s.categories);
    line("Birth date", s.birth_date); line("MT5", s.mt5_login || (s.mt5_accounts ?? []).map((a: any) => a.login ?? a));
  }
  sheet("Students", found);

  const phones = [...new Set(found.map((s) => last9(s.phone)).filter((p) => p.length === 9))];
  const names = [...new Set(found.map((s) => String(s.full_name ?? "").trim()).filter(Boolean))];
  const ids = found.map((s) => s._id);
  const lookalikes = (await col("students").find({
    _id: { $nin: ids },
    $or: [
      ...phones.map((p) => ({ phone: { $regex: p.split("").join("\\D*") + "\\D*$" } })),
      ...names.map((n) => ({ full_name: { $regex: `^\\s*${escape(n)}\\s*$`, $options: "i" } })),
    ],
  }, { projection: { full_name: 1, student_code: 1, email: 1, phone: 1, primary_mentor_id: 1, created_date: 1 } }).toArray()) as any[];
  if (lookalikes.length) {
    console.log(`\n  Others with the same phone or name (${lookalikes.length}):`);
    for (const o of lookalikes) console.log(`   · ${o.full_name} · ${o.student_code ?? "—"} · ${show(o.email)} · ${show(o.phone)} · CS ${nameOf(o.primary_mentor_id)} · ${day(o.created_date)}`);
    sheet("Same phone or name", lookalikes);
  }

  // Everything else is by student id (as text or ObjectId), and a few by email.
  const sid = [...ids.map(String), ...ids];
  const byStudent = { $or: [{ student_id: { $in: sid } }, { student_ids: { $in: sid } }] };
  const find = async (name: string, filter: any = byStudent, sort: any = { _id: 1 }) =>
    (await col(name).find(filter).sort(sort).limit(2000).toArray().catch(() => [])) as any[];

  // ── 2. CS and team ───────────────────────────────────────────────────────
  head("2. CS and team");
  const history = await find("student_history", byStudent, { at: 1, created_date: 1, _id: 1 });
  for (const s of found) {
    const team = teams.teamOf(s.primary_mentor_id);
    console.log(`\n  ${s.student_code ?? s.full_name}`);
    line("CS now", nameOf(s.primary_mentor_id));
    line("Team", team ? `${team.name} (${team.location})` : s.team_name || "none");
    line("Location", s.current_location || s.location);
    line("Common CS", (s.common_cs ?? []).map(nameOf));
    line("Closed by", s.closed_by_name || nameOf(s.closed_by));
    line("First received by", s.first_assignee_name ? `${s.first_assignee_name} (${s.first_assignee_role || "—"}), ${day(s.first_assigned_at)}` : "—");
  }
  const moves = history.filter((h) => ["arrived", "created", "assigned", "mentor_changed"].includes(h.type));
  console.log(`\n  Moves (${moves.length}):`);
  for (const h of moves) console.log(`   · ${day(h.at || h.created_date)}  ${h.type.padEnd(15)} ${h.text || ""}${h.by_name ? `  — ${h.by_name}` : ""}`);

  // ── 3. LMS ───────────────────────────────────────────────────────────────
  head("3. LMS");
  for (const s of found) {
    console.log(`\n  ${s.student_code ?? s.full_name}`);
    line("LMS account", s.lms_user_id ? `yes (${s.lms_user_id})` : s.lms_account ? show(s.lms_account) : "no");
    line("Courses", (s.lms_courses ?? []).map((c: any) => c?.title || c?.code || c));
    line("Classes", s.lms_classes);
    line("Last LMS activity", s.lms_activity);
    line("Enrolment set by", s.enrolment_updated_by_name ? `${s.enrolment_updated_by_name}, ${day(s.enrolment_updated_at)}` : "—");
  }
  const completions = await find("class_completions", byStudent, { ended_at: 1 });
  console.log(`\n  Class completions (${completions.length}):`);
  for (const c of completions) console.log(`   · ${day(c.ended_at)}  ${c.title || c.class_title || "class"}  told ${day(c.notified_at)}  called ${day(c.called_at)}`);
  const lmsActivity = await find("lms_activity", byStudent, { at: 1 });
  sheet("Class completions", completions); sheet("LMS activity", lmsActivity);

  // ── 4. Money ─────────────────────────────────────────────────────────────
  head("4. Money");
  const funding = await find("funding_transactions", byStudent, { created_date: 1 });
  console.log(`\n  Funding requests (${funding.length}):`);
  for (const f of funding) {
    console.log(`   · ${day(f.created_date)}  ${String(f.type ?? "").padEnd(10)} ${String(f.status ?? "").padEnd(10)} ${show(f.amount)} ${f.currency ?? ""}  ${f.tags?.length ? `[${f.tags.join(", ")}] ` : ""}by ${f.initiating_mentor_name || nameOf(f.initiating_mentor_id)}`);
  }
  const credits = await find("commission_credits", byStudent, { created_date: 1 });
  console.log(`\n  Commission credits (${credits.length}):`);
  for (const c of credits) console.log(`   · ${day(c.created_date || c.requested_at)}  ${c.recipient_name || nameOf(c.recipient_id)}  L${show(c.level)}  ${show(c.commission_usd)} USD  ${c.status ?? ""}`);
  const upgrades = await find("course_upgrades", byStudent, { created_at: 1 });
  const payments = await find("course_payments", byStudent, { created_at: 1 });
  console.log(`\n  Course upgrades (${upgrades.length}):`);
  for (const u of upgrades) console.log(`   · ${day(u.created_at)}  ${u.course ?? ""} ${u.plan ?? ""}  ${u.status ?? ""}  due ${show(u.quote?.dueAed)} AED  by ${u.created_by_name || nameOf(u.created_by)}`);
  console.log(`\n  Course payments (${payments.length}):`);
  for (const p of payments) console.log(`   · ${day(p.created_at)}  ${show(p.amount_aed)} AED (approved ${show(p.approved_amount_aed)})  ${p.method ?? ""}  ${p.status ?? ""}  decided ${day(p.decided_at)}`);
  const links = await find("payment_link_requests", byStudent, { created_at: 1 });
  console.log(`\n  Payment links (${links.length}):`);
  for (const l of links) console.log(`   · ${day(l.created_at || l.created_date)}  ${show(l.amount)} ${l.currency ?? ""}  ${l.status ?? ""}  ${l.kind || l.provider || ""}`);
  const emails = [...new Set(found.flatMap((s) => String(s.email ?? "").toLowerCase().match(/[^\s,;<>]+@[^\s,;<>]+/g) ?? []))];
  const invoices = await find("zoho_invoices", { $or: [byStudent, ...emails.map((e) => ({ email: { $regex: `^${escape(e)}$`, $options: "i" } }))] }, { date: 1 });
  console.log(`\n  Zoho invoices (${invoices.length}):`);
  for (const i of invoices) console.log(`   · ${show(i.date)}  ${i.invoice_number ?? ""}  ${show(i.total)} ${i.currency_code ?? i.currency ?? ""}  ${i.status ?? ""}  ${i.student_id ? "" : "(not linked)"}`);
  const enrolmentPayments = await find("enrolment_payments", byStudent);
  sheet("Funding requests", funding); sheet("Commission credits", credits); sheet("Course upgrades", upgrades);
  sheet("Course payments", payments); sheet("Payment links", links); sheet("Zoho invoices", invoices); sheet("Enrolment payments", enrolmentPayments);

  // ── 5. Activity ──────────────────────────────────────────────────────────
  head("5. Activity");
  const followups = await find("student_followups", byStudent, { created_date: 1 });
  const open = followups.filter((f) => !f.done && !f.completed && f.status !== "done");
  console.log(`\n  Follow-ups (${followups.length}, ${open.length} open):`);
  for (const f of followups.slice(-15)) console.log(`   · ${day(f.created_date)}  next ${show(f.next_followup_date || f.due_date)}  ${f.category ?? ""}  ${String(f.what_client_said || f.note || f.notes || "").replace(/\s+/g, " ").slice(0, 90)}  — ${f.created_by_name || nameOf(f.mentor_id)}`);
  if (followups.length > 15) console.log(`   … ${followups.length - 15} earlier in the spreadsheet`);
  const events = await find("student_followup_events", byStudent, { at: 1 });
  const calls = await find("student_calls", byStudent, { started_at: 1 });
  console.log(`\n  3CX calls (${calls.length}, ${calls.filter((c) => c.status === "answered").length} answered):`);
  for (const c of calls.slice(-15)) console.log(`   · ${day(c.started_at)}  ${c.direction === "in" ? "in " : "out"}  ${String(c.status ?? "").padEnd(9)} ${c.talk_seconds ?? 0}s  ${c.user_name || c.agent_name || c.extension || "nobody"}${c.recording_ids?.length ? "  🎙" : ""}`);
  const whatsapp = await find("whatsapp_messages", byStudent, { at: 1 });
  console.log(`\n  WhatsApp (${whatsapp.length} — ${whatsapp.filter((m) => m.direction === "in").length} from them, ${whatsapp.filter((m) => m.direction === "out").length} to them):`);
  for (const m of whatsapp.slice(-10)) console.log(`   · ${day(m.at)}  ${m.direction === "in" ? "←" : "→"}  ${nameOf(m.owner_id)}  ${String(m.body ?? "").replace(/\s+/g, " ").slice(0, 80)}`);
  const mails = await find("email_log", byStudent, { at: 1 });
  console.log(`\n  Emails from the portal (${mails.length}):`);
  for (const m of mails) console.log(`   · ${day(m.at)}  ${m.kind ?? ""}  ${m.subject ?? ""}  ${m.status ?? ""}  — ${m.by_name ?? ""}`);
  const others = history.filter((h) => !moves.includes(h));
  console.log(`\n  Other history (${others.length}): ${[...new Set(others.map((h) => h.type))].join(", ") || "—"}`);
  sheet("Follow-ups", followups); sheet("Follow-up events", events); sheet("Calls", calls);
  sheet("WhatsApp", whatsapp.map(({ media, ...m }) => ({ ...m, media: media?.type ?? "" }))); sheet("Emails", mails); sheet("History", history);

  if (out) {
    writeFileSync(out, JSON.stringify({ title: `Student check — ${email || code}`, notes: `Read from ${config.mongoDb} on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, sheets }, null, 1));
    console.log(`\nSaved ${sheets.length} sheets to ${out} — python3 src/scripts/sheets-to-xlsx.py ${out} ${out.replace(/\.json$/, "")}.xlsx`);
  }
} finally {
  await closeDb();
}
