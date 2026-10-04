/**
 * Evens out the CS people with one year's students: those added in --year (by the Added date) who are not Closed are
 * shared out again so every CS ends with the same number of students in all, moving as few as it can (the user's ask,
 * 2026-10-03: the 471 students of 2023, each CS equal, CS 1- MH and CS2 - EX left out):
 *   - every active CS in the four teams takes part, except the ones named in --leave-out (by name or email): they give
 *     that year's students away and get none of them;
 *   - a CS above the level gives some of theirs away (spread over the year's months); a CS below it receives them;
 *     every other student of that year stays with the CS they have;
 *   - students who share an email or phone go together; one who is the same person as a student from another year
 *     (or a Closed one) stays with, or goes to, that student's CS — even when that CS is left out.
 * Students from other years, and Closed ones, are not moved; they only count in each CS's total. Each move is the app's
 * own change of CS: the history line, the team from the new CS. Enrolment, deposits and Common entries stay — except
 * that a new CS who was already on the student as Common is taken off that list.
 *
 *   cd backend
 *   bun src/scripts/balance-cs.ts --year=2023 --leave-out="CS 1- MH,CS2 - EX"           shows the plan (add --report=<file.csv> for every move)
 *   bun src/scripts/balance-cs.ts --year=2023 --leave-out="CS 1- MH,CS2 - EX" --apply   does it; saves an undo file
 *   bun src/scripts/balance-cs.ts --undo=<file> [--apply]                                puts back what --apply did
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
const ACTOR: AuthUser = { id: "", email: "", full_name: "CS balance", app_role: "super_admin" };
const VIA = "cs-balance";

const emailsOf = (v: unknown) => [...new Set((String(v ?? "").match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) ?? []).map((e) => `e:${e.toLowerCase().replace(/[.,]+$/, "")}`))];
const phoneKeys = (v: unknown) => [...new Set(String(v ?? "").replace(/\.0$/, "").split(/[\n\r/,;|]+| - /)
  .map((x) => x.replace(/\(.*?\)/g, "").replace(/\D/g, "").replace(/^00/, "")).filter((x) => x.length >= 7).map((x) => `p:${x.slice(-9)}`))];
const keysOf = (s: any) => [...emailsOf(s.email), ...phoneKeys(s.phone)];
/** The year a student was added — UTC, as the counts given to the user were made. */
const yearOf = (s: any) => { const d = s.created_date ? new Date(s.created_date) : null; return d && !isNaN(+d) ? d.getUTCFullYear() : 0; };

const log = { database: config.mongoDb, host, applied_at: now, history_ids: [] as string[],
  changes: [] as { id: string; before: Record<string, unknown>; after: Record<string, unknown> }[] };

async function change(s: any, data: Record<string, unknown>) {
  log.changes.push({ id: String(s._id), before: Object.fromEntries(Object.keys(data).map((k) => [k, k in s ? s[k] : MISSING])), after: data });
  await col("students").updateOne({ _id: s._id }, { $set: data });
  Object.assign(s, data);
}

async function balance() {
  const year = Number(option("year"));
  if (!Number.isInteger(year) || year < 2000) throw new Error("Say which year's students to share out: --year=2023");
  const leaveOut = (option("leave-out") ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

  const index = await loadTeams();
  const user = (id: unknown) => (id ? index.userById.get(String(id)) : undefined);
  // The four teams: led by a Chief Mentor, with CS people — in the order teams (and their CS people) take turns.
  const teams = index.teams.filter((t) => t.active && t.cs.length && user(t.id)?.app_role === "chief_mentor");
  const everyone = teams.flatMap((t) => t.cs.map((c) => ({ ...c, team: t.name })));
  const named = (c: { id: string; name: string }, n: string) => c.name.trim().toLowerCase() === n || String(user(c.id)?.email ?? "").toLowerCase() === n;
  const unknown = leaveOut.filter((n) => !everyone.some((c) => named(c, n)));
  if (unknown.length) throw new Error(`--leave-out: no CS in the teams called ${unknown.join(", ")}`);
  const isOut = (c: { id: string; name: string }) => leaveOut.some((n) => named(c, n));
  const cs = everyone.filter((c) => !isOut(c));
  if (!cs.length) throw new Error("No CS left to share the students to — nothing done");
  const csIds = new Set(cs.map((c) => c.id)), everyoneIds = new Set(everyone.map((c) => c.id));

  const students = (await col("students").find({}).toArray()) as any[];
  const holder = (s: any) => String(s.primary_mentor_id ?? "");
  const pool = students.filter((s) => yearOf(s) === year && s.enrolment_status !== "closed");
  const inPool = new Set(pool.map((s) => String(s._id)));

  // One person (or family) on several records: grouped by any shared email / phone, so they go together.
  const parent = new Map<string, string>();
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  const byKey = new Map<string, string>();
  for (const s of pool) {
    const id = String(s._id);
    parent.set(id, id);
    for (const k of keysOf(s)) { const other = byKey.get(k); if (other) parent.set(find(id), find(other)); else byKey.set(k, id); }
  }
  const groups = new Map<string, any[]>();
  for (const s of pool) { const r = find(String(s._id)); groups.set(r, [...(groups.get(r) ?? []), s]); }
  // The same person as a student from another year (or a Closed one) with a CS of the teams: with that CS.
  const twinCs = new Map<string, string>();
  for (const s of students) if (!inPool.has(String(s._id)) && everyoneIds.has(holder(s))) for (const k of keysOf(s)) if (!twinCs.has(k)) twinCs.set(k, holder(s));

  type Unit = { g: any[]; size: number; at: string; date: string; fixed: string | null; to?: string };
  const units: Unit[] = [...groups.values()].map((g) => {
    const holders = g.map(holder);
    const at = holders.find((h) => csIds.has(h)) ?? holders[0] ?? "";
    const twins = [...new Set(g.flatMap(keysOf).map((k) => twinCs.get(k)).filter((x): x is string => !!x))];
    return { g, size: g.length, at, date: g.map((s) => String(s.created_date ?? "")).sort()[0] ?? "", fixed: twins.length ? (twins.includes(at) ? at : twins[0]!) : null };
  });
  for (const u of units) if (u.fixed) u.to = u.fixed;

  // The level: each CS's students from other years (and Closed ones) plus their fixed ones, then the rest of the
  // year's students one at a time to whoever has the fewest (in turn when level) — every CS ends equal, or one apart.
  const base = new Map(cs.map((c) => [c.id, students.filter((s) => holder(s) === c.id && !inPool.has(String(s._id))).length]));
  for (const u of units) if (u.fixed && csIds.has(u.fixed)) base.set(u.fixed, base.get(u.fixed)! + u.size);
  const movable = units.filter((u) => !u.fixed);
  const quota = new Map(cs.map((c) => [c.id, 0]));
  const level = (id: string) => base.get(id)! + quota.get(id)!;
  for (let n = movable.reduce((t, u) => t + u.size, 0); n > 0; n--) {
    let best = cs[0]!.id;
    for (const c of cs) if (level(c.id) < level(best)) best = c.id;
    quota.set(best, quota.get(best)! + 1);
  }

  // Keep what fits; a CS above their share gives the rest away, spread over the year (one at a time before groups).
  const given: Unit[] = [];
  const room = new Map(cs.map((c) => [c.id, quota.get(c.id)!]));
  const byDate = (a: Unit, b: Unit) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  for (const c of cs) {
    const own = movable.filter((u) => u.at === c.id).sort(byDate);
    let over = own.reduce((t, u) => t + u.size, 0) - quota.get(c.id)!;
    const out = new Set<Unit>();
    if (over > 0) {
      const singles = own.filter((u) => u.size === 1);
      const take = Math.min(over, singles.length);
      for (let k = 0; k < take; k++) out.add(singles[Math.floor(((k + 0.5) * singles.length) / take)]!);
      over -= take;
      for (const u of own.filter((x) => x.size > 1)) { if (over <= 0) break; out.add(u); over -= u.size; }
    }
    for (const u of own) if (out.has(u)) given.push(u); else { u.to = c.id; room.set(c.id, room.get(c.id)! - u.size); }
  }
  // Everything held by a CS who is left out (or by nobody in the teams) is given away too.
  given.push(...movable.filter((u) => !csIds.has(u.at)));
  // Groups first, then the rest in date order, each to whoever has the most of their share still open (as a part of
  // it) — so every receiving CS fills at the same pace and gets a spread of the year's months.
  const need = new Map(room);
  const open = (id: string) => (room.get(id)! > 0 ? room.get(id)! / need.get(id)! : -1);
  given.sort((a, b) => b.size - a.size || byDate(a, b));
  for (const u of given) {
    let best = cs[0]!.id;
    for (const c of cs) if (open(c.id) > open(best) || (open(c.id) === open(best) && room.get(c.id)! > room.get(best)!)) best = c.id;
    u.to = best;
    room.set(best, room.get(best)! - u.size);
  }

  const plan: { s: any; to: string; why: "twin" | "balance" }[] = [];
  for (const u of units) for (const s of u.g) if (holder(s) !== u.to) plan.push({ s, to: u.to!, why: u.fixed ? "twin" : "balance" });

  // What it comes to
  const name = (id: string) => String(user(id)?.full_name || user(id)?.email || id || "nobody");
  const total = (id: string) => students.filter((s) => holder(s) === id).length;
  const after = (id: string) => total(id) - plan.filter((p) => holder(p.s) === id).length + plan.filter((p) => p.to === id).length;
  const ofYear = (id: string) => pool.filter((s) => holder(s) === id).length;
  const ofYearAfter = (id: string) => units.filter((u) => u.to === id).reduce((t, u) => t + u.size, 0);
  const multi = units.filter((u) => u.size > 1);
  const levels = [...new Set(cs.map((c) => after(c.id)))].sort((a, b) => a - b);
  console.log(`\nStudents: ${students.length} · added in ${year} and not Closed: ${pool.length} — everyone else stays as they are`);
  if (leaveOut.length) console.log(`  left out (give their ${year} students away, get none): ${everyone.filter(isOut).map((c) => c.name).join(", ")}`);
  console.log(`  kept together (same email or phone): ${multi.length} group(s), ${multi.reduce((t, u) => t + u.size, 0)} students`);
  console.log(`  same person as a student from another year → that student's CS: ${units.filter((u) => u.fixed).reduce((t, u) => t + u.size, 0)}`);
  console.log(`  every CS taking part ends with ${levels.join(" or ")} students`);
  const held = pool.filter((s) => !everyoneIds.has(holder(s))).length;
  if (held) console.log(`  ${held} of them are with nobody in the teams now — they are given out too`);
  console.log(`\n${"Team".padEnd(18)} ${"CS".padEnd(24)} ${"now".padStart(5)} ${`${year} now`.padStart(9)} ${`${year} after`.padStart(11)} ${"after".padStart(6)} ${"change".padStart(7)}`);
  for (const t of teams) for (const c of t.cs) {
    const d = after(c.id) - total(c.id);
    console.log(`${t.name.padEnd(18)} ${(c.name + (isOut(c) ? " (left out)" : "")).padEnd(24)} ${String(total(c.id)).padStart(5)} ${String(ofYear(c.id)).padStart(9)} ${String(ofYearAfter(c.id)).padStart(11)} ${String(after(c.id)).padStart(6)} ${(d > 0 ? `+${d}` : String(d)).padStart(7)}`);
  }
  console.log(`\nTeams after: ${teams.map((t) => `${t.name} ${t.cs.reduce((n, c) => n + after(c.id), 0)}`).join(" · ")}`);
  console.log(`Moves: ${plan.length} student(s) change CS; ${pool.length - plan.length} of the ${pool.length} stay where they are.`);

  const report = option("report");
  if (report) {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ["Student code,Name,Email,Phone,Added,Now with,New CS,New team,Why"];
    for (const p of plan) lines.push([p.s.student_code, p.s.full_name, p.s.email, p.s.phone, String(p.s.created_date ?? "").slice(0, 10), p.s.primary_mentor_name || "(no CS)", name(p.to), index.teamOf(p.to)?.name ?? "", p.why === "twin" ? "same person as their CS's student" : "evening out the CS"].map(q).join(","));
    await Bun.write(report, lines.join("\n") + "\n");
    console.log(`\nEvery move written to ${report}`);
  }
  if (!plan.length || !apply) return;

  const undoPath = join(homedir(), `cs-balance-undo-${now.replace(/[:.]/g, "-")}.json`);
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
      // Keep the undo file current, so stopping half way can still be undone.
      const done = ++count;
      if (done % 50 === 0) { await Bun.write(undoPath, JSON.stringify(log, null, 1)); process.stdout.write(`\r  ${done} / ${plan.length}`); }
    }
    console.log(`\nDone: ${plan.length} student(s) moved.`);
  } finally {
    if (log.changes.length) {
      await Bun.write(undoPath, JSON.stringify(log, null, 1));
      console.log(`Undo file: ${undoPath}\n  bun src/scripts/balance-cs.ts --undo=${undoPath}          (shows what it would put back)`);
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
  console.log(`\nUndo of the CS balance on ${saved.applied_at}: ${back} change(s) put back, ${saved.history_ids.length} history line(s) removed`);
  for (const k of kept.slice(0, 50)) console.log(`  ${k}`);
  if (kept.length > 50) console.log(`  … and ${kept.length - 50} more`);
  if (apply) await col("student_history").deleteMany({ _id: { $in: saved.history_ids.map((id) => toObjectId(id)) as any[] } });
}

await connectDb();
console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}`);
try {
  const undoFile = option("undo");
  if (undoFile) await undo(undoFile);
  else await balance();
} finally {
  await closeDb();
}
if (!apply) console.log("\nNothing was written. Run again with --apply to do it.");
