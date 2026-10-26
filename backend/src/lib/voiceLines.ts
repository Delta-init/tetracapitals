/* ────────────────────────────────────────────────────────────────────────────
   The TV board's lines in the owner's own voice, made ahead of time in pieces
   (the user, 2026-10-26: "generate all employees' names, course names and
   amounts, then it plays the recording") — recorded once with Chatterbox on
   Google Colab (backend/voice/chatterbox_tv_voice.ipynb) from the list
   scripts/voice-clips.ts makes, and stitched together for each payment
   (functions/csTv.ts):

     cs:<user id>       "Payment collected by Haritha, in Team Money Heist!"
     course:<KEY>       "D S L P."
     aed:<n> / inr:<n>  "For two thousand dirhams."
     congrats           "Congratulations!"
     gap                a short silence between them

   The words are made here, so the list and the board always agree on them.
──────────────────────────────────────────────────────────────────────────── */

export const productKeyOf = (name: unknown) => String(name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** A name as it should be said: "haritha.kg" → "Haritha", "athiravelayudan" → "Athiravelayudan", "Alice Antony" stays. */
export function spokenName(name: unknown): string {
  let n = String(name ?? "").trim();
  if (!/\s/.test(n) && /[._]/.test(n)) n = n.split(/[._]/)[0]!;
  return n.split(/\s+/).filter(Boolean).map((w) => (w === w.toLowerCase() ? w[0]!.toUpperCase() + w.slice(1) : w)).join(" ");
}

/** Short words that are words, not codes: said as written. */
const SAID_AS_WORDS = new Set(["PRO", "FULL", "PLUS", "MAX", "MINI", "LIVE", "OFFER"]);
/**
 * A course as it should be said: a code is spelt out ("DSLP" → "D S L P", "mmc" → "M M C") — short capitals, or a
 * short word with no vowel — and a word stays a word ("DSLP PRO" → "D S L P Pro").
 */
export function spokenCourse(product: unknown): string {
  return String(product ?? "").trim().split(/(\s+|[-–/+&])/).map((w) => {
    if (SAID_AS_WORDS.has(w.toUpperCase())) return w[0]!.toUpperCase() + w.slice(1).toLowerCase();
    if (/^[A-Za-z]{2,5}$/.test(w) && (/^[A-Z]+$/.test(w) || !/[aeiouy]/i.test(w))) return w.toUpperCase().split("").join(" ");
    return w;
  }).join("").replace(/\s+/g, " ").trim();
}

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function under1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const rest = r < 20 ? ONES[r]! : `${TENS[Math.floor(r / 10)]}${r % 10 ? `-${ONES[r % 10]}` : ""}`;
  return h ? `${ONES[h]} hundred${r ? ` and ${rest}` : ""}` : rest;
}
/** 54,496 → "fifty-four thousand, four hundred and ninety-six" (whole numbers below a billion). */
export function numberWords(value: number): string {
  let n = Math.round(Math.abs(value));
  if (n === 0) return "zero";
  const parts: string[] = [];
  for (const [size, word] of [[1_000_000, "million"], [1000, "thousand"]] as const) {
    if (n >= size) { parts.push(`${under1000(Math.floor(n / size))} ${word}`); n %= size; }
  }
  // "eleven thousand and twenty", "eleven thousand, three hundred and twenty".
  if (n && parts.length && n < 100) return `${parts.join(", ")} and ${under1000(n)}`;
  if (n) parts.push(under1000(n));
  return parts.join(", ");
}

export type VoiceLine = { key: string; text: string };

export const csLine = (id: string, name: string, team?: string | null): VoiceLine =>
  ({ key: `cs:${id}`, text: `Payment collected by ${spokenName(name)}${team && team !== "No team" ? `, in ${team}` : ""}!` });
export const courseLine = (product: string): VoiceLine => ({ key: `course:${productKeyOf(product)}`, text: `${spokenCourse(product)}.` });
export const amountLine = (amount: number, currency: "AED" | "INR"): VoiceLine =>
  ({ key: `${currency.toLowerCase()}:${Math.round(amount)}`, text: `For ${numberWords(amount)} ${currency === "INR" ? "rupees" : "dirhams"}.` });
export const CONGRATS: VoiceLine = { key: "congrats", text: "Congratulations!" };
export const GAP_KEY = "gap";

/** Round amounts always recorded: every 500 from 500 to 50,000 dirhams. */
export const ROUND_AED = Array.from({ length: 100 }, (_, i) => (i + 1) * 500);
