import { writeFileSync } from "node:fs";
import { ObjectId } from "mongodb";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";

/**
 * What some CSs have been doing (the user, 2026-10-26: "CS 1- EX, CS2, haritha, Megha … their activity") — read only.
 *
 * For each person named, over the last --days days (Dubai): their 3CX calls, follow-ups opened, logged and notes,
 * changes to students (their history), funding requests raised, WhatsApp messages sent and received, and emails
 * sent from the portal. Three sheets for sheets-to-xlsx.py: a summary per CS, a day-by-day count, and every
 * activity in order.
 *
 *   cd backend
 *   bun src/scripts/cs-activity-export.ts --names="CS 1- EX,CS2,haritha,Megha" --days=30 --out=<file.json>
 *   python3 src/scripts/sheets-to-xlsx.py <file.json> <file.xlsx>
 *
 * A name matches an account whose name or email holds it (case, spaces and dashes aside); every match is listed.
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env). Writes nothing there.
 */

const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const names = (option("names") ?? "").split(",").map((n) => n.trim()).filter(Boolean);
const days = Math.max(1, Math.min(366, Number(option("days")) || 30));
const out = option("out");
if (!names.length || !out) { console.log('Give --names="A,B" [--days=30] --out=<file.json>'); process.exit(1); }
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const key = (v: unknown) => String(v ?? "").toLowerCase().replace(/[\s\-_.]/g, "");
const dubai = (iso: unknown) => (iso ? new Date(new Date(String(iso)).getTime() + 4 * 3600_000).toISOString().replace("T", " ").slice(0, 16) : "");
const short = (v: unknown, n = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const ROLE: Record<string, string> = { cs: "CS", cs_manager: "CS Manager" };

await connectDb();
console.log(`${host}/${config.mongoDb} — read only`);
try {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const users = (await col("users").find({}, { projection: { full_name: 1, email: 1, app_role: 1, status: 1 } }).toArray()) as any[];
  const people: any[] = [];
  for (const n of names) {
    const k = key(n);
    const hits = users.filter((u) => key(u.full_name) === k).length ? users.filter((u) => key(u.full_name) === k) : users.filter((u) => key(u.full_name).includes(k) || key(String(u.email).split("@")[0]).includes(k));
    if (!hits.length) console.log(`  "${n}": no account found`);
    for (const u of hits) { if (!people.some((p) => String(p._id) === String(u._id))) people.push(u); console.log(`  "${n}" → ${u.full_name} <${u.email}> ${u.app_role}${u.status === "inactive" ? " (off)" : ""}`); }
  }
  if (!people.length) { console.log("Nobody to report on."); process.exit(1); }
  const ids = people.map((p) => String(p._id));
  const nameOf = new Map(people.map((p) => [String(p._id), p.full_name ?? p.email]));

  const [calls, events, history, funding, wa, mail] = await Promise.all([
    col("student_calls").find({ user_id: { $in: ids }, started_at: { $gte: since } } as any, { projection: { user_id: 1, student_id: 1, started_at: 1, direction: 1, answered: 1, talk_seconds: 1, phone: 1 } }).toArray(),
    col("student_followup_events").find({ by_id: { $in: ids }, at: { $gte: since } } as any, { projection: { by_id: 1, student_id: 1, at: 1, kind: 1, stage_to: 1, client_said: 1, notes: 1, text: 1 } }).toArray(),
    col("student_history").find({ by_id: { $in: ids }, at: { $gte: since } } as any, { projection: { by_id: 1, student_id: 1, at: 1, type: 1, text: 1 } }).toArray(),
    col("funding_transactions").find({ requested_by_id: { $in: ids }, $or: [{ requested_at: { $gte: since } }, { requested_at: { $in: [null, ""] }, created_date: { $gte: since } }] } as any, { projection: { requested_by_id: 1, student_id: 1, student_name: 1, type: 1, status: 1, amount_usd: 1, amount_aed: 1, course_payment: 1, requested_at: 1, created_date: 1 } }).toArray(),
    col("whatsapp_messages").find({ owner_id: { $in: ids }, at: { $gte: since } } as any, { projection: { owner_id: 1, direction: 1, at: 1, student_ids: 1 } }).toArray(),
    col("email_log").find({ by_id: { $in: ids }, at: { $gte: since } } as any, { projection: { by_id: 1, student_id: 1, at: 1, subject: 1, kind: 1, status: 1 } }).toArray(),
  ]) as any[][];

  const sids = [...new Set([...calls, ...events, ...history, ...funding, ...mail].map((x) => String(x.student_id ?? "")).filter((id) => ObjectId.isValid(id)))];
  const students = new Map(((await col("students").find({ _id: { $in: sids.map((id) => new ObjectId(id)) } }, { projection: { full_name: 1, student_code: 1 } }).toArray()) as any[]).map((s) => [String(s._id), s]));
  const who = (id: unknown) => { const s = students.get(String(id ?? "")); return s ? `${s.full_name ?? ""} ${s.student_code ?? ""}`.trim() : ""; };

  type Row = { at: string; cs: string; what: string; student: string; detail: string };
  const rows: Row[] = [];
  const KIND: Record<string, string> = { created: "Follow-up opened", logged: "Follow-up logged", note: "Follow-up note", auto_converted: "Follow-up converted" };
  for (const c of calls) rows.push({ at: c.started_at, cs: nameOf.get(String(c.user_id))!, what: c.direction === "in" ? "Call in" : "Call out", student: who(c.student_id), detail: `${c.answered ? `answered, ${Math.round((Number(c.talk_seconds) || 0) / 60 * 10) / 10} min` : c.direction === "in" ? "missed" : "no answer"}` });
  for (const e of events) rows.push({ at: e.at, cs: nameOf.get(String(e.by_id))!, what: KIND[e.kind] ?? `Follow-up ${e.kind}`, student: who(e.student_id), detail: short([e.stage_to ? `→ ${e.stage_to}` : "", e.client_said, e.notes].filter(Boolean).join(" · ") || e.text) });
  for (const h of history) rows.push({ at: h.at, cs: nameOf.get(String(h.by_id))!, what: `Student: ${String(h.type ?? "").replace(/_/g, " ")}`, student: who(h.student_id), detail: short(h.text) });
  for (const f of funding) rows.push({ at: f.requested_at || f.created_date, cs: nameOf.get(String(f.requested_by_id))!, what: `Funding request: ${f.type}`, student: f.student_name ?? who(f.student_id), detail: `${f.status} · $${Number(f.amount_usd) || 0}${f.course_payment?.product ? ` · ${f.course_payment.product}` : ""}` });
  for (const m of mail) rows.push({ at: m.at, cs: nameOf.get(String(m.by_id))!, what: "Email sent", student: who(m.student_id), detail: short(`${m.subject ?? ""}${m.status && m.status !== "sent" ? ` (${m.status})` : ""}`) });
  rows.sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const blank = () => ({ callsOut: 0, answered: 0, talk: 0, callsIn: 0, fuOpened: 0, fuLogged: 0, fuNotes: 0, studentChanges: 0, funding: 0, waOut: 0, waIn: 0, emails: 0, days: new Set<string>(), first: "", last: "" });
  const per = new Map(ids.map((id) => [id, blank()]));
  const daily = new Map<string, Map<string, number>>();
  const bump = (id: string, at: string) => {
    const s = per.get(id)!; const d = dubai(at).slice(0, 10);
    s.days.add(d); if (!s.first || at < s.first) s.first = at; if (!s.last || at > s.last) s.last = at;
    const m = daily.get(d) ?? new Map(); m.set(id, (m.get(id) ?? 0) + 1); daily.set(d, m);
  };
  for (const c of calls) { const s = per.get(String(c.user_id))!; if (c.direction === "in") s.callsIn++; else { s.callsOut++; if (c.answered) s.answered++; } s.talk += Number(c.talk_seconds) || 0; bump(String(c.user_id), c.started_at); }
  for (const e of events) { const s = per.get(String(e.by_id))!; if (e.kind === "created") s.fuOpened++; else if (e.kind === "logged") s.fuLogged++; else s.fuNotes++; bump(String(e.by_id), e.at); }
  for (const h of history) { per.get(String(h.by_id))!.studentChanges++; bump(String(h.by_id), h.at); }
  for (const f of funding) { per.get(String(f.requested_by_id))!.funding++; bump(String(f.requested_by_id), f.requested_at || f.created_date); }
  for (const m of wa) { const s = per.get(String(m.owner_id))!; if (m.direction === "out") { s.waOut++; bump(String(m.owner_id), m.at); } else s.waIn++; }
  for (const m of mail) { per.get(String(m.by_id))!.emails++; bump(String(m.by_id), m.at); }

  const summary = people.map((p) => {
    const s = per.get(String(p._id))!;
    return [p.full_name ?? "", ROLE[p.app_role] ?? p.app_role, p.status === "inactive" ? "Off" : "On", s.days.size, s.callsOut, s.answered, Math.round(s.talk / 60), s.callsIn,
      s.fuOpened, s.fuLogged, s.fuNotes, s.studentChanges, s.funding, s.waOut, s.waIn, s.emails, dubai(s.first), dubai(s.last)];
  });
  const dayRows = [...daily.keys()].sort().map((d) => [d, ...ids.map((id) => daily.get(d)?.get(id) ?? 0)]);

  writeFileSync(out, JSON.stringify({
    title: `CS activity — last ${days} days (${dubai(since).slice(0, 10)} to ${dubai(new Date().toISOString()).slice(0, 10)})`,
    notes: [`People: ${people.map((p) => p.full_name).join(", ")}`, "Times are Dubai. An active day is a day with anything they did (WhatsApp counted only when they sent).", `Looked up ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`],
    sheets: [
      { name: "Summary", columns: ["CS", "Role", "Account", "Active days", "Calls out", "Answered", "Talk (min)", "Calls in", "Follow-ups opened", "Follow-ups logged", "Follow-up notes", "Student changes", "Funding requests", "WhatsApp sent", "WhatsApp received", "Emails sent", "First activity", "Last activity"], rows: summary },
      { name: "Day by day", columns: ["Day", ...people.map((p) => p.full_name)], rows: dayRows },
      { name: "Activity", columns: ["When (Dubai)", "CS", "What", "Student", "Detail"], rows: rows.map((r) => [dubai(r.at), r.cs, r.what, r.student, r.detail]) },
    ],
  }, null, 1));
  console.log(`${people.length} people, last ${days} days: ${rows.length} activities (+ ${wa.length} WhatsApp messages counted) → ${out}`);
} finally {
  await closeDb();
}
