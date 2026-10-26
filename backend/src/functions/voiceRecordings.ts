import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { loadTeams } from "../students/teams";
import { r2Configured, r2Delete, r2Put } from "../lib/r2";
import { csLine, courseLine, amountLine, CONGRATS, ROUND_AED, VOICE_KEY, type VoiceLine } from "../lib/voiceLines";

/* ────────────────────────────────────────────────────────────────────────────
   The TV board's voice, recorded by the owner (the user, 2026-10-26: "own
   Malayalam recordings, stored in R2"): each line — who collected it, the
   course, an amount, "Congratulations" — recorded once on the Voice
   recordings page (pages/VoiceRecordings.jsx), kept in R2 under
   portal/tv-voice/, listed in tv_voice_clips (key, prompt, url, mime, who
   and when). The board plays them one after another for each payment
   (functions/csTv.ts handleCsTvVoicePlan). Super Admins only.
──────────────────────────────────────────────────────────────────────────── */

const CLIPS = "tv_voice_clips";
const MAX_BYTES = 3 * 1024 * 1024;
const INR_PER_AED = 1 / (3.67 * 0.01);
const EXT: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/aac": "aac" };

/** Every line the board may need: each CS on it, each course paid or on the Products page, round and paid amounts, the close. */
export async function allVoiceLines(): Promise<VoiceLine[]> {
  const teams = await loadTeams();
  const people = (await col("users").find({ app_role: "cs", status: { $ne: "inactive" }, email: { $not: /@deltatest\.dev$/i } }, { projection: { full_name: 1 } }).toArray()) as any[];
  const since = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const paid = (await col("funding_transactions").find(
    { type: "BONUS", status: "APPROVED", bonus_credit: { $in: [null, ""] }, "course_payment.product": { $exists: true }, approved_at: { $gte: since } },
    { projection: { course_payment: 1, amount_aed: 1, initiating_mentor_id: 1, requested_by_id: 1 } },
  ).toArray()) as any[];
  const products = (await col("transaction_tags").find({ active: { $ne: false } }, { projection: { name: 1, bonus_usd: 1 } }).toArray()) as any[];

  const lines = new Map<string, VoiceLine>();
  const add = (l: VoiceLine) => { if (!lines.has(l.key)) lines.set(l.key, l); };
  for (const u of people) add(csLine(String(u._id), String(u.full_name ?? ""), teams.teamOf(String(u._id))?.name));
  for (const t of paid) if (t.course_payment?.product) add(courseLine(String(t.course_payment.product)));
  for (const p of products) if (Number(p.bonus_usd) > 0 && p.name) add(courseLine(String(p.name)));
  for (const a of ROUND_AED) add(amountLine(a, "AED"));
  for (const t of paid) {
    const aed = Math.round(Number(t.course_payment?.paid_today_aed) || Number(t.amount_aed) || 0);
    if (aed <= 0) continue;
    const by = String(t.initiating_mentor_id || t.requested_by_id || "");
    if ((teams.teamOf(by)?.location ?? "dubai") === "bangalore") add(amountLine(Math.round(aed * INR_PER_AED), "INR"));
    else add(amountLine(aed, "AED"));
  }
  add(CONGRATS);
  return [...lines.values()];
}

const view = (c: any) => (c?.url ? { url: c.url, mime: c.mime ?? "", at: c.recorded_at ?? null, by: c.recorded_by_name ?? "" } : null);

/** POST /api/functions/getVoiceRecordings → { ready, lines: [{ key, prompt, text, group, recording }] } */
export async function getVoiceRecordings(_req: Request, user: AuthUser): Promise<Response> {
  if (user.app_role !== "super_admin") return forbidden();
  const lines = await allVoiceLines();
  const clips = new Map(((await col(CLIPS).find({}, { projection: { mp3: 0 } }).toArray()) as any[]).map((c) => [String(c._id), c]));
  return json({
    ready: r2Configured(),
    lines: lines.map((l) => ({ key: l.key, prompt: l.prompt ?? l.text, text: l.text, group: l.group ?? "close", recording: view(clips.get(l.key)) })),
  });
}

/** POST /api/functions/saveVoiceRecording { key, audio: base64, mime } → { recording } — kept in R2, the one before it removed. */
export async function saveVoiceRecording(req: Request, user: AuthUser): Promise<Response> {
  if (user.app_role !== "super_admin") return forbidden();
  if (!r2Configured()) return error("R2 isn't set up on this server yet (R2_* settings) — recordings can't be kept", 503);
  const body: any = await req.json().catch(() => ({}));
  const key = String(body?.key ?? "");
  if (!VOICE_KEY.test(key)) return error("Not a line the board says", 400);
  const mime = String(body?.mime ?? "").split(";")[0]!.trim().toLowerCase();
  const ext = EXT[mime];
  if (!ext) return error("That recording format isn't one the TV can play", 400);
  const bytes = Buffer.from(String(body?.audio ?? ""), "base64");
  if (bytes.length < 1000) return error("The recording is empty — record it again", 400);
  if (bytes.length > MAX_BYTES) return error("The recording is too long — keep each line under a minute", 400);

  const had: any = await col(CLIPS).findOne({ _id: key } as any, { projection: { r2_key: 1 } });
  const r2Key = `tv-voice/${key.replace(/[^A-Za-z0-9]/g, "-")}-${Date.now()}.${ext}`;
  let url: string;
  try {
    url = await r2Put(r2Key, new Uint8Array(bytes), mime);
  } catch (err) {
    console.error("[voice] R2 upload", err);
    return error(`R2 refused it: ${err instanceof Error ? err.message : "unknown"}`, 502);
  }
  const line = (await allVoiceLines()).find((l) => l.key === key);
  const now = new Date().toISOString();
  await col(CLIPS).updateOne({ _id: key } as any, {
    $set: { prompt: line?.prompt ?? "", text: line?.text ?? "", r2_key: r2Key, url, mime, bytes: bytes.length, recorded_at: now, recorded_by: user.id, recorded_by_name: user.full_name ?? "" },
    $unset: { mp3: "" },
  }, { upsert: true });
  if (had?.r2_key && had.r2_key !== r2Key) await r2Delete(had.r2_key);
  return json({ recording: { url, mime, at: now, by: user.full_name ?? "" } });
}

/** POST /api/functions/deleteVoiceRecording { key } → { ok } — the board says that line with the browser's voice again. */
export async function deleteVoiceRecording(req: Request, user: AuthUser): Promise<Response> {
  if (user.app_role !== "super_admin") return forbidden();
  const key = String(((await req.json().catch(() => ({}))) as any)?.key ?? "");
  if (!VOICE_KEY.test(key)) return error("Not a line the board says", 400);
  const had: any = await col(CLIPS).findOneAndDelete({ _id: key } as any);
  const doc = (had as any)?.value ?? had;
  if (doc?.r2_key) await r2Delete(doc.r2_key);
  return json({ ok: true });
}
