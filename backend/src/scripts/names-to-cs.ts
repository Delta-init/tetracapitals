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
 * longer words alone. One student: Found. Several: each is listed as Possible, to pick from. None: Not found.
 *
 *   cd backend
 *   bun src/scripts/names-to-cs.ts --names=<file, one name a line> --out=<file.json>
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

/** "MUBASHIR  MUBASHIR." → ["mubashir"]: lower case, letters only, each word once. */
const words = (s: unknown) => [...new Set(String(s ?? "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean))];

await connectDb();
console.log(`${host}/${config.mongoDb} — read only`);
try {
  const names = readFileSync(namesFile, "utf8").split(/\r?\n/).map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean);
  const [students, users, teams] = await Promise.all([
    col("students").find({}, { projection: { full_name: 1, student_code: 1, email: 1, phone: 1, primary_mentor_id: 1, not_student: 1, enrollment_status: 1 } }).toArray() as Promise<any[]>,
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
    ];
    let loose: typeof indexed = [];
    for (const tier of tiers) { if (want.length) loose = indexed.filter(tier); if (loose.length) break; }
    const hits = loose.slice(0, 15);
    if (!hits.length) { rows.push({ name, match: "Not found" }); continue; }
    for (const { s } of hits) {
      const csId = String(s.primary_mentor_id ?? "");
      const cs = userById.get(csId);
      const team = csId ? teams.teamOf(csId) : null;
      rows.push({
        name, match: hits.length === 1 ? "Found" : `Possible (${loose.length})`,
        student: s.full_name ?? "", code: s.student_code ?? "", email: s.email ?? "", phone: s.phone ?? "",
        cs: cs?.full_name ?? (csId ? "(unknown user)" : "No CS"), cs_email: cs?.email ?? "", cs_off: cs?.status === "inactive",
        team: team?.name ?? "", location: team?.location ?? "", not_student: s.not_student === true,
      });
    }
  }
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), names: names.length, rows }, null, 1));
  const found = new Set(rows.filter((r) => r.match === "Found").map((r) => r.name)).size;
  const possible = new Set(rows.filter((r) => String(r.match).startsWith("Possible")).map((r) => r.name)).size;
  console.log(`${names.length} names: ${found} found, ${possible} with several possible students, ${names.length - found - possible} not found → ${out}`);
} finally {
  await closeDb();
}
