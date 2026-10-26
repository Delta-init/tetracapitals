import { randomBytes } from "node:crypto";
import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { loadTeams } from "../students/teams";
import { hrmsPhotos } from "../lib/hrms";

/* ────────────────────────────────────────────────────────────────────────────
   The CS TV board (the user, 2026-10-22: "a public leaderboard link of the CS,
   like the Sales TV, the screen can rotate") — for the office TVs, no sign-in,
   behind a secret in the link that a Super Admin copies from the Leaderboard
   page. One location's CSs this month: the course payments they collected
   (approved, never a sales close) and today's, ranked, with their HRMS photos;
   the teams; and the latest approved payments, for a pop-up. Names and amounts
   only — never a student, never an email. Kept 20 seconds, whatever the screens.
──────────────────────────────────────────────────────────────────────────── */

const TOKEN_KEY = "cs_tv_token";
const CACHE_MS = 20_000;
const round = (n: number) => Math.round(n * 100) / 100;
const dubaiDay = (ms = Date.now()) => new Date(ms + 4 * 3600_000).toISOString().slice(0, 10);
const dubaiStart = (day: string) => new Date(`${day}T00:00:00+04:00`).toISOString();

async function token(create = false): Promise<string> {
  const doc: any = await col("settings").findOne({ key: TOKEN_KEY });
  if (doc?.value) return String(doc.value);
  if (!create) return "";
  const value = randomBytes(18).toString("base64url");
  await col("settings").updateOne({ key: TOKEN_KEY }, { $setOnInsert: { key: TOKEN_KEY, value, created_date: new Date().toISOString() } }, { upsert: true });
  return String(((await col("settings").findOne({ key: TOKEN_KEY })) as any)?.value ?? value);
}

/** POST /api/functions/getCsTvLink { reset? } → { token } — a Super Admin's; `reset` makes a new one (old links stop). */
export async function getCsTvLink(req: Request, user: AuthUser): Promise<Response> {
  if (user.app_role !== "super_admin") return forbidden();
  const body: any = await req.json().catch(() => ({}));
  if (body?.reset === true) await col("settings").deleteOne({ key: TOKEN_KEY });
  return json({ token: await token(true) });
}

const cache = new Map<string, { at: number; data: any }>();

async function board(location: "dubai" | "bangalore") {
  const index = await loadTeams();
  const people = ((await col("users").find({ app_role: "cs", status: { $ne: "inactive" } }, { projection: { full_name: 1, email: 1 } }).toArray()) as any[])
    .filter((u) => (index.teamOf(String(u._id))?.location ?? "dubai") === location);
  const row = new Map(people.map((u) => {
    const team = index.teamOf(String(u._id));
    return [String(u._id), { id: String(u._id), name: String(u.full_name ?? "").trim(), email: String(u.email ?? "").toLowerCase(), team_id: team?.id ?? "", team: team?.name ?? "No team",
      month_aed: 0, today_aed: 0, payments: 0, today_payments: 0, photo: null as string | null }];
  }));
  const today = dubaiDay(), monthStart = dubaiStart(`${today.slice(0, 8)}01`), todayStart = dubaiStart(today);
  const txs = (await col("funding_transactions").find({
    type: "BONUS", status: "APPROVED", bonus_credit: { $in: [null, ""] }, "course_payment.product": { $exists: true }, approved_at: { $gte: monthStart },
  }, { projection: { initiating_mentor_id: 1, requested_by_id: 1, course_payment: 1, amount_aed: 1, approved_at: 1, tags: 1 } }).sort({ approved_at: -1 }).toArray()) as any[];
  const recent: any[] = [];
  for (const t of txs) {
    const r = row.get(String(t.initiating_mentor_id || t.requested_by_id || ""));
    if (!r) continue;
    const aed = Number(t.course_payment?.paid_today_aed) || Number(t.amount_aed) || 0;
    r.month_aed += aed; r.payments += 1;
    if (String(t.approved_at) >= todayStart) { r.today_aed += aed; r.today_payments += 1; }
    if (recent.length < 20) recent.push({ id: String(t._id), cs: r.name, team: r.team, aed: round(aed), product: String(t.course_payment?.product ?? (t.tags ?? [])[0] ?? ""), at: t.approved_at });
  }
  const photos = await hrmsPhotos([...row.values()].map((r) => ({ email: r.email, name: r.name })));
  const cs = [...row.values()]
    .map(({ email, ...r }) => ({ ...r, photo: photos.get(email) ?? null, month_aed: round(r.month_aed), today_aed: round(r.today_aed) }))
    .sort((a, b) => b.month_aed - a.month_aed || b.payments - a.payments || a.name.localeCompare(b.name))
    .map((r, i) => ({ ...r, rank: i + 1 }));
  const teams = new Map<string, any>();
  for (const r of cs) {
    const k = r.team_id || "-";
    const t = teams.get(k) ?? { id: r.team_id, team: r.team, month_aed: 0, today_aed: 0, payments: 0, cs_count: 0 };
    t.month_aed += r.month_aed; t.today_aed += r.today_aed; t.payments += r.payments; t.cs_count += 1;
    teams.set(k, t);
  }
  return {
    location, month: today.slice(0, 7), generated_at: new Date().toISOString(),
    cs, teams: [...teams.values()].map((t) => ({ ...t, month_aed: round(t.month_aed), today_aed: round(t.today_aed) })).sort((a, b) => b.month_aed - a.month_aed),
    totals: { month_aed: round(cs.reduce((s, r) => s + r.month_aed, 0)), today_aed: round(cs.reduce((s, r) => s + r.today_aed, 0)), payments: cs.reduce((s, r) => s + r.payments, 0) },
    recent,
  };
}

/**
 * GET /api/public/cs-tv?location=dubai|bangalore — the board, for the TV page at /cs/dubai or /cs/bangalore. Open, no
 * secret (the user asked for it twice, 2026-10-22: "I need normal /cs/dubai only") — names, teams and amounts only,
 * never a student or an email.
 */
export async function handleCsTv(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const location = url.searchParams.get("location") === "bangalore" ? "bangalore" : "dubai";
  const had = cache.get(location);
  if (had && Date.now() - had.at < CACHE_MS) return json(had.data);
  try {
    const data = await board(location);
    cache.set(location, { at: Date.now(), data });
    return json(data);
  } catch (err) {
    console.error("[cs tv]", err);
    return error("The board couldn't be made — try again", 500);
  }
}


/* ── The voice (the user, 2026-10-26: the user's own, cloned — lib/voice.ts) ─────────────────────────────────────── */

const CURRENCY_WORDS: Record<string, string> = { AED: "dirhams", INR: "rupees", USD: "dollars" };
const INR_PER_AED = 1 / (3.67 * 0.01);

/** What the board says for a payment — the same words as its browser voice (components/cstv/saleAnnouncement.js). */
export function spokenLineFor(p: { cs?: string; team?: string; product?: string; aed?: number }, location: "dubai" | "bangalore"): string {
  const currency = location === "bangalore" ? "INR" : "AED";
  const amount = Math.round((Number(p.aed) || 0) * (currency === "INR" ? INR_PER_AED : 1));
  let line = p.cs ? `Payment collected by ${p.cs}${p.team ? `, in ${p.team}` : ""}! ` : `Payment collected${p.team ? `, in ${p.team}` : ""}! `;
  line += p.product || "A course payment";
  if (amount > 0) line += `, for ${amount.toLocaleString("en-US")} ${CURRENCY_WORDS[currency]}`;
  return `${line}. Congratulations!`;
}

/**
 * GET /api/public/cs-tv/voice?location=&id=<payment id | test> → audio/mpeg: a payment on the board, said in the
 * voice. Only a payment the board shows (its latest 20) or the Test line — so nobody can make it say anything else,
 * or run up the bill; each line is made once (lib/voice.ts). 404 when there's no voice here: the board then speaks
 * with the browser's own.
 */
export async function handleCsTvVoice(req: Request): Promise<Response> {
  const { voiceConfigured, voiceMp3 } = await import("../lib/voice");
  if (!voiceConfigured()) return error("No voice on this server", 404);
  const url = new URL(req.url);
  const location = url.searchParams.get("location") === "bangalore" ? "bangalore" : "dubai";
  const id = String(url.searchParams.get("id") ?? "");
  let text = "";
  if (id === "test") text = spokenLineFor({ cs: "Test", team: "CS TV", product: "Sample course", aed: 2000 }, location);
  else {
    const had = cache.get(location);
    const data = had && Date.now() - had.at < 5 * 60_000 ? had.data : await board(location);
    const p = (data.recent as any[]).find((r) => r.id === id);
    if (!p) return error("Not a payment on the board", 404);
    text = spokenLineFor({ cs: p.cs, team: p.team, product: p.product, aed: p.aed }, location);
  }
  try {
    const mp3 = await voiceMp3(text);
    return new Response(new Uint8Array(mp3), { headers: { "content-type": "audio/mpeg", "cache-control": "public, max-age=86400", "access-control-allow-origin": "*" } });
  } catch (err) {
    console.error("[cs tv voice]", err instanceof Error ? err.message : err);
    return error("The voice couldn't be made", 502);
  }
}
