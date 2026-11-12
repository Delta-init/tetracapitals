import { ObjectId } from "mongodb";
import { col } from "../db";
import { config } from "../config";
import type { AuthUser } from "../auth/middleware";
import { ok, refuse, secretMatches, text, isEmail, studentWithEmail } from "./intake";
import { MERGES, MergeError, mergeStudents, undoMerge, type Change } from "./merge";
import { recordHistory } from "./history";

/* ────────────────────────────────────────────────────────────────────────────
   Merges, both ways between here and the Delta LMS (the user, 2026-11-12:
   "when merge on the lms it will merge on the commission portal also … if
   merges [here] it will change to lms").

   LMS → here: the LMS's merge pop-up asks who its two accounts are here
   (POST /integrations/lms/merge/preview) and offers the CS when both are here
   with different CSs; once it has merged, it tells this side
   (/integrations/lms/merge), which — once per LMS merge:
     · both accounts here as two students → merges them, with the CS picked;
     · only the closed account here → re-links that student to the kept LMS
       account (its LMS id and email; the old ones stay findable on it);
     · otherwise → nothing to do.
   Its undo undoes this side (/integrations/lms/merge/undo).

   Here → LMS: a merge made on the Duplicates page tells the LMS
   (/integrations/cs-portal/merge there), which merges the two students' LMS
   accounts, the kept student's keeping. Its undo undoes the LMS's. Not
   reached: kept "pending" and tried again every minute (startMergeLinkWorker).

   Each side marks what came from the other and never sends it back. The
   secret is the one only these two share — the LMS's COMMISSION_S2S_SECRET,
   LMS_S2S_SECRET here — in x-lms-secret (LMS → here) and x-commission-secret
   (here → LMS).
──────────────────────────────────────────────────────────────────────────── */

const ID = /^[0-9a-f]{24}$/i;
const lmsLinked = () => !!(config.lms.apiUrl && config.lmsS2sSecret);
/** Who a change from the LMS is recorded as. */
const fromLmsUser = (by: any): AuthUser => ({
  id: "lms", email: text(by?.email), app_role: "super_admin",
  full_name: `LMS${text(by?.name) || text(by?.email) ? ` · ${text(by?.name) || text(by?.email)}` : ""}`,
});

interface Account { lmsUserId?: string; email?: string }

/** The student here for an LMS account: by its LMS id — theirs, or one merged into theirs — else by email. */
async function studentFor(a: Account | undefined): Promise<any | null> {
  const id = text(a?.lmsUserId, 64);
  const email = text(a?.email).toLowerCase();
  const byId = ID.test(id) ? await col("students").findOne({ $or: [{ lms_user_id: id }, { other_lms_user_ids: id }] }) : null;
  return byId ?? (isEmail(email) ? await studentWithEmail(email) : null);
}

async function summary(s: any) {
  return {
    id: String(s._id), code: s.student_code ?? "", name: String(s.full_name ?? "").trim(),
    cs: s.assignment_status === "open_pool" ? "" : String(s.primary_mentor_name ?? ""), team: String(s.team_name ?? ""),
    open: s.assignment_status === "open_pool",
    deposits: await col("funding_transactions").countDocuments({ student_id: String(s._id), type: "DEPOSIT", status: "APPROVED" }),
  };
}

function inbound(req: Request): Response | null {
  if (!config.lmsS2sSecret) return refuse(503, "INTEGRATION_DISABLED", "The Delta LMS link is not configured on this server");
  if (!secretMatches(req.headers.get("x-lms-secret"), config.lmsS2sSecret)) return refuse(401, "UNAUTHORISED", "Bad secret");
  return null;
}
const bodyOf = async (req: Request): Promise<any> => {
  const b = await req.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? b : null;
};

/* ── LMS → here ──────────────────────────────────────────────────────────── */

/** POST /api/v1/integrations/lms/merge/preview { primary, secondary } → who they are here, and what a merge would do. Read only. */
export async function handleLmsMergePreview(req: Request): Promise<Response> {
  const no = inbound(req); if (no) return no;
  const b = await bodyOf(req);
  if (!b) return refuse(400, "VALIDATION_ERROR", "Body must be a JSON object");
  const [p, s] = await Promise.all([studentFor(b.primary), studentFor(b.secondary)]);
  const same = !!p && !!s && String(p._id) === String(s._id);
  const action = p && s && !same ? "merge" : !p && s ? "relink" : "nothing";
  return ok({
    action,
    primary: p ? await summary(p) : null,
    secondary: s && !same ? await summary(s) : null,
    sameCs: !!p && !!s && String(p.primary_mentor_id ?? "") === String(s.primary_mentor_id ?? ""),
  });
}

/** POST /api/v1/integrations/lms/merge { lmsMergeId, primary, secondary, csFrom, otherCsAsCommon, by } — once per LMS merge. */
export async function handleLmsMerge(req: Request): Promise<Response> {
  const no = inbound(req); if (no) return no;
  const b = await bodyOf(req);
  const lmsMergeId = text(b?.lmsMergeId, 64);
  if (!b || !ID.test(lmsMergeId)) return refuse(400, "VALIDATION_ERROR", "lmsMergeId is required");
  const done: any = await col(MERGES).findOne({ lms_merge_id: lmsMergeId, status: { $in: ["merged", "running", "undoing"] } });
  if (done) return ok({ action: done.type === "relink" ? "relink" : "merge", mergeId: String(done._id), already: true });

  const [p, s] = await Promise.all([studentFor(b.primary), studentFor(b.secondary)]);
  const user = fromLmsUser(b.by);
  try {
    if (p && s && String(p._id) !== String(s._id)) {
      const r = await mergeStudents(
        { keepId: String(p._id), closeId: String(s._id), csFrom: b.csFrom === "secondary" ? "closed" : "kept", otherCsAsCommon: b.otherCsAsCommon !== false },
        user, { origin: "lms", lmsMergeId },
      );
      return ok({ action: "merge", mergeId: r.mergeId, kept: r.kept, closed: r.closed });
    }
    if (!p && s) return ok(await relink(s, b.primary ?? {}, lmsMergeId, user));
    return ok({ action: "nothing" });
  } catch (err) {
    if (err instanceof MergeError) return refuse(err.status, "MERGE_REFUSED", err.message);
    throw err;
  }
}

/** The one student here was the LMS's closed account: it follows the kept account — its LMS id and email — the old ones kept findable. */
async function relink(s: any, to: Account, lmsMergeId: string, user: AuthUser) {
  const now = new Date().toISOString();
  const toId = text(to.lmsUserId, 64), toEmail = text(to.email).toLowerCase();
  const set: Record<string, unknown> = {};
  if (ID.test(toId) && toId !== s.lms_user_id && !(await col("students").findOne({ lms_user_id: toId, _id: { $ne: s._id } }))) {
    set.lms_user_id = toId;
    if (s.lms_user_id) set.other_lms_user_ids = [...new Set([...(s.other_lms_user_ids ?? []), String(s.lms_user_id)])];
  }
  if (isEmail(toEmail) && toEmail !== String(s.email ?? "").toLowerCase()) {
    set.email = toEmail;
    if (s.email) set.other_emails = [...new Set([...(s.other_emails ?? []), String(s.email).toLowerCase()])];
  }
  if (!Object.keys(set).length) return { action: "nothing" };
  set.updated_date = now;
  const changes: Change[] = Object.entries(set).map(([f, v]) => ({ col: "students", id: s._id, field: f, had: f in s, before: s[f] ?? null, after: v }));
  const mergeId = new ObjectId();
  await col(MERGES).insertOne({
    _id: mergeId, type: "relink", status: "running", lock_keys: [String(s._id)], origin: "lms", lms_merge_id: lmsMergeId,
    kept: { id: String(s._id), code: s.student_code, name: s.full_name }, closed: null,
    relink: { fromEmail: s.email ?? "", fromLmsUserId: s.lms_user_id ?? "", toEmail, toLmsUserId: toId },
    by: { id: user.id, name: user.full_name }, at: now, changes, moved: [],
  });
  try {
    await col("students").updateOne({ _id: s._id }, { $set: set });
    await recordHistory([{
      student_id: String(s._id), at: now, by_id: user.id, by_name: String(user.full_name), type: "merged",
      text: `LMS accounts merged: now on ${toEmail || "the kept LMS account"}${s.email && set.email ? ` (${s.email} is kept on them too)` : ""}`,
    }]);
    await col(MERGES).updateOne({ _id: mergeId }, { $set: { status: "merged", done_at: new Date().toISOString() }, $unset: { lock_keys: "" } });
  } catch (err) {
    await col(MERGES).updateOne({ _id: mergeId }, { $set: { status: "failed", error: (err as Error).message }, $unset: { lock_keys: "" } });
    throw err;
  }
  return { action: "relink", mergeId: String(mergeId) };
}

/** POST /api/v1/integrations/lms/merge/undo { lmsMergeId } or { csMergeId } — the LMS undid its merge; this side's follows. */
export async function handleLmsMergeUndo(req: Request): Promise<Response> {
  const no = inbound(req); if (no) return no;
  const b = await bodyOf(req);
  const lmsMergeId = text(b?.lmsMergeId, 64), csMergeId = text(b?.csMergeId, 64);
  const m: any = ID.test(csMergeId) ? await col(MERGES).findOne({ _id: new ObjectId(csMergeId) })
    : ID.test(lmsMergeId) ? await col(MERGES).findOne({ lms_merge_id: lmsMergeId }, { sort: { at: -1 } })
    : null;
  if (!b || (!ID.test(lmsMergeId) && !ID.test(csMergeId))) return refuse(400, "VALIDATION_ERROR", "lmsMergeId or csMergeId is required");
  if (!m) return ok({ undone: false, nothing: true });
  if (m.status === "undone") return ok({ undone: true, already: true });
  try {
    const r = await undoMerge(String(m._id), fromLmsUser(b.by), { fromLms: true });
    return ok({ undone: true, leftAsIs: r.leftAsIs ?? [] });
  } catch (err) {
    if (err instanceof MergeError) return refuse(err.status, "UNDO_REFUSED", err.message);
    throw err;
  }
}

/* ── Here → LMS ──────────────────────────────────────────────────────────── */

const TIMEOUT_MS = 20_000;
async function callLmsMerge(path: string, body: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${config.lms.apiUrl}/api/v1/integrations/cs-portal${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-commission-secret": config.lmsS2sSecret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error("The LMS could not be reached");
  }
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j?.error?.message ?? j?.message ?? `The LMS answered ${res.status}`), { status: res.status });
  return j?.data ?? j;
}
/** Waiting longer after each failed try: 1, 2, 4 … minutes, at most an hour. */
const backoff = (attempts: number) => new Date(Date.now() + Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000).toISOString();

/** A merge made here: the LMS merges the two students' accounts. Never throws; what happened is on the merge (`lms`). */
export async function sendMergeToLms(mergeId: string): Promise<any> {
  const m: any = await col(MERGES).findOne({ _id: new ObjectId(mergeId) });
  if (!m || m.origin === "lms" || m.type === "relink") return null;
  if (m.status !== "merged") {
    if (m.lms?.state === "pending") await col(MERGES).updateOne({ _id: m._id }, { $set: { "lms.state": "cancelled" } });
    return null;
  }
  if (!lmsLinked()) {
    const lms = { state: "not_linked", at: new Date().toISOString() };
    await col(MERGES).updateOne({ _id: m._id }, { $set: { lms } });
    return lms;
  }
  const attempts = Number(m.lms?.attempts ?? 0) + 1;
  try {
    const r = await callLmsMerge("/merge", {
      csMergeId: String(m._id),
      primary: m.lms_identity?.kept ?? {}, secondary: m.lms_identity?.closed ?? {},
      by: { name: m.by?.name ?? "", email: "" },
    });
    const lms = { state: r?.action === "merge" ? "done" : "nothing", action: r?.action ?? "nothing", lms_merge_id: r?.mergeId ?? null, at: new Date().toISOString(), attempts };
    await col(MERGES).updateOne({ _id: m._id }, { $set: { lms } });
    return lms;
  } catch (err) {
    // A refusal (4xx) will not change by trying again: recorded failed, for a person to look at.
    const status = Number((err as { status?: number }).status ?? 0);
    const final = status >= 400 && status < 500 && status !== 401;
    const lms = { state: final ? "failed" : "pending", error: (err as Error).message, attempts, next_at: backoff(attempts), at: new Date().toISOString() };
    await col(MERGES).updateOne({ _id: m._id }, { $set: { lms } });
    return lms;
  }
}

/** A merge undone here: the LMS undoes its side — the one it made for this merge, or the LMS merge this one came from. */
export async function sendUndoToLms(mergeId: string): Promise<any> {
  const m: any = await col(MERGES).findOne({ _id: new ObjectId(mergeId) });
  if (!m || m.status !== "undone") return null;
  const target = m.origin === "lms" ? (m.lms_merge_id ? { lmsMergeId: m.lms_merge_id } : null)
    : m.lms?.state === "done" ? { csMergeId: String(m._id) } : null;
  if (!target) return null;
  if (!lmsLinked()) return null;
  const attempts = Number(m.lms_undo?.attempts ?? 0) + 1;
  try {
    const r = await callLmsMerge("/merge/undo", target);
    const lms_undo = { state: "done", nothing: !!r?.nothing, at: new Date().toISOString(), attempts };
    await col(MERGES).updateOne({ _id: m._id }, { $set: { lms_undo } });
    return lms_undo;
  } catch (err) {
    const lms_undo = { state: "pending", error: (err as Error).message, attempts, next_at: backoff(attempts), at: new Date().toISOString() };
    await col(MERGES).updateOne({ _id: m._id }, { $set: { lms_undo } });
    return lms_undo;
  }
}

/** Whatever the LMS has not been told yet: merges and undos it could not be reached for. */
export async function retryMergeLinks(now = new Date()): Promise<{ merges: number; undos: number }> {
  if (!lmsLinked()) return { merges: 0, undos: 0 };
  const due = { $lte: now.toISOString() };
  const merges = await col(MERGES).find({ status: "merged", "lms.state": "pending", "lms.next_at": due, "lms.attempts": { $lt: 30 } }, { projection: { _id: 1 } }).toArray();
  for (const m of merges) await sendMergeToLms(String(m._id));
  const undos = await col(MERGES).find({ status: "undone", "lms_undo.state": "pending", "lms_undo.next_at": due, "lms_undo.attempts": { $lt: 30 } }, { projection: { _id: 1 } }).toArray();
  for (const m of undos) await sendUndoToLms(String(m._id));
  return { merges: merges.length, undos: undos.length };
}

let running = false;
/** Every minute (MERGE_LMS_SYNC=off to keep a server out of it). */
export function startMergeLinkWorker(): void {
  if (!lmsLinked() || /^(off|false|0|no)$/i.test(process.env.MERGE_LMS_SYNC ?? "")) return;
  setInterval(() => {
    if (running) return;
    running = true;
    retryMergeLinks()
      .then((r) => { if (r.merges || r.undos) console.log("[merge → LMS] retried", r); })
      .catch((err) => console.error("[merge → LMS] retry failed", err))
      .finally(() => { running = false; });
  }, 60_000);
}
