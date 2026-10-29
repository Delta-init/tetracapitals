import { connectDb, closeDb, col } from "../db";
import { config } from "../config";
import { callLms, lmsConfigured } from "../lib/lms";
import { addressRe } from "../functions/meetingOutcomes";

/**
 * Why a mentor meeting isn't on "Meetings done" (the user, 2026-10-29: Ammu Sudharshan's, Rani's) — read only,
 * nothing is changed, here or in the LMS.
 *
 * For each meeting in the Mentor Calendar whose title or attendee matches --name (the last 60 days and the next 14,
 * or --from / --to): when, the mentor, its kind, who booked it, whether Meetings done has it, and if not, why:
 *   · its kind isn't Student (the name was typed, not picked from the suggestions — the form starts on Staff)
 *   · it wasn't booked from the CS Portal (booked in the LMS: no outcome is asked, so it never lists)
 *   · no email on it, or no student here with that email
 *   · on the page — then for whom (their CS), and its status (the page starts on Held, this month)
 *
 *   cd backend
 *   bun src/scripts/meeting-check.ts --name=Ammu                         (--from=2026-10-01 --to=2026-10-31 too)
 *
 * Uses the same database and LMS link as the API (MONGO_URI / MONGO_DB / LMS_API_URL / LMS_SERVICE_SECRET, from .env).
 */

const option = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const name = option("name")?.trim().toLowerCase();
if (!name) { console.log("Give --name=<part of the student's name or the meeting's title> [--from=YYYY-MM-DD --to=YYYY-MM-DD]"); process.exit(1); }
const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
const from = option("from") ?? day(new Date(Date.now() - 60 * 864e5));
const to = option("to") ?? day(new Date(Date.now() + 14 * 864e5));
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dubai", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];

if (!lmsConfigured()) { console.log("No LMS link in this .env (LMS_API_URL / LMS_SERVICE_SECRET)."); process.exit(1); }
await connectDb();
console.log(`${host}/${config.mongoDb} — read only · ${from} to ${to} · "${name}"`);
try {
  const cal: any = await callLms("/mentors", {
    query: { from: new Date(`${from}T00:00:00+04:00`).toISOString(), to: new Date(Date.parse(`${to}T00:00:00+04:00`) + 864e5).toISOString(), allAcademies: "1" },
    verb: "list its mentors",
  });
  const listed: any = await callLms("/meeting-outcomes/meetings", { query: { from, to }, verb: "list the meetings" });
  const onPage = new Map<string, any>((listed?.meetings ?? []).map((m: any) => [String(m.id), m]));
  const staff = new Set(((await col("users").find({}, { projection: { email: 1 } }).toArray()) as any[]).map((u) => String(u.email ?? "").trim().toLowerCase()));

  const found = (cal?.mentors ?? []).flatMap((mentor: any) => (mentor.meetings ?? []).map((v: any) => ({ v, mentor })))
    .filter(({ v }: any) => [v.title, ...(v.attendeeNames ?? [])].some((x) => String(x ?? "").toLowerCase().includes(name)))
    .sort((a: any, b: any) => String(b.v.startsAt).localeCompare(String(a.v.startsAt)));
  if (!found.length) console.log(`\nNo meeting in the Mentor Calendar matches "${name}" between ${from} and ${to}.`);

  for (const { v, mentor } of found) {
    console.log(`\n━━ ${when(v.startsAt)} · ${v.title} · mentor ${mentor.name || mentor.email}`);
    console.log(`   with ${(v.attendeeNames ?? []).join(", ") || "nobody named"} · kind ${v.kind || "—"} · booked by ${v.bookedByEmail || "—"}${v.category ? ` · ${v.category}` : ""}`);
    const p = onPage.get(String(v.id));
    if (!p) {
      if (v.kind !== "student") console.log(`   ✗ NOT on Meetings done: its kind is "${v.kind || "none"}", not Student — the name was typed instead of picked from the suggestions (the form starts on Staff).`);
      else if (!staff.has(String(v.bookedByEmail ?? "").toLowerCase())) console.log("   ✗ NOT on Meetings done: it was booked in the LMS, not from the CS Portal — no outcome is asked for it, so it never lists.");
      else console.log("   ✗ NOT on Meetings done: the LMS doesn't list it as a CS Portal student meeting (booked before outcomes were asked, or in the LMS).");
      continue;
    }
    console.log(`   status ${p.status}${p.status === "upcoming" ? " (the page's default \"Held\" leaves it out until it's over)" : p.status === "cancelled" ? " (only under \"Cancelled\")" : ""}${p.outcome?.stage ? ` · outcome ${p.outcome.stage}` : ""}`);
    for (const a of p.attendees ?? []) {
      const e = String(a.email ?? "").trim().toLowerCase();
      if (!e.includes("@")) { console.log(`   · ${a.name}: no email on the meeting — only a Super Admin or its mentor sees it, under nobody's student.`); continue; }
      const exact = await col("students").findOne({ email: e }, { projection: { _id: 1 } });
      const s: any = await col("students").findOne({ email: addressRe(e) }, { projection: { full_name: 1, student_code: 1, primary_mentor_name: 1, email: 1 } });
      if (!s) { console.log(`   · ${a.name} <${e}>: no student here with that email — only a Super Admin or its mentor sees it.`); continue; }
      console.log(`   ✓ ${a.name} <${e}> → ${s.full_name} ${s.student_code ?? ""} · CS ${s.primary_mentor_name || "none"} — shown to their CS and leaders`
        + (exact ? "" : `  (was hidden before 2026-10-29: the record's email is "${s.email}" — the fix matches it, after the API deploy)`));
    }
  }
} finally {
  await closeDb();
}
