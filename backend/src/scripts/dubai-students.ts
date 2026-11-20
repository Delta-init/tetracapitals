import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";
import { loadTeams, type TeamIndex } from "../students/teams";
import { takeTurn } from "../students/intake";
import { prepareStudentUpdate, type HistoryEntry } from "../students/history";
import { notifyStudentsGiven } from "../lib/notify";
import type { AuthUser } from "../auth/middleware";

/**
 * DUBAI-STUD students from before finance said so (the user, 2026-11-20: a Sales CRM, Draw or Remote close for the
 * Bangalore academy is a DUBAI-STUD — served by a Dubai team, the money in the Bangalore books; "backfill" the ones
 * already here). Finance's backfill tags their invoices and prints the ids for this.
 *
 * For each student whose finance invoice is one of --invoice-ids (finance_invoice_id, or one merged into them):
 *   - `dubai_student` set (finance/students.ts) — their MT5 bonuses go to Bangalore's finance, in rupees, decided by
 *     Bangalore's broker admins (lib/location.ts moneyLocationOf);
 *   - `location` "dubai", as a new DUBAI-STUD arrives;
 *   - on a Bangalore team: given to the next Dubai team and its next CS in the Dubai round new students take (the
 *     same turn a new Dubai student would have taken), as the app's own Transfer does it — the CS, the team from the
 *     new CS, a history line, and the new CS told; nothing goes to the student. With no team (Open Students) or on a
 *     Dubai team already: the flag and location only. Their course fees, payments and follow-ups stay as they are.
 * An id that fits no student is said and left; one that fits several stops the run before anything is written.
 *
 *   cd backend
 *   bun src/scripts/dubai-students.ts --invoice-ids=<id,id,…>             dry run: who, and what would change
 *   bun src/scripts/dubai-students.ts --invoice-ids=<id,id,…> --write     does it; an undo file in backups/dubai-students/
 *   bun src/scripts/dubai-students.ts --undo=<file> [--write]             puts them back (not the Dubai round's turn)
 */

const write = process.argv.includes("--write");
function option(name: string): string | undefined {
  const i = process.argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const a = process.argv[i]!;
  return a.includes("=") ? a.slice(a.indexOf("=") + 1) : process.argv[i + 1];
}
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const MISSING = { $missing: true };
const ACTOR: AuthUser = { id: "", email: "", full_name: "DUBAI-STUD backfill", app_role: "super_admin" };
const VIA = "dubai-students";

const log = { database: config.mongoDb, host, applied_at: now, history_ids: [] as string[],
  changes: [] as { id: string; code: string; before: Record<string, unknown>; after: Record<string, unknown> }[] };

type Plan = { s: any; flag: boolean; location: boolean; move: boolean; teamNow: string; csNow: string };

const teamOfStudent = (index: TeamIndex, s: any) =>
  (s.team_id ? index.teams.find((t) => t.id === String(s.team_id)) : undefined) ?? index.teamOf(s.primary_mentor_id) ?? null;

async function run() {
  const raw = option("invoice-ids");
  if (!raw) throw new Error("Give finance's invoice ids: --invoice-ids=<id,id,…>");
  const ids = [...new Set(raw.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))];
  const bad = ids.filter((id) => !/^[a-f0-9]{24}$/i.test(id));
  if (bad.length) throw new Error(`Not finance invoice ids: ${bad.join(", ")}`);

  const index = await loadTeams();
  const problems: string[] = [];
  const notHere: string[] = [];
  const plans = new Map<string, Plan>();
  for (const id of ids) {
    const found = (await col("students").find({ $or: [{ finance_invoice_id: id }, { other_finance_invoice_ids: id }] }).toArray()) as any[];
    if (!found.length) { notHere.push(id); continue; }
    if (found.length > 1) { problems.push(`${id}: ${found.length} students have this invoice (${found.map((s) => `${s.student_code} ${s.full_name}`).join("; ")})`); continue; }
    const s = found[0];
    if (plans.has(String(s._id))) continue;
    const team = teamOfStudent(index, s);
    plans.set(String(s._id), {
      s,
      flag: s.dubai_student !== true,
      location: s.location !== "dubai",
      move: team?.location === "bangalore",
      teamNow: team ? `${team.name}${team.location === "bangalore" ? " (Bangalore)" : ""}` : "no team",
      csNow: String(s.primary_mentor_name || "nobody"),
    });
  }

  const dubaiTeams = index.teams.filter((t) => t.active && t.cs.length > 0 && t.location === "dubai");
  const all = [...plans.values()];
  const todo = all.filter((p) => p.flag || p.location || p.move);
  const moves = todo.filter((p) => p.move);
  if (moves.length && !dubaiTeams.length) problems.push("no Dubai team has a CS to give them to");

  console.log(`\n${ids.length} invoice id(s) · ${all.length} student(s) found · ${todo.length} to change · ${moves.length} to move to a Dubai team · ${all.length - todo.length} already done`);
  if (notHere.length) console.log(`Not here (no student has the invoice — nothing to do for them): ${notHere.join(", ")}`);
  if (moves.length) console.log(`Dubai teams in turn: ${dubaiTeams.map((t) => t.name).join(", ") || "none"}`);
  console.log("");
  for (const p of all) {
    const what = !p.flag && !p.location && !p.move ? "already DUBAI-STUD — nothing to change"
      : [p.flag && "DUBAI-STUD", p.location && "location Dubai", p.move && "→ the next Dubai team and its CS, in turn"].filter(Boolean).join(" · ");
    console.log(`  ${String(p.s.student_code ?? "").padEnd(9)} ${String(p.s.full_name ?? "").trim().slice(0, 30).padEnd(31)} ${`${p.teamNow} / ${p.csNow}`.slice(0, 44).padEnd(45)} ${what}`);
  }
  if (problems.length) {
    console.log(`\nStopped — nothing is written until every id is right:`);
    for (const p of problems) console.log(`  ✗ ${p}`);
    process.exitCode = 1;
    return;
  }
  if (!write) { if (todo.length) console.log("\nNothing was written. Run again with --write to do it."); return; }
  if (!todo.length) return;

  const dir = resolve("backups/dubai-students");
  mkdirSync(dir, { recursive: true });
  const undoPath = join(dir, `undo-${now.replace(/[:.]/g, "-")}.json`);
  const moved: unknown[] = [];
  try {
    for (const p of todo) {
      const s = p.s;
      const data: Record<string, any> = { updated_date: now };
      let entries: HistoryEntry[] = [];
      let toText = "";
      if (p.move) {
        const turn = await takeTurn("dubai");
        if (!turn) throw new Error("no Dubai team has a CS to give them to");
        Object.assign(data, { primary_mentor_id: turn.cs.id, primary_mentor_name: turn.cs.name, assignment_status: "assigned" });
        if (!s.first_assignee_id && s.primary_mentor_id) Object.assign(data, { first_assignee_id: String(s.primary_mentor_id), first_assignee_name: String(s.primary_mentor_name ?? ""),
          first_assignee_role: String(index.userById.get(String(s.primary_mentor_id))?.app_role ?? ""), first_assigned_at: String(s.assigned_at || s.created_date || now) });
        // The team from the new CS, assigned_at and the history line — as a Transfer.
        entries = await prepareStudentUpdate(s, data, ACTOR);
        toText = ` → ${turn.team.name} / ${turn.cs.name}`;
      }
      // After prepareStudentUpdate, which drops the server's own fields a client may not set — this one it may.
      data.dubai_student = true;
      data.location = "dubai";
      if (p.flag) {
        entries.push({
          student_id: String(s._id), at: now, type: "details_changed", by_id: null, by_name: ACTOR.full_name,
          text: "DUBAI-STUD — a sales close for the Bangalore academy: served by Dubai, the money in Bangalore's books",
          from: { dubai_student: false }, to: { dubai_student: true },
        } as HistoryEntry);
      }
      log.changes.push({ id: String(s._id), code: String(s.student_code ?? ""), before: Object.fromEntries(Object.keys(data).map((k) => [k, k in s ? s[k] : MISSING])), after: { ...data } });
      await col("students").updateOne({ _id: s._id }, { $set: data });
      for (const e of entries) e.via = VIA;
      if (entries.length) log.history_ids.push(...Object.values((await col("student_history").insertMany(entries as any[])).insertedIds).map(String));
      await Bun.write(undoPath, JSON.stringify(log, null, 1));
      if (p.move) moved.push(s._id);
      console.log(`  ✓ ${s.student_code} ${String(s.full_name ?? "").trim()}${toText}`);
    }
    // The new CS is told, as a Transfer does — never the student.
    if (moved.length) await notifyStudentsGiven((await col("students").find({ _id: { $in: moved as any[] } }).toArray()) as any[], null);
    console.log(`\nDone: ${todo.length} student(s) changed, ${moved.length} given to a Dubai team.`);
  } finally {
    if (log.changes.length) {
      await Bun.write(undoPath, JSON.stringify(log, null, 1));
      console.log(`Undo file: ${undoPath}\n  bun src/scripts/dubai-students.ts --undo=${undoPath}          (shows what it would put back)`);
    }
  }
}

async function undo(file: string) {
  const saved = JSON.parse(await Bun.file(file).text()) as typeof log;
  if (saved.database !== config.mongoDb || saved.host !== host) throw new Error(`That undo file is for "${saved.database}" on ${saved.host}, not this database.`);
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  let back = 0;
  const kept: string[] = [];
  for (const c of [...saved.changes].reverse()) {
    const doc: any = await col("students").findOne({ _id: toObjectId(c.id) as any });
    if (!doc) continue;
    // Whole or not at all: a student changed again since is left as now.
    const changed = Object.keys(c.before).filter((k) => k !== "updated_date" && !same(doc[k], c.after[k]));
    if (changed.length) { kept.push(`${c.code}: ${changed.join(", ")} changed since — left as now`); continue; }
    const $set: Record<string, unknown> = {}, $unset: Record<string, ""> = {};
    for (const k of Object.keys(c.before)) { const v = c.before[k] as any; if (v && typeof v === "object" && v.$missing) $unset[k] = ""; else $set[k] = v; }
    back++;
    if (write) await col("students").updateOne({ _id: doc._id }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) });
  }
  console.log(`\nUndo of the DUBAI-STUD backfill on ${saved.applied_at}: ${back} student(s) ${write ? "put back" : "would be put back"}, ${saved.history_ids.length} history line(s) ${write ? "removed" : "to remove"}${write ? "" : " — add --write"}`);
  console.log("The Dubai round's turn is not put back: the next new Dubai student goes on from where it is.");
  for (const k of kept) console.log(`  ${k}`);
  if (write) await col("student_history").deleteMany({ _id: { $in: saved.history_ids.map((id) => toObjectId(id)) as any[] } });
}

await connectDb();
console.log(`Database "${config.mongoDb}" on ${host}${write ? "" : "  — dry run, nothing is written"}`);
try {
  const undoFile = option("undo");
  if (undoFile) await undo(undoFile);
  else await run();
} catch (err) {
  console.log(`\nStopped: ${err instanceof Error ? err.message : err}${log.changes.length ? "" : "\nNothing was written."}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
