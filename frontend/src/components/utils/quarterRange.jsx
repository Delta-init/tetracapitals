// Single source of truth for commission quarter boundaries.
//
// Every screen that splits funding transactions into quarters (the mentor
// "My Funding Requests" summary, the admin "Quarter Closing" page, the
// Dashboard) MUST derive its window from here so they always agree.
//
// Boundaries are anchored to the BUSINESS timezone (IST, UTC+05:30) — not the
// viewer's browser timezone and not raw UTC. Anchoring to the browser meant two
// people in different timezones saw different numbers; anchoring to UTC misfiled
// a transaction that happened just after local midnight into the previous
// quarter (e.g. a 2026-03-31T19:31Z withdrawal = Apr 1 01:01 IST was counted as
// Q1 by the UTC-based admin path but Q2 by the local-time mentor path, a $2,000
// gap). Anchoring both to IST makes the answer correct and identical everywhere.
//
// IST has no daylight-saving, so a fixed offset is exact. If the business ever
// operates from a DST timezone, replace this constant with a tz library
// (luxon / date-fns-tz) here — every caller picks up the change for free.
export const BUSINESS_UTC_OFFSET_MINUTES = 330; // IST = UTC+05:30

/**
 * [start, end] instants for the given quarter (1-4) and year, where the
 * boundaries are local midnight in the business timezone expressed as real UTC
 * instants. Compare directly against a transaction's `requested_at` ISO string.
 */
export function getQuarterRange(quarter, year) {
  const startMonth = (quarter - 1) * 3;
  const offMs = BUSINESS_UTC_OFFSET_MINUTES * 60000;
  // Date.UTC(...) gives the instant for that wall-clock time AT UTC; subtracting
  // the business offset shifts it to that same wall-clock time IN the business tz.
  const start = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0) - offMs);
  const end = new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999) - offMs);
  return { start, end };
}

/** Business-timezone quarter number (1-4) and year for a given instant. */
export function getBusinessQuarter(date = new Date()) {
  // Shift the instant into business-local time, then read its month/year off the
  // UTC fields of the shifted value.
  const local = new Date(date.getTime() + BUSINESS_UTC_OFFSET_MINUTES * 60000);
  return { quarter: Math.floor(local.getUTCMonth() / 3) + 1, year: local.getUTCFullYear() };
}
