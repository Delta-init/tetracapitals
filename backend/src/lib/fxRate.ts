import { col } from "../db";

/* ────────────────────────────────────────────────────────────────────────────
   The INR rate, live (the user, 2026-11-05): it was a fixed 1 INR = 0.010 USD.
   Fetched once a day from open.er-api.com (free, no key) and kept in
   app_settings, so every page and the TV board use the same rate; when the
   service doesn't answer, the last rate fetched stays (0.010 before any).
   AED stays fixed at 3.67 to the USD. A funding request keeps the rate it was
   made with (fx_rate_usd_per_inr — finance/funding.ts usdPerInrOf).
──────────────────────────────────────────────────────────────────────────── */

export const AED_PER_USD = 3.67;
/** The rate before any was fetched — the portal's old fixed one. */
export const FALLBACK_USD_PER_INR = 0.01;
const SETTINGS_ID = "fx_inr";
const DAY_MS = 24 * 3_600_000;
const RETRY_MS = 15 * 60_000;
const SOURCE = "https://open.er-api.com/v6/latest/USD";

export interface InrRate { usd_per_inr: number; inr_per_usd: number; fetched_at: string | null; source: string }

let kept: { rate: InrRate; checkedAt: number } | null = null;
let fetching: Promise<InrRate> | null = null;

const rateOf = (usdPerInr: number, fetchedAt: string | null, source: string): InrRate =>
  ({ usd_per_inr: usdPerInr, inr_per_usd: Math.round((1 / usdPerInr) * 10_000) / 10_000, fetched_at: fetchedAt, source });

async function refresh(): Promise<InrRate> {
  const doc: any = await col("app_settings").findOne({ _id: SETTINGS_ID } as any);
  const saved = Number(doc?.usd_per_inr) > 0 ? rateOf(Number(doc.usd_per_inr), doc.fetched_at ?? null, String(doc.source ?? "")) : null;
  if (saved?.fetched_at && Date.now() - Date.parse(saved.fetched_at) < DAY_MS) return saved;
  try {
    const res = await fetch(SOURCE, { signal: AbortSignal.timeout(6000) });
    const inrPerUsd = Number(((await res.json()) as any)?.rates?.INR);
    // A sane rupee: anything else is the service's mistake, not a rate.
    if (!res.ok || !(inrPerUsd > 40 && inrPerUsd < 250)) throw new Error(`no INR rate (HTTP ${res.status})`);
    const rate = rateOf(Math.round((1 / inrPerUsd) * 1e8) / 1e8, new Date().toISOString(), "open.er-api.com");
    await col("app_settings").updateOne({ _id: SETTINGS_ID } as any, { $set: { usd_per_inr: rate.usd_per_inr, inr_per_usd: inrPerUsd, fetched_at: rate.fetched_at, source: rate.source } }, { upsert: true });
    return rate;
  } catch (err) {
    console.error("[fx rate] INR rate not fetched — the last one stays:", err instanceof Error ? err.message : err);
    return saved ?? rateOf(FALLBACK_USD_PER_INR, null, "fixed");
  }
}

/** The INR rate now: today's fetched one, else the last fetched, else the old fixed 0.010. */
export async function inrRate(): Promise<InrRate> {
  if (kept && Date.now() - kept.checkedAt < (kept.rate.fetched_at ? Math.min(RETRY_MS * 4, DAY_MS) : RETRY_MS)) return kept.rate;
  fetching ??= refresh().finally(() => { fetching = null; });
  const rate = await fetching;
  kept = { rate, checkedAt: Date.now() };
  return rate;
}

/** Rupees to the dirham at the rate now. */
export const inrPerAed = async () => 1 / (AED_PER_USD * (await inrRate()).usd_per_inr);
