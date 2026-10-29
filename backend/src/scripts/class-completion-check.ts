import { ObjectId } from "mongodb";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";
import { loadTeams } from "../students/teams";
import { callLms, lmsConfigured } from "../lib/lms";
import { SHOWN_DAYS } from "../students/classCompletions";

/**
 * Why a student's class completion isn't on Class Completions (the user, 2026-10-29, for Murshid) — read only,
 * nothing is changed, here or in the LMS.
 *
 *   1. The student: every record with this email / code / name, their LMS account and CS.
 *   2. The class completions kept for them, and why each is or isn't on the page.
 *   3. Attended classes of theirs the portal couldn't match to a student ("not a student", retried for 7 days).
 *   4. What the LMS reports they attended in the last 31 days (the same read the portal makes every 2 minutes).
 *   5. Whether the portal's 2-minute LMS job runs on this server.
 *
 *   cd backend
 *   bun src/scripts/class-completion-check.ts --email=someone@gmail.com      (or --code=STU-1234, or --name=Murshid)
 *
 * Uses the same database and LMS link as the API (MONGO_URI / MONGO_DB / LMS_API_URL / LMS_SERVICE_SECRET, from .env).
 */

const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const email = option("email")?.trim().toLowerCase();
const code = option("code")?.trim().toUpperCase();
const name = option("name")?.trim();
if (!email && !code && !name) { console.log("Give --email=<address>, --code=STU-1234 or --name=<part of the name>"); process.exit(1); }
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const day = (v: unknown) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 16).replace("T", " ") : "—");
const show = (v: unknown): string => (v == null || v === "" ? "—" : Array.isArray(v) ? (v.length ? v.map(show).join(", ") : "—") : typeof v === "object" && !(v instanceof Date) && !(v instanceof ObjectId) ? JSON.stringify(v) : String(v));
const line = (label: string, v: unknown) => console.log(`  ${label.padEnd(24)} ${show(v)}`);
const head = (t: string) => console.log(`\n━━ ${t} ${"━".repeat(Math.max(0, 70 - t.length))}`);
const emailsOf = (raw: unknown) => String(raw ?? "").toLowerCase().split(/[\s,;<>/]+/).filter((e) => e.includes("@"));
const what = (c: any) => [c?.course, c?.title].filter(Boolean).join(" · ") || "a class";

await connectDb();
console.log(`${host}/${config.mongoDb} — read only`);
try {
  const now = new Date();
  // ── 1. The student ───────────────────────────────────────────────────────
  const found = (await col("students").find(
    email ? { email: { $regex: `(^|[\\s,;<])${escape(email)}($|[\\s,;>])`, $options: "i" } }
      : code ? { student_code: code }
      : { full_name: { $regex: escape(name!), $options: "i" } },
  ).limit(30).toArray()) as any[];
  if (!found.length) { console.log(`\nNo student with ${email ? `the email ${email}` : code ? `the code ${code}` : `"${name}" in the name`}.`); process.exit(0); }

  const teams = await loadTeams();
  const nameOf = (id: unknown) => (id ? String(teams.userById.get(String(id))?.full_name || teams.userById.get(String(id))?.email || id) : "none");
  head(`1. Student — ${found.length} found`);
  if (found.length > 1) console.log("  ⚠ More than one: check it's the right person (give --email or --code to narrow it).");
  for (const s of found) {
    const cs = teams.userById.get(String(s.primary_mentor_id ?? ""));
    console.log(`\n  ${s.full_name} · ${s.student_code ?? "no code"} · id ${s._id}`);
    line("Email", s.email);
    line("LMS account", s.lms_user_id || "not linked (matched by email only)");
    line("CS", cs ? `${cs.full_name} (${cs.app_role}${cs.status === "inactive" ? ", INACTIVE — Super Admins are told instead" : ""})` : "none — Super Admins are told");
    line("Common CS", (s.common_cs ?? []).map((c: any) => c?.name || nameOf(c?.id)));
    line("Not a student", s.not_student ? "YES — their completions are never shown" : "no");
    line("LMS classes", s.lms_classes);
  }

  const ids = found.map((s) => String(s._id));
  const emails = [...new Set(found.flatMap((s) => emailsOf(s.email)))];
  const lmsIds = [...new Set(found.map((s) => String(s.lms_user_id ?? "")).filter(Boolean))];

  // ── 2. Kept for them ─────────────────────────────────────────────────────
  const since = new Date(now.getTime() - SHOWN_DAYS * 86_400_000).toISOString();
  const kept = (await col("class_completions").find({ student_id: { $in: ids } } as any).sort({ ended_at: -1 }).limit(100).toArray()) as any[];
  head(`2. Class completions kept — ${kept.length}`);
  for (const c of kept) {
    const why = c.withdrawn_at ? `taken back ${day(c.withdrawn_at)} (the LMS says the seat was missed / cancelled)`
      : c.student_not_student ? "not shown: marked Not a student"
      : c.ended_at < since ? `not shown: older than ${SHOWN_DAYS} days`
      : !c.notified_at ? `waiting to be told at ${day(c.notify_at)}`
      : c.called_at ? `CALLED ${day(c.called_at)} by ${c.called_by || "—"} (${c.called_via}) — off the page`
      : `ON THE PAGE — told ${day(c.notified_at)} to ${(c.told ?? []).map((p: any) => p.name).join(", ") || c.told_to || "—"}`;
    console.log(`   · ended ${day(c.ended_at)}  ${what(c.class)}  [${c.class?.attendance ?? "—"}, end by ${c.class?.endSource ?? "—"}]\n       → ${why}`);
  }
  if (!kept.length) console.log("  None — the portal never kept an attended class for them.");

  // ── 3. Not matched ───────────────────────────────────────────────────────
  const unmatched = (await col("lms_activity").find({
    type: "class_attended", outcome: "not_a_student",
    $or: [
      ...(emails.length ? [{ "lms_student.email": { $in: emails.map((e) => new RegExp(`^\\s*${escape(e)}\\s*$`, "i")) } }] : []),
      ...(lmsIds.length ? [{ "lms_student.lmsUserId": { $in: lmsIds } }] : []),
      ...found.map((s) => ({ "lms_student.name": { $regex: `^\\s*${escape(String(s.full_name ?? "").trim())}\\s*$`, $options: "i" } })),
    ],
  } as any).sort({ at: -1 }).limit(50).toArray()) as any[];
  head(`3. Attended classes the portal couldn't match — ${unmatched.length}`);
  for (const r of unmatched) {
    console.log(`   · ${day(r.at)}  ${what(r.class)}  LMS email ${r.lms_student?.email || "—"} (${r.lms_student?.name || "—"})  retried until ${day(r.retry_until)}`);
  }
  if (unmatched.length) console.log("  → The LMS email isn't on this student's record (or the LMS account isn't linked): put the LMS email on the record.");

  // ── 4. The LMS ───────────────────────────────────────────────────────────
  head("4. What the LMS reports they attended (last 31 days)");
  if (!lmsConfigured()) console.log("  No LMS link in this .env (LMS_API_URL / LMS_SERVICE_SECRET).");
  else {
    try {
      const from = new Date(now.getTime() - 31 * 86_400_000).toISOString();
      const data: any = await callLms("/student-activity", { query: { since: from, include: "classes,unattended" }, verb: "share what students did" });
      const evs = (data?.events ?? []).filter((e: any) =>
        lmsIds.includes(String(e.student?.lmsUserId ?? "")) || emails.includes(String(e.student?.email ?? "").trim().toLowerCase()));
      const att = evs.filter((e: any) => e.type === "class_attended"), un = evs.filter((e: any) => e.type === "class_unattended");
      console.log(`  ${att.length} attended class${att.length === 1 ? "" : "es"}, ${un.length} seat${un.length === 1 ? "" : "s"} later marked missed / cancelled`);
      const keptKeys = new Set(kept.map((c) => String(c._id)));
      for (const e of att) {
        console.log(`   · ended ${day(e.class?.endedAt)}  ${what(e.class)}  [${e.class?.attendance}, end by ${e.class?.endSource}]  LMS email ${e.student?.email}  ${keptKeys.has(e.key) ? "kept in the portal ✓" : "NOT KEPT in the portal ✗"}`);
      }
      for (const e of un) console.log(`   · seat ${e.booking?.id} → ${e.booking?.status} (${day(e.at)})`);
      if (!att.length) console.log("  → The LMS doesn't count them as attending any class that has ended: the seat wasn't marked attended, the join wasn't recorded, or the class was cancelled. Check their bookings in the LMS.");
      if (!lmsIds.length && !emails.length) console.log("  (No email or LMS account on the record to look for.)");
    } catch (err) {
      console.log(`  The LMS didn't answer: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── 5. The job ───────────────────────────────────────────────────────────
  head("5. The portal's 2-minute LMS job (on the API server)");
  const st: any = await col("app_settings").findOne({ _id: "lms_activity" } as any);
  if (!st) console.log("  Never ran against this database — the job is off or the API never started it.");
  else {
    line("Asked the LMS up to", day(st.cursor));
    line("Last run", st.last_run ? `${day(st.last_run.at)}${st.last_run.ok ? " ok" : ` FAILED: ${st.last_run.error}`}` : "—");
    line("Last good run", st.last_ok_run ? `${day(st.last_ok_run.at)} (${st.last_ok_run.events} events, ${st.last_ok_run.class_notices ?? 0} told)` : "—");
    if (st.last_run?.stuck) console.log(`  ⚠ STUCK: ${st.last_run.stuck}`);
    if (st.cursor_exact) console.log("  Catching up: the LMS had more than one answer's worth — each run takes the next.");
    const behind = st.cursor ? (now.getTime() - Date.parse(st.cursor)) / 60_000 : 0;
    if (behind > 30) console.log(`  ⚠ ${Math.round(behind / 60)} hours behind: what students did since ${day(st.cursor)} hasn't come in yet${st.cursor_exact ? " (catching up)" : " — stuck, if it doesn't move"}.`);
    const late = st.last_ok_run?.at ? (now.getTime() - Date.parse(st.last_ok_run.at)) / 60_000 : Infinity;
    if (late > 15) console.log(`  ⚠ No good run for ${Number.isFinite(late) ? `${Math.round(late)} minutes` : "ever"} — nobody's completions are coming in.`);
  }
} finally {
  await closeDb();
}
