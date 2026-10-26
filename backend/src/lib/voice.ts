import { createHash } from "node:crypto";
import { Binary } from "mongodb";
import { col } from "../db";

/* ────────────────────────────────────────────────────────────────────────────
   A voice of our own for the TV boards (the user, 2026-10-26: "generate voice
   from this, instead of the AI voice, in the same voice, for every close — it
   is my voice"): ElevenLabs text-to-speech in a voice cloned once from the
   user's own recordings (scripts/make-voice.ts prints its id).

     ELEVENLABS_API_KEY   the account's key — on the server only
     ELEVENLABS_VOICE_ID  the cloned voice
     ELEVENLABS_MODEL     optional, eleven_multilingual_v2 by default

   Unset: no voice here, and the boards keep the browser's own. Each line is
   made once and kept (tv_voice_cache, 60 days), so a close shown on ten
   screens is paid for once.
──────────────────────────────────────────────────────────────────────────── */

const CACHE = "tv_voice_cache";
const KEEP_MS = 60 * 86_400_000;
const MAX_CHARS = 400;

export const voiceConfigured = () => !!(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID);

let indexed = false;
async function ensureIndex() {
  if (indexed) return;
  indexed = true;
  await col(CACHE).createIndex({ created_at: 1 }, { expireAfterSeconds: Math.round(KEEP_MS / 1000) }).catch(() => { indexed = false; });
}

/** The line spoken in the voice, as MP3 — from the cache, else made now (and kept). Throws when it can't be made. */
export async function voiceMp3(text: string): Promise<Buffer> {
  const line = text.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  if (!line) throw new Error("Nothing to say");
  if (!voiceConfigured()) throw new Error("No voice on this server (ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID)");
  const voiceId = String(process.env.ELEVENLABS_VOICE_ID);
  const model = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
  const id = createHash("sha256").update(`${voiceId}|${model}|${line}`).digest("hex");
  await ensureIndex();
  const had: any = await col(CACHE).findOne({ _id: id } as any);
  if (had?.mp3) return Buffer.from(had.mp3.buffer ?? had.mp3);

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": String(process.env.ELEVENLABS_API_KEY), "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text: line, model_id: model, voice_settings: { stability: 0.45, similarity_boost: 0.85, style: 0.35, use_speaker_boost: true } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`ElevenLabs answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const mp3 = Buffer.from(await res.arrayBuffer());
  await col(CACHE).updateOne({ _id: id } as any, { $set: { text: line, mp3: new Binary(mp3), created_at: new Date() } }, { upsert: true }).catch(() => {});
  return mp3;
}
