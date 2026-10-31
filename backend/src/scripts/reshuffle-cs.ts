/**
 * The CS reshuffle the user asked for on 2026-10-31, in this order:
 *   1. Arya moves to Money Heist with her students: her Up Head becomes the one Money Heist's other CS people have
 *      (its CS Manager), and her students' stored team follows (also on Common entries naming her).
 *   2. Haritha's students are shared between Athira and Arya, half each; Haritha then takes no new students
 *      (Personnel → "No new students", `no_auto_assign`), so the rotation doesn't fill her up again.
 *   3. CS 1- MH's students go to Wall Street, half to Ammu and half to Anuja.
 *   4. CS2 - EX's students are shared between Megha and Alice, half each.
 *
 * A share is equal and mixed: oldest added first, to whoever has had fewest from this share so far (in turn when
 * level). Students who share an email or phone (one person on two records, a family) go together. Each move is the
 * app's own change of CS: the history line (via "cs-reshuffle"), the team from the new CS, who received them first;
 * a new CS who was on the student as Common is taken off that list. Payments, follow-ups and enrolment stay.
 *
 * People are found by name among active CS people (exact name first, then a name containing it); a name that fits more
 * than one stops the script, listing them. Names can be changed: --arya= --team="Money Heist" --haritha= --athira=
 * --mh="CS 1- MH" --ammu= --anuja= --ex="CS2 - EX" --megha= --alice=
 *
 *   cd backend
 *   bun src/scripts/reshuffle-cs.ts                          shows what it would do (--report=<file.csv>: every move)
 *   bun src/scripts/reshuffle-cs.ts --apply                  does it; saves an undo file in your home folder
 *   bun src/scripts/reshuffle-cs.ts --undo=<file> [--apply]  puts back what --apply did
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env). Running it again moves nobody.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";
import { loadTeams, type TeamIndex } from "../students/teams";
import { prepareStudentUpdate, type HistoryEntry } from "../students/history";
import type { AuthUser } from "../auth/middleware";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const MISSING = { $missing: true };
const ACTOR: AuthUser = { id: "", email: "", full_name: "CS reshuffle", app_role: "super_admin" };
const VIA = "cs-reshuffle";

const names = {
  arya: option("arya") ?? "Arya", team: option("team") ?? "Money Heist", haritha: option("haritha") ?? "Haritha",
  athira: option("athira") ?? "Athira", mh: option("mh") ?? "CS 1- MH", ammu: option("ammu") ?? "Ammu",
  anuja: option("anuja") ?? "Anuja", ex: option("ex") ?? "CS2 - EX", megha: option("megha") ?? "Megha", alice: option("alice") ?? "Alice",
};

const emailsOf = (v: unknown) => [...new Set((String(v ?? "").match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) ?? []).map((e) => `e:${e.toLowerCase().replace(/[.,]+$/, "")}`))];
const phoneKeys = (v: unknown) => [...new Set(String(v ?? "").replace(/\.0$/, "").split(/[\n\r/,;|]+| - /)
  .map((x) => x.replace(/\(.*?\)/g, "").replace(/\D/g, "").replace(/^00/, "")).filter((x) => x.length >= 7).map((x) => `p:${x.slice(-9)}`))];
const keysOf = (s: any) => [...emailsOf(s.email), ...phoneKeys(s.phone)];

const log = { database: config.mongoDb, host, applied_at: now, history_ids: [] as string[],
  changes: [] as { coll: "students" | "users"; id: string; before: Record<string, unknown>; after: Record<string, unknown> }[] };

async function change(coll: "students" | "users", doc: any, data: Record<string, unknown>) {
  log.changes.push({ coll, id: String(doc._id), before: Object.fromEntries(Object.keys(data).map((k) => [k, k in doc ? doc[k] : MISSING])), after: data });
  await col(coll).updateOne({ _id: doc._id }, { $set: data });
  Object.assign(doc, data);
}

/** One active CS by name: exact (case and spaces aside), else the only one whose name contains it. */
function person(index: TeamIndex, name: string, label: string): any {
  const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  // CS people only: a mentor of the same name (there is an Arya among the Junior Mentors) is never picked.
  const staff = [...index.userById.values()].filter((u) => u.app_role === "cs" && u.status !== "inactive");
  const want = norm(name);
  const exact = staff.filter((u) => norm(u.full_name) === want);
  const found = exact.length ? exact : staff.filter((u) => norm(u.full_name).includes(want));
  const show = (u: any) => `${u.full_name} <${u.email}> (${u.app_role}, ${index.teamOf(u._id)?.name ?? "no team"})`;
  if (found.length === 1) return found[0];
  throw new Error(found.length
    ? `"${name}" (${label}) fits ${found.length} people — give the full name with --${label}="…":\n  ${found.map(show).join("\n  ")}`
    : `Nobody active is called "${name}" (${label}) — give the name with --${label}="…"`);
}

type Move = { s: any; to: any; step: string };

/** `from`'s students shared between `to`, oldest first, equal counts; one person's records go together. */
function share(students: any[], from: any, to: any[], step: string): Move[] {
  const mine = students.filter((s) => String(s.primary_mentor_id ?? "") === String(from._id));
  const parent = new Map<string, string>();
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  const byKey = new Map<string, string>();
  for (const s of mine) {
    const id = String(s._id);
    parent.set(id, id);
    for (const k of keysOf(s)) { const other = byKey.get(k); if (other) parent.set(find(id), find(other)); else byKey.set(k, id); }
  }
  const groups = new Map<string, any[]>();
  for (const s of mine) { const r = find(String(s._id)); groups.set(r, [...(groups.get(r) ?? []), s]); }
  const ordered = [...groups.values()].map((g) => ({ g, key: g.map((s) => `${s.created_date ?? ""}|${s.student_code ?? ""}`).sort()[0] ?? "" }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const count = to.map(() => 0);
  let turn = 0;
  const moves: Move[] = [];
  for (const { g } of ordered) {
    let best = -1;
    for (let k = 0; k < to.length; k++) { const i = (turn + k) % to.length; if (best < 0 || count[i]! < count[best]!) best = i; }
    turn = best + 1;
    count[best]! += g.length;
    for (const s of g) moves.push({ s, to: to[best], step });
  }
  return moves;
}

async function run() {
  let index = await loadTeams();
  const arya = person(index, names.arya, "arya");
  const haritha = person(index, names.haritha, "haritha");
  const athira = person(index, names.athira, "athira");
  const mh = person(index, names.mh, "mh");
  const ammu = person(index, names.ammu, "ammu");
  const anuja = person(index, names.anuja, "anuja");
  const ex = person(index, names.ex, "ex");
  const megha = person(index, names.megha, "megha");
  const alice = person(index, names.alice, "alice");
  const label = (u: any) => `${u.full_name} (${index.teamOf(u._id)?.name ?? "no team"})`;
  console.log(`\nPeople: Arya = ${label(arya)} · Haritha = ${label(haritha)} · Athira = ${label(athira)} · CS 1- MH = ${label(mh)}`);
  console.log(`        Ammu = ${label(ammu)} · Anuja = ${label(anuja)} · CS2 - EX = ${label(ex)} · Megha = ${label(megha)} · Alice = ${label(alice)}`);

  // ── 1. Arya to Money Heist ──────────────────────────────────────────────
  const want = names.team.trim().toLowerCase();
  const teams = index.teams.filter((t) => t.name.toLowerCase().includes(want));
  if (teams.length !== 1) throw new Error(`"${names.team}" fits ${teams.length} teams: ${index.teams.map((t) => t.name).join(", ")}`);
  const team = teams[0]!;
  // The Up Head Money Heist's other CS people have (its CS Manager); its leader when they differ or there are none.
  const heads = new Map<string, number>();
  for (const u of index.userById.values()) {
    if (u.app_role !== "cs" || u.status === "inactive" || String(u._id) === String(arya._id) || index.teamOf(u._id)?.id !== team.id || !u.up_head_id) continue;
    heads.set(String(u.up_head_id), (heads.get(String(u.up_head_id)) ?? 0) + 1);
  }
  const headId = [...heads.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? team.id;
  const head = index.userById.get(headId);
  const aryaMoves = index.teamOf(arya._id)?.id !== team.id;
  console.log(`\n1. ${arya.full_name} → ${team.name}: ${aryaMoves ? `Up Head ${index.userById.get(String(arya.up_head_id ?? ""))?.full_name ?? "none"} → ${head?.full_name ?? headId}` : "already there"}`);

  const students = (await col("students").find({}).toArray()) as any[];
  const theirs = students.filter((s) => String(s.primary_mentor_id ?? "") === String(arya._id));
  const commons = students.filter((s) => (s.common_cs ?? []).some((c: any) => String(c?.id) === String(arya._id)));
  console.log(`   her students: ${theirs.length} (their team → ${team.name}) · Common entries naming her: ${commons.length}`);

  // ── 2–4. The shares ─────────────────────────────────────────────────────
  const moves = [
    ...share(students, haritha, [athira, arya], `2. ${haritha.full_name} → ${athira.full_name} / ${arya.full_name}`),
    ...share(students, mh, [ammu, anuja], `3. ${mh.full_name} → ${ammu.full_name} / ${anuja.full_name}`),
    ...share(students, ex, [megha, alice], `4. ${ex.full_name} → ${megha.full_name} / ${alice.full_name}`),
  ];
  for (const step of [...new Set(moves.map((m) => m.step))]) {
    const of = moves.filter((m) => m.step === step);
    const per = new Map<string, number>();
    for (const m of of) per.set(m.to.full_name, (per.get(m.to.full_name) ?? 0) + 1);
    console.log(`\n${step}: ${of.length} students — ${[...per.entries()].map(([n, c]) => `${n} ${c}`).join(" · ")}`);
  }
  for (const [n, from] of [["2", haritha], ["3", mh], ["4", ex]] as const) {
    if (!moves.some((m) => m.step.startsWith(n))) console.log(`\n${n}. ${from.full_name} has no students — nothing to share`);
  }
  console.log(`   ${haritha.full_name}: ${haritha.no_auto_assign === true ? "takes no new students already" : "→ No new students"}`);

  const people = [arya, haritha, athira, mh, ammu, anuja, ex, megha, alice];
  console.log("\nEach person's students, before → after:");
  for (const p of people) {
    const id = String(p._id);
    const before = students.filter((s) => String(s.primary_mentor_id ?? "") === id).length;
    const after = before - moves.filter((m) => String(m.s.primary_mentor_id) === id).length + moves.filter((m) => String(m.to._id) === id).length;
    console.log(`  ${String(p.full_name).padEnd(26)} ${String(before).padStart(5)} → ${after}`);
  }
  const report = option("report");
  if (report) {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ["Step,Student code,Name,Email,Phone,Added,Now with,New CS"];
    for (const m of moves) lines.push([m.step, m.s.student_code, m.s.full_name, m.s.email, m.s.phone, String(m.s.created_date ?? "").slice(0, 10), m.s.primary_mentor_name, m.to.full_name].map(q).join(","));
    await Bun.write(report, lines.join("\n") + "\n");
    console.log(`\nEvery move written to ${report}`);
  }
  if (!apply || (!aryaMoves && !moves.length && haritha.no_auto_assign === true)) return;

  const undoPath = join(homedir(), `cs-reshuffle-undo-${now.replace(/[:.]/g, "-")}.json`);
  try {
    // 1. Arya's Up Head, then her students' stored team (and on Common entries naming her) from where she is now.
    if (aryaMoves) {
      await change("users", arya, { up_head_id: headId, ...("up_head_name" in arya ? { up_head_name: String(head?.full_name ?? "") } : {}), updated_date: now });
      index = await loadTeams();
    }
    const t = index.teamOf(arya._id);
    for (const s of theirs) if (t && (s.team_id !== t.id || s.team_name !== t.name)) await change("students", s, { team_id: t.id, team_name: t.name });
    for (const s of commons) {
      const next = s.common_cs.map((c: any) => (String(c?.id) === String(arya._id) && t ? { ...c, team_name: t.name } : c));
      if (JSON.stringify(next) !== JSON.stringify(s.common_cs)) await change("students", s, { common_cs: next });
    }
    // 2–4. Each move, as the app's change of CS.
    let done = 0;
    for (const m of moves) {
      const s = m.s, to = m.to, toId = String(to._id);
      if (!s.first_assignee_id && s.primary_mentor_id) {
        await change("students", s, { first_assignee_id: String(s.primary_mentor_id), first_assignee_name: String(s.primary_mentor_name ?? ""),
          first_assignee_role: String(index.userById.get(String(s.primary_mentor_id))?.app_role ?? ""), first_assigned_at: String(s.assigned_at || s.created_date || now) });
      }
      const data: Record<string, any> = { primary_mentor_id: toId, primary_mentor_name: String(to.full_name || to.email),
        ...(s.assignment_status !== "assigned" ? { assignment_status: "assigned" } : {}), updated_date: now };
      const entries: HistoryEntry[] = await prepareStudentUpdate(s, data, ACTOR);
      await change("students", s, data);
      for (const e of entries) e.via = VIA;
      if (entries.length) {
        const res = await col("student_history").insertMany(entries as any[]);
        log.history_ids.push(...Object.values(res.insertedIds).map(String));
      }
      if (Array.isArray(s.common_cs) && s.common_cs.some((c: any) => String(c?.id) === toId)) {
        await change("students", s, { common_cs: s.common_cs.filter((c: any) => String(c?.id) !== toId), updated_date: now });
      }
      if (++done % 100 === 0) { await Bun.write(undoPath, JSON.stringify(log, null, 1)); process.stdout.write(`\r  ${done} / ${moves.length}`); }
    }
    // Haritha takes no new students.
    if (haritha.no_auto_assign !== true) await change("users", haritha, { no_auto_assign: true, updated_date: now });
    console.log(`\nDone: ${aryaMoves ? `${arya.full_name} moved to ${team.name}, ` : ""}${moves.length} student(s) moved.`);
  } finally {
    if (log.changes.length) {
      await Bun.write(undoPath, JSON.stringify(log, null, 1));
      console.log(`Undo file: ${undoPath}\n  bun src/scripts/reshuffle-cs.ts --undo=${undoPath}          (shows what it would put back)`);
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
    const doc: any = await col(c.coll ?? "students").findOne({ _id: toObjectId(c.id) as any });
    if (!doc) continue;
    // Put back whole or not at all; updated_date only when nothing has touched it since.
    const fields = Object.keys(c.before).filter((k) => k !== "updated_date");
    const moved = fields.filter((k) => !same(doc[k], c.after[k]));
    if (moved.length) { kept.push(`${doc.student_code ?? doc.full_name}: ${moved.join(", ")} changed since — left as now`); continue; }
    if (!fields.length) continue;
    const keys = "updated_date" in c.before && same(doc.updated_date, c.after.updated_date) ? [...fields, "updated_date"] : fields;
    const $set: Record<string, unknown> = {}, $unset: Record<string, ""> = {};
    for (const k of keys) { const v = c.before[k] as any; if (v && typeof v === "object" && v.$missing) $unset[k] = ""; else $set[k] = v; }
    back++;
    if (apply) await col(c.coll ?? "students").updateOne({ _id: doc._id }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) });
  }
  console.log(`\nUndo of the CS reshuffle on ${saved.applied_at}: ${back} change(s) put back, ${saved.history_ids.length} history line(s) removed`);
  for (const k of kept.slice(0, 50)) console.log(`  ${k}`);
  if (kept.length > 50) console.log(`  … and ${kept.length - 50} more`);
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
if (!apply) console.log("\nNothing was written. Run again with --apply to do it.");
