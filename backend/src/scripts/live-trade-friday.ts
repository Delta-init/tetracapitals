/**
 * "live trade Friday" — the mentors' live-trade hours for Friday 27 November 2026, each a program for every student
 * with an LMS account (the user, 2026-11-27: "create programs according to this timing with these mentors"; all
 * students; one day only). The two 10:00 ones — Fousiya and Nadeem — were made by hand as "live trade" and are not
 * here; 14 remain.
 *
 * Run on the server, where the portal's own settings are: it makes each one through the Programs functions
 * themselves, as the person named with --as, so a program is made, booked in the LMS and announced exactly as if that
 * person had added it from the Programs page with "Add all".
 *
 *   bun src/scripts/live-trade-friday.ts --as you@example.com            shows what it would do — makes nothing
 *   bun src/scripts/live-trade-friday.ts --as you@example.com --apply    makes them
 *
 * --as must be an active CS, CS Manager, Chief Mentor or Super Admin. A slot whose time has passed is left out
 * (--include-past keeps it). A slot that already has a program for that mentor, day and time is left out, so a
 * second run makes nothing twice. Once made, every student on a program is emailed — that cannot be taken back; a
 * program can only be stopped afterwards. After the last one it waits for those messages to finish before it ends.
 */
import { connectDb, closeDb, col } from "../db";
import * as F from "../functions/programs";
import { PROGRAM_NOTICES } from "../students/programNotices";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? String(process.argv[i + 1] ?? "") : ""; };
const AS = arg("--as").trim().toLowerCase();
const APPLY = process.argv.includes("--apply");
const INCLUDE_PAST = process.argv.includes("--include-past");
if (!AS.includes("@")) { console.error("Say who makes them: --as <their email> (a CS, CS Manager, Chief Mentor or Super Admin)."); process.exit(1); }

const DAY = "2026-11-27"; // a Friday
const TITLE = "live trade Friday";
const M = {
  fousiya: "fousiya@deltainstitutions.com", nadeem: "nadeem@deltainstitutions.com", kiran: "kiran@deltainstitutions.com",
  jugal: "jugal@deltainstitutions.com", vishnu: "vishnuprasad@deltainstitutions.com", anfida: "nafeesathul.anfida@deltainstitutions.com",
  libin: "libin@deltainstitutions.com", tony: "tony.alexm@deltainstitutions.com",
};
// Dubai time. 10:00 Fousiya and 10:00 Nadeem are not here: they exist already.
const SLOTS: [string, string][] = [
  ["11:00", M.kiran], ["11:00", M.jugal], ["12:00", M.vishnu],
  ["15:00", M.fousiya], ["15:00", M.nadeem], ["16:00", M.vishnu], ["16:00", M.anfida],
  ["17:00", M.nadeem], ["17:00", M.libin], ["17:00", M.tony],
  ["18:00", M.jugal], ["18:00", M.anfida], ["19:00", M.kiran], ["19:00", M.libin],
];
// Dubai is UTC+4 all year.
const startOf = (time: string) => new Date(`${DAY}T${time}:00+04:00`);

await connectDb();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const doc: any = await col("users").findOne({ email: new RegExp(`^${esc(AS)}$`, "i") });
if (!doc || doc.status === "inactive") { console.error(`No active portal account for ${AS}.`); await closeDb(); process.exit(1); }
const who = { id: String(doc._id), email: String(doc.email), full_name: doc.full_name ?? "", app_role: doc.app_role } as any;
const call = async (fn: (r: Request, u: any) => Promise<Response>, body: unknown = {}) => {
  const res = await fn(new Request("http://script", { method: "POST", body: JSON.stringify(body) }), who);
  const out: any = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${res.status} ${out?.error ?? out?.message ?? ""}`.trim());
  return out;
};

let failed = 0;
try {
  const listed = await call(F.listPrograms);
  if (!listed?.canCreate) throw new Error(`${who.email} (${who.app_role}) cannot make programs — it takes a CS, CS Manager, Chief Mentor or Super Admin.`);
  const existing: any[] = listed.programs ?? [];
  const has = (time: string, mentor: string) => existing.some((p) => p.startDate === DAY && p.time === time && p.status !== "stopped" && String(p.mentor?.email ?? "").toLowerCase() === mentor);

  // Every student in the portal with an LMS account — what "Add all" gives.
  const found = await call(F.searchProgramStudents, { all: true, enrolledOnly: true });
  const emails = [...new Set<string>((found?.students ?? []).map((s: any) => String(s.email).toLowerCase()))];
  console.log(`As ${who.full_name || who.email} (${who.app_role}). ${emails.length} students with an LMS account. ${APPLY ? "MAKING the programs." : "Showing only — nothing is made without --apply."}\n`);
  if (!emails.length) throw new Error("No students came back — stopping.");

  let made = 0, skipped = 0;
  for (const [time, mentor] of SLOTS) {
    const label = `${time}  ${mentor}`;
    if (has(time, mentor)) { console.log(`skip   ${label} — already has a program`); skipped++; continue; }
    if (!INCLUDE_PAST && startOf(time).getTime() <= Date.now()) { console.log(`skip   ${label} — its time has passed`); skipped++; continue; }
    if (!APPLY) { console.log(`would  ${label} — "${TITLE}", 60 minutes, online, ${emails.length} students`); continue; }
    try {
      const p = await call(F.createProgram, {
        title: TITLE, mentorEmail: mentor, teams: ["all"], repeat: "weekly", weekdays: [5], startDate: DAY, endDate: DAY,
        time, durationMins: 60, isOnline: true, studentEmails: emails,
      });
      console.log(`made   ${label} — ${p?.students?.length ?? "?"} on it, ${p?.told ?? "?"} being told${p?.missing?.length ? `, ${p.missing.length} kept as guests` : ""}`);
      made++;
    } catch (e) {
      console.log(`FAILED ${label} — ${e instanceof Error ? e.message : e}`);
      failed++;
    }
  }
  console.log(`\n${APPLY ? `${made} made` : "nothing made"}, ${skipped} left out, ${failed} failed.`);

  // The messages go out after each program is made; ending now would cut them off part-way.
  if (APPLY && made) {
    const waiting = () => col(PROGRAM_NOTICES).countDocuments({ sending: true, program_title: TITLE });
    let left = await waiting(), quiet = 0;
    const until = Date.now() + 3 * 60 * 60_000;
    while (left > 0 && Date.now() < until) {
      console.log(`  ${left} messages still going out…`);
      await new Promise((r) => setTimeout(r, 30_000));
      const now = await waiting();
      // Nothing moved for five minutes: whatever is left is stuck, and Resend on the program's page sends it again.
      quiet = now === left ? quiet + 1 : 0;
      left = now;
      if (quiet >= 10) break;
    }
    console.log(left ? `${left} messages did not finish — use Resend on the program's page for those.` : "Every message has gone out.");
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  failed++;
}
await closeDb();
process.exit(failed ? 1 : 0);
