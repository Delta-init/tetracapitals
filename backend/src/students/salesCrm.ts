/* ────────────────────────────────────────────────────────────────────────────
   Which sales CRM sold a student's course — Delta's Sales CRM, the Remote CRM
   or Draw — by the codes finance and the Root portal use, as finance passes
   it on. Kept on each course's fees (`sales_crm`), and on the student: the CRM
   they first came through, shown with how they arrived.

   Not `source`: that already says how a student got here at all ("delta_lms"
   for every one finance sends). An older finance says nothing, which is no
   CRM rather than a guess.
──────────────────────────────────────────────────────────────────────────── */

export const SALES_CRMS = ["delta", "remote", "draw", "banglore"] as const;
export type SalesCrm = (typeof SALES_CRMS)[number];

/** The tag, as finance and the LMS show it. */
export const SALES_CRM_LABELS: Record<SalesCrm, string> = {
  delta: "Sales CRM",
  remote: "Remote CRM",
  draw: "Draw",
  // The Banglore CRM (finance's code, spelt so) — its students are Bangalore students (lib/location.ts).
  banglore: "Banglore CRM",
};

/** One of the three, or "" for anything else. */
export function salesCrmOf(raw: unknown): SalesCrm | "" {
  const v = String(raw ?? "").trim().toLowerCase();
  return (SALES_CRMS as readonly string[]).includes(v) ? (v as SalesCrm) : "";
}

/** The currency every sales CRM gives the course (MT5) bonus in. */
export const CRM_BONUS_CURRENCY = "USD";

/**
 * A course's bonus currency (the user, 2026-10-12): its own (`bonus_currency`); else USD for one a
 * sales CRM sold — a close queued before the CRMs said so, its bonus meant in US dollars all the
 * same — else the fee's. Nothing is converted: the label the amount is shown and counted with.
 */
export function bonusCurrencyOf(fee: { bonus_currency?: unknown; sales_crm?: unknown; currency?: unknown } | null | undefined): string {
  const own = String(fee?.bonus_currency ?? "").trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(own)) return own;
  if (salesCrmOf(fee?.sales_crm)) return CRM_BONUS_CURRENCY;
  return String(fee?.currency || "AED").trim().toUpperCase();
}

/**
 * The CRM by name, as a student's arrival is told — "Delta sales CRM" for a
 * student from before finance said which, as every one of those was.
 */
export function salesCrmName(raw: unknown): string {
  const crm = salesCrmOf(raw);
  if (crm === "remote") return "Remote CRM";
  if (crm === "draw") return "Draw";
  if (crm === "banglore") return "Banglore CRM";
  return "Delta sales CRM";
}
