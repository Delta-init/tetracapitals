import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Makes the TV boards' voice (the user, 2026-10-26: their own voice, from their recordings) — an ElevenLabs Instant
 * Voice Clone — and prints its id for ELEVENLABS_VOICE_ID (lib/voice.ts).
 *
 * The more clean speech the better: a minute or more, one person, no music, in a quiet room — several files are
 * fine. A WhatsApp voice note (.ogg / .opus) is turned into MP3 first (needs ffmpeg).
 *
 *   cd backend
 *   ELEVENLABS_API_KEY=… bun src/scripts/make-voice.ts --name="Delta TV voice" <file> [<file> …]
 *   bun src/scripts/make-voice.ts --say="Payment collected by Haritha, for 2,000 dirhams. Congratulations!" --out=~/Downloads/try.mp3
 *       (with ELEVENLABS_VOICE_ID set too: hear a line in the voice before the boards use it)
 *
 * The key is read from the environment (or this folder's .env) — never written anywhere by this script.
 */

const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const key = process.env.ELEVENLABS_API_KEY;
if (!key) { console.log("Set ELEVENLABS_API_KEY first (your ElevenLabs account → Profile → API key)."); process.exit(1); }

const say = option("say");
if (say) {
  const voice = process.env.ELEVENLABS_VOICE_ID;
  const out = (option("out") ?? "voice-try.mp3").replace(/^~/, process.env.HOME ?? "~");
  if (!voice) { console.log("Set ELEVENLABS_VOICE_ID (printed when the voice was made)."); process.exit(1); }
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST", headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ text: say, model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2", voice_settings: { stability: 0.45, similarity_boost: 0.85, style: 0.35, use_speaker_boost: true } }),
  });
  if (!res.ok) { console.log(`ElevenLabs answered ${res.status}: ${await res.text()}`); process.exit(1); }
  await Bun.write(out, await res.arrayBuffer());
  console.log(`Saved ${out}`);
  process.exit(0);
}

const files = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((f) => f.replace(/^~/, process.env.HOME ?? "~"));
if (!files.length) { console.log("Give one or more recordings of your voice."); process.exit(1); }
const work = mkdtempSync(join(tmpdir(), "voice-"));
try {
  const form = new FormData();
  form.append("name", option("name") ?? "Delta TV voice");
  form.append("description", "The TV boards' announcer — the owner's own voice");
  for (const f of files) {
    if (!existsSync(f)) { console.log(`No file: ${f}`); process.exit(1); }
    let path = f;
    if ([".ogg", ".opus", ".oga", ".webm", ".aac", ".amr"].includes(extname(f).toLowerCase())) {
      path = join(work, `${basename(f, extname(f))}.mp3`);
      const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", f, "-ac", "1", "-ar", "44100", "-b:a", "192k", path]);
      if (r.status !== 0) { console.log(`Couldn't turn ${f} into MP3 (is ffmpeg installed?): ${r.stderr?.toString()}`); process.exit(1); }
    }
    form.append("files", new Blob([readFileSync(path)], { type: "audio/mpeg" }), basename(path));
  }
  const res = await fetch("https://api.elevenlabs.io/v1/voices/add", { method: "POST", headers: { "xi-api-key": key }, body: form });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) { console.log(`ElevenLabs answered ${res.status}: ${JSON.stringify(body)}`); process.exit(1); }
  console.log(`Voice made: ${body.voice_id}`);
  console.log("On the API server, set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID=" + body.voice_id + " and restart it.");
} finally {
  rmSync(work, { recursive: true, force: true });
}
