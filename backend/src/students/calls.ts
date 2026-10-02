import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { col } from "../db";
import { config } from "../config";
import { toObjectId } from "../lib/id";
import { threecxConfigured, threecxFetch, threecxJson } from "../lib/threecx";

/* ────────────────────────────────────────────────────────────────────────────
   Calls with students, from 3CX.

   Every minute the 3CX call log (the report behind 3CX's own Call
   History) is read for the last few hours, and every call between a
   student's number and the phone system is kept in `student_calls`: when,
   in / out, answered or missed, who took it (3CX extension), ringing and
   talking time, and its recordings. Calls with numbers that aren't
   students are ignored. The first run reaches 90 days back.

   Recordings are never copied: they play from 3CX through the backend on a
   short-lived signed link, so the 3CX key never reaches a browser.

   Who took a call = the portal user whose `extension` is that 3CX
   extension. Extensions are filled in from 3CX's users by email; one typed
   on Personnel (extension_source "manual") is never overwritten.
──────────────────────────────────────────────────────────────────────────── */

const SETTINGS_ID = "threecx_calls";
export const CALLS = "student_calls";
const DAY_MS = 86_400_000;
export const BACKFILL_DAYS = 90;
const OVERLAP_MS = 3 * 3_600_000;      // a call is logged when it ends — look back far enough for long ones
const PAGE = 500;
const TICK_MS = 60_000;                  // every minute, so a call shows on the Calls page soon after it ends
/** How 3CX's rows are read into calls; when it changes, the next run reads the 90 days again (calls are keyed, so none
 *  is kept twice). 2 — a call is the rows sharing its call history id, its main row the lowest Indent (V20 sends 1). */
const PARSER = 2;
const LOCK_MS = 15 * 60_000;
const EXTENSIONS_EVERY_MS = 6 * 3_600_000;
export const LINK_TTL_S = 10 * 60;
const iso = () => new Date().toISOString();

/* ── settings + a lock, so two servers never sync at once ────────────────── */

export async function getCallSettings(): Promise<Record<string, any>> {
  const doc: any = await col("app_settings").findOne({ _id: SETTINGS_ID } as any);
  const { _id, ...rest } = doc ?? {};
  return rest;
}

async function saveSettings(patch: Record<string, unknown>) {
  await col("app_settings").updateOne({ _id: SETTINGS_ID } as any, { $set: patch }, { upsert: true });
}

async function takeLock(): Promise<boolean> {
  try {
    const res = await col("app_settings").updateOne(
      { _id: SETTINGS_ID, $or: [{ lock_until: null }, { lock_until: { $lt: iso() } }] } as any,
      { $set: { lock_until: new Date(Date.now() + LOCK_MS).toISOString() } },
      { upsert: true },
    );
    return res.modifiedCount === 1 || res.upsertedCount === 1;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false; // held by another run
    throw err;
  }
}
const extendLock = () => saveSettings({ lock_until: new Date(Date.now() + LOCK_MS).toISOString() });
const releaseLock = () => saveSettings({ lock_until: null });

/* ── reading 3CX's rows ──────────────────────────────────────────────────── */

/** ISO 8601 duration ("PT1M23.5S") or a TimeSpan ("00:01:23") → whole seconds. */
export function durationSeconds(v: unknown): number {
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const p = s.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (p) return Math.round((Number(p[1] || 0) * 7 + Number(p[2] || 0)) * 86400 + Number(p[3] || 0) * 3600 + Number(p[4] || 0) * 60 + Number(p[5] || 0));
  const t = s.match(/^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
  if (t) return Number(t[1] || 0) * 86400 + Number(t[2]) * 3600 + Number(t[3]) * 60 + Number(t[4]);
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** The last 9 digits of a number — how 3CX numbers are matched to students (country codes vary). */
export function phoneKey(raw: unknown): string {
  const d = String(raw ?? "").replace(/\D/g, "").replace(/^00/, "");
  return d.length >= 7 ? d.slice(-9) : "";
}

interface Side { dn: string; number: string; key: string; name: string }

/** One end of a row: its DN, a real phone number if it has one (caller ID first), its name. */
function sideOf(row: any, which: "Source" | "Destination"): Side {
  const dn = String(row?.[`${which}Dn`] ?? "").trim();
  const callerId = String(row?.[`${which}CallerId`] ?? "").trim();
  const number = [callerId, dn].find((v) => phoneKey(v)) ?? "";
  return { dn, number, key: phoneKey(number), name: String(row?.[`${which}DisplayName`] ?? "").trim() };
}

const indent = (r: any) => Number(r?.Indent) || 0;
const text = (v: unknown) => (v === undefined || v === null ? "" : String(v));

/**
 * Rows → calls: the rows of one call share its call history id (MainCallHistoryId). Which of them is the main row
 * is the call's own business (parseCall): 3CX V20 sends Indent 1 on every row, older versions 0 on the main one. A
 * row without that id stands alone — CallId cannot join them (V20 has given every row CallId 1).
 */
export function groupRows(rows: any[]): any[][] {
  const calls = new Map<string, any[]>();
  const alone: any[][] = [];
  for (const r of rows) {
    const k = text(r?.MainCallHistoryId) || text(r?.CallHistoryId);
    if (!k) { alone.push([r]); continue; }
    calls.set(k, [...(calls.get(k) ?? []), r]);
  }
  return [...calls.values(), ...alone];
}

export interface ParsedCall {
  key: string;
  call_id: string;
  segment_id: string;
  started_at: string;
  direction: "in" | "out";
  status: "answered" | "missed" | "no_answer";
  answered: boolean;
  talk_seconds: number;
  ring_seconds: number;
  number: string;
  number_key: string;
  extension: string;
  agent_name: string;
  recording_ids: number[];
  recording_url: string;
  reason: string;
  rows: number;
}

/**
 * One call (its rows) → what we keep, when one end of it is a student's
 * number (`isStudent`); null otherwise. The student's end is found by its
 * number, not by 3CX's DN type codes: extensions and trunks have short
 * numbers and never match.
 */
export function parseCall(group: any[], isStudent: (numberKey: string) => boolean): ParsedCall | null {
  // The main row: the lowest Indent (V20: 1 on every row; older: 0), the earliest of those.
  const top = Math.min(...group.map(indent));
  const main = group.filter((r) => indent(r) === top).sort((a, b) => text(a?.StartTime).localeCompare(text(b?.StartTime)))[0] ?? group[0];
  const started = Date.parse(String(main?.StartTime ?? ""));
  if (!main || !Number.isFinite(started)) return null;
  const src = sideOf(main, "Source");
  const dst = sideOf(main, "Destination");
  const inbound = !!src.key && isStudent(src.key);
  if (!inbound && !(dst.key && isStudent(dst.key))) return null;
  const student = inbound ? src : dst;

  // Who took it: an extension on a row that talked (a queue call is answered on a row under the main one) —
  // the far end first; never the student's own end.
  const order = inbound ? (["Destination", "Source"] as const) : (["Source", "Destination"] as const);
  const extOf = (r: any): Side | null => {
    for (const which of order) {
      const s = sideOf(r, which);
      if (/^\d{2,6}$/.test(s.dn) && s.key !== student.key) return s;
    }
    return null;
  };
  const talked = group.filter((r) => r?.Answered === true && durationSeconds(r?.TalkingDuration) > 0);
  const answered = talked.length > 0 || main.Answered === true;
  // Rows under the main one first: the main row of a queue call names the queue, not who answered.
  const taker = [...talked.filter((r) => indent(r) > top), ...talked.filter((r) => indent(r) === top)].map(extOf).find(Boolean) ?? extOf(main);

  const recording_ids = [...new Set(group.flatMap((r) => [r?.SrcRecId, r?.DstRecId]).map(Number))].filter((n) => Number.isInteger(n) && n > 0);
  const recording_url = String(group.map((r) => r?.RecordingUrl).find((u) => typeof u === "string" && u) ?? "");
  // The call's own id — its call history id. (Not SegmentId: 3CX V20 sends 1 on every row, so every call would be one.)
  const historyId = text(main.MainCallHistoryId) || text(main.CallHistoryId);
  const key = historyId
    ? `call:${historyId}`
    : `h:${createHash("sha1").update([main.StartTime, main.SourceDn, main.SourceCallerId, main.DestinationDn, main.DestinationCallerId].join("|")).digest("hex")}`;

  return {
    key,
    call_id: String(main.CallId ?? ""),
    segment_id: String(main.SegmentId ?? ""),
    started_at: new Date(started).toISOString(),
    direction: inbound ? "in" : "out",
    status: answered ? "answered" : inbound ? "missed" : "no_answer",
    answered,
    talk_seconds: Math.max(0, ...group.map((r) => durationSeconds(r?.TalkingDuration))),
    ring_seconds: durationSeconds(main.RingingDuration),
    number: student.number,
    number_key: student.key,
    extension: taker?.dn ?? "",
    agent_name: taker?.name ?? (inbound ? dst.name : src.name),
    recording_ids,
    recording_url,
    reason: String(main.Reason ?? ""),
    rows: group.length,
  };
}

const stamp = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** The call log report for [from, to), one page. */
export const callLogPath = (from: number, to: number, skip: number, top = PAGE) =>
  `/xapi/v1/ReportCallLogData/Pbx.GetCallLogData(periodFrom=${stamp(from)},periodTo=${stamp(to)},sourceType=0,sourceFilter='',destinationType=0,destinationFilter='',callsType=0,callTimeFilterType=0,callTimeFilterFrom='0:00:0',callTimeFilterTo='0:00:0',hidePcalls=false)?$orderby=StartTime%20asc&$skip=${skip}&$top=${top}`;

async function fetchWindow(from: number, to: number): Promise<any[]> {
  const rows: any[] = [];
  for (let skip = 0; skip < 500_000; skip += PAGE) {
    const data = await threecxJson<{ value?: any[] }>(callLogPath(from, to, skip));
    const page = Array.isArray(data?.value) ? data.value : [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

/* ── matching ────────────────────────────────────────────────────────────── */

export async function studentsByPhone(): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  const students = col("students").find(
    { phone: { $nin: [null, ""] } },
    { projection: { full_name: 1, student_code: 1, phone: 1, primary_mentor_id: 1 } },
  );
  for await (const s of students) {
    const k = phoneKey((s as any).phone);
    if (k && !map.has(k)) map.set(k, s);
  }
  return map;
}

async function usersByExtension(): Promise<Map<string, any>> {
  const users = await col("users").find({ extension: { $nin: [null, ""] } }, { projection: { full_name: 1, extension: 1 } }).toArray();
  return new Map(users.map((u: any) => [String(u.extension).trim(), u]));
}

/** Calls nobody was matched to yet get their person once that person's extension is known (history is never re-assigned). */
async function linkUnmatchedCalls(users: Map<string, any>) {
  for (const [ext, u] of users) {
    await col(CALLS).updateMany({ extension: ext, user_id: "" }, { $set: { user_id: String(u._id), user_name: String(u.full_name ?? "") } });
  }
}

/** 3CX's users → portal users with the same email get that extension (never over a manual one). */
export async function syncExtensions(): Promise<{ threecx_users: number; matched: number; updated: number }> {
  const all: any[] = [];
  for (let skip = 0; skip < 20_000; skip += 100) {
    const data = await threecxJson<{ value?: any[] }>(`/xapi/v1/Users?$select=Id,FirstName,LastName,Number,EmailAddress&$orderby=Number&$top=100&$skip=${skip}`);
    const page = Array.isArray(data?.value) ? data.value : [];
    all.push(...page);
    if (page.length < 100) break;
  }
  const byEmail = new Map(
    all.filter((u) => u?.EmailAddress && u?.Number).map((u) => [String(u.EmailAddress).trim().toLowerCase(), u]),
  );
  const users = (await col("users").find({}, { projection: { email: 1, extension: 1, extension_source: 1 } }).toArray()) as any[];
  let matched = 0;
  let updated = 0;
  for (const u of users) {
    const t = byEmail.get(String(u.email ?? "").trim().toLowerCase());
    if (!t) continue;
    matched++;
    if (u.extension_source === "manual") continue;
    const ext = String(t.Number).trim();
    if (String(u.extension ?? "") === ext) continue;
    await col("users").updateOne({ _id: u._id }, { $set: { extension: ext, extension_source: "3cx", updated_date: iso() } });
    updated++;
  }
  const out = { threecx_users: all.length, matched, updated };
  await saveSettings({ extensions_synced_at: iso(), extensions: out });
  return out;
}

/* ── the sync ────────────────────────────────────────────────────────────── */

export interface SyncSummary {
  ok: boolean;
  skipped?: string;
  error?: string;
  from?: string;
  to?: string;
  windows: number;
  rows: number;
  calls: number;
  inserted: number;
  updated: number;
}

async function syncWindow(from: number, to: number, students: Map<string, any>, users: Map<string, any>, now: string) {
  const rows = await fetchWindow(from, to);
  const ops: any[] = [];
  for (const group of groupRows(rows)) {
    const c = parseCall(group, (k) => students.has(k));
    const s = c ? students.get(c.number_key) : null;
    if (!c || !s) continue; // not a call with a student
    const u = c.extension ? users.get(c.extension) : null;
    ops.push({
      updateOne: {
        filter: { key: c.key },
        update: {
          $set: {
            ...c,
            student_id: String(s._id),
            student_name: String(s.full_name ?? "").trim(),
            student_code: String(s.student_code ?? ""),
            mentor_id: String(s.primary_mentor_id ?? ""),
            user_id: u ? String(u._id) : "",
            user_name: u ? String(u.full_name ?? "") : "",
            synced_at: now,
          },
          $setOnInsert: { created_at: now },
        },
        upsert: true,
      },
    });
  }
  let inserted = 0;
  let updated = 0;
  if (ops.length) {
    const r = await col(CALLS).bulkWrite(ops, { ordered: false });
    inserted = r.upsertedCount;
    updated = r.modifiedCount;
  }
  return { rows: rows.length, calls: ops.length, inserted, updated };
}

/**
 * Bring `student_calls` up to date: from where the last run got to (less a
 * few hours, for calls that were still going), or 90 days back the first
 * time — a day at a time, noting progress so a failed run resumes.
 */
export async function syncCalls(by = "Schedule"): Promise<SyncSummary> {
  const sum: SyncSummary = { ok: true, windows: 0, rows: 0, calls: 0, inserted: 0, updated: 0 };
  if (!threecxConfigured()) return { ...sum, ok: false, skipped: "3CX is not connected" };
  if (!(await takeLock())) return { ...sum, ok: false, skipped: "A sync is already running" };
  const now = iso();
  try {
    const s = await getCallSettings();
    if (!s.extensions_synced_at || Date.now() - Date.parse(s.extensions_synced_at) > EXTENSIONS_EVERY_MS) {
      await syncExtensions().catch((err) => saveSettings({ extensions_error: { at: iso(), message: err instanceof Error ? err.message : String(err) } }));
    }
    const [students, users] = await Promise.all([studentsByPhone(), usersByExtension()]);
    await linkUnmatchedCalls(users);

    // Rows read a new way since the last run: the 90 days again, from the start (progress is kept as it goes, so a
    // run that stops resumes; the Calls page says the import is running until it is done).
    if (s.parser !== PARSER) {
      await saveSettings({ parser: PARSER, synced_to: null, backfilled_at: null });
      Object.assign(s, { parser: PARSER, synced_to: null, backfilled_at: null });
    }
    const to = Date.now();
    const from = s.synced_to ? Math.max(Date.parse(s.synced_to) - OVERLAP_MS, to - BACKFILL_DAYS * DAY_MS) : to - BACKFILL_DAYS * DAY_MS;
    sum.from = new Date(from).toISOString();
    sum.to = new Date(to).toISOString();
    for (let a = from; a < to; a += DAY_MS) {
      const b = Math.min(a + DAY_MS, to);
      const r = await syncWindow(a, b, students, users, now);
      sum.windows++;
      sum.rows += r.rows;
      sum.calls += r.calls;
      sum.inserted += r.inserted;
      sum.updated += r.updated;
      await saveSettings({ synced_to: new Date(b).toISOString() });
      await extendLock();
    }
    await saveSettings({
      last_run: { ...sum, at: iso(), by },
      last_ok_at: iso(),
      last_error: null,
      ...(s.backfilled_at ? {} : { backfilled_at: iso() }),
    });
  } catch (err) {
    sum.ok = false;
    sum.error = err instanceof Error ? err.message : String(err);
    await saveSettings({ last_run: { ...sum, at: iso(), by }, last_error: { at: iso(), message: sum.error } });
  } finally {
    await releaseLock();
  }
  return sum;
}

/** Every minute, when 3CX is connected. */
export function startCallSyncWorker(): void {
  if (!threecxConfigured()) {
    console.log("[calls] 3CX not connected — no call sync (THREECX_URL / THREECX_CLIENT_ID / THREECX_API_KEY)");
    return;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await syncCalls();
      if (r.error) console.error(`[calls] sync failed: ${r.error}`);
      else if (r.inserted) console.log(`[calls] ${r.inserted} new call(s) with students`);
    } catch (err) {
      console.error("[calls] sync failed", err);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void tick(), 2 * 60_000);
  setInterval(() => void tick(), TICK_MS);
}

/* ── recordings: short-lived signed links, played through the backend ────── */

const sign = (payload: string) => createHmac("sha256", `${config.jwtSecret}|call-recordings`).update(payload).digest("base64url");

/** The path a browser plays recording `index` of call `callId` from (valid 10 minutes, for `userId`). */
export function recordingPath(callId: string, index: number, userId: string): string {
  const exp = Math.floor(Date.now() / 1000) + LINK_TTL_S;
  const q = new URLSearchParams({ c: callId, i: String(index), e: String(exp), u: userId, s: sign(`${callId}.${index}.${exp}.${userId}`) });
  return `/api/calls/recording?${q}`;
}

export function checkRecordingLink(params: URLSearchParams): { callId: string; index: number; userId: string } | null {
  const c = params.get("c") ?? "";
  const i = params.get("i") ?? "";
  const e = params.get("e") ?? "";
  const u = params.get("u") ?? "";
  const s = params.get("s") ?? "";
  if (!/^[a-f0-9]{24}$/.test(c) || !/^\d{1,2}$/.test(i) || !/^\d{9,11}$/.test(e) || !s) return null;
  if (Number(e) < Date.now() / 1000) return null;
  const want = Buffer.from(sign(`${c}.${i}.${e}.${u}`));
  const got = Buffer.from(s);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return { callId: c, index: Number(i), userId: u };
}

/**
 * Where on 3CX recording `index` of `call` is; "" if none. By recording id;
 * RecordingUrl only when it is a path on the configured 3CX (usually it is
 * just the file name, which can't be fetched).
 */
export function recordingSource(call: any, index: number): string {
  const id = Number(call?.recording_ids?.[index]);
  if (Number.isInteger(id) && id > 0) return `/xapi/v1/Recordings/Pbx.DownloadRecording(recId=${id})`;
  const url = String(call?.recording_url ?? "");
  if (index !== 0 || !url) return "";
  if (url.startsWith("/")) return url;
  if (config.threecx.url && url.startsWith(`${config.threecx.url}/`)) return url.slice(config.threecx.url.length);
  return "";
}

/** How many recordings of `call` can be played. */
export const recordingCount = (call: any): number => call?.recording_ids?.length || (recordingSource(call, 0) ? 1 : 0);

const AUDIO_TYPES: Record<string, string> = { wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg", opus: "audio/ogg", m4a: "audio/mp4", webm: "audio/webm" };

/** GET /api/calls/recording?… — the audio, streamed from 3CX (range requests pass through, so it can be scrubbed). */
export async function streamRecording(req: Request, url: URL): Promise<Response> {
  const link = checkRecordingLink(url.searchParams);
  if (!link) return new Response("This recording link has expired — play it again from the portal.", { status: 403 });
  const call: any = await col(CALLS).findOne({ _id: toObjectId(link.callId) as any });
  const path = recordingSource(call, link.index);
  if (!path) return new Response("No recording", { status: 404 });
  const range = req.headers.get("range");
  let res: Response;
  try {
    res = await threecxFetch(path, { timeoutMs: 180_000, headers: range ? { Range: range } : {} });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "3CX did not answer", { status: 502 });
  }
  if (!res.ok) return new Response(`3CX could not give the recording (HTTP ${res.status})`, { status: 502 });
  const given = res.headers.get("content-type") ?? "";
  const file = (res.headers.get("content-disposition") ?? "").match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1] ?? "";
  const ext = (file.split(".").pop() ?? "").toLowerCase();
  const type = given.startsWith("audio/") ? given : AUDIO_TYPES[ext] ?? "audio/wav";
  const headers = new Headers({
    "Content-Type": type,
    "Cache-Control": "private, max-age=600",
    "Content-Disposition": `inline; filename="call-${link.callId}.${AUDIO_TYPES[ext] ? ext : "wav"}"`,
  });
  for (const h of ["content-length", "content-range", "accept-ranges"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers });
}
