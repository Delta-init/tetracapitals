/* ────────────────────────────────────────────────────────────────────────────
   What a student still owes on a course Delta finance sold them, and when the
   next instalment is due (the user, 2026-10-11).

   Finance keeps each enrolment's money and works out the next due date — the
   latest payment's paid-on date + 29 days, again after every payment, until
   the balance is 0 — and sends it here whenever it changes
   (finance/feeUpdates.ts), onto the student's `course_fees` entry for that
   invoice: paid_minor, balance_minor, status, next_due_on, payments.

   Only finance's own entries count — what it sends is Forex — never a row of
   the CS enrolment tracker (source "cs_tracker"). A void or deleted invoice
   owes nothing. Days are UAE days (the reminders go at 10:00 UAE).
──────────────────────────────────────────────────────────────────────────── */

/** Finished with: nothing more is owed on it, whatever its balance says. */
export const CLOSED_FEE_STATUSES = ["void", "deleted", "paid"];
/** How near the next due date is "due soon": today and the next 3 days. */
export const DUE_SOON_DAYS = 3;

const UAE_OFFSET_MS = 4 * 3_600_000;
export const uaeDay = (now = Date.now()) => new Date(now + UAE_OFFSET_MS).toISOString().slice(0, 10);
/** `d` (YYYY-MM-DD) moved by `n` days. */
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Whole days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
export const isDay = (s: unknown): s is string => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  // 2026-13-45 is no day; 2026-02-30 would roll over into March — neither is one.
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
};

/** A course_fees entry still owing — the Mongo $elemMatch, and the same in code (owes). */
export const OWING_FEE = {
  source: { $ne: "cs_tracker" },
  balance_minor: { $gt: 0 },
  status: { $nin: CLOSED_FEE_STATUSES },
};
export const owingFilter = () => ({ course_fees: { $elemMatch: OWING_FEE } });
/** Owing, with the next instalment due within DUE_SOON_DAYS of `today` — or overdue. */
export const dueSoonFilter = (today: string) => ({
  course_fees: { $elemMatch: { ...OWING_FEE, next_due_on: { $gt: "", $lte: addDays(today, DUE_SOON_DAYS) } } },
});

export const owes = (f: any): boolean =>
  !!f && f.source !== "cs_tracker" && Number(f.balance_minor) > 0 && !CLOSED_FEE_STATUSES.includes(String(f.status ?? ""));

export const owingFeesOf = (s: any): any[] => (Array.isArray(s?.course_fees) ? s.course_fees.filter(owes) : []);

export type DueState = "overdue" | "soon" | "later" | "none";

/** Where a next due date stands on `today`: overdue, due within 3 days (today included), later, or no date yet. */
export function dueStateOf(nextDueOn: unknown, today: string): { state: DueState; daysLeft: number | null } {
  if (!isDay(nextDueOn)) return { state: "none", daysLeft: null };
  const daysLeft = daysBetween(today, nextDueOn);
  return { state: daysLeft < 0 ? "overdue" : daysLeft <= DUE_SOON_DAYS ? "soon" : "later", daysLeft };
}

/** "AED 1,250.00" — never adding one currency to another. */
export const moneyText = (minor: unknown, currency: unknown) =>
  `${String(currency ?? "")} ${(Number(minor || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
