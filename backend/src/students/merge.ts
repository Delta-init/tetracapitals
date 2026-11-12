import { ObjectId } from "mongodb";
import { col, db } from "../db";
import type { AuthUser } from "../auth/middleware";
import { prepareStudentUpdate, recordHistory, type HistoryEntry } from "./history";
import { phoneKey } from "./calls";
import { visibleMentorIds } from "./followups";

/* ────────────────────────────────────────────────────────────────────────────
   Merging two student records into one (the user, 2026-11-12: "this merging
   also need in the commission portal … which CS will get, we can decide").

   A Super Admin, or a CS Manager for students in their reach, keeps one
   record (KEPT) and closes the other (CLOSED):
     · everything filed under the closed one moves to the kept one — every
       place a student is referred to (REFS, found by scanning the data,
       2026-11-12: 34 collections, by id and by STU code, nested lists too).
       After a merge the whole database is scanned once for the closed
       record's id and code; anything left over is recorded on the merge
       (`leftovers`), so a place added later cannot be missed silently;
     · the kept record takes what it lacks from the closed one, and both
       records' lists (tags, course fees, Common CSs, …) are put together;
     · the CS is chosen: the kept record's or the closed one's — the change
       is the app's own change of CS (prepareStudentUpdate: history, team);
       the other CS can stay on as a Common CS. Commission already credited
       stays with whoever earned it (commission_credits keep their recipient);
     · the closed record is taken out of `students` — kept whole on the merge
       — and its code, email, LMS account and finance invoice stay findable
       on the kept one (other_codes / other_emails / other_lms_user_ids /
       other_finance_invoice_ids), so finance and the LMS still land on it.
   Every change is written down on the merge as it happens (there are no
   transactions here), so a merge — even one that stopped half-way — can be
   undone: each field goes back only if it still holds what the merge put
   there; anything changed since is reported, not overwritten.
──────────────────────────────────────────────────────────────────────────── */

export const MERGES = "student_merges";
export const DISMISSALS = "student_duplicate_dismissals";

/** Who may merge: a Super Admin anywhere; a CS Manager within their reach (both students theirs or unassigned). */
export const MERGE_ROLES = new Set(["super_admin", "cs_manager"]);

/* ── Where a student is referred to ──────────────────────────────────────
   `ids`/`codes`: paths holding the student's id / STU code ("a[].b" — inside
   a list). Found by scanning the live data and the code (2026-11-12). */
interface Ref { col: string; ids?: string[]; codes?: string[]; label: string }
export const REFS: Ref[] = [
  { col: "funding_transactions", ids: ["student_id"], codes: ["student_code"], label: "Deposits, withdrawals and bonuses" },
  { col: "commission_credits", ids: ["student_id"], label: "Commission credits (stay with whoever earned them)" },
  { col: "credit_requests", ids: ["student_id"], codes: ["student_code"], label: "Credit requests" },
  { col: "finance_withdrawals", codes: ["student_code"], label: "Finance withdrawals" },
  { col: "mentor_referrals", ids: ["student_id"], codes: ["student_code"], label: "Referrals" },
  { col: "mt5_accounts", ids: ["student_id"], codes: ["student_code"], label: "MT5 accounts" },
  { col: "course_upgrades", ids: ["student_id"], label: "Course upgrades" },
  { col: "course_payments", ids: ["student_id"], label: "Course payments" },
  { col: "enrolment_payments", ids: ["student_id"], label: "Balance payments" },
  { col: "payment_link_requests", ids: ["student_id"], codes: ["student_code"], label: "Payment links" },
  { col: "tabby_links", ids: ["student_id"], codes: ["student_code"], label: "Tabby links" },
  { col: "zoho_invoices", ids: ["student_id"], label: "Zoho invoices" },
  { col: "student_followups", ids: ["student_id"], label: "Follow-ups" },
  { col: "student_followup_events", ids: ["student_id"], label: "Follow-up activity" },
  { col: "followup_reminders", ids: ["items[].student_id"], codes: ["items[].student_code"], label: "Follow-up reminder emails" },
  { col: "reminders", ids: ["student_id"], codes: ["student_code"], label: "Reminders" },
  { col: "student_calls", ids: ["student_id"], codes: ["student_code"], label: "Calls" },
  { col: "student_logs", ids: ["student_id"], codes: ["student_code"], label: "Student logs" },
  { col: "student_log_history", ids: ["student_id"], codes: ["student_code"], label: "Student log history" },
  { col: "student_history", ids: ["student_id"], label: "History" },
  { col: "student_requests", ids: ["student_id", "created_student_id", "existing_student_id"], label: "Student requests" },
  { col: "student_courses", ids: ["student_id"], label: "Courses" },
  { col: "tickets", ids: ["student_id"], label: "Tickets" },
  { col: "lms_ticket_whatsapp", ids: ["student_id"], label: "LMS ticket WhatsApps" },
  { col: "lms_activity", ids: ["student_id", "student.id"], codes: ["student.code"], label: "LMS activity" },
  { col: "class_completions", ids: ["student_id"], codes: ["student_code"], label: "Class completions" },
  { col: "program_guests", ids: ["student_id"], label: "Programme guests" },
  { col: "program_notices", ids: ["student_id"], label: "Programme notices" },
  { col: "meeting_requests", ids: ["student_id"], codes: ["student_code"], label: "Meeting requests" },
  { col: "meeting_outcomes", ids: ["student_ids[]", "reminders[].student_id"], label: "Meeting outcomes" },
  { col: "meeting_status_checks", ids: ["student.id"], codes: ["student.code"], label: "Meeting status checks" },
  { col: "onboarding_alerts", ids: ["items[].student_id", "student_ids[]", "emailed_ids[]"], codes: ["items[].code"], label: "Onboarding alerts" },
  { col: "balance_reminders", ids: ["items[].student_id"], codes: ["items[].student_code"], label: "Balance reminders" },
  { col: "balance_reminder_claims", ids: ["student_id"], label: "Balance reminder claims" },
  { col: "email_log", ids: ["student_id"], label: "Emails sent" },
  { col: "whatsapp_messages", ids: ["student_ids[]"], label: "WhatsApp messages" },
  { col: "whatsapp_links", ids: ["student_id"], label: "WhatsApp links" },
  { col: "retention_assignments", ids: ["student_id"], label: "Retention" },
  { col: "mentor_deductions", ids: ["student_id"], label: "Mentor deductions" },
  { col: "logs", ids: ["entity_id"], label: "Activity log" },
];

/** Never scanned for leftovers: the merge's own records, and the students themselves. */
// Kept-whole copies: a deleted funding request (finance/fundingDelete.ts) names the student as it was.
const NOT_SCANNED = new Set(["students", MERGES, DISMISSALS, "deleted_funding_requests"]);

/* ── The student record ──────────────────────────────────────────────── */

/** Lists put together, each by what makes an entry the same one. */
const LISTS: Record<string, (x: any) => string> = {
  tags: (x) => String(x),
  categories: (x) => String(x),
  sheet_rows: (x) => JSON.stringify(x),
  closed_by: (x) => String(x?.email ?? JSON.stringify(x)).toLowerCase(),
  course_fees: (x) => String(x?.invoice_id ?? JSON.stringify(x)),
  program_completions: (x) => JSON.stringify(x),
  lms_courses: (x) => String(x?.slug ?? x?.id ?? JSON.stringify(x)),
  common_cs: (x) => String(x?.id ?? ""),
};
/** Never copied from the closed record: who it is, who has it, and what the portal works out itself. */
const OWN = new Set([
  "_id", "student_code", "email", "full_name", "created_date", "created_by", "created_by_id", "created_by_name", "updated_date",
  "primary_mentor_id", "primary_mentor_name", "team_id", "team_name", "assigned_at", "assignment_status",
  "first_assigned_at", "first_assignee_id", "first_assignee_name", "first_assignee_role", "senior_mentor_id", "senior_mentor_name",
  "lms_cs_sent", "new_for_id", "new_since", "lms_user_id", "finance_invoice_id", "finance_invoice_number",
  "net_deposit_usd", "notes", "onboarded", "onboarded_at", "onboarded_by_id", "onboarded_by_name", "onboarded_via",
  "enrolment_status", "enrolment_updated_at", "enrolment_updated_by_id", "enrolment_updated_by_name",
  "other_codes", "other_emails", "other_lms_user_ids", "other_finance_invoice_ids", "merged_from",
  ...Object.keys(LISTS),
]);
const empty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)
  || (typeof v === "object" && !(v instanceof Date) && !(v instanceof ObjectId) && !Array.isArray(v) && !Object.keys(v as object).length);
const uniq = (xs: unknown[]) => [...new Set(xs.map((x) => String(x ?? "").trim()).filter(Boolean))];

export interface MergeChoice {
  keepId: string;
  closeId: string;
  /** Whose CS the merged student has: the kept record's, or the closed one's. */
  csFrom: "kept" | "closed";
  /** The CS not chosen stays on as a Common CS (when the two differ). */
  otherCsAsCommon: boolean;
}

/** The kept record's fields after the merge — everything except the CS, which is applied the app's way after. */
export function mergedFields(k: any, c: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [f, v] of Object.entries(c)) {
    if (OWN.has(f) || empty(v)) continue;
    if (empty(k[f])) out[f] = v;
  }
  for (const [f, key] of Object.entries(LISTS)) {
    const a = Array.isArray(k[f]) ? k[f] : [], b = Array.isArray(c[f]) ? c[f] : [];
    if (!b.length) continue;
    const seen = new Set(a.map(key));
    const add = b.filter((x: any) => { const id = key(x); if (!id || seen.has(id)) return false; seen.add(id); return true; });
    if (add.length) out[f] = [...a, ...add];
  }
  // Notes: both, the closed record's under a line saying where they came from.
  if (String(c.notes ?? "").trim()) out.notes = [String(k.notes ?? "").trim(), `From ${c.student_code}: ${String(c.notes).trim()}`].filter(Boolean).join("\n\n");
  // An imported deposit figure: the two added up.
  if (Number(c.net_deposit_usd) || Number(k.net_deposit_usd)) out.net_deposit_usd = Math.round(((Number(k.net_deposit_usd) || 0) + (Number(c.net_deposit_usd) || 0)) * 100) / 100;
  // Onboarded on either: the earlier welcome counts.
  if (c.onboarded && (!k.onboarded || String(c.onboarded_at ?? "") < String(k.onboarded_at ?? "9999"))) {
    for (const f of ["onboarded", "onboarded_at", "onboarded_by_id", "onboarded_by_name", "onboarded_via"]) if (f in c) out[f] = c[f];
  }
  // An enrolment Closed on either carries over (as the old merge script did).
  if (k.enrolment_status !== "closed" && c.enrolment_status === "closed") {
    for (const f of ["enrolment_status", "enrolment_updated_at", "enrolment_updated_by_id", "enrolment_updated_by_name"]) if (f in c) out[f] = c[f];
  }
  // The closed record's identity, still findable on the kept one.
  out.other_codes = uniq([...(k.other_codes ?? []), c.student_code, ...(c.other_codes ?? [])]).filter((x) => x !== k.student_code);
  out.other_emails = uniq([...(k.other_emails ?? []), c.email, ...(c.other_emails ?? [])].map((e) => String(e ?? "").toLowerCase()))
    .filter((e) => e.includes("@") && e !== String(k.email ?? "").toLowerCase());
  // Unique on students: moved over when the kept record has none, else kept beside it.
  if (!k.lms_user_id && c.lms_user_id) out.lms_user_id = c.lms_user_id;
  out.other_lms_user_ids = uniq([...(k.other_lms_user_ids ?? []), ...(k.lms_user_id && c.lms_user_id && c.lms_user_id !== k.lms_user_id ? [c.lms_user_id] : []), ...(c.other_lms_user_ids ?? [])]);
  if (!k.finance_invoice_id && c.finance_invoice_id) { out.finance_invoice_id = c.finance_invoice_id; out.finance_invoice_number = c.finance_invoice_number ?? ""; }
  out.other_finance_invoice_ids = uniq([...(k.other_finance_invoice_ids ?? []),
    ...(k.finance_invoice_id && c.finance_invoice_id && c.finance_invoice_id !== k.finance_invoice_id ? [c.finance_invoice_id] : []), ...(c.other_finance_invoice_ids ?? [])]);
  for (const f of ["other_codes", "other_emails", "other_lms_user_ids", "other_finance_invoice_ids"]) if (!(out[f] as unknown[]).length && !k[f]) delete out[f];
  out.merged_from = [...(Array.isArray(k.merged_from) ? k.merged_from : []), { id: String(c._id), code: c.student_code, name: c.full_name, at: new Date().toISOString() }];
  return out;
}

/* ── Paths ───────────────────────────────────────────────────────────────── */

/** "a[].b" → the top-level field ("a"), and a function that rewrites the value under it. */
function rewriter(path: string, from: string, to: string) {
  const parts = path.split(".");
  const top = parts[0]!.replace("[]", "");
  const same = (v: unknown) => (v instanceof ObjectId ? v.toHexString() : String(v ?? "")) === from;
  const swap = (v: unknown) => (v instanceof ObjectId ? new ObjectId(to) : to);
  const walk = (v: any, i: number): { v: any; n: number } => {
    const p = parts[i]!;
    const isList = p.endsWith("[]");
    const key = p.replace("[]", "");
    const last = i === parts.length - 1;
    const step = (x: any): { v: any; n: number } => (last ? (same(x) ? { v: swap(x), n: 1 } : { v: x, n: 0 }) : walk(x, i + 1));
    if (i === 0) {
      // v is the document's top-level value for `key`.
      if (isList) {
        if (!Array.isArray(v)) return { v, n: 0 };
        let n = 0;
        const list = v.map((x) => { const r = step(x); n += r.n; return r.v; });
        // A list of ids holds each once.
        return { v: last ? [...new Map(list.map((x) => [String(x), x])).values()] : list, n };
      }
      return step(v);
    }
    if (v == null || typeof v !== "object") return { v, n: 0 };
    if (isList) {
      if (!Array.isArray(v[key])) return { v, n: 0 };
      let n = 0;
      const list = v[key].map((x: any) => { const r = step(x); n += r.n; return r.v; });
      return { v: { ...v, [key]: last ? [...new Map(list.map((x: any) => [String(x), x])).values()] : list }, n };
    }
    const r = step(v[key]);
    return { v: r.n ? { ...v, [key]: r.v } : v, n: r.n };
  };
  return { top, rewrite: (topValue: any) => walk(topValue, 0) };
}

/** The query matching a path's value: the id as text or as an ObjectId. */
function matchOf(path: string, value: string, isId: boolean) {
  const field = path.replace(/\[\]/g, "");
  const values: unknown[] = [value];
  if (isId && ObjectId.isValid(value)) values.push(new ObjectId(value));
  return { [field]: { $in: values } };
}

/* ── Scope ───────────────────────────────────────────────────────────────── */

/** Whether `user` may merge these students: a Super Admin any; a CS Manager those with no CS or a CS in their reach. */
export async function mayMerge(user: AuthUser, students: any[]): Promise<boolean> {
  if (!MERGE_ROLES.has(user.app_role)) return false;
  if (user.app_role === "super_admin") return true;
  const reach = await visibleMentorIds(user);
  if (!reach) return true;
  return students.every((s) => {
    const ids = [String(s.primary_mentor_id ?? ""), ...((Array.isArray(s.common_cs) ? s.common_cs : []).map((x: any) => String(x?.id ?? "")))].filter(Boolean);
    return !ids.length || s.assignment_status === "open_pool" || ids.some((id) => reach.has(id));
  });
}

/* ── Preview ─────────────────────────────────────────────────────────────── */

export async function loadPair(keepId: string, closeId: string) {
  if (!ObjectId.isValid(keepId) || !ObjectId.isValid(closeId)) throw new MergeError(400, "Pick two students");
  if (keepId === closeId) throw new MergeError(400, "That is the same student twice");
  const [k, c] = await Promise.all([
    col("students").findOne({ _id: new ObjectId(keepId) }),
    col("students").findOne({ _id: new ObjectId(closeId) }),
  ]);
  if (!k || !c) throw new MergeError(404, "One of the students is not here any more — merged or removed already");
  return { k: k as any, c: c as any };
}

export class MergeError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** What would move, per place, and how much — nothing changed. */
export async function countMoves(closed: any): Promise<{ label: string; count: number }[]> {
  const id = String(closed._id), code = String(closed.student_code ?? "");
  const out: { label: string; count: number }[] = [];
  for (const r of REFS) {
    const ors = [
      ...(r.ids ?? []).map((p) => matchOf(p, id, true)),
      ...(code ? (r.codes ?? []).map((p) => matchOf(p, code, false)) : []),
    ];
    if (!ors.length) continue;
    const n = await col(r.col).countDocuments({ $or: ors });
    if (n) out.push({ label: r.label, count: n });
  }
  return out;
}

/* ── The merge ───────────────────────────────────────────────────────────── */

/** One field the merge changed: what it held (`had` false: it was not there) and what the merge put there. */
export interface Change { col: string; id: unknown; field: string; had: boolean; before: unknown; after: unknown }

/**
 * Where a merge came from (2026-11-12, phase 2): this page, or the Delta LMS merging two accounts
 * (students/lmsMergeLink.ts) — that one is not sent back to the LMS, and its undo comes from there.
 */
export interface MergeOrigin { origin?: "cs_portal" | "lms"; lmsMergeId?: string }

/**
 * Merge `closeId` into `keepId`. Claimed first (two people merging the same
 * student at once: one wins), written down as it goes, and marked done — or
 * failed, with what was done so far, for undo.
 */
export async function mergeStudents(choice: MergeChoice, user: AuthUser, from: MergeOrigin = {}): Promise<any> {
  const { k, c } = await loadPair(choice.keepId, choice.closeId);
  if (!(await mayMerge(user, [k, c]))) throw new MergeError(403, "Only a Super Admin, or a CS Manager for their own students, merges students");
  const by = { id: user.id, name: user.full_name || user.email || "somebody" };
  const now = new Date().toISOString();

  const mergeId = new ObjectId();
  try {
    await col(MERGES).insertOne({
      _id: mergeId, status: "running", lock_keys: [String(k._id), String(c._id)],
      kept: { id: String(k._id), code: k.student_code, name: k.full_name },
      closed: { id: String(c._id), code: c.student_code, name: c.full_name, email: c.email },
      choice: { csFrom: choice.csFrom, otherCsAsCommon: choice.otherCsAsCommon },
      origin: from.origin ?? "cs_portal", ...(from.lmsMergeId ? { lms_merge_id: from.lmsMergeId } : {}),
      // Their LMS accounts, for the LMS to merge them too (students/lmsMergeLink.ts).
      lms_identity: { kept: { lmsUserId: k.lms_user_id ?? "", email: k.email ?? "" }, closed: { lmsUserId: c.lms_user_id ?? "", email: c.email ?? "" } },
      by, at: now, changes: [] as Change[], closed_doc: c, moved: [],
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new MergeError(409, "One of these students is being merged right now");
    throw err;
  }

  const changes: Change[] = [];
  const note = async (batch: Change[]) => {
    if (!batch.length) return;
    changes.push(...batch);
    await col(MERGES).updateOne({ _id: mergeId }, { $push: { changes: { $each: batch } } } as any);
  };

  try {
    // 1. Everything filed under the closed record.
    const moved: { label: string; count: number }[] = [];
    const id = String(c._id), code = String(c.student_code ?? "");
    for (const r of REFS) {
      const targets = [
        ...(r.ids ?? []).map((p) => ({ p, from: id, to: String(k._id), isId: true })),
        ...(code ? (r.codes ?? []).map((p) => ({ p, from: code, to: String(k.student_code ?? ""), isId: false })) : []),
      ];
      if (!targets.length) continue;
      const docs = await col(r.col).find({ $or: targets.map((t) => matchOf(t.p, t.from, t.isId)) }).toArray();
      let count = 0;
      for (const d of docs as any[]) {
        const set: Record<string, unknown> = {};
        const batch: Change[] = [];
        for (const t of targets) {
          const { top, rewrite } = rewriter(t.p, t.from, t.to);
          const current = top in set ? set[top] : d[top];
          const r2 = rewrite(current);
          if (r2.n) {
            if (!batch.some((b) => b.field === top)) batch.push({ col: r.col, id: d._id, field: top, had: top in d, before: d[top] ?? null, after: undefined });
            set[top] = r2.v;
          }
        }
        if (!batch.length) continue;
        for (const b of batch) b.after = set[b.field];
        await note(batch);
        await col(r.col).updateOne({ _id: d._id }, { $set: set });
        count++;
      }
      if (count) moved.push({ label: r.label, count });
    }
    await col(MERGES).updateOne({ _id: mergeId }, { $set: { moved } });

    // 2. The closed record out of the way first: its unique fields (LMS account, finance invoice) go to the kept one.
    await col("students").deleteOne({ _id: c._id });
    await col(MERGES).updateOne({ _id: mergeId }, { $set: { closed_removed: true } });

    // 3. The kept record: what it lacks, both lists, the closed one's identity.
    const fields = mergedFields(k, c);
    const keptBatch: Change[] = Object.entries({ ...fields, updated_date: now }).map(([f, v]) => ({ col: "students", id: k._id, field: f, had: f in k, before: k[f] ?? null, after: v }));
    await note(keptBatch);
    await col("students").updateOne({ _id: k._id }, { $set: { ...fields, updated_date: now } });

    // 4. The CS: the app's own change of CS — history, team — when the closed record's is chosen.
    const history: HistoryEntry[] = [];
    const keptNow: any = await col("students").findOne({ _id: k._id });
    const keptCs = { id: String(k.primary_mentor_id ?? ""), name: String(k.primary_mentor_name ?? "") };
    const closedCs = { id: String(c.primary_mentor_id ?? ""), name: String(c.primary_mentor_name ?? "") };
    const chosen = choice.csFrom === "closed" ? closedCs : keptCs;
    const other = choice.csFrom === "closed" ? keptCs : closedCs;
    const csData: Record<string, unknown> = {};
    if (chosen.id !== keptCs.id) {
      csData.primary_mentor_id = chosen.id;
      csData.primary_mentor_name = chosen.name;
      if (choice.csFrom === "closed") csData.assignment_status = c.assignment_status ?? keptNow.assignment_status;
    }
    let common = Array.isArray(keptNow.common_cs) ? [...keptNow.common_cs] : [];
    const before = common.length;
    common = common.filter((x: any) => String(x?.id ?? "") !== chosen.id);
    if (choice.otherCsAsCommon && other.id && other.id !== chosen.id && !common.some((x: any) => String(x?.id ?? "") === other.id)) {
      common.push({ id: other.id, name: other.name, at: now, via: "merge" });
    }
    if (common.length !== before || common.some((x: any, i: number) => x !== keptNow.common_cs?.[i])) csData.common_cs = common;
    if (Object.keys(csData).length) {
      // The app's own change of CS (team, assigned time, a history line); it drops what the server owns — Common
      // among them — from what it is given, so Common goes on after.
      const data: Record<string, unknown> = { ...csData, updated_date: now };
      delete data.common_cs;
      const entries = "primary_mentor_id" in data ? await prepareStudentUpdate(keptNow, data, user) : [];
      if ("common_cs" in csData) data.common_cs = csData.common_cs;
      delete data.updated_date; // set with step 3's, and recorded there
      const batch: Change[] = Object.entries(data).map(([f, v]) => ({ col: "students", id: k._id, field: f, had: f in keptNow, before: keptNow[f] ?? null, after: v }));
      await note(batch);
      await col("students").updateOne({ _id: k._id }, { $set: data });
      history.push(...entries);
    }

    // 5. A line on the kept record's history saying what happened.
    history.push({
      student_id: String(k._id), at: now, by_id: by.id, by_name: by.name, type: "merged",
      text: `Merged with ${c.student_code ?? "another record"}${c.full_name ? ` (${String(c.full_name).trim()})` : ""} — its records moved here${chosen.id && chosen.id !== keptCs.id ? `; CS now ${chosen.name}` : ""}${choice.otherCsAsCommon && other.id && other.id !== chosen.id ? `; ${other.name} kept as Common CS` : ""}`,
    });
    await recordHistory(history);

    // 6. Anything still pointing at the closed record — a place REFS does not know.
    const leftovers = await scanFor(String(c._id), code);
    await col(MERGES).updateOne({ _id: mergeId }, { $set: { status: "merged", done_at: new Date().toISOString(), leftovers }, $unset: { lock_keys: "" } });
    // Made here: the LMS merges the two students' LMS accounts too — retried until it has (students/lmsMergeLink.ts).
    const lms = from.origin === "lms" ? null : await (await import("./lmsMergeLink")).sendMergeToLms(String(mergeId)).catch(() => null);
    return { mergeId: String(mergeId), kept: { id: String(k._id), code: k.student_code }, closed: { id: String(c._id), code: c.student_code }, moved, leftovers, lms };
  } catch (err) {
    await col(MERGES).updateOne({ _id: mergeId }, { $set: { status: "failed", error: (err as Error).message, failed_at: new Date().toISOString() }, $unset: { lock_keys: "" } });
    console.error("[student merge] stopped part-way — undo it from the merge history", { mergeId: String(mergeId), err });
    throw new MergeError(500, `The merge stopped part-way (${(err as Error).message}). Undo it from the merge history.`);
  }
}

/** Every collection but the students and the merges, for a value anywhere in a document: where it still is. */
export async function scanFor(id: string, code: string): Promise<{ col: string; path: string; count: number }[]> {
  const found = new Map<string, number>();
  const look = (name: string, v: any, path: string) => {
    if (v == null) return;
    if (v instanceof ObjectId) { if (v.toHexString() === id) found.set(`${name}|${path}`, (found.get(`${name}|${path}`) ?? 0) + 1); return; }
    if (typeof v === "string") { if (v === id || (code && v === code)) found.set(`${name}|${path}`, (found.get(`${name}|${path}`) ?? 0) + 1); return; }
    if (Array.isArray(v)) { for (const x of v) look(name, x, `${path}[]`); return; }
    if (typeof v === "object" && !(v instanceof Date)) for (const [key, x] of Object.entries(v)) look(name, x, path ? `${path}.${key}` : key);
  };
  for (const { name } of await db().listCollections({}, { nameOnly: true }).toArray()) {
    if (NOT_SCANNED.has(name) || name.startsWith("system.")) continue;
    for await (const d of col(name).find({})) look(name, d, "");
  }
  return [...found].map(([k, count]) => { const [c, path] = k.split("|"); return { col: c!, path: path!, count }; });
}

/* ── Undo ────────────────────────────────────────────────────────────────── */

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Put a merge back: the closed record back in `students`, and every field the
 * merge changed back to what it was — only where it still holds what the
 * merge put there. What has changed since is left as it is and reported.
 */
export async function undoMerge(mergeId: string, user: AuthUser, opts: { fromLms?: boolean } = {}): Promise<any> {
  if (!ObjectId.isValid(mergeId)) throw new MergeError(404, "Merge not found");
  const m: any = await col(MERGES).findOne({ _id: new ObjectId(mergeId) });
  if (!m) throw new MergeError(404, "Merge not found");
  if (m.status === "undone") throw new MergeError(409, "This merge was undone already");
  if (m.status === "running") throw new MergeError(409, "This merge is still running");
  const keptNow: any = m.kept?.id && ObjectId.isValid(m.kept.id) ? await col("students").findOne({ _id: new ObjectId(m.kept.id) }) : null;
  if (!opts.fromLms && !(await mayMerge(user, [m.closed_doc, keptNow].filter(Boolean)))) throw new MergeError(403, "Only a Super Admin, or a CS Manager for their own students, undoes a merge");
  const claim = await col(MERGES).updateOne({ _id: m._id, status: { $in: ["merged", "failed"] } }, { $set: { status: "undoing" } });
  if (!claim.modifiedCount) throw new MergeError(409, "Somebody is undoing it right now");

  const kept: { col: string; id: string; field: string }[] = [];
  try {
    // The kept record's unique fields first, so the closed one can have its own back.
    const changes: Change[] = m.changes ?? [];
    for (const ch of [...changes].reverse()) {
      const doc: any = await col(ch.col).findOne({ _id: ch.id as any }, { projection: { [ch.field]: 1 } });
      if (!doc) continue;
      if (!sameValue(doc[ch.field], ch.after)) { kept.push({ col: ch.col, id: String(ch.id), field: ch.field }); continue; }
      // Not there before the merge: taken away again, not left as an empty value.
      await col(ch.col).updateOne({ _id: ch.id as any }, ch.had === false ? { $unset: { [ch.field]: "" } } : { $set: { [ch.field]: ch.before } });
    }
    if (m.closed_removed && m.closed_doc && !(await col("students").findOne({ _id: m.closed_doc._id }))) {
      await col("students").insertOne(m.closed_doc);
    }
    await recordHistory([{
      student_id: String(m.kept.id), at: new Date().toISOString(), by_id: user.id, by_name: user.full_name || user.email || "somebody", type: "merge_undone",
      text: m.type === "relink"
        ? `Re-linked LMS account undone — back on ${m.relink?.fromEmail || "the earlier account"}`
        : `Merge with ${m.closed?.code ?? "another record"} undone — its records are back on it`,
    }]);
    await col(MERGES).updateOne({ _id: m._id }, { $set: { status: "undone", undone_at: new Date().toISOString(), undone_by: { id: user.id, name: user.full_name || user.email }, left_as_is: kept } });
    // Undone here: the LMS undoes its side too. Asked by the LMS: it has already.
    const lms = opts.fromLms ? null : await (await import("./lmsMergeLink")).sendUndoToLms(String(m._id)).catch(() => null);
    return { undone: true, leftAsIs: kept, lms };
  } catch (err) {
    await col(MERGES).updateOne({ _id: m._id }, { $set: { status: m.status, undo_error: (err as Error).message } });
    throw err;
  }
}

/* ── Finding duplicates ──────────────────────────────────────────────────── */

const nameKey = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
const emailKey = (s: unknown) => String(s ?? "").toLowerCase().trim();

export interface DuplicateGroup {
  key: string;
  /** Why they look like one person: the same phone, email, or LMS account. */
  by: string[];
  confidence: "high" | "medium" | "low";
  students: any[];
}

/** Students that look like one person, in the viewer's reach: the same phone (last 9 digits), the same email. */
export async function findDuplicates(user: AuthUser, opts: { includeDismissed?: boolean } = {}): Promise<DuplicateGroup[]> {
  const reach = user.app_role === "super_admin" ? null : await visibleMentorIds(user);
  const students = (await col("students").find({}, {
    projection: { full_name: 1, student_code: 1, email: 1, phone: 1, primary_mentor_id: 1, primary_mentor_name: 1, team_name: 1, common_cs: 1, assignment_status: 1, created_date: 1, lms_user_id: 1, enrolment_status: 1, not_student: 1 },
  }).toArray()) as any[];
  const parent = new Map<string, string>();
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  const join = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const why = new Map<string, Set<string>>();
  const link = (field: string, keyOf: (s: any) => string) => {
    const by = new Map<string, string[]>();
    for (const s of students) { const k = keyOf(s); if (k) by.set(k, [...(by.get(k) ?? []), String(s._id)]); }
    for (const ids of by.values()) {
      if (ids.length < 2) continue;
      for (const id of ids) { join(ids[0]!, id); why.set(id, (why.get(id) ?? new Set()).add(field)); }
    }
  };
  link("phone", (s) => phoneKey(s.phone));
  link("email", (s) => (emailKey(s.email).includes("@") ? emailKey(s.email) : ""));
  const groups = new Map<string, any[]>();
  for (const s of students) if (why.has(String(s._id))) { const r = find(String(s._id)); groups.set(r, [...(groups.get(r) ?? []), s]); }
  const dismissed = new Set((await col(DISMISSALS).find({}).toArray()).map((d: any) => String(d.key)));
  const out: DuplicateGroup[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const key = list.map((s) => String(s._id)).sort().join(",");
    if (!opts.includeDismissed && dismissed.has(key)) continue;
    if (reach && !(await mayMerge(user, list))) continue;
    const by = [...new Set(list.flatMap((s) => [...(why.get(String(s._id)) ?? [])]))];
    const names = new Set(list.map((s) => nameKey(s.full_name)));
    const confidence = by.includes("email") && names.size === 1 ? "high" : names.size === 1 || by.includes("email") ? "medium" : "low";
    out.push({
      key, by, confidence,
      students: list.map((s) => ({
        id: String(s._id), code: s.student_code ?? "", name: String(s.full_name ?? "").trim(), email: s.email ?? "", phone: String(s.phone ?? ""),
        cs: s.primary_mentor_name || "", csId: s.primary_mentor_id || "", team: s.team_name || "", open: s.assignment_status === "open_pool",
        created: s.created_date ?? "", lms: !!s.lms_user_id, enrolment: s.enrolment_status ?? "",
      })),
      ...(dismissed.has(key) ? { dismissed: true } : {}),
    } as DuplicateGroup);
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.confidence] - rank[b.confidence] || a.students[0].name.localeCompare(b.students[0].name));
}
