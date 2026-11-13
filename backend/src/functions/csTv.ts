import { inrRate, inrPerAed } from "../lib/fxRate";
import { randomBytes } from "node:crypto";
import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { loadTeams } from "../students/teams";
import { hrmsPhotos } from "../lib/hrms";
import { EXTRAS, onExtrasChange, onScreen } from "./csTvExtras";
import { toObjectId } from "../lib/id";

/* ────────────────────────────────────────────────────────────────────────────
   The CS TV board (the user, 2026-10-22: "a public leaderboard link of the CS,
   like the Sales TV, the screen can rotate") — for the office TVs, no sign-in,
   behind a secret in the link that a Super Admin copies from the Leaderboard
   page. One location's CSs this month: the course payments they collected
   (approved, never a sales close) and today's, ranked, with their HRMS photos;
   the teams; and the latest approved payments, for a pop-up. Names and amounts
   only — never a student, never an email. Kept 20 seconds, whatever the screens.

   The amounts added for the TV (functions/csTvExtras.ts) count like payments on
   the boards they say. Somebody of the other location with one to show here —
   a Bangalore CS on the Dubai TV (the user, 2026-11-14) — gets a row among this
   location's, with only what was added for them: never their own board's
   payments. `?real=1` leaves every added amount out, and those rows with them:
   what Root's Manager TV asks for, so managers read what was collected.
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
onExtrasChange(() => cache.clear());

/** "2026-10" → the next month, "2026-11". */
const nextMonth = (m: string) => { const [y, mm] = m.split("-").map(Number) as [number, number]; return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`; };

/**
 * The board — this month's, or with `month` (YYYY-MM, the Root Manager TV's month switch, 2026-11-01) that month's as
 * it ended: what each CS collected in it, nothing for today, no latest payments.
 */
async function board(location: "dubai" | "bangalore", month?: string, real = false) {
  const index = await loadTeams();
  const people = ((await col("users").find({ app_role: "cs", status: { $ne: "inactive" } }, { projection: { full_name: 1, email: 1 } }).toArray()) as any[])
    .filter((u) => (index.teamOf(String(u._id))?.location ?? "dubai") === location);
  const row = new Map(people.map((u) => {
    const team = index.teamOf(String(u._id));
    return [String(u._id), { id: String(u._id), name: String(u.full_name ?? "").trim(), email: String(u.email ?? "").toLowerCase(), team_id: team?.id ?? "", team: team?.name ?? "No team",
      month_aed: 0, today_aed: 0, payments: 0, today_payments: 0, photo: null as string | null }];
  }));
  const today = dubaiDay();
  const past = !!month && month !== today.slice(0, 7);
  const shownMonth = past ? month! : today.slice(0, 7);
  const monthStart = dubaiStart(`${shownMonth}-01`), monthEnd = dubaiStart(`${nextMonth(shownMonth)}-01`), todayStart = dubaiStart(today);
  const txs = (await col("funding_transactions").find({
    type: "BONUS", status: "APPROVED", bonus_credit: { $in: [null, ""] }, "course_payment.product": { $exists: true }, approved_at: { $gte: monthStart, $lt: monthEnd },
  }, { projection: { initiating_mentor_id: 1, requested_by_id: 1, course_payment: 1, amount_aed: 1, approved_at: 1, tags: 1 } }).sort({ approved_at: -1 }).toArray()) as any[];
  // The amounts a Super Admin adds for the TV (functions/csTvExtras.ts, 2026-11-13) count here exactly like payments —
  // those this board is to show (2026-11-14), none of them when the real board is asked for.
  const extras = real ? [] : (await col(EXTRAS).find({ ...onScreen(location), at: { $gte: monthStart, $lt: monthEnd } }).toArray()) as any[];
  // Somebody of the other location with an amount to show here: a row of their own, holding only what was added for
  // them. Still an active CS — one switched off, or no longer a CS, drops off the board as anybody does.
  const guests = new Set<string>();
  const guestIds = [...new Set(extras.map((e) => String(e.cs_id)).filter((id) => !row.has(id)))].map((id) => toObjectId(id)).filter(Boolean);
  if (guestIds.length) {
    for (const u of (await col("users").find({ _id: { $in: guestIds as any[] }, app_role: "cs", status: { $ne: "inactive" } }, { projection: { full_name: 1, email: 1 } }).toArray()) as any[]) {
      const id = String(u._id), team = index.teamOf(id);
      guests.add(id);
      row.set(id, { id, name: String(u.full_name ?? "").trim(), email: String(u.email ?? "").toLowerCase(), team_id: team?.id ?? "", team: team?.name ?? "No team",
        month_aed: 0, today_aed: 0, payments: 0, today_payments: 0, photo: null as string | null });
    }
  }
  const items = [
    ...txs.map((t) => ({ id: String(t._id), cs_id: String(t.initiating_mentor_id || t.requested_by_id || ""), aed: Number(t.course_payment?.paid_today_aed) || Number(t.amount_aed) || 0,
      product: String(t.course_payment?.product ?? (t.tags ?? [])[0] ?? ""), at: String(t.approved_at) })).filter((t) => !guests.has(t.cs_id)),
    ...extras.map((e) => ({ id: String(e._id), cs_id: String(e.cs_id), aed: Number(e.aed) || 0, product: String(e.product ?? ""), at: String(e.at) })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const recent: any[] = [];
  for (const t of items) {
    const r = row.get(t.cs_id);
    if (!r) continue;
    r.month_aed += t.aed; r.payments += 1;
    if (!past && t.at >= todayStart) { r.today_aed += t.aed; r.today_payments += 1; }
    if (!past && recent.length < 20) recent.push({ id: t.id, cs_id: r.id, cs: r.name, team: r.team, aed: round(t.aed), product: t.product, at: t.at });
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
    location, month: shownMonth, generated_at: new Date().toISOString(),
    cs, teams: [...teams.values()].map((t) => ({ ...t, month_aed: round(t.month_aed), today_aed: round(t.today_aed) })).sort((a, b) => b.month_aed - a.month_aed),
    totals: { month_aed: round(cs.reduce((s, r) => s + r.month_aed, 0)), today_aed: round(cs.reduce((s, r) => s + r.today_aed, 0)), payments: cs.reduce((s, r) => s + r.payments, 0) },
    recent,
  };
}

/**
 * GET /api/public/cs-tv?location=dubai|bangalore[&month=][&real=1] — the board, for the TV page at /cs/dubai or /cs/bangalore. Open, no
 * secret (the user asked for it twice, 2026-10-22: "I need normal /cs/dubai only") — names, teams and amounts only,
 * never a student or an email.
 */
export async function handleCsTv(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const location = url.searchParams.get("location") === "bangalore" ? "bangalore" : "dubai";
  // ?month=YYYY-MM: a month gone by (not one to come), kept 5 minutes — it no longer changes much.
  const asked = url.searchParams.get("month") ?? "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) && asked < dubaiDay().slice(0, 7) ? asked : undefined;
  // ?real=1: without the amounts added for the TV (Root's Manager TV, 2026-11-14) — kept apart from the TV's own.
  const real = url.searchParams.get("real") === "1";
  const key = `${month ? `${location}:${month}` : location}${real ? ":real" : ""}`;
  const had = cache.get(key);
  // Who collected each payment is kept for the voice (its recordings are by person), not shown.
  // The INR rate the screen converts with (lib/fxRate.ts, 2026-11-05).
  const usdPerInr = (await inrRate()).usd_per_inr;
  const shown = (data: any) => ({ ...data, usd_per_inr: usdPerInr, recent: (data.recent ?? []).map(({ cs_id: _id, ...r }: any) => r) });
  if (had && Date.now() - had.at < (month ? 5 * 60_000 : CACHE_MS)) return json(shown(had.data));
  try {
    const data = await board(location, month, real);
    cache.set(key, { at: Date.now(), data });
    return json(shown(data));
  } catch (err) {
    console.error("[cs tv]", err);
    return error("The board couldn't be made — try again", 500);
  }
}


/* ── The voice (the user, 2026-10-26: the user's own, cloned — lib/voice.ts) ─────────────────────────────────────── */

const CURRENCY_WORDS: Record<string, string> = { AED: "dirhams", INR: "rupees", USD: "dollars" };

/** What the board says for a payment — the same words as its browser voice (components/cstv/saleAnnouncement.js). */
export function spokenLineFor(p: { cs?: string; team?: string; product?: string; aed?: number }, location: "dubai" | "bangalore", inrPerAed = 1): string {
  const currency = location === "bangalore" ? "INR" : "AED";
  const amount = Math.round((Number(p.aed) || 0) * (currency === "INR" ? inrPerAed : 1));
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
  const url = new URL(req.url);
  const location = url.searchParams.get("location") === "bangalore" ? "bangalore" : "dubai";
  const id = String(url.searchParams.get("id") ?? "");
  let p: any = null;
  if (id !== "test") {
    const had = cache.get(location);
    const data = had && Date.now() - had.at < 5 * 60_000 ? had.data : await board(location);
    p = (data.recent as any[]).find((r) => r.id === id);
    if (!p) return error("Not a payment on the board", 404);
  }
  // No ElevenLabs: the owner's own recordings, stitched (2026-10-26, Chatterbox on Colab — lib/voiceLines.ts).
  if (!voiceConfigured()) return stitchedVoice(p, location);
  const text = p ? spokenLineFor({ cs: p.cs, team: p.team, product: p.product, aed: p.aed }, location, await inrPerAed())
    : spokenLineFor({ cs: "Test", team: "CS TV", product: "Sample course", aed: 2000 }, location, await inrPerAed());
  try {
    const mp3 = await voiceMp3(text);
    return new Response(new Uint8Array(mp3), { headers: { "content-type": "audio/mpeg", "cache-control": "public, max-age=86400", "access-control-allow-origin": "*" } });
  } catch (err) {
    console.error("[cs tv voice]", err instanceof Error ? err.message : err);
    return error("The voice couldn't be made", 502);
  }
}

/**
 * A payment said from the recordings made ahead (tv_voice_clips — scripts/voice-clips.ts upload): who collected it,
 * the course, the amount when that amount was recorded, "Congratulations!", with a short pause between. Without the
 * person's recording: 404, and the board speaks with the browser's own voice. The Test line: the first CS recorded.
 */
async function stitchedVoice(p: any, location: "dubai" | "bangalore"): Promise<Response> {
  const { csLine, courseLine, amountLine, CONGRATS, GAP_KEY } = await import("../lib/voiceLines");
  const clips = col("tv_voice_clips");
  let first: any = null;
  if (p) first = await clips.findOne({ _id: csLine(String(p.cs_id), p.cs, p.team).key } as any);
  else first = await clips.findOne({ _id: { $regex: "^cs:" } } as any);
  if (!first?.mp3) return error("No recording for them yet", 404);
  const currency = location === "bangalore" ? "INR" : "AED";
  const amount = p ? Math.round((Number(p.aed) || 0) * (currency === "INR" ? await inrPerAed() : 1)) : 2000;
  const keys = [
    p?.product ? courseLine(p.product).key : "",
    amount > 0 ? amountLine(amount, currency).key : "",
    CONGRATS.key,
  ].filter(Boolean);
  const found = new Map(((await clips.find({ _id: { $in: [...keys, GAP_KEY] } } as any).toArray()) as any[]).map((c) => [String(c._id), c]));
  const gap = found.get(GAP_KEY)?.mp3;
  const parts: Buffer[] = [Buffer.from(first.mp3.buffer ?? first.mp3)];
  for (const k of keys) {
    const c = found.get(k);
    if (!c?.mp3) continue;   // an amount nobody recorded: left out (the screen shows it)
    if (gap) parts.push(Buffer.from(gap.buffer ?? gap));
    parts.push(Buffer.from(c.mp3.buffer ?? c.mp3));
  }
  return new Response(new Uint8Array(Buffer.concat(parts)), { headers: { "content-type": "audio/mpeg", "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" } });
}

/**
 * GET /api/public/cs-tv/voice-plan?location=&id=<payment | test> → { urls } — the owner's own recordings for a payment
 * on the board (R2 — functions/voiceRecordings.ts), in the order said: who collected it, the course, the amount when it
 * was recorded (else left out — the screen shows it), "Congratulations". Empty when the person isn't recorded: the
 * board then speaks as before. The Test: the first person recorded, 2,000 dirhams.
 */
export async function handleCsTvVoicePlan(req: Request): Promise<Response> {
  const { csLine, courseLine, amountLine, CONGRATS } = await import("../lib/voiceLines");
  const url = new URL(req.url);
  const location = url.searchParams.get("location") === "bangalore" ? "bangalore" : "dubai";
  const id = String(url.searchParams.get("id") ?? "");
  const clips = col("tv_voice_clips");
  let p: any = null;
  if (id !== "test") {
    const had = cache.get(location);
    const data = had && Date.now() - had.at < 5 * 60_000 ? had.data : await board(location);
    p = (data.recent as any[]).find((r) => r.id === id);
    if (!p) return error("Not a payment on the board", 404);
  }
  const first: any = p
    ? await clips.findOne({ _id: csLine(String(p.cs_id), p.cs, p.team).key, url: { $exists: true } } as any, { projection: { url: 1 } })
    : await clips.findOne({ _id: { $regex: "^cs:" }, url: { $exists: true } } as any, { projection: { url: 1 } });
  // Spelled as json()'s own header so it replaces that one (2026-10-29): spelled lowercase, the answer carried both —
  // "https://commission-v2…, *" — which browsers refuse, so the TV never got the recordings and fell back to the made line.
  const nocache = { "cache-control": "no-store", "Access-Control-Allow-Origin": "*" };
  if (!first?.url) return json({ urls: [] }, { headers: nocache });
  const currency = location === "bangalore" ? "INR" : "AED";
  const amount = p ? Math.round((Number(p.aed) || 0) * (currency === "INR" ? await inrPerAed() : 1)) : 2000;
  const keys = [p?.product ? courseLine(p.product).key : "", amount > 0 ? amountLine(amount, currency).key : "", CONGRATS.key].filter(Boolean);
  const found = new Map(((await clips.find({ _id: { $in: keys }, url: { $exists: true } } as any, { projection: { url: 1 } }).toArray()) as any[]).map((c) => [String(c._id), c.url]));
  return json({ urls: [first.url, ...keys.map((k) => found.get(k)).filter(Boolean)] }, { headers: nocache });
}

