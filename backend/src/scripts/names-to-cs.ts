import { readFileSync, writeFileSync } from "node:fs";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";
import { loadTeams } from "../students/teams";

/**
 * A list of names (a class's attendance from Google Meet, say) → each one's student here and their CS (the user,
 * 2026-10-24). Read only.
 *
 * Meet shows the name a person joined with, so a name is matched loosely: the same name whatever its case, dots or
 * a word said twice ("MUBASHIR MUBASHIR"); else every word of it in a student's name ("ADHIL" → "Adhil Rahman"), a
 * short word read as initials ("FAWAS KV" → "Fawas Kunnath Valappil", "ABHILASH M" → "Abhilash Mohan"); else its
 * longer words alone. Spellings of the same name count as one (Mohammad / Mohamed / Muhammed / MD, Ahamed / Ahmed,
 * D'Souza / Dsouza), and a long word one letter off (two, past 7 letters) is the same word.
 * Several students: the one who attended an LMS class that day (--day, their last class), else the only one with an
 * LMS account, is taken — said so in the match; else each is listed as Possible, to pick from. None: Not found.
 *
 *   cd backend
 *   bun src/scripts/names-to-cs.ts --names=<file, one name a line> --out=<file.json> [--day=YYYY-MM-DD]
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env). Writes nothing there.
 */

const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const namesFile = option("names"), out = option("out");
if (!namesFile || !out) {
  console.log("Give --names=<file, one name a line> and --out=<file.json>");
  process.exit(1);
}
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];

/** One spelling for the names spelt many ways. */
const SAME: [RegExp, string][] = [
  [/^(md|mohd|mohamad|mohamed|mohammad|mohammed|mohamud|muhamad|muhamed|muhammad|muhammed|muhamm?ad)$/, "muhammad"],
  [/^(ahamed|ahammed|ahmad|ahmed|ahamad)$/, "ahmed"],
];
/** "MUBASHIR  MUBASHIR." → ["mubashir"]: lower case, letters only (D'Souza → dsouza), one spelling, each word once. */
const words = (s: unknown) => [...new Set(String(s ?? "").toLowerCase().replace(/['’`]/g, "").replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean)
  .map((w) => SAME.find(([re]) => re.test(w))?.[1] ?? w))];
/** How many letters apart two words are (edits). */
function apart(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length]![b.length]!;
}
/** The same word, or a long one a letter off (two, past 7 letters): "basheer" / "basheeer", "nizamudeen" / "nizamuddeen". */
const near = (w: string, t: string) => w === t || (w.length > 4 && t.length > 4 && apart(w, t) <= (w.length > 7 ? 2 : 1));
const dayArg = option("day") ?? "";
const dubaiDay = (iso: unknown) => (iso ? new Date(new Date(String(iso)).getTime() + 4 * 3600_000).toISOString().slice(0, 10) : "");

await connectDb();
console.log(`${host}/${config.mongoDb} — read only`);
try {
  const names = readFileSync(namesFile, "utf8").split(/\r?\n/).map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean);
  const [students, users, teams] = await Promise.all([
    col("students").find({}, { projection: { full_name: 1, student_code: 1, email: 1, phone: 1, primary_mentor_id: 1, not_student: 1, lms_account: 1, lms_classes: 1 } }).toArray() as Promise<any[]>,
    col("users").find({}, { projection: { full_name: 1, email: 1, app_role: 1, status: 1 } }).toArray() as Promise<any[]>,
    loadTeams(),
  ]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const indexed = students.map((s) => ({ s, w: words(s.full_name) }));
  // A word of theirs: the same word, or — up to three letters — initials of their other words ("kv" → K… V…).
  const has = (w: string, theirs: string[]) => theirs.includes(w)
    || (w.length <= 3 && [...w].every((ch, i) => theirs.some((t, j) => t[0] === ch && (i === 0 || j > 0))));
  const rows: any[] = [];
  for (const name of names) {
    const want = words(name);
    const long = want.filter((w) => w.length > 3);
    const tiers = [
      (x: { w: string[] }) => x.w.length === want.length && want.every((w) => x.w.includes(w)),
      (x: { w: string[] }) => want.every((w) => has(w, x.w)),
      (x: { w: string[] }) => long.length > 0 && long.every((w) => x.w.includes(w)),
      (x: { w: string[] }) => want.every((w) => has(w, x.w) || x.w.some((t) => near(w, t))),
      (x: { w: string[] }) => long.length > 0 && long.every((w) => x.w.some((t) => near(w, t))),
    ];
    let loose: typeof indexed = [], tierNo = 0;
    for (const [i, tier] of tiers.entries()) { if (want.length) loose = indexed.filter(tier); if (loose.length) { tierNo = i; break; } }
    // Several: the one in an LMS class that day, else the only one with an LMS account (they joined an LMS class).
    let why = "";
    if (loose.length > 1) {
      const thatDay = dayArg ? loose.filter((x) => dubaiDay(x.s.lms_classes?.last_attended_at) >= dayArg) : [];
      const onLms = loose.filter((x) => x.s.lms_account?.exists === true);
      if (thatDay.length === 1) { loose = thatDay; why = " (in an LMS class that day)"; }
      else if (onLms.length === 1) { loose = onLms; why = " (the only one with an LMS account)"; }
      else if (onLms.length > 1 && onLms.length < loose.length) loose = onLms;
    }
    const hits = loose.slice(0, 15);
    if (!hits.length) { rows.push({ name, match: "Not found" }); continue; }
    const spelt = tierNo >= 3 ? " — spelt differently" : "";
    for (const { s } of hits) {
      const csId = String(s.primary_mentor_id ?? "");
      const cs = userById.get(csId);
      const team = csId ? teams.teamOf(csId) : null;
      rows.push({
        name, match: hits.length === 1 ? `Found${why}${spelt}` : `Possible (${loose.length})${spelt}`,
        lms: s.lms_account?.exists === true, last_class: dubaiDay(s.lms_classes?.last_attended_at),
        student: s.full_name ?? "", code: s.student_code ?? "", email: s.email ?? "", phone: s.phone ?? "",
        cs: cs?.full_name ?? (csId ? "(unknown user)" : "No CS"), cs_email: cs?.email ?? "", cs_off: cs?.status === "inactive",
        team: team?.name ?? "", location: team?.location ?? "", not_student: s.not_student === true,
      });
    }
  }
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), names: names.length, rows }, null, 1));
  const found = new Set(rows.filter((r) => String(r.match).startsWith("Found")).map((r) => r.name)).size;
  const possible = new Set(rows.filter((r) => String(r.match).startsWith("Possible")).map((r) => r.name)).size;
  console.log(`${names.length} names: ${found} found, ${possible} with several possible students, ${names.length - found - possible} not found → ${out}`);
} finally {
  await closeDb();
}
