/**
 * The CS enrolment tracker → the portal. One tab per CS; each row a student who enrolled: course, amount pitched,
 * bonus, pending, status, remarks. For every student on it:
 *   - they go to the CS of their tab, as the CS-sheet import moves them (history line, team from the CS), and are
 *     marked as on that CS's own list (cs_sheet);
 *   - on two CSs' tabs — or already given to another CS by that CS's own sheet — they stay with the first and become
 *     Common with the other: both see and work on them, and they appear in both teams;
 *   - Enrolment: Closed, with a "Closed - <course>" tag for every course they are on the tracker with (a tag not on
 *     the Student Tags list yet is made);
 *   - each row's payment goes on them as a Course fees entry beside Delta finance's, marked as from the tracker.
 * Students not in the portal are made (no CS on their tab: Delta Open Students). Students are found as the CS-sheet
 * import finds them — the same email, or the same phone (any number in the cell, last 9 digits) — every matching
 * record. A row with no email and no phone is skipped.
 *
 *   cd backend
 *   bun src/scripts/import-enrolment-tracker.ts --file=<the tracker's JSON>            shows what it would do
 *   bun src/scripts/import-enrolment-tracker.ts --file=<…> --apply                     does it; saves an undo file
 *   bun src/scripts/import-enrolment-tracker.ts --undo=<file> [--apply]                takes back what --apply did
 *
 * The JSON: { rows: [{ tab, row, cs_email, name, phone, email, course, fee, currency, bonus_usd, pending, status,
 * remarks }] } — made from the tracker, tabs in their order (a student on two tabs goes to the first). Amounts as
 * written, not minor units. Running it again changes nothing.
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";
import { isMentorRole } from "../lib/roles";
import { nextStudentCode } from "../lib/studentCode";
import { loadTeams } from "../students/teams";
import { commonIds } from "../students/followups";
import { stampNewStudents, recordCreated, prepareStudentUpdate, describePerson, type HistoryEntry } from "../students/history";
import { CLOSED_PREFIX } from "../students/tags";
import type { AuthUser } from "../auth/middleware";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const MISSING = { $missing: true };
const LINKED = ["student_followups", "student_calls", "funding_transactions", "student_requests", "tickets",
  "commission_credits", "commission_ledgers", "mentor_referrals", "manual_commission_adjustments"];
const ACTOR: AuthUser = { id: "", email: "", full_name: "CS enrolment tracker", app_role: "super_admin" };
const VIA = "cs-tracker";

interface Row {
  tab: string; row: number; cs_email: string; name: string; phone: string; email: string; course: string;
  fee: number | null; currency: string; bonus_usd: number | null; pending: number | null; status: string; remarks: string;
}

const emailsOf = (v: unknown) => [...new Set((String(v ?? "").match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) ?? []).map((e) => e.toLowerCase().replace(/[.,]+$/, "")))];
/** Every number in a phone cell, by its last 9 digits. */
const phoneKeys = (v: unknown) => [...new Set(String(v ?? "").replace(/\.0$/, "").split(/[\n\r/,;|]+| - /)
  .map((x) => x.replace(/\(.*?\)/g, "").replace(/\D/g, "").replace(/^00/, "")).filter((x) => x.length >= 7).map((x) => x.slice(-9)))];
const minor = (v: number | null) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100));
const tagOf = (course: string) => `${CLOSED_PREFIX}${course}`;
const coursesOf = (rows: Row[]) => [...new Set(rows.map((r) => r.course).filter(Boolean))];

/** One tracker row as a Course fees entry — the same shape finance's are, plus where it came from. */
function feeEntry(r: Row, csName: string) {
  const fee = minor(r.fee), pending = minor(r.pending);
  return {
    invoice_id: `tracker:${r.tab}:${r.row}`,
    invoice_number: "",
    course: r.course,
    currency: r.currency || "AED",
    fee_minor: fee,
    // Paid only where the tracker gives both the amount and what is still to collect.
    paid_minor: fee !== null && pending !== null ? Math.max(0, fee - pending) : null,
    balance_minor: pending,
    bonus_given: r.bonus_usd === null ? null : r.bonus_usd > 0,
    bonus_minor: minor(r.bonus_usd) ?? 0,
    bonus_currency: "USD",
    receipt_url: "",
    receipt_name: "",
    source: "cs_tracker",
    tracker_tab: r.tab,
    tracker_cs: csName,
    payment_status: r.status,
    remarks: r.remarks,
    recorded_at: now,
  };
}

const log = {
  database: config.mongoDb, host, batch: `cs-tracker-${now.slice(0, 10)}`, applied_at: now,
  created: [] as string[], history_ids: [] as string[], tag_ids: [] as string[],
  changes: [] as { id: string; before: Record<string, unknown>; after: Record<string, unknown> }[],
  added: [] as { id: string; invoice_ids: string[]; updated_before: unknown; fees_existed: boolean }[],
};

async function insertHistory(entries: HistoryEntry[]) {
  if (!entries.length) return;
  for (const e of entries) e.via = VIA;
  const res = await col("student_history").insertMany(entries as any[]);
  log.history_ids.push(...Object.values(res.insertedIds).map(String));
}

/** One recorded change: what it was, what it is now — what --undo puts back. */
async function change(s: any, data: Record<string, unknown>) {
  log.changes.push({ id: String(s._id), before: Object.fromEntries(Object.keys(data).map((k) => [k, k in s ? s[k] : MISSING])), after: data });
  await col("students").updateOne({ _id: s._id }, { $set: data });
  Object.assign(s, data);
}

async function importRows(file: string) {
  const rows = (JSON.parse(await Bun.file(file).text()).rows ?? []) as Row[];
  if (!rows.length) throw new Error(`No rows in ${file}`);

  const users = (await col("users").find({}).toArray()) as any[];
  const userByEmail = new Map(users.map((u) => [String(u.email ?? "").toLowerCase(), u]));
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const csOf = (r: Row): any => (r.cs_email ? userByEmail.get(r.cs_email.toLowerCase()) ?? null : null);
  for (const e of new Set(rows.map((r) => r.cs_email).filter(Boolean))) {
    const u = userByEmail.get(e.toLowerCase());
    if (!u) throw new Error(`No account for ${e} — nothing done`);
    if (u.status === "inactive" || !isMentorRole(String(u.app_role ?? ""))) throw new Error(`${e} is switched off or not a CS / mentor — nothing done`);
  }
  const nameOf = (id: string) => String(userById.get(id)?.full_name || userById.get(id)?.email || "");
  const csIdsOf = (rs: Row[]) => [...new Set(rs.map(csOf).filter(Boolean).map((u: any) => String(u._id)))];
  const csName = (r: Row) => (csOf(r) ? nameOf(String(csOf(r)._id)) : r.tab.charAt(0) + r.tab.slice(1).toLowerCase());

  const byEmail = new Map<string, any[]>(), byPhone = new Map<string, any[]>();
  for await (const s of col("students").find({}) as any) {
    for (const e of emailsOf(s.email)) byEmail.set(e, [...(byEmail.get(e) ?? []), s]);
    for (const k of phoneKeys(s.phone)) byPhone.set(k, [...(byPhone.get(k) ?? []), s]);
  }

  // 1. Who each row is: portal records (every one that matches), or a student to make (once, however many rows).
  const targets = new Map<string, { s: any; rows: Row[] }>();
  const creates: { rows: Row[] }[] = [];
  const newBy = new Map<string, { rows: Row[] }>();
  const skipped: Row[] = [], notes: string[] = [];
  for (const r of rows) {
    const emails = emailsOf(r.email), keys = phoneKeys(r.phone);
    if (!emails.length && !keys.length) { skipped.push(r); continue; }
    const found = new Map<string, any>();
    for (const e of emails) for (const s of byEmail.get(e) ?? []) found.set(String(s._id), s);
    for (const k of keys) for (const s of byPhone.get(k) ?? []) found.set(String(s._id), s);
    if (!found.size) {
      const twin = [...emails, ...keys].map((k) => newBy.get(k)).find(Boolean);
      if (twin) { twin.rows.push(r); continue; }
      const c = { rows: [r] };
      for (const k of [...emails, ...keys]) newBy.set(k, c);
      creates.push(c);
      continue;
    }
    if (found.size > 1) notes.push(`${r.tab} row ${r.row} ${r.name} — ${found.size} portal records, each gets all of it: ${[...found.values()].map((s) => s.student_code).join(", ")}`);
    for (const s of found.values()) {
      const t = targets.get(String(s._id)) ?? { s, rows: [] };
      t.rows.push(r);
      targets.set(String(s._id), t);
    }
  }

  // 2. What happens to each record.
  const plans = [...targets.values()].map(({ s, rows: rs }) => {
    const csIds = csIdsOf(rs);
    const current = String(s.primary_mentor_id ?? "");
    const sheetCs = s.cs_sheet?.cs ? userByEmail.get(String(s.cs_sheet.cs).toLowerCase()) : null;
    // Given to the CS they are with by that CS's own sheet: they stay, and the tracker's CS is added as Common.
    const keptBySheet = !!sheetCs && String(sheetCs._id) === current && !csIds.includes(current);
    const move = csIds.length > 0 && !csIds.includes(current) && !keptBySheet;
    const main = move ? csIds[0]! : current;
    const have = new Set(commonIds(s));
    const common = csIds.filter((id) => id !== main && !have.has(id));
    const mark = csIds.includes(main) && (move || !s.cs_sheet);   // on their CS's own list: a later sheet makes it Common
    const own: string[] = Array.isArray(s.tags) ? s.tags : [];
    const tags = coursesOf(rs).map(tagOf).filter((t) => !own.includes(t));
    const close = s.enrolment_status !== "closed";
    const haveFees = new Set((Array.isArray(s.course_fees) ? s.course_fees : []).map((f: any) => f?.invoice_id));
    const entries = rs.map((r) => feeEntry(r, csName(r))).filter((e) => !haveFees.has(e.invoice_id));
    const who = `${s.student_code} ${String(s.full_name ?? "").trim()}`;
    if (keptBySheet && common.length) notes.push(`${who} — on ${s.cs_sheet.cs}'s own sheet: stays with ${s.primary_mentor_name}, Common with ${common.map(nameOf).join(", ")}`);
    else if (common.length) notes.push(`${who} — on ${[...new Set(rs.map((r) => r.tab))].join(" and ")}: with ${nameOf(main)}, Common with ${common.map(nameOf).join(", ")}`);
    return { s, rows: rs, main, move, common, mark, tags, close, entries };
  });

  const needTags = [...new Set([...plans.flatMap((p) => p.tags), ...creates.flatMap((c) => coursesOf(c.rows).map(tagOf))])];
  const haveTags = new Set((await col("student_tags").find({ name: { $in: needTags } }, { projection: { name: 1 } }).toArray()).map((t: any) => String(t.name)));
  const newTagNames = needTags.filter((t) => !haveTags.has(t));

  type Plan = (typeof plans)[number];
  const count = (f: (p: Plan) => boolean) => plans.filter(f).length;
  const from: Record<string, number> = {};
  for (const p of plans.filter((x) => x.move)) { const k = `${p.s.primary_mentor_name || "(no CS)"} → ${nameOf(p.main)}`; from[k] = (from[k] ?? 0) + 1; }
  const tagCount: Record<string, number> = {};
  for (const t of [...plans.flatMap((p) => p.tags), ...creates.flatMap((c) => coursesOf(c.rows).map(tagOf))]) tagCount[t] = (tagCount[t] ?? 0) + 1;
  const newCommon = creates.filter((c) => csIdsOf(c.rows).length > 1).length;
  console.log(`\nTracker: ${rows.length} rows → ${plans.length} portal record(s), ${creates.length} new student(s)`);
  console.log(`  move to their tab's CS: ${count((p) => p.move)}`);
  for (const [k, c] of Object.entries(from).sort((a, b) => b[1] - a[1])) console.log(`    ${k}: ${c}`);
  console.log(`  already with their tab's CS: ${count((p) => !p.move && csIdsOf(p.rows).includes(p.main))}`);
  console.log(`  made Common (they appear in both teams): ${count((p) => p.common.length > 0) + newCommon}`);
  console.log(`  Enrolment set to Closed: ${count((p) => p.close) + creates.length} (from Old ${count((p) => p.close && p.s.enrolment_status === "old")}, from Open ${count((p) => p.close && p.s.enrolment_status !== "old")}, new ${creates.length})`);
  console.log(`  course tags put on: ${Object.entries(tagCount).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t} ${c}`).join(" · ") || "none"}`);
  if (newTagNames.length) console.log(`  new on the Student Tags list: ${newTagNames.join(", ")}`);
  console.log(`  payment rows added: ${plans.reduce((s, p) => s + p.entries.length, 0) + creates.reduce((s, c) => s + c.rows.length, 0)}`);
  console.log(`  new students: ${creates.length}`);
  for (const c of creates) {
    const r = c.rows[0]!, cs = csOf(r), others = csIdsOf(c.rows).filter((id) => id !== (cs ? String(cs._id) : ""));
    console.log(`    ${r.tab} row ${r.row} ${r.name} <${r.email || "-"}> ${r.phone || ""} · ${coursesOf(c.rows).join(", ") || "no course"} · ${cs ? `CS ${nameOf(String(cs._id))}` : "no CS → Delta Open Students"}${others.length ? ` · Common with ${others.map(nameOf).join(", ")}` : ""}`);
  }
  console.log(`  no email and no phone (skipped): ${skipped.length}${skipped.length ? " — " + skipped.map((r) => `${r.tab} row ${r.row} ${r.name}`).join(", ") : ""}`);
  console.log(`\nTo know about (${notes.length}):`);
  for (const x of notes) console.log(`  ${x}`);
  if (!apply) return;

  const undoPath = join(homedir(), `enrolment-tracker-undo-${now.replace(/[:.]/g, "-")}.json`);
  try {
    const index = await loadTeams();
    const marker = (id: string) => ({ cs: String(userById.get(id)?.email ?? ""), batch: log.batch, at: now });
    const rowFor = (rs: Row[], id: string) => rs.find((r) => csOf(r) && String(csOf(r)._id) === id) ?? rs[0]!;
    const commonEntry = (id: string, r: Row) => ({ id, name: nameOf(id), email: String(userById.get(id)?.email ?? ""), team_name: index.teamOf(id)?.name ?? "", at: now, via: VIA, tab: r.tab, sheet_row: r.row });
    const commonLine = (sid: string, id: string): HistoryEntry => ({
      student_id: sid, at: now, type: "made_common", text: `Common — also with ${describePerson(index, id, nameOf(id))}: on their tracker tab too`,
      by_id: null, by_name: ACTOR.full_name!, to: { id, name: nameOf(id), team: index.teamOf(id)?.name ?? null },
    });
    const tagLine = (sid: string, t: string): HistoryEntry => ({ student_id: sid, at: now, type: "tag_changed", text: `Tag added: ${t}`, by_id: null, by_name: ACTOR.full_name!, to: t });
    const closedLine = (sid: string, from: string, rs: Row[]): HistoryEntry => ({
      student_id: sid, at: now, type: "enrolment_changed", text: `Enrolment closed — enrolled (CS enrolment tracker${coursesOf(rs).length ? `, ${coursesOf(rs).join(", ")}` : ""})`,
      by_id: null, by_name: ACTOR.full_name!, from, to: "closed",
    });

    // 0. Any "Closed - <course>" not on the Student Tags list yet
    for (const name of newTagNames) {
      const res = await col("student_tags").insertOne({ name, color: "#059669", kind: "closed", course: name.slice(CLOSED_PREFIX.length), active: true,
        created_date: now, updated_date: now, created_by: "", created_by_name: ACTOR.full_name } as any);
      log.tag_ids.push(String(res.insertedId));
    }
    // 1. The students already here
    for (const p of plans) {
      const s = p.s, sid = String(s._id);
      if (p.move) {
        // Loaded before the portal kept who received a student first: that was the CS they are with now.
        if (!s.first_assignee_id && s.primary_mentor_id) {
          await change(s, { first_assignee_id: String(s.primary_mentor_id), first_assignee_name: String(s.primary_mentor_name ?? ""),
            first_assignee_role: String(userById.get(String(s.primary_mentor_id))?.app_role ?? ""), first_assigned_at: String(s.assigned_at || s.created_date || now) });
        }
        // Given a CS, as the app gives one — out of Delta Open Students if they were waiting there.
        const data: Record<string, any> = { primary_mentor_id: p.main, primary_mentor_name: nameOf(p.main), cs_sheet: marker(p.main),
          ...(s.assignment_status !== "assigned" ? { assignment_status: "assigned" } : {}), updated_date: now };
        const entries = await prepareStudentUpdate(s, data, ACTOR);
        await change(s, data);
        await insertHistory(entries);
      } else if (p.mark) {
        await change(s, { cs_sheet: marker(p.main), updated_date: now });
      }
      if (p.common.length) {
        await change(s, { common_cs: [...(Array.isArray(s.common_cs) ? s.common_cs : []), ...p.common.map((id) => commonEntry(id, rowFor(p.rows, id)))], updated_date: now });
        await insertHistory(p.common.map((id) => commonLine(sid, id)));
      }
      if (p.close) {
        const from = s.enrolment_status === "old" ? "old" : "open";
        await change(s, { enrolment_status: "closed", enrolment_updated_at: now, enrolment_updated_by_id: "", enrolment_updated_by_name: ACTOR.full_name!, updated_date: now });
        await insertHistory([closedLine(sid, from, p.rows)]);
      }
      if (p.tags.length) {
        await change(s, { tags: [...(Array.isArray(s.tags) ? s.tags : []), ...p.tags], updated_date: now });
        await insertHistory(p.tags.map((t) => tagLine(sid, t)));
      }
      if (p.entries.length) {
        log.added.push({ id: sid, invoice_ids: p.entries.map((e) => e.invoice_id), updated_before: s.updated_date ?? null, fees_existed: "course_fees" in s });
        await col("students").updateOne({ _id: s._id }, { $push: { course_fees: { $each: p.entries } }, $set: { updated_date: now } } as any);
        s.updated_date = now;
      }
    }
    // 2. The students not here yet
    const docs: any[] = creates.map(({ rows: rs }) => {
      const r = rs[0]!, cs = csOf(r), emails = emailsOf(r.email);
      return {
        full_name: r.name || emails[0]?.split("@")[0] || r.phone, email: emails[0] ?? "", phone: r.phone, country: "",
        // Text in the email column that is no email is kept where somebody can read it, not stored as one.
        notes: `From the CS enrolment tracker (${[...new Set(rs.map((x) => x.tab))].join(", ")})${r.remarks ? ` — ${r.remarks}` : ""}${!emails.length && r.email ? `. Email on the tracker: "${r.email}"` : ""}`,
        primary_mentor_id: cs ? String(cs._id) : "", primary_mentor_name: cs ? nameOf(String(cs._id)) : "",
        senior_mentor_id: "", senior_mentor_name: "",
        assignment_status: cs ? "assigned" : "open_pool", status: "ACTIVE", student_level: "LEVEL_1",
        source: "cs_tracker", import_batch: log.batch, ...(cs ? { cs_sheet: marker(String(cs._id)) } : {}),
        enrolment_status: "closed", enrolment_updated_at: now, enrolment_updated_by_id: "", enrolment_updated_by_name: ACTOR.full_name,
        course_fees: rs.map((x) => feeEntry(x, csName(x))),
        created_date: now, updated_date: now, created_by_id: "", created_by_name: ACTOR.full_name,
      };
    });
    if (docs.length) {
      await stampNewStudents(docs, index);
      // After stamping, which clears the fields only the server sets: the course tags, and Common with the other tabs' CSs.
      docs.forEach((d, i) => {
        const rs = creates[i]!.rows;
        d.tags = coursesOf(rs).map(tagOf);
        const others = csIdsOf(rs).filter((id) => id !== d.primary_mentor_id);
        if (others.length) d.common_cs = others.map((id) => commonEntry(id, rowFor(rs, id)));
      });
      for (const d of docs) d.student_code = await nextStudentCode();
      const res = await col("students").insertMany(docs);
      docs.forEach((d, i) => { d._id = res.insertedIds[i]; log.created.push(String(d._id)); });
      await recordCreated(docs, ACTOR, "imported", index);
      await insertHistory(docs.flatMap((d, i) => [
        closedLine(String(d._id), "open", creates[i]!.rows),
        ...d.tags.map((t: string) => tagLine(String(d._id), t)),
        ...(d.common_cs ?? []).map((c: any) => commonLine(String(d._id), c.id)),
      ]));
    }
    console.log(`\nDone: ${count((p) => p.move)} moved, ${count((p) => p.common.length > 0) + newCommon} made Common, ${count((p) => p.close) + docs.length} set to Closed, ` +
      `${plans.reduce((s, p) => s + p.tags.length, 0) + docs.reduce((s, d) => s + d.tags.length, 0)} course tag(s) put on, ` +
      `${plans.reduce((s, p) => s + p.entries.length, 0) + docs.reduce((s, d) => s + d.course_fees.length, 0)} payment row(s) added, ` +
      `${docs.length} new student(s)${docs.length ? ` (${docs[0].student_code} → ${docs[docs.length - 1].student_code})` : ""}.`);
  } finally {
    if (log.changes.length || log.added.length || log.created.length || log.tag_ids.length) {
      await Bun.write(undoPath, JSON.stringify(log, null, 1));
      console.log(`Undo file: ${undoPath}\n  bun src/scripts/import-enrolment-tracker.ts --undo=${undoPath}          (shows what it would take back)`);
    }
  }
}

async function undo(file: string) {
  const saved = JSON.parse(await Bun.file(file).text()) as typeof log;
  if (saved.database !== config.mongoDb || saved.host !== host) throw new Error(`That undo file is for "${saved.database}" on ${saved.host}, not this database.`);
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const kept: string[] = [];

  // 1. The payments (added last, so taken back first)
  let taken = 0;
  for (const a of saved.added) {
    const doc: any = await col("students").findOne({ _id: toObjectId(a.id) as any }, { projection: { course_fees: 1, updated_date: 1 } });
    const ours = (Array.isArray(doc?.course_fees) ? doc.course_fees : []).filter((f: any) => a.invoice_ids.includes(f?.invoice_id));
    if (!ours.length) continue;
    taken += ours.length;
    // A student who had no Course fees before has none again; updated_date goes back only when untouched since.
    const left = doc.course_fees.length - ours.length;
    const $unset: Record<string, ""> = {}, $set: Record<string, unknown> = {};
    if (!left && a.fees_existed === false) $unset.course_fees = "";
    if (doc.updated_date === saved.applied_at) { if (a.updated_before === null) $unset.updated_date = ""; else $set.updated_date = a.updated_before; }
    const update: Record<string, unknown> = "course_fees" in $unset ? {} : { $pull: { course_fees: { invoice_id: { $in: a.invoice_ids } } } };
    if (Object.keys($unset).length) update.$unset = $unset;
    if (Object.keys($set).length) update.$set = $set;
    if (apply) await col("students").updateOne({ _id: doc._id }, update as any);
  }
  // 2. The other changes, newest first — each put back whole or not at all (left as now if anything in it changed since).
  let restored = 0;
  for (const c of [...saved.changes].reverse()) {
    const doc: any = await col("students").findOne({ _id: toObjectId(c.id) as any });
    if (!doc) continue;
    const fields = Object.keys(c.before).filter((k) => k !== "updated_date");
    const moved = fields.filter((k) => !same(doc[k], c.after[k]));
    if (moved.length) { kept.push(`${doc.student_code}: ${moved.join(", ")} changed since — this change left as now`); continue; }
    if (!fields.length) continue;
    const keys = "updated_date" in c.before && same(doc.updated_date, c.after.updated_date) ? [...fields, "updated_date"] : fields;
    const $set: Record<string, unknown> = {}, $unset: Record<string, ""> = {};
    for (const k of keys) { const v = c.before[k] as any; if (v && typeof v === "object" && v.$missing) $unset[k] = ""; else $set[k] = v; }
    restored++;
    if (apply) await col("students").updateOne({ _id: doc._id }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) });
  }
  // 3. The students it made, if nobody has worked on them since
  const remove: any[] = [];
  for (const id of saved.created) {
    const doc: any = await col("students").findOne({ _id: toObjectId(id) as any });
    if (!doc) continue;
    const links = (await Promise.all(LINKED.map(async (c) => ((await col(c).countDocuments({ student_id: id })) ? c : "")))).filter(Boolean);
    if (links.length || doc.updated_date !== saved.applied_at) kept.push(`${doc.student_code} ${doc.full_name}: worked on since — not removed`);
    else remove.push(doc);
  }
  console.log(`\nUndo of the tracker import on ${saved.applied_at}: ${taken} payment row(s) taken off, ${restored} change(s) put back, ${remove.length} made student(s) removed`);
  for (const k of kept) console.log(`  ${k}`);
  if (!apply) return;
  await col("student_history").deleteMany({ _id: { $in: saved.history_ids.map((id) => toObjectId(id)) as any[] } });
  if (remove.length) {
    await col("student_history").deleteMany({ student_id: { $in: remove.map((d) => String(d._id)) } });
    await col("students").deleteMany({ _id: { $in: remove.map((d) => d._id) } });
  }
  // 4. The tags it put on the list, unless a student has one since
  for (const id of saved.tag_ids ?? []) {
    const t: any = await col("student_tags").findOne({ _id: toObjectId(id) as any });
    if (t && !(await col("students").countDocuments({ tags: t.name }))) await col("student_tags").deleteOne({ _id: t._id });
  }
}

await connectDb();
console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}`);
try {
  const undoFile = option("undo"), file = option("file");
  if (undoFile) await undo(undoFile);
  else if (file) await importRows(file);
  else console.log("Give --file=<the tracker's JSON> (or --undo=<undo file>).");
} finally {
  await closeDb();
}
if (!apply) console.log("\nNothing was written. Run again with --apply to do it.");
