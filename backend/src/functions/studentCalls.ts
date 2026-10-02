import { col } from "../db";
import { config } from "../config";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { isAdmin, visibleMentorIds, isStudentOf, studentsOf } from "../students/followups";
import { threecxConfigured, threecxFetch, threecxJson, threecxPost } from "../lib/threecx";
import {
  CALLS, BACKFILL_DAYS, LINK_TTL_S, getCallSettings, syncCalls, syncExtensions, recordingPath, recordingSource, recordingCount,
  callLogPath, groupRows, parseCall, studentsByPhone, phoneKey,
} from "../students/calls";

const DAY_MS = 86_400_000;
const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const who = (u: AuthUser) => u.full_name || u.email || "somebody";
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Calls `user` may see — Follow-ups' rule: admin roles all; Chief Mentor and
 * CS Manager calls with their people's students; anyone else their own
 * students' (Common ones too). Plus any call they took themselves.
 */
async function scopeFilter(user: AuthUser): Promise<Record<string, any> | null> {
  const visible = await visibleMentorIds(user);
  if (!visible) return null;
  const students = await col("students").find(studentsOf(visible), { projection: { _id: 1 } }).toArray();
  return { $or: [{ student_id: { $in: students.map((s: any) => String(s._id)) } }, { user_id: user.id }] };
}

async function canSeeCall(user: AuthUser, call: any): Promise<boolean> {
  const visible = await visibleMentorIds(user);
  if (!visible || call.user_id === user.id) return true;
  const s: any = await col("students").findOne({ _id: toObjectId(String(call.student_id)) as any }, { projection: { primary_mentor_id: 1, common_cs: 1 } });
  return !!s && isStudentOf(s, visible);
}

/** Who a call is counted under: the portal user, else the 3CX extension, else "-" (nobody took it). */
const personKey = (userId: string, extension: string) => (userId ? `u:${userId}` : extension ? `x:${extension}` : "-");
function personFilter(key: string): Record<string, any> | null {
  if (key === "-") return { user_id: "", extension: "" };
  if (key.startsWith("u:")) return { user_id: key.slice(2) };
  if (key.startsWith("x:")) return { user_id: "", extension: key.slice(2) };
  return null;
}

const row = (c: any) => ({
  id: String(c._id),
  started_at: c.started_at,
  direction: c.direction,
  status: c.status,
  talk_seconds: c.talk_seconds ?? 0,
  ring_seconds: c.ring_seconds ?? 0,
  number: c.number ?? "",
  extension: c.extension ?? "",
  agent_name: c.agent_name ?? "",
  user_id: c.user_id ?? "",
  user_name: c.user_name ?? "",
  person: personKey(c.user_id ?? "", c.extension ?? ""),
  student_id: c.student_id,
  student_name: c.student_name ?? "",
  student_code: c.student_code ?? "",
  recordings: recordingCount(c),
  reason: c.reason ?? "",
});

/** Midnight UAE time today, as a UTC timestamp. */
const uaeMidnight = () => {
  const d = new Date(Date.now() + 4 * 3_600_000);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - 4 * 3_600_000;
};

const count = (status: string) => ({ $sum: { $cond: [{ $eq: ["$status", status] }, 1, 0] } });

/**
 * POST /api/functions/getCalls
 * Body: { studentId } — that student's calls; or
 *       { range: "today"|"7"|"30"|"90", status?, direction?, person? } — calls in that period.
 * Returns: { calls (newest first, capped), total, truncated, stats, people, threecx, can_sync }
 * — stats and people cover every matching call, not only the ones listed.
 */
export async function getCalls(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const and: any[] = [];
  const scope = await scopeFilter(user);
  if (scope) and.push(scope);
  const studentId = str(body?.studentId, 40);
  let range: string | null = null;
  if (studentId) {
    and.push({ student_id: studentId });
  } else {
    range = ["today", "7", "30", "90"].includes(String(body?.range)) ? String(body.range) : "7";
    const since = range === "today" ? uaeMidnight() : Date.now() - Number(range) * DAY_MS;
    and.push({ started_at: { $gte: new Date(since).toISOString() } });
  }
  if (["answered", "missed", "no_answer"].includes(body?.status)) and.push({ status: body.status });
  if (["in", "out"].includes(body?.direction)) and.push({ direction: body.direction });
  const base = and.length ? { $and: and } : {};

  // Per person over everything matching (the person filter narrows the list and totals, not this table).
  const grouped = await col(CALLS).aggregate([
    { $match: base },
    {
      $group: {
        _id: { u: { $ifNull: ["$user_id", ""] }, x: { $ifNull: ["$extension", ""] } },
        user_name: { $first: "$user_name" },
        agent_name: { $first: "$agent_name" },
        calls: { $sum: 1 },
        answered: count("answered"),
        missed: count("missed"),
        no_answer: count("no_answer"),
        talk_seconds: { $sum: { $ifNull: ["$talk_seconds", 0] } },
        recorded: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ["$recording_ids", []] } }, 0] }, 1, 0] } },
      },
    },
  ]).toArray();
  const people = new Map<string, any>();
  for (const g of grouped as any[]) {
    const key = personKey(g._id.u, g._id.x);
    const p = people.get(key) ?? {
      key,
      user_id: g._id.u,
      extension: g._id.x,
      name: g.user_name || g.agent_name || (g._id.x ? `Ext ${g._id.x}` : "Nobody — not answered"),
      calls: 0, answered: 0, missed: 0, no_answer: 0, talk_seconds: 0, recorded: 0,
    };
    for (const k of ["calls", "answered", "missed", "no_answer", "talk_seconds", "recorded"]) p[k] += g[k] ?? 0;
    people.set(key, p);
  }

  const person = str(body?.person, 80);
  const onePerson = person ? personFilter(person) : null;
  const pick = onePerson ? [people.get(person)].filter(Boolean) : [...people.values()];
  const stats = { calls: 0, answered: 0, missed: 0, no_answer: 0, talk_seconds: 0, recorded: 0 } as Record<string, number>;
  for (const p of pick) for (const k of Object.keys(stats)) stats[k] += p[k] ?? 0;

  const limit = studentId ? 500 : 2000;
  const match = onePerson ? { $and: [...and, onePerson] } : base;
  const docs = await col(CALLS).find(match).sort({ started_at: -1 }).limit(limit).toArray();

  const s = await getCallSettings();
  return json({
    calls: docs.map(row),
    total: stats.calls,
    truncated: stats.calls > docs.length,
    stats,
    people: [...people.values()].sort((a, b) => b.calls - a.calls),
    range,
    threecx: {
      connected: threecxConfigured(),
      updated_at: s.last_ok_at ?? null,
      first_import_done: !!s.backfilled_at,
      running: !!(s.lock_until && Date.parse(s.lock_until) > Date.now()),
      backfill_days: BACKFILL_DAYS,
      // What went wrong, for admin roles only.
      error: isAdmin(user) ? s.last_error ?? null : null,
    },
    can_sync: user.app_role === "super_admin",
  });
}

/**
 * POST /api/functions/getCallRecording
 * Body: { callId, index? } → { url } — a link valid 10 minutes, for whoever may
 * see the call. Each one is noted in the audit log (who opened which recording).
 */
export async function getCallRecording(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(str(body?.callId, 40));
  if (!oid) return error("callId is required", 400);
  const index = Number.isInteger(Number(body?.index)) ? Number(body.index) : 0;
  const call: any = await col(CALLS).findOne({ _id: oid });
  if (!call) return notFound();
  if (!(await canSeeCall(user, call))) return forbidden();
  if (!recordingSource(call, index)) return error("No recording for this call", 404);
  await col("logs").insertOne({
    timestamp: new Date().toISOString(),
    user_id: user.id, user_email: user.email, user_name: user.full_name, user_role: user.app_role,
    action_type: "call_recording_opened",
    entity_type: "StudentCall",
    entity_id: String(call._id),
    details: JSON.stringify({ student: call.student_name, student_id: call.student_id, started_at: call.started_at, number: call.number, recording: index }),
    success: true,
  } as any);
  return json({ url: recordingPath(String(call._id), index, user.id), expires_in: LINK_TTL_S });
}

/** POST /api/functions/syncCallsNow — Super Admin: fetch new calls from 3CX now (the first import runs in the background). */
export async function syncCallsNow(_req: Request, user: AuthUser): Promise<Response> {
  if (user.app_role !== "super_admin") return forbidden();
  if (!threecxConfigured()) return error("3CX is not connected — set THREECX_URL, THREECX_CLIENT_ID and THREECX_API_KEY on the server", 400);
  const s = await getCallSettings();
  const firstImport = `The first import is running — ${BACKFILL_DAYS} days of calls. This can take a few minutes.`;
  if (s.lock_until && Date.parse(s.lock_until) > Date.now()) {
    return json({ started: true, message: s.backfilled_at ? "A sync is already running — new calls show in a minute." : firstImport });
  }
  await syncExtensions().catch(() => null); // failures show in "Test connection"
  if (!s.backfilled_at) {
    void syncCalls(who(user));
    return json({ started: true, message: firstImport });
  }
  const r = await syncCalls(who(user));
  return r.ok ? json(r) : error(r.error || r.skipped || "The sync failed", 400);
}

/**
 * POST /api/functions/testThreecx — Super Admin. Checks the connection step by
 * step (sign in, users and extensions, the last 24 hours of the call log, one
 * recording) and returns a few raw rows with how they were read.
 */
export async function testThreecx(_req: Request, user: AuthUser): Promise<Response> {
  if (user.app_role !== "super_admin") return forbidden();
  const steps: { name: string; ok: boolean; detail: string }[] = [];
  if (!threecxConfigured()) {
    return json({ ok: false, steps: [{ name: "Settings", ok: false, detail: "THREECX_URL, THREECX_CLIENT_ID and THREECX_API_KEY are not all set on the server" }] });
  }
  steps.push({ name: "Settings", ok: true, detail: `${config.threecx.url} · client ${config.threecx.clientId}` });

  try {
    const res = await threecxFetch("/xapi/v1/Defs?$select=Id", { timeoutMs: 30_000 });
    const version = res.headers.get("x-3cx-version") ?? "";
    await res.body?.cancel();
    steps.push({ name: "Sign in", ok: res.ok, detail: res.ok ? `Connected${version ? ` — 3CX ${version}` : ""}` : `HTTP ${res.status}` });
    if (!res.ok) return json({ ok: false, steps });
  } catch (err) {
    steps.push({ name: "Sign in", ok: false, detail: message(err) });
    return json({ ok: false, steps });
  }

  try {
    const r = await syncExtensions();
    steps.push({ name: "Extensions", ok: true, detail: `${r.threecx_users} 3CX users; ${r.matched} matched to portal users by email${r.updated ? `, ${r.updated} extension(s) filled in` : ""}` });
  } catch (err) {
    steps.push({ name: "Extensions", ok: false, detail: message(err) });
  }

  let sample: any[] = [];
  let parsed: any[] = [];
  try {
    const to = Date.now();
    const data = await threecxJson<{ value?: any[] }>(callLogPath(to - DAY_MS, to, 0, 200));
    const rows = Array.isArray(data?.value) ? data.value : [];
    const groups = groupRows(rows);
    const students = await studentsByPhone();
    const calls = groups.map((g) => parseCall(g, (k) => students.has(k))).filter((c): c is NonNullable<typeof c> => !!c);
    steps.push({
      name: "Call log",
      ok: true,
      detail: `${rows.length} rows in the last 24 hours → ${groups.length} calls, ${calls.length} with students (${calls.filter((c) => recordingCount(c)).length} recorded)`,
    });
    sample = rows.slice(0, 3);
    parsed = calls.slice(0, 5).map((c) => ({ ...c, student: students.get(c.number_key)?.full_name ?? null }));
  } catch (err) {
    steps.push({ name: "Call log", ok: false, detail: message(err) });
  }

  const recorded = parsed.find((c) => c.recording_ids?.length);
  if (recorded) {
    try {
      const res = await threecxFetch(`/xapi/v1/Recordings/Pbx.DownloadRecording(recId=${recorded.recording_ids[0]})`, { timeoutMs: 60_000, headers: { Range: "bytes=0-1023" } });
      await res.body?.cancel();
      steps.push({ name: "Recordings", ok: res.ok, detail: res.ok ? `A recording opened (${res.headers.get("content-type") || "audio"})` : `HTTP ${res.status}` });
    } catch (err) {
      steps.push({ name: "Recordings", ok: false, detail: message(err) });
    }
  } else {
    steps.push({ name: "Recordings", ok: true, detail: "No recorded call with a student in the last 24 hours to try" });
  }
  return json({ ok: steps.every((s) => s.ok), steps, sample, parsed });
}

/* ── The Call button: 3CX rings your own extension, then dials the student ── */

/** The caller's 3CX extension — typed on Personnel, or filled in from 3CX by email. */
async function extensionOf(user: AuthUser): Promise<string> {
  const oid = toObjectId(user.id);
  const me: any = oid ? await col("users").findOne({ _id: oid as any }, { projection: { extension: 1 } }) : null;
  return str(me?.extension, 10);
}

/**
 * POST /api/functions/getClickToCall — whether this person's Call buttons place the call through 3CX (their
 * extension is known and 3CX is connected); otherwise they stay a tel: link for the 3CX app.
 */
export async function getClickToCall(_req: Request, user: AuthUser): Promise<Response> {
  const extension = await extensionOf(user);
  return json({ enabled: threecxConfigured() && !!extension, extension });
}

/**
 * POST /api/functions/callStudent { studentId, dial } — the Call button. 3CX rings the caller's own extension
 * (whichever app or phone is signed in on it) and, once they answer, dials the student (Call Control makecall).
 * `dial` is the number the button shows, and must be one of the student's numbers. Whoever may see the student may
 * call them. The call itself reaches the Calls page with the 5-minute sync, like any other.
 */
export async function callStudent(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  if (!threecxConfigured()) return error("3CX is not connected on this server", 409);
  const extension = await extensionOf(user);
  if (!extension) return error("Your 3CX extension is not set — an admin adds it on Personnel", 409);
  const sid = toObjectId(str(body?.studentId, 40));
  if (!sid) return error("studentId is required", 400);
  const s: any = await col("students").findOne({ _id: sid as any }, { projection: { phone: 1, primary_mentor_id: 1, common_cs: 1 } });
  if (!s) return notFound();
  const visible = await visibleMentorIds(user);
  if (visible && !isStudentOf(s, visible)) return forbidden("You can call only students you can see");
  const dial = str(body?.dial, 24).replace(/[^\d+]/g, "");
  const theirs = new Set(String(s.phone ?? "").split(/[\n\r/,;|]+| - /).map(phoneKey).filter(Boolean));
  if (!/^\+?\d{7,15}$/.test(dial) || !theirs.has(phoneKey(dial))) return error("That number is not on this student", 400);

  const ext = encodeURIComponent(extension);
  try {
    // Something has to be signed in on the extension for 3CX to ring it.
    const state = await threecxFetch(`/callcontrol/${ext}`, { timeoutMs: 15_000 });
    if (!state.ok) {
      await state.body?.cancel();
      return error(state.status === 404 ? `3CX has no extension ${extension}`
        : state.status === 403 ? `3CX does not let the portal control extension ${extension} — check the API client's Call Control access in 3CX`
        : `3CX could not look up extension ${extension} (HTTP ${state.status})`, 502);
    }
    const dn: any = await state.json().catch(() => null);
    const devices = Array.isArray(dn?.devices) ? dn.devices : [];
    if (!devices.length) return error(`Nothing is signed in on your extension ${extension} — open your 3CX app (or desk phone) and try again`, 409);

    const res = await threecxPost(`/callcontrol/${ext}/makecall`, { destination: dial, timeout: 30 });
    const out: any = await res.json().catch(() => null);
    if (!res.ok || /fail/i.test(String(out?.finalstatus ?? ""))) {
      const said = String(out?.reasontext || out?.reason || "").trim();
      return error(`3CX could not place the call — ${res.status === 403 ? `the API client may not control extension ${extension}`
        : res.status === 424 ? "your 3CX app or phone did not answer 3CX" : said || `HTTP ${res.status}`}`, 502);
    }
    return json({ ok: true, extension, dial, ringing: devices.map((d: any) => String(d?.user_agent ?? "")).filter(Boolean), call_id: out?.result?.callid ?? null });
  } catch (err) {
    return error(message(err), 502);
  }
}
