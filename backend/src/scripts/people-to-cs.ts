import { readFileSync, writeFileSync } from "node:fs";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";
import { loadTeams } from "../students/teams";

/**
 * A list of people — name, email, phone (pasted from a sheet, tab-separated) — → their student here, the team and the
 * CS (the user, 2026-10-24). Read only.
 *
 * Matched by email (any address on the record, whatever its case), else by phone (the last 9 digits, the phone or
 * WhatsApp number), else by the exact name. The sheets JSON goes to sheets-to-xlsx.py:
 *
 *   cd backend
 *   bun src/scripts/people-to-cs.ts --list=<file: name<TAB>email<TAB>phone a line> --out=<file.json> [--title=...]
 *   python3 src/scripts/sheets-to-xlsx.py <file.json> <file.xlsx>
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env). Writes nothing there.
 */

const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const list = option("list"), out = option("out"), title = option("title") ?? "Students — team and CS";
if (!list || !out) {
  console.log("Give --list=<file: name<TAB>email<TAB>phone a line> --out=<file.json>");
  process.exit(1);
}
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const emailsOf = (v: unknown) => (String(v ?? "").toLowerCase().match(/[^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+/g) ?? []);
const tail = (v: unknown) => { const d = String(v ?? "").replace(/\D/g, ""); return d.length >= 8 ? d.slice(-9) : ""; };
const nameKey = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z]/g, "");
const ROLE: Record<string, string> = { cs: "CS", cs_manager: "CS Manager", chief_mentor: "Chief Mentor", senior_mentor: "Senior Mentor", junior_mentor: "Junior Mentor", subjunior_mentor: "Sub-junior Mentor" };

await connectDb();
console.log(`${host}/${config.mongoDb} — read only`);
try {
  const people = readFileSync(list, "utf8").split(/\r?\n/).map((l) => l.split("\t").map((x) => x.trim().replace(/^'/, ""))).filter((p) => p[0] || p[1] || p[2]);
  const [students, teams] = await Promise.all([
    col("students").find({}, { projection: { full_name: 1, student_code: 1, email: 1, phone: 1, whatsapp: 1, primary_mentor_id: 1, not_student: 1, enrollment_status: 1, lms_account: 1 } }).toArray() as Promise<any[]>,
    loadTeams(),
  ]);
  const byEmail = new Map<string, any[]>(), byPhone = new Map<string, any[]>(), byName = new Map<string, any[]>();
  const add = (m: Map<string, any[]>, k: string, s: any) => { if (k) m.set(k, [...(m.get(k) ?? []), s]); };
  for (const s of students) {
    for (const e of emailsOf(s.email)) add(byEmail, e, s);
    for (const p of new Set([tail(s.phone), tail(s.whatsapp)])) add(byPhone, p, s);
    add(byName, nameKey(s.full_name), s);
  }

  const rows: any[][] = [];
  const perTeam = new Map<string, { team: string; location: string; cs: Map<string, string[]> }>();
  let found = 0, several = 0;
  for (const [i, [name = "", email = "", phone = ""]] of people.entries()) {
    const e = emailsOf(email)[0] ?? "";
    let hits: any[] = [], how = "";
    if (e && byEmail.get(e)?.length) { hits = byEmail.get(e)!; how = "Email"; }
    else if (tail(phone) && byPhone.get(tail(phone))?.length) { hits = byPhone.get(tail(phone))!; how = "Phone"; }
    else if (byName.get(nameKey(name))?.length) { hits = byName.get(nameKey(name))!; how = "Name only — check"; }
    hits = [...new Map(hits.map((s) => [String(s._id), s])).values()];
    if (!hits.length) { rows.push([i + 1, name, email, phone, "Not found", "", "", "", "", "", "", ""]); continue; }
    if (hits.length === 1) found++; else several++;
    for (const s of hits) {
      const csId = String(s.primary_mentor_id ?? "");
      const cs = csId ? teams.userById.get(csId) : null;
      const team = csId ? teams.teamOf(csId) : null;
      rows.push([
        i + 1, name, email, phone, hits.length === 1 ? `Found by ${how.toLowerCase()}` : `${hits.length} students — by ${how.toLowerCase()}`,
        s.full_name ?? "", s.student_code ?? "", team?.name ?? (cs ? "No team" : ""), team?.leaderName ?? "",
        cs?.full_name ?? (csId ? "(unknown user)" : "No CS"), cs ? ROLE[cs.app_role] ?? cs.app_role : "",
        [(team?.location ?? "") === "bangalore" ? "Bangalore" : team ? "Dubai" : "", cs?.status === "inactive" ? "CS switched off" : "", s.not_student ? "marked 'not a student'" : ""].filter(Boolean).join(" · "),
      ]);
      if (hits.length === 1) {
        const key = team?.id ?? "-";
        const t = perTeam.get(key) ?? { team: team?.name ?? "No team", location: team?.location === "bangalore" ? "Bangalore" : team ? "Dubai" : "", cs: new Map() };
        const csName = cs?.full_name ?? "No CS";
        t.cs.set(csName, [...(t.cs.get(csName) ?? []), `${s.full_name ?? name}${s.student_code ? ` (${s.student_code})` : ""}`]);
        perTeam.set(key, t);
      }
    }
  }
  const teamRows: any[][] = [];
  for (const t of [...perTeam.values()].sort((a, b) => a.team.localeCompare(b.team))) {
    for (const [cs, names] of [...t.cs.entries()].sort((a, b) => b[1].length - a[1].length)) teamRows.push([t.team, t.location, cs, names.length, names.join(", ")]);
  }
  writeFileSync(out, JSON.stringify({
    title,
    notes: [`${people.length} people: ${found} found, ${several} matching several students, ${people.length - found - several} not found`, `Looked up ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC — matched by email, else phone (last 9 digits), else exact name`],
    sheets: [
      { name: "Students", columns: ["#", "Name (list)", "Email (list)", "Phone (list)", "Match", "Student", "Code", "Team", "Team leader", "CS", "CS role", "Note"], rows },
      { name: "By team and CS", columns: ["Team", "Location", "CS", "Students", "Names"], rows: teamRows },
    ],
  }, null, 1));
  console.log(`${people.length} people: ${found} found, ${several} matching several, ${people.length - found - several} not found → ${out}`);
} finally {
  await closeDb();
}
