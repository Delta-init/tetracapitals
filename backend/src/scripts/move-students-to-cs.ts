import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";
import { loadTeams } from "../students/teams";
import { prepareStudentUpdate, type HistoryEntry } from "../students/history";
import { notifyStudentsGiven } from "../lib/notify";
import type { AuthUser } from "../auth/middleware";

/**
 * Students moved to the CS a list gives each (the user, 2026-11-19: Jennifer's follow-up leads split between Alice and
 * Athira, as "Jennifer follow up - split Alice Athira.xlsx"). The list is a CSV — `<student code>,<CS name>` a line
 * (a header line is skipped). Each move is the app's own Transfer (functions/studentTransfer.ts): the CS, the team
 * from the new CS, a history line, and the new CS told they've been given the students — nothing goes to the student.
 * Payments, commission and follow-ups stay as they are; follow-ups show to whoever the student's CS now is.
 *
 * Only students who are with --from (the CS they come from) are moved, so a code two records share (88 do) can't move
 * the wrong one; a code that fits none or several of their students, or a CS name that fits nobody or several, is
 * listed and stops the run before anything is written.
 *
 *   cd backend
 *   bun src/scripts/move-students-to-cs.ts --file=<list.csv> --from="jennifer"              dry run (a line: code,CS[,name]): every move
 *   bun src/scripts/move-students-to-cs.ts --file=<list.csv> --from="jennifer" --apply      does it; an undo file first
 *   bun src/scripts/move-students-to-cs.ts --undo=<file> [--apply]                          puts them back
 */

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const MISSING = { $missing: true };
const ACTOR: AuthUser = { id: "", email: "", full_name: "Student move (list)", app_role: "super_admin" };
const VIA = "move-students-to-cs";
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const log = { database: config.mongoDb, host, applied_at: now, history_ids: [] as string[],
  changes: [] as { id: string; code: string; before: Record<string, unknown>; after: Record<string, unknown> }[] };

/** One active CS (or CS Manager, who works as one) by name or email: exact first, else the only one containing it. */
function person(staff: any[], name: string): any | string {
  const want = norm(name);
  const exact = staff.filter((u) => norm(u.full_name) === want || norm(u.email) === want || norm(String(u.email).split("@")[0]) === want);
  const found = exact.length ? exact : staff.filter((u) => norm(u.full_name).includes(want) || norm(u.email).includes(want));
  if (found.length === 1) return found[0];
  return found.length ? `"${name}" fits ${found.length}: ${found.map((u) => `${u.full_name} <${u.email}>`).join(", ")}` : `nobody active is called "${name}"`;
}

async function run() {
  const file = option("file"), fromName = option("from");
  if (!file || !fromName) throw new Error('Give the list and who they come from: --file=<list.csv> --from="<CS name>"');
  const lines = (await Bun.file(file).text()).split(/\r?\n/).map((l) => l.split(",").map((x) => x.trim())).filter((l) => l[0]);
  const wanted = lines.filter((l) => /^STU-?\d+/i.test(l[0]!)).map((l) => ({ code: l[0]!.toUpperCase(), to: l[1] ?? "", name: l.slice(2).join(",") }));
  const index = await loadTeams();
  const staff = [...index.userById.values()].filter((u) => ["cs", "cs_manager"].includes(u.app_role) && u.status !== "inactive");
  const from = person(staff, fromName);
  const problems: string[] = [];
  if (typeof from === "string") throw new Error(`--from: ${from}`);
  const toByName = new Map<string, any>();
  for (const n of new Set(wanted.map((w) => w.to))) {
    const p = person(staff, n);
    if (typeof p === "string") problems.push(`CS ${p}`); else toByName.set(n, p);
  }
  const seen = new Set<string>();
  const moves: { s: any; to: any }[] = [];
  let already = 0;
  for (const w of wanted) {
    if (seen.has(w.code)) { problems.push(`${w.code}: listed twice`); continue; }
    seen.add(w.code);
    const to = toByName.get(w.to);
    if (!to) continue;
    let all = (await col("students").find({ student_code: { $regex: `^\\s*${w.code}\\s*$`, $options: "i" } }).toArray()) as any[];
    // A name on the line, when a record of the code has it, narrows it to that record (a code two records share).
    if (w.name && all.length > 1) { const byName = all.filter((s) => norm(s.full_name) === norm(w.name)); if (byName.length) all = byName; }
    const done = all.filter((s) => String(s.primary_mentor_id ?? "") === String(to._id));
    // With --from, or already with another CS on the list (moved by hand before, now to the other one).
    const others = [...toByName.values()].map((p) => String(p._id)).filter((id) => id !== String(to._id));
    let mine = all.filter((s) => [String(from._id), ...others].includes(String(s.primary_mentor_id ?? "")));
    // A code two records share: the one --from has, then the one with the name the list gives.
    if (mine.length > 1) { const f = mine.filter((s) => String(s.primary_mentor_id) === String(from._id)); if (f.length) mine = f; }
    if (mine.length > 1 && w.name) { const byName = mine.filter((s) => norm(s.full_name) === norm(w.name)); if (byName.length) mine = byName; }
    if (!mine.length && done.length) { already++; continue; }
    if (mine.length !== 1) {
      problems.push(`${w.code}: ${mine.length ? `${mine.length} students have this code (${mine.map((s) => `${s.full_name} with ${s.primary_mentor_name}`).join("; ")}) — give the name as a third column` : `no student of ${from.full_name} has this code${all.length ? ` (it is ${all.map((s) => `${s.full_name} with ${s.primary_mentor_name || "nobody"}`).join("; ")})` : ""}`}`);
      continue;
    }
    moves.push({ s: mine[0], to });
  }
  console.log(`\nFrom: ${from.full_name} <${from.email}>`);
  for (const [n, p] of toByName) console.log(`To "${n}": ${p.full_name} <${p.email}> (${index.teamOf(p._id)?.name ?? "no team"})`);
  console.log(`\n${wanted.length} listed · ${moves.length} to move · ${already} already with their new CS\n`);
  for (const m of moves) console.log(`  ${String(m.s.student_code).padEnd(9)} ${String(m.s.full_name ?? "").trim().padEnd(36)} ${String(m.s.primary_mentor_name ?? "").padEnd(20)} → ${m.to.full_name}`);
  const per = new Map<string, number>();
  for (const m of moves) per.set(m.to.full_name, (per.get(m.to.full_name) ?? 0) + 1);
  console.log(`\n${[...per].map(([n, c]) => `${n}: ${c}`).join(" · ")}`);
  if (problems.length) {
    console.log(`\nStopped — nothing is written until every line is right:`);
    for (const p of problems) console.log(`  ✗ ${p}`);
    process.exitCode = 1;
    return;
  }
  if (!apply) { if (moves.length) console.log("\nNothing was written. Run again with --apply to do it."); return; }
  if (!moves.length) return;

  const undoPath = join(homedir(), `move-students-to-cs-undo-${now.replace(/[:.]/g, "-")}.json`);
  try {
    for (const { s, to } of moves) {
      const data: Record<string, any> = { primary_mentor_id: String(to._id), primary_mentor_name: String(to.full_name || to.email), assignment_status: "assigned", updated_date: now };
      if (!s.first_assignee_id && s.primary_mentor_id) Object.assign(data, { first_assignee_id: String(s.primary_mentor_id), first_assignee_name: String(s.primary_mentor_name ?? ""),
        first_assignee_role: String(index.userById.get(String(s.primary_mentor_id))?.app_role ?? ""), first_assigned_at: String(s.assigned_at || s.created_date || now) });
      const entries: HistoryEntry[] = await prepareStudentUpdate(s, data, ACTOR);
      // The team (and the rest prepareStudentUpdate adds to `data`) is part of the change, so the undo has it too.
      const all = { ...data };
      log.changes.push({ id: String(s._id), code: String(s.student_code ?? ""), before: Object.fromEntries(Object.keys(all).map((k) => [k, k in s ? s[k] : MISSING])), after: all });
      await col("students").updateOne({ _id: s._id }, { $set: all });
      for (const e of entries) e.via = VIA;
      if (entries.length) log.history_ids.push(...Object.values((await col("student_history").insertMany(entries as any[])).insertedIds).map(String));
      await Bun.write(undoPath, JSON.stringify(log, null, 1));
    }
    // The new CS is told, as a Transfer does (students.new_for_id + their notice) — never the student.
    const docs = (await col("students").find({ _id: { $in: moves.map((m) => m.s._id) } }).toArray()) as any[];
    await notifyStudentsGiven(docs, null);
    console.log(`\nDone: ${moves.length} student(s) moved.`);
  } finally {
    if (log.changes.length) {
      await Bun.write(undoPath, JSON.stringify(log, null, 1));
      console.log(`Undo file: ${undoPath}\n  bun src/scripts/move-students-to-cs.ts --undo=${undoPath}          (shows what it would put back)`);
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
    // Whole or not at all: a student moved again since is left as now.
    const fields = Object.keys(c.before).filter((k) => k !== "updated_date");
    const moved = fields.filter((k) => !same(doc[k], c.after[k]));
    if (moved.length) { kept.push(`${c.code}: ${moved.join(", ")} changed since — left as now`); continue; }
    const $set: Record<string, unknown> = {}, $unset: Record<string, ""> = {};
    for (const k of Object.keys(c.before)) { const v = c.before[k] as any; if (v && typeof v === "object" && v.$missing) $unset[k] = ""; else $set[k] = v; }
    back++;
    if (apply) await col("students").updateOne({ _id: doc._id }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) });
  }
  console.log(`\nUndo of the move on ${saved.applied_at}: ${back} student(s) ${apply ? "put back" : "would be put back"}, ${saved.history_ids.length} history line(s) ${apply ? "removed" : "to remove"}${apply ? "" : " — add --apply"}`);
  for (const k of kept) console.log(`  ${k}`);
  if (apply) await col("student_history").deleteMany({ _id: { $in: saved.history_ids.map((id) => toObjectId(id)) as any[] } });
}

await connectDb();
console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}`);
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
