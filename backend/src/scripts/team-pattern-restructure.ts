/**
 * The team pattern from "Team Pattern.docx" (30 Sep 2026), set up on the portal:
 *
 *   Team Wall Street   Raghav ← Arya Mol (Admin) ← CSE Ammu, Anuja · mentors Libin, Nadeem
 *   Team Gladiators    Midlaj ← CSE Jennifer, Ajna · mentors Vishnu, Anfida           (no Admin yet)
 *   Team Expandables   Amjad  ← Megha (Admin) ← CSE Alice, Muskan · mentors Jugal, Fousiya
 *   Team Money Heist   Mujeeb ← Haritha (Admin) ← CSE Athira · mentors Arya, Kiran, Akhil
 *   Mena               Moiz, Hafizulla — straight under Raghav or Amjad with --mena=raghav|amjad;
 *                      without it they are left as they are
 *
 * In order:
 *   1. switches off the three test mentor accounts, and helanmary (left, per HRMS)
 *   2. creates the missing accounts (emails from HRMS) as the Root portal's provision-user does:
 *      a random password nobody is told — they sign in from the Root portal
 *   3. roles: CSEs → CS (they take new students in turns), Admins → CS Manager,
 *      new mentors and Jugal → Junior Mentor
 *   4. the CS Manager role sees its team's students (data scope "downline", "Team students")
 *   5. team names — on the four Chiefs, and on the students that carry the old ones
 *   6. reporting lines (Up Head)
 *   7. real students left on switched-off test accounts → their team's CSEs, in turns,
 *      recorded in their history like any other change of mentor
 *   8. the team stored on the students of everyone placed here, where they have none yet
 *
 *   cd backend
 *   bun src/scripts/team-pattern-restructure.ts [--mena=raghav|amjad]           shows what it would do
 *   bun src/scripts/team-pattern-restructure.ts [--mena=raghav|amjad] --apply   does it; saves an undo file
 *   bun src/scripts/team-pattern-restructure.ts --undo=<file> [--apply]         puts back what --apply changed
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env).
 * Safe to run again: whatever is already as planned is left alone.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";
import { loadTeams } from "../students/teams";
import { prepareStudentUpdate } from "../students/history";
import type { AuthUser } from "../auth/middleware";

const D = "@deltainstitutions.com";
const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = new Date().toISOString();
const ACTOR: AuthUser = { id: "", email: "", full_name: "Team restructure", app_role: "super_admin" };
const ROLE_NAME: Record<string, string> = {
  cs: "CS", cs_manager: "CS Manager", junior_mentor: "Junior Mentor", senior_mentor: "Senior Mentor",
  chief_mentor: "Chief Mentor", assistance: "Assistance", academic_admin: "Academic Admin",
};

/** `role`: the role they end with (left as it is when absent). `name`: from HRMS — the account is created when missing. */
interface Person { email: string; role?: string; name?: string }
interface TeamPlan { name: string; head: string; testKey: string; admin?: string; members: Person[] }

const TEAMS: TeamPlan[] = [
  {
    name: "Team Wall Street", head: `raghav${D}`, testKey: "raghav", admin: `arya.mol${D}`,
    members: [
      { email: `ammu.sudarshanan${D}`, role: "cs" },
      { email: `anuja${D}`, role: "cs", name: "Anuja Sabu" },
      { email: `libin${D}` },
      { email: `nadeem${D}`, role: "junior_mentor", name: "Nadeem" },
    ],
  },
  {
    name: "Team Gladiators", head: `midlaj${D}`, testKey: "midlaj",
    members: [
      { email: `jennifer.fernandez${D}`, role: "cs" },
      { email: `ajna${D}`, role: "cs", name: "Ajna Hamza" },
      { email: `vishnuprasad${D}` },
      { email: `nafeesathul.anfida${D}`, role: "junior_mentor", name: "Nafeesathul Anfida N V" },
    ],
  },
  {
    name: "Team Expandables", head: `amjad${D}`, testKey: "amjad", admin: `megha${D}`,
    members: [
      { email: `alice.antony${D}`, role: "cs", name: "Alice Antony" },
      { email: `muskanshaikh${D}`, role: "cs", name: "Muskan Shaikh" },
      { email: `jugal${D}`, role: "junior_mentor" },
      { email: `fousiya${D}`, role: "junior_mentor", name: "Fousiya Beevi" },
    ],
  },
  {
    name: "Team Money Heist", head: `mujeebrahmanp${D}`, testKey: "mujeeb", admin: `haritha.kg${D}`,
    members: [
      { email: `athiravelayudan${D}`, role: "cs" },
      { email: `arya${D}` },
      { email: `kiran${D}`, role: "junior_mentor", name: "Kiran Vishnudas" },
      { email: `akhilcp${D}`, role: "junior_mentor", name: "Akhil CP" },
    ],
  },
];
const MENA: Person[] = [
  { email: `moizzuhaib${D}` },
  { email: `haffizullakhan${D}`, role: "junior_mentor", name: "Hafizulla Khan" },
];
const MENA_HEAD: Record<string, string> = { raghav: `raghav${D}`, amjad: `amjad${D}` };
const SWITCH_OFF = ["nasrunpk55@gmail.com", "shafeelkt080@gmail.com", "testcarlton9@gmail.com", `helanmary${D}`];

/* ── what --apply changed, so --undo can put it back ─────────────────────── */

const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const MISSING = { $missing: true };
interface Change { coll: string; id: string; before: Record<string, unknown>; after: Record<string, unknown> }
const log = { database: config.mongoDb, host, applied_at: now, created_users: [] as string[], history_ids: [] as string[], changes: [] as Change[] };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const short = (u: any) => String(u?.email ?? "").replace(D, "");
const section = (title: string) => console.log(`\n${title}`);
const line = (text: string) => console.log(`  ${text}`);

/** $set what differs (plus updated_date unless `touch` is false); with --apply, note what it was. */
async function update(coll: string, doc: any, set: Record<string, unknown>, touch = true): Promise<string[]> {
  const changed = Object.keys(set).filter((k) => !same(doc[k], set[k]));
  if (!changed.length) return [];
  if (apply) {
    const $set: Record<string, unknown> = Object.fromEntries(changed.map((k) => [k, set[k]]));
    if (touch) $set.updated_date = now;
    log.changes.push({
      coll, id: String(doc._id),
      before: Object.fromEntries(Object.keys($set).map((k) => [k, k in doc ? doc[k] : MISSING])),
      after: $set,
    });
    await col(coll).updateOne({ _id: doc._id }, { $set });
    Object.assign(doc, $set);
  }
  return changed;
}

/** The same field set on many students (no updated_date: a stored copy of the team, not an edit). */
async function updateStudents(docs: any[], set: Record<string, unknown>) {
  if (!apply || !docs.length) return;
  for (let i = 0; i < docs.length; i += 500) {
    const part = docs.slice(i, i + 500);
    for (const d of part) {
      log.changes.push({ coll: "students", id: String(d._id), before: Object.fromEntries(Object.keys(set).map((k) => [k, k in d ? d[k] : MISSING])), after: set });
    }
    await col("students").bulkWrite(part.map((d) => ({ updateOne: { filter: { _id: d._id }, update: { $set: set } } })));
  }
}

/* ── the restructure ─────────────────────────────────────────────────────── */

async function restructure() {
  const menaKey = option("mena");
  if (menaKey && !MENA_HEAD[menaKey]) throw new Error(`--mena is raghav or amjad, not "${menaKey}"`);

  // Everyone the plan names: their team, who they report to, the role they end with.
  const rows: { email: string; upHead: string | null; team: string; role?: string; name?: string }[] = [];
  for (const t of TEAMS) {
    rows.push({ email: t.head, upHead: null, team: t.name });
    if (t.admin) rows.push({ email: t.admin, upHead: t.head, team: t.name, role: "cs_manager" });
    for (const m of t.members) rows.push({ ...m, upHead: t.admin ?? t.head, team: t.name });
  }
  if (menaKey) {
    const head = MENA_HEAD[menaKey];
    for (const m of MENA) rows.push({ ...m, upHead: head, team: TEAMS.find((t) => t.head === head)!.name });
  }

  const found = new Map<string, any>();
  for (const email of [...rows.map((r) => r.email), ...SWITCH_OFF]) {
    const u = await col("users").findOne({ email });
    if (u) found.set(email, u);
  }
  const problems = [
    ...rows.filter((r) => !found.has(r.email) && !r.name).map((r) => `${r.email} should already have an account`),
    ...TEAMS.filter((t) => found.get(t.head) && found.get(t.head).app_role !== "chief_mentor").map((t) => `${t.head} is not a Chief Mentor`),
  ];
  if (problems.length) {
    for (const p of problems) console.log(`  ! ${p}`);
    throw new Error("Nothing was changed.");
  }
  for (const r of rows) if (found.get(r.email)?.status === "inactive") console.log(`  ! ${r.email} is switched off — placed anyway, still off`);

  section("1. Switch off");
  for (const email of SWITCH_OFF) {
    const u = found.get(email);
    line(`${email}: ${!u ? "no account" : (await update("users", u, { status: "inactive" })).length ? "switched off" : "already off"}`);
  }

  section("2. New accounts (sign in from the Root portal)");
  const toCreate = rows.filter((r) => !found.has(r.email));
  if (!toCreate.length) line("none");
  for (const r of toCreate) {
    line(`${r.name} <${r.email}> — ${ROLE_NAME[r.role!]}, ${r.team}`);
    if (!apply) continue;
    const doc = {
      email: r.email,
      full_name: r.name,
      app_role: r.role,
      // What the Root portal's provision-user gives.
      commission_rate: 4,
      upline_commission_percentage: 0,
      password_hash: await bcrypt.hash(randomBytes(24).toString("hex"), 10),
      status: "active",
      created_via: "team-pattern-restructure",
      created_date: now,
      updated_date: now,
    };
    const res = await col("users").insertOne(doc as any);
    log.created_users.push(String(res.insertedId));
    found.set(r.email, { _id: res.insertedId, ...doc });
  }

  section("3. Roles");
  let roles = 0;
  for (const r of rows) {
    const u = found.get(r.email);
    if (!u || !r.role || toCreate.includes(r)) continue;
    const before = u.app_role;
    if ((await update("users", u, { app_role: r.role })).length) {
      roles++;
      line(`${short(u)}: ${ROLE_NAME[before] ?? before ?? "no role"} → ${ROLE_NAME[r.role]}`);
    }
  }
  if (!roles) line("nothing to change");

  section("4. The CS Manager role sees its team's students");
  const csm = await col("commission_roles").findOne({ role_key: "cs_manager" });
  if (!csm) line("there is no CS Manager role — nothing to do");
  else {
    const before = csm.data_scope ?? "(none)";
    line((await update("commission_roles", csm, { data_scope: "downline" })).length ? `data scope ${before} → downline ("Team students")` : "already downline");
  }

  section("5. Team names");
  for (const t of TEAMS) {
    const head = found.get(t.head);
    const before = head.team_name || "(none)";
    await update("users", head, { team_name: t.name });
    const stale = await col("students").find({ team_id: String(head._id), team_name: { $ne: t.name } }, { projection: { team_name: 1 } }).toArray();
    line(`${before} → ${t.name} (${short(head)}); ${stale.length} student(s) carry the old name`);
    await updateStudents(stale, { team_name: t.name });
  }

  section("6. Reporting lines (Up Head)");
  let lines = 0;
  for (const r of rows.filter((r) => r.upHead)) {
    const head = found.get(r.upHead!);
    const u = found.get(r.email);
    if (!u) { lines++; line(`${r.name} (new) → ${short(head)}`); continue; }
    const before = u.up_head_name || "none";
    if ((await update("users", u, { up_head_id: String(head._id), up_head_name: String(head.full_name ?? "") })).length) {
      lines++;
      line(`${short(u)}: ${before} → ${short(head)}`);
    }
  }
  if (!lines) line("nothing to change");
  if (!menaKey) line(`Mena (${MENA.map((m) => m.email.replace(D, "")).join(", ")}): left as they are — pass --mena=raghav or --mena=amjad`);

  if (apply) {
    // The teams as the portal now sees them — must match the plan.
    const index = await loadTeams();
    const wrong = rows.filter((r) => index.teamOf(String(found.get(r.email)._id))?.name !== r.team);
    section("   Check: the portal's own team logic");
    line(wrong.length ? `! not where planned: ${wrong.map((r) => `${r.email} (${index.teamOf(String(found.get(r.email)._id))?.name ?? "no team"})`).join(", ")}` : `all ${rows.length} people are on the planned team`);
  }

  section("7. Real students on switched-off test accounts → their team's CSEs, in turns");
  const tests = await col("users").find({ $or: [{ is_test: true }, { email: /@deltatest\.dev$/ }] }, { projection: { email: 1 } }).toArray();
  const testEmail = new Map(tests.map((u: any) => [String(u._id), String(u.email)]));
  const stuck = await col("students")
    .find({ primary_mentor_id: { $in: [...testEmail.keys()] }, is_test: { $ne: true } })
    .sort({ created_date: 1 })
    .toArray();
  const turns = new Map<string, number>();
  if (!stuck.length) line("none");
  for (const s of stuck as any[]) {
    const from = testEmail.get(String(s.primary_mentor_id)) ?? "";
    const t = TEAMS.find((t) => String(found.get(t.head)._id) === String(s.team_id)) ?? TEAMS.find((t) => from.startsWith(`test.${t.testKey}.`));
    if (!t) { line(`${s.student_code} ${s.full_name}: on ${from}, team unknown — left as it is`); continue; }
    const cses = rows.filter((r) => r.team === t.name && r.role === "cs");
    const i = turns.get(t.name) ?? 0;
    turns.set(t.name, i + 1);
    const to = cses[i % cses.length];
    const cse = found.get(to.email);
    line(`${s.student_code} ${s.full_name}: ${from.replace("@deltatest.dev", "")} → ${cse ? short(cse) : `${to.name} (new)`}, ${t.name}`);
    if (!apply) continue;
    const data: Record<string, any> = { primary_mentor_id: String(cse._id), primary_mentor_name: String(cse.full_name ?? ""), updated_date: now };
    const entries = await prepareStudentUpdate(s, data, ACTOR);
    for (const e of entries) e.via = "team-restructure";
    log.changes.push({ coll: "students", id: String(s._id), before: Object.fromEntries(Object.keys(data).map((k) => [k, k in s ? s[k] : MISSING])), after: data });
    await col("students").updateOne({ _id: s._id }, { $set: data });
    if (entries.length) {
      const res = await col("student_history").insertMany(entries as any[]);
      log.history_ids.push(...Object.values(res.insertedIds).map(String));
    }
  }

  section("8. The team stored on the students of everyone placed here (where they have none)");
  const index = apply ? await loadTeams() : null;
  let given = 0;
  for (const r of rows) {
    const u = found.get(r.email);
    if (!u) continue;
    const teamless = await col("students")
      .find({ primary_mentor_id: String(u._id), $or: [{ team_id: { $exists: false } }, { team_id: null }, { team_id: "" }] }, { projection: { team_id: 1, team_name: 1 } })
      .toArray();
    if (!teamless.length) continue;
    const team = index ? index.teamOf(String(u._id)) : null;
    line(`${short(u)}: ${teamless.length} → ${index ? team?.name ?? "no team — left as they are" : r.team}`);
    given += teamless.length;
    if (team) await updateStudents(teamless, { team_id: team.id, team_name: team.name });
  }
  if (!given) line("none");
}

/* ── undo ────────────────────────────────────────────────────────────────── */

async function undo(file: string) {
  const saved = JSON.parse(await Bun.file(file).text()) as typeof log;
  if (saved.database !== config.mongoDb || saved.host !== host) throw new Error(`That undo file is for "${saved.database}" on ${saved.host}, not this database.`);
  section(`Undo of the run at ${saved.applied_at}`);

  // Fields back, newest first — unless something else has changed them since.
  let restored = 0;
  const skipped: string[] = [];
  for (const c of [...saved.changes].reverse()) {
    const doc: any = await col(c.coll).findOne({ _id: toObjectId(c.id) as any });
    if (!doc) { skipped.push(`${c.coll} ${c.id} (gone)`); continue; }
    const keys = Object.keys(c.before).filter((k) => k === "updated_date" || same(doc[k], c.after[k]));
    const moved = Object.keys(c.before).filter((k) => !keys.includes(k));
    if (moved.length) skipped.push(`${c.coll} ${doc.email ?? doc.student_code ?? c.id}: ${moved.join(", ")} changed since`);
    if (!keys.some((k) => k !== "updated_date")) continue;
    const $set: Record<string, unknown> = {};
    const $unset: Record<string, ""> = {};
    for (const k of keys) {
      const v = c.before[k] as any;
      if (v && typeof v === "object" && v.$missing) $unset[k] = "";
      else $set[k] = v;
    }
    restored++;
    if (apply) await col(c.coll).updateOne({ _id: doc._id }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) });
  }
  line(`${restored} document(s) put back${skipped.length ? `; left as they are now:` : ""}`);
  for (const s of skipped) line(`  - ${s}`);

  if (saved.history_ids.length) {
    line(`${saved.history_ids.length} history line(s) removed`);
    if (apply) await col("student_history").deleteMany({ _id: { $in: saved.history_ids.map((id) => toObjectId(id)) as any[] } });
  }

  // Accounts it created: removed, unless somebody depends on them by now — then switched off.
  for (const id of saved.created_users) {
    const u: any = await col("users").findOne({ _id: toObjectId(id) as any });
    if (!u) continue;
    if (!apply) { line(`${u.email}: removed — or switched off if students or people are still on it once the rest is back`); continue; }
    const [students, reports] = await Promise.all([
      col("students").countDocuments({ primary_mentor_id: id }),
      col("users").countDocuments({ up_head_id: id }),
    ]);
    if (!students && !reports) {
      line(`${u.email}: removed`);
      if (apply) await col("users").deleteOne({ _id: u._id });
    } else {
      line(`${u.email}: switched off, not removed — ${students} student(s), ${reports} reporting to them`);
      if (apply) await col("users").updateOne({ _id: u._id }, { $set: { status: "inactive", updated_date: now } });
    }
  }
}

/* ── run ─────────────────────────────────────────────────────────────────── */

await connectDb();
console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}`);
const undoFile = option("undo");
try {
  if (undoFile) await undo(undoFile);
  else await restructure();
} finally {
  if (apply && !undoFile && (log.changes.length || log.created_users.length)) {
    const path = join(homedir(), `team-pattern-undo-${now.replace(/[:.]/g, "-")}.json`);
    await Bun.write(path, JSON.stringify(log, null, 1));
    console.log(`\nUndo file: ${path}\n  bun src/scripts/team-pattern-restructure.ts --undo=${path}          (shows what it would put back)`);
  }
  await closeDb();
}
if (!apply) console.log("\nNothing was written. Run again with --apply to make these changes.");
