import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Binary } from "mongodb";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";
import { loadTeams } from "../students/teams";
import { csLine, courseLine, amountLine, CONGRATS, ROUND_AED, type VoiceLine } from "../lib/voiceLines";

/**
 * The TV board's lines in the owner's own voice, made ahead (the user, 2026-10-26 — lib/voiceLines.ts):
 *
 *   list    every line to record → a JSON file for the Colab notebook (backend/voice/chatterbox_tv_voice.ipynb):
 *           each CS on the board ("Payment collected by Haritha, in Team Money Heist!"), each course paid in the
 *           last 180 days or on the Products page, every 500 dirhams to 50,000, the amounts actually paid in the
 *           last 180 days (in rupees too for Bangalore), and "Congratulations!". Read only.
 *   upload  the notebook's recordings (its unzipped folder: manifest.json + MP3s) into the portal (tv_voice_clips) —
 *           the board plays them from then on. Each recording replaces the one with its key.
 *   missing what the board would need that isn't recorded yet (a new CS, a new course) → a JSON file to record next.
 *
 *   cd backend
 *   bun src/scripts/voice-clips.ts list --out=~/voice-lines.json
 *   bun src/scripts/voice-clips.ts upload --dir=~/Downloads/tv_voice_clips
 *   bun src/scripts/voice-clips.ts missing --out=~/voice-lines-new.json
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env).
 */

const mode = process.argv[2];
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)?.replace(/^~/, process.env.HOME ?? "~");
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const INR_PER_AED = 1 / (3.67 * 0.01);

async function allLines(): Promise<VoiceLine[]> {
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

await connectDb();
console.log(`${host}/${config.mongoDb}`);
try {
  if (mode === "list" || mode === "missing") {
    const out = option("out");
    if (!out) { console.log("Give --out=<file.json>"); process.exit(1); }
    let lines = await allLines();
    if (mode === "missing") {
      const have = new Set(((await col("tv_voice_clips").find({}, { projection: { _id: 1, text: 1 } }).toArray()) as any[]).map((c) => `${c._id}|${c.text}`));
      lines = lines.filter((l) => !have.has(`${l.key}|${l.text}`));
    }
    writeFileSync(out, JSON.stringify({ made_at: new Date().toISOString(), lines }, null, 1));
    const by = (p: string) => lines.filter((l) => l.key.startsWith(p)).length;
    console.log(`${lines.length} lines → ${out}: ${by("cs:")} people, ${by("course:")} courses, ${by("aed:")} amounts in dirhams, ${by("inr:")} in rupees, ${by("congrats")} congratulations`);
  } else if (mode === "upload") {
    const dir = option("dir");
    if (!dir || !existsSync(join(dir, "manifest.json"))) { console.log("Give --dir=<the unzipped folder, with manifest.json>"); process.exit(1); }
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { key: string; text: string; file: string }[];
    let n = 0;
    for (const m of manifest) {
      const path = join(dir, m.file);
      if (!existsSync(path)) { console.log(`  missing file for ${m.key}: ${m.file}`); continue; }
      await col("tv_voice_clips").updateOne({ _id: m.key } as any, { $set: { text: m.text, mp3: new Binary(readFileSync(path)), uploaded_at: new Date() } }, { upsert: true });
      n++;
    }
    console.log(`Uploaded ${n} of ${manifest.length} recordings — the board says payments in your voice from now on (with the API deploy).`);
  } else {
    console.log("Say list, upload or missing — see the top of this file.");
  }
} finally {
  await closeDb();
}
