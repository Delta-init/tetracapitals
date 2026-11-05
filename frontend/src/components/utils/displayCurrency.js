/* ────────────────────────────────────────────────────────────────────────────
   The currency money is shown in (the user, 2026-10-14): INR for anyone on a
   Bangalore team — its CSs, CS Managers and mentors — AED for everyone else.
   The server says which (functions/myCurrency.ts getMyCurrency, "View as"
   included); Layout asks once and remembers it here, so every AED figure
   on the pages comes out in the viewer's own currency: 1 USD = 3.67 AED fixed,
   and the INR rate live (the user, 2026-11-05 — it was a fixed 0.010 USD):
   the server's, fetched daily (backend lib/fxRate.ts), given with
   getMyCurrency and kept here. Only what is shown changes — what is stored,
   and commission, stay in AED / USD.
──────────────────────────────────────────────────────────────────────────── */

export const AED_PER_USD = 3.67;
const KEY = 'display_currency';
const RATE_KEY = 'usd_per_inr';
/** 1 INR in USD — live (a binding importers see change); the last one known until the server answers. */
export let USD_PER_INR = (() => {
  try { const r = Number(localStorage.getItem(RATE_KEY)); return r > 0.004 && r < 0.025 ? r : 0.01; } catch { return 0.01; }
})();
const inrPerAed = () => 1 / (AED_PER_USD * USD_PER_INR);
/** The server's rate (getMyCurrency) — kept for the next visit too. */
export function setUsdPerInr(rate) {
  const r = Number(rate);
  if (r > 0.004 && r < 0.025) {
    USD_PER_INR = r;
    try { localStorage.setItem(RATE_KEY, String(r)); } catch { /* private mode */ }
  }
  return USD_PER_INR;
}

let current = (() => {
  try { return localStorage.getItem(KEY) === 'INR' ? 'INR' : 'AED'; } catch { return 'AED'; }
})();

/** 'AED' or 'INR' — the viewer's currency. */
export const displayCurrency = () => current;
export const showsInr = () => current === 'INR';
export function setDisplayCurrency(c) {
  current = c === 'INR' ? 'INR' : 'AED';
  try { localStorage.setItem(KEY, current); } catch { /* private mode */ }
  return current;
}

const fmt = (n, decimals) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: 2 });

/** An AED amount in the viewer's currency: "AED 2,000" or "INR 54,495.91". `decimals` keeps two places. */
export const localFromAed = (aed, { decimals = false } = {}) =>
  (current === 'INR' ? `INR ${fmt((Number(aed) || 0) * inrPerAed(), decimals)}` : `AED ${fmt(aed, decimals)}`);
/** A USD amount in the viewer's currency (AED at 3.67, or INR at the live rate). */
export const localFromUsd = (usd, opts) => localFromAed((Number(usd) || 0) * AED_PER_USD, opts);
/** The number alone, for an Excel column. */
export const localNumberFromAed = (aed) => Math.round((Number(aed) || 0) * (current === 'INR' ? inrPerAed() : 1) * 100) / 100;
/** What a request was typed in, when that is the viewer's currency — shown exactly as typed. */
export const typedLocal = (t) => (current === 'INR' && t?.amount_currency === 'INR' && Number(t.amount_original) > 0 ? `INR ${fmt(t.amount_original)}` : null);
