/**
 * Only CS people hold students. Every student whose CS is not an active CS (role "cs") — a Chief, a Senior or Junior
 * Mentor, a switched-off account, an admin, or nobody — is given one, split as the user asked:
 *   - month by month (by when they were added), to the four teams so each team gets a quarter of each month — each
 *     student (or group) to the team with the fewest from that month so far, in turn when they are level;
 *   - inside a team, to its CS people the same way (fewest from this split so far, in turn when level);
 *   - students who share an email or phone (one person on two records, or a family) go together;
 *   - the same person as a student a CS already has goes to that CS, outside the turns.
 * Students already with an active CS are left as they are. Each move is the app's own change of CS: the history line,
 * the team from the new CS, who received them first. Enrolment, deposits and Common entries stay — except that a new
 * CS who was already on the student as Common is taken off that list.
 *
 *   cd backend
 *   bun src/scripts/split-students-to-cs.ts                         shows the split (add --report=<file.csv> for every move)
 *   bun src/scripts/split-students-to-cs.ts --tag="DATA - "         only students with a tag starting so (anyone else
 *                                                                   without a CS stays as they are); works with --apply
 *   bun src/scripts/split-students-to-cs.ts --apply                 does it; saves an undo file
 *   bun src/scripts/split-students-to-cs.ts --undo=<file> [--apply] puts back what --apply did
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env). Running it again moves nobody.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";
import { loadTeams } from "../students/teams";
import { prepareStudentUpdate, type HistoryEntry } from "../students/history";
import type { AuthUser } from "../auth/middleware";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const MISSING = { $missing: true };
const ACTOR: AuthUser = { id: "", email: "", full_name: "Student split", app_role: "super_admin" };
const VIA = "student-split";

const emailsOf = (v: unknown) => [...new Set((String(v ?? "").match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) ?? []).map((e) => `e:${e.toLowerCase().replace(/[.,]+$/, "")}`))];
const phoneKeys = (v: unknown) => [...new Set(String(v ?? "").replace(/\.0$/, "").split(/[\n\r/,;|]+| - /)
  .map((x) => x.replace(/\(.*?\)/g, "").replace(/\D/g, "").replace(/^00/, "")).filter((x) => x.length >= 7).map((x) => `p:${x.slice(-9)}`))];
const keysOf = (s: any) => [...emailsOf(s.email), ...phoneKeys(s.phone)];
/** --tag="DATA - ": only students with a tag starting so are given out (2026-10-02, the DATA sheet's students). */
const onlyTag = option("tag");
const tagged = (s: any) => !onlyTag || (Array.isArray(s.tags) ? s.tags : []).some((t: unknown) => typeof t === "string" && t.startsWith(onlyTag));

const log = { database: config.mongoDb, host, applied_at: now, history_ids: [] as string[],
  changes: [] as { id: string; before: Record<string, unknown>; after: Record<string, unknown> }[] };

async function change(s: any, data: Record<string, unknown>) {
  log.changes.push({ id: String(s._id), before: Object.fromEntries(Object.keys(data).map((k) => [k, k in s ? s[k] : MISSING])), after: data });
  await col("students").updateOne({ _id: s._id }, { $set: data });
  Object.assign(s, data);
}

async function split() {
  const index = await loadTeams();
  const user = (id: unknown) => (id ? index.userById.get(String(id)) : undefined);
  const isCs = (u: any) => !!u && u.app_role === "cs" && u.status !== "inactive";
  // The four teams: led by a Chief Mentor, with CS people to give students to — in the order teams take turns.
  const teams = index.teams.filter((t) => t.active && t.cs.length && user(t.id)?.app_role === "chief_mentor");
  if (!teams.length) throw new Error("No team with CS people — nothing done");

  const students = (await col("students").find({}).toArray()) as any[];
  const held = students.filter((s) => isCs(user(s.primary_mentor_id)));
  const todo = students.filter((s) => !isCs(user(s.primary_mentor_id)) && tagged(s));
  const untagged = students.filter((s) => !isCs(user(s.primary_mentor_id)) && !tagged(s)).length;

  // One person (or family) on several records: grouped by any shared email / phone, so they go together.
  const parent = new Map<string, string>();
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  const byKey = new Map<string, string>();
  for (const s of todo) {
    const id = String(s._id);
    parent.set(id, id);
    for (const k of keysOf(s)) { const other = byKey.get(k); if (other) parent.set(find(id), find(other)); else byKey.set(k, id); }
  }
  const groups = new Map<string, any[]>();
  for (const s of todo) { const r = find(String(s._id)); groups.set(r, [...(groups.get(r) ?? []), s]); }
  // The same person as a student a CS already has: to that CS.
  const csByKey = new Map<string, any>();
  for (const s of held) for (const k of keysOf(s)) if (!csByKey.has(k)) csByKey.set(k, s);

  const plan: { s: any; to: string; team: string; month: string; why: "twin" | "split" }[] = [];
  // Fewest so far wins; when level, whoever's turn it is — a family on one record or several counts as its size.
  const perMonthTeam = new Map<string, number>(), perCs = new Map<string, number>();
  const turn = { team: 0 }, csTurn = new Map<string, number>();
  const pick = <T,>(items: T[], count: (x: T) => number, start: number) => {
    let best = -1;
    for (let k = 0; k < items.length; k++) {
      const i = (start + k) % items.length;
      if (best < 0 || count(items[i]!) < count(items[best]!)) best = i;
    }
    return best;
  };
  const ordered = [...groups.values()]
    .map((g) => ({ g, date: g.map((s) => String(s.created_date ?? "")).sort()[0] ?? "", code: g.map((s) => String(s.student_code ?? "")).sort()[0] ?? "" }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  for (const { g, date } of ordered) {
    const month = date.slice(0, 7) || "(no date)";
    const twin = g.flatMap(keysOf).map((k) => csByKey.get(k)).find(Boolean);
    if (twin) {
      const to = String(twin.primary_mentor_id);
      for (const s of g) plan.push({ s, to, team: index.teamOf(to)?.name ?? "", month, why: "twin" });
      continue;
    }
    const ti = pick(teams, (t) => perMonthTeam.get(`${month}|${t.id}`) ?? 0, turn.team);
    const team = teams[ti]!;
    turn.team = ti + 1;
    perMonthTeam.set(`${month}|${team.id}`, (perMonthTeam.get(`${month}|${team.id}`) ?? 0) + g.length);
    const ci = pick(team.cs, (c) => perCs.get(c.id) ?? 0, csTurn.get(team.id) ?? 0);
    const to = team.cs[ci]!.id;
    csTurn.set(team.id, ci + 1);
    perCs.set(to, (perCs.get(to) ?? 0) + g.length);
    for (const s of g) plan.push({ s, to, team: team.name, month, why: "split" });
  }

  // What it comes to
  const name = (id: string) => String(user(id)?.full_name || user(id)?.email || id);
  const from: Record<string, number> = {};
  for (const p of plan) { const k = p.s.primary_mentor_id ? `${p.s.primary_mentor_name || name(p.s.primary_mentor_id)} (${user(p.s.primary_mentor_id)?.app_role ?? "unknown"}${user(p.s.primary_mentor_id)?.status === "inactive" ? ", off" : ""})` : "no CS"; from[k] = (from[k] ?? 0) + 1; }
  const months = [...new Set(plan.map((p) => p.month))].sort();
  const multi = [...groups.values()].filter((g) => g.length > 1);
  console.log(`\nStudents: ${students.length} · with an active CS, left as they are: ${held.length} · to give a CS: ${todo.length}`);
  if (onlyTag) console.log(`  only students with a tag starting "${onlyTag}" — ${untagged} other student(s) without a CS stay as they are`);
  console.log(`  held now by: ${Object.entries(from).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ")}`);
  console.log(`  kept together (same email or phone): ${multi.length} group(s), ${multi.reduce((n, g) => n + g.length, 0)} students`);
  console.log(`  same person as a student a CS already has → that CS: ${plan.filter((p) => p.why === "twin").length}`);
  console.log(`\nTeams, in turn: ${teams.map((t) => `${t.name} (${t.cs.map((c) => c.name).join(", ")})`).join(" · ")}`);
  console.log(`\nSplit by month added (students per team):`);
  for (const m of months) {
    const inMonth = plan.filter((p) => p.month === m && p.why === "split");
    console.log(`  ${m}: ${teams.map((t) => `${t.name} ${inMonth.filter((p) => p.team === t.name).length}`).join(" · ")}`);
  }
  console.log(`\nEach CS, before → after:`);
  for (const t of teams) for (const c of t.cs) {
    const before = held.filter((s) => String(s.primary_mentor_id) === c.id).length;
    console.log(`  ${t.name.padEnd(18)} ${c.name.padEnd(24)} ${String(before).padStart(4)} → ${before + plan.filter((p) => p.to === c.id).length}`);
  }
  const report = option("report");
  if (report) {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ["Student code,Name,Email,Phone,Added,Now with,New CS,New team,Why"];
    for (const p of plan) lines.push([p.s.student_code, p.s.full_name, p.s.email, p.s.phone, String(p.s.created_date ?? "").slice(0, 10), p.s.primary_mentor_name || "(no CS)", name(p.to), p.team, p.why === "twin" ? "same person as their CS's student" : "monthly split"].map(q).join(","));
    await Bun.write(report, lines.join("\n") + "\n");
    console.log(`\nEvery move written to ${report}`);
  }
  if (!plan.length || !apply) return;

  const undoPath = join(homedir(), `student-split-undo-${now.replace(/[:.]/g, "-")}.json`);
  let count = 0;
  try {
    for (const p of plan) {
      const s = p.s, to = user(p.to)!;
      // Loaded before the portal kept who received a student first: that was whoever has them now.
      if (!s.first_assignee_id && s.primary_mentor_id) {
        await change(s, { first_assignee_id: String(s.primary_mentor_id), first_assignee_name: String(s.primary_mentor_name ?? ""),
          first_assignee_role: String(user(s.primary_mentor_id)?.app_role ?? ""), first_assigned_at: String(s.assigned_at || s.created_date || now) });
      }
      const data: Record<string, any> = { primary_mentor_id: p.to, primary_mentor_name: String(to.full_name || to.email),
        ...(s.assignment_status !== "assigned" ? { assignment_status: "assigned" } : {}), updated_date: now };
      const entries: HistoryEntry[] = await prepareStudentUpdate(s, data, ACTOR);
      await change(s, data);
      for (const e of entries) e.via = VIA;
      if (entries.length) {
        const res = await col("student_history").insertMany(entries as any[]);
        log.history_ids.push(...Object.values(res.insertedIds).map(String));
      }
      // Their new CS no longer needs to be on the student as Common.
      if (Array.isArray(s.common_cs) && s.common_cs.some((c: any) => c?.id === p.to)) {
        await change(s, { common_cs: s.common_cs.filter((c: any) => c?.id !== p.to), updated_date: now });
      }
      // A long run: keep the undo file current, so stopping half way can still be undone.
      const done = ++count;
      if (done % 100 === 0) { await Bun.write(undoPath, JSON.stringify(log, null, 1)); process.stdout.write(`\r  ${done} / ${plan.length}`); }
    }
    console.log(`\nDone: ${plan.length} student(s) given to a CS.`);
  } finally {
    if (log.changes.length) {
      await Bun.write(undoPath, JSON.stringify(log, null, 1));
      console.log(`Undo file: ${undoPath}\n  bun src/scripts/split-students-to-cs.ts --undo=${undoPath}          (shows what it would put back)`);
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
    // Put back whole or not at all; updated_date only when nothing has touched the student since.
    const fields = Object.keys(c.before).filter((k) => k !== "updated_date");
    const moved = fields.filter((k) => !same(doc[k], c.after[k]));
    if (moved.length) { kept.push(`${doc.student_code}: ${moved.join(", ")} changed since — left as now`); continue; }
    if (!fields.length) continue;
    const keys = "updated_date" in c.before && same(doc.updated_date, c.after.updated_date) ? [...fields, "updated_date"] : fields;
    const $set: Record<string, unknown> = {}, $unset: Record<string, ""> = {};
    for (const k of keys) { const v = c.before[k] as any; if (v && typeof v === "object" && v.$missing) $unset[k] = ""; else $set[k] = v; }
    back++;
    if (apply) await col("students").updateOne({ _id: doc._id }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) });
  }
  console.log(`\nUndo of the student split on ${saved.applied_at}: ${back} change(s) put back, ${saved.history_ids.length} history line(s) removed`);
  for (const k of kept.slice(0, 50)) console.log(`  ${k}`);
  if (kept.length > 50) console.log(`  … and ${kept.length - 50} more`);
  if (apply) await col("student_history").deleteMany({ _id: { $in: saved.history_ids.map((id) => toObjectId(id)) as any[] } });
}

await connectDb();
console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}`);
try {
  const undoFile = option("undo");
  if (undoFile) await undo(undoFile);
  else await split();
} finally {
  await closeDb();
}
if (!apply) console.log("\nNothing was written. Run again with --apply to do it.");
