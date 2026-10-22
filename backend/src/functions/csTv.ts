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

/** GET /api/public/cs-tv?t=<token>&location=dubai|bangalore — the board, for the TV page; no sign-in. */
export async function handleCsTv(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const want = await token();
  const t = String(url.searchParams.get("t") ?? "");
  if (!want || t !== want) return error("This TV link isn't valid — copy it again from the Leaderboard page", 403);
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

