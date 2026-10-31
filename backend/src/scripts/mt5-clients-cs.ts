import { ObjectId } from "mongodb";
import { dirname, basename, join } from "node:path";
import { unlinkSync } from "node:fs";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";
import { loadTeams } from "../students/teams";

/**
 * A sheet of MT5 clients → the same sheet with each one's CS and team (the user, 2026-10-31: "Losses Booked Delta
 * clients who received bonus credits") — read only, nothing is changed.
 *
 * Every sheet of the workbook is kept, in order, with its columns; added to each row: Student code · Student · CS ·
 * Team · Location · Matched by. A client is found by their MT5 login (MT5 accounts, then the login on their funding
 * requests), then by email (a column named mail / email), then by the exact name. Two students for one client: both,
 * in one cell.
 *
 *   cd backend
 *   bun src/scripts/mt5-clients-cs.ts --in="/Users/…/clients.xlsx"          (--out=… to name the new file)
 *
 * Writes "<name> with CS.xlsx" beside it. Needs python3 with openpyxl. Uses the API's database (MONGO_URI / MONGO_DB, .env).
 */

const option = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const input = option("in");
if (!input) { console.log('Give --in="<the .xlsx>"'); process.exit(1); }
const output = option("out") ?? join(dirname(input), `${basename(input).replace(/\.xlsx$/i, "").replace(/\.+$/, "")} with CS.xlsx`);
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const py = (code: string, ...args: string[]) => {
  const r = Bun.spawnSync(["python3", "-I", "-c", code, ...args], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) { console.log(`python3 failed: ${r.stderr.toString().trim()}`); process.exit(1); }
  return r.stdout.toString();
};

// ── The workbook, as plain rows ────────────────────────────────────────────
const sheets: { name: string; rows: unknown[][] }[] = JSON.parse(py(`
import json, sys, datetime
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1], read_only=True, data_only=True)
out = []
for ws in wb.worksheets:
    rows = [[(v.isoformat() if isinstance(v, (datetime.date, datetime.datetime)) else v) for v in r] for r in ws.iter_rows(values_only=True)]
    while rows and all(v is None for v in rows[-1]): rows.pop()
    out.append({"name": ws.title, "rows": rows})
print(json.dumps(out))
`, input));

const loginOf = (v: unknown) => {
  const s = String(v ?? "").trim().replace(/\.0+$/, "");
  return /^\d{4,15}$/.test(s) ? s : "";
};
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

await connectDb();
console.log(`${host}/${config.mongoDb} — read only · ${input}`);
try {
  const teams = await loadTeams();
  const nameOf = (id: unknown) => String(teams.userById.get(String(id ?? ""))?.full_name || teams.userById.get(String(id ?? ""))?.email || "");
  const PROJ = { projection: { full_name: 1, student_code: 1, primary_mentor_id: 1, primary_mentor_name: 1, team_name: 1, not_student: 1 } };
  const byIds = async (ids: string[]) => {
    const oids = [...new Set(ids)].filter((i) => ObjectId.isValid(i)).map((i) => new ObjectId(i));
    return oids.length ? ((await col("students").find({ _id: { $in: oids } }, PROJ).toArray()) as any[]) : [];
  };

  const find = async (login: string, email: string, name: string): Promise<{ students: any[]; how: string }> => {
    if (login) {
      const both = { $in: [login, Number(login)] };
      const acc = (await col("mt5_accounts").find({ mt5_login: both } as any, { projection: { student_id: 1 } }).toArray()) as any[];
      let s = await byIds(acc.map((a) => String(a.student_id ?? "")));
      if (s.length) return { students: s, how: "MT5 login" };
      const txs = (await col("funding_transactions").find({ mt5_login: both } as any, { projection: { student_id: 1 } }).limit(50).toArray()) as any[];
      s = await byIds(txs.map((t) => String(t.student_id ?? "")));
      if (s.length) return { students: s, how: "MT5 login (funding requests)" };
    }
    if (email.includes("@")) {
      const s = (await col("students").find({ email: { $regex: `(^|[\\s,;<])${escape(email)}($|[\\s,;>])`, $options: "i" } }, PROJ).limit(5).toArray()) as any[];
      if (s.length) return { students: s, how: "email" };
    }
    if (name) {
      const s = (await col("students").find({ full_name: { $regex: `^\\s*${escape(name).replace(/ /g, "\\s+")}\\s*$`, $options: "i" } }, PROJ).limit(5).toArray()) as any[];
      if (s.length) return { students: s, how: "name" };
    }
    return { students: [], how: "not found" };
  };

  const out = { title: `${basename(input)} — with CS and team`, notes: [`Made ${new Date().toISOString().slice(0, 10)} from the CS Portal. Matched by MT5 login, then email, then exact name.`], sheets: [] as any[] };
  for (const sheet of sheets) {
    const [head = [], ...rows] = sheet.rows;
    const cols = head.map((h, i) => String(h ?? `Column ${i + 1}`));
    const at = (re: RegExp) => cols.findIndex((c) => re.test(c.trim()));
    const iLogin = at(/^(mt5|mt5 ?login|login|account)$/i), iMail = at(/^(e-?mail|mail)$/i), iName = at(/^(name|client|client name|full name)$/i);
    const added = ["Student code", "Student", "CS", "Team", "Location", "Matched by"];
    const outRows: unknown[][] = [];
    let found = 0;
    for (const r of rows) {
      if (r.every((v) => v === null || v === "")) continue;
      const login = iLogin >= 0 ? loginOf(r[iLogin]) : "";
      const { students, how } = await find(login, iMail >= 0 ? norm(r[iMail]) : "", iName >= 0 ? norm(r[iName]) : "");
      if (students.length) found++;
      const many = (f: (s: any) => string) => [...new Set(students.map(f).filter(Boolean))].join(" / ");
      const csId = (s: any) => String(s.primary_mentor_id ?? "");
      outRows.push([
        ...cols.map((_, i) => (i === iLogin && login ? Number(login) : r[i] ?? "")),
        many((s) => String(s.student_code ?? "")),
        many((s) => `${s.full_name ?? ""}${s.not_student ? " (not a student)" : ""}`),
        many((s) => String(s.primary_mentor_name || nameOf(csId(s)) || "no CS")),
        many((s) => String(teams.teamOf(csId(s))?.name || s.team_name || "")),
        many((s) => { const t = teams.teamOf(csId(s)); return t ? (t.location === "bangalore" ? "Bangalore" : "Dubai") : ""; }),
        how,
      ]);
    }
    console.log(`  ${sheet.name}: ${outRows.length} rows, ${found} found, ${outRows.length - found} not found`);
    out.sheets.push({ name: sheet.name, columns: [...cols, ...added], rows: outRows });
  }

  const json = join(dirname(output), `.${basename(output)}.json`);
  await Bun.write(json, JSON.stringify(out));
  py(`import runpy, sys; sys.argv = sys.argv[1:]; runpy.run_path(sys.argv[0], run_name="__main__")`, join(import.meta.dir, "sheets-to-xlsx.py"), json, output);
  unlinkSync(json);
  console.log(`\nWritten: ${output}`);
} finally {
  await closeDb();
}
