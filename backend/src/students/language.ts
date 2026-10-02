/* ────────────────────────────────────────────────────────────────────────────
   The language a student studies in — as the sales CRMs ask it at every close
   (Delta's and the Remote team's, the same four), and as finance passes it on.
   Kept on the student as `language`, and on each course's fees.

   Older enrolments were typed by hand in finance ("MALAYALAM", "hindi",
   "Hindi / Urdu"), so anything that is one of the four however it is written
   becomes that one; "Not specified" (a close from before the CRMs asked) and
   anything else is no language.
──────────────────────────────────────────────────────────────────────────── */

export const LANGUAGES = ["English", "Malayalam", "Hindi/Urdu", "Tamil"] as const;
export type Language = (typeof LANGUAGES)[number];

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** One of the four, or "" for none. */
export function languageOf(raw: unknown): Language | "" {
  const key = squash(String(raw ?? ""));
  if (!key) return "";
  if (key === "hindi" || key === "urdu" || key === "urdu/hindi") return "Hindi/Urdu";
  return LANGUAGES.find((l) => squash(l) === key) ?? "";
}
