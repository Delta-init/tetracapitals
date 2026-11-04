import { json, error } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { HrmsAnswerError, hrmsConfigured, hrmsGetAnswered } from "../lib/hrms";

/**
 * POST /api/functions/getMyWallet { month? } → the person's wallet from the HRMS (the user, 2026-11-04: "the wallet on
 * every portal"): salary a day at a time, what came off and why, commission, what finance has paid. Found by the email
 * they sign in with; this month when none is given. Only ever their own — not while viewing as someone else, whose pay
 * is not the viewer's to read.
 */
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** The HRMS may ask finance, and finance the CRMs, before it answers. */
const WALLET_TIMEOUT_MS = 30_000;

export async function getMyWallet(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const month = String(body?.month ?? "");
  if (month && !MONTH.test(month)) return error("month must be YYYY-MM", 400);
  if ((user as any)._impersonatedBy) return error("Your wallet isn't shown while you're viewing the CS Portal as someone else.", 403);
  if (!hrmsConfigured()) return error("The CS Portal isn't linked to the HRMS yet, so there is no wallet to show.", 503);
  const email = String(user.email ?? "").trim().toLowerCase();
  if (!email) return error("Your account has no email to find your HRMS record with.", 400);
  try {
    return json(await hrmsGetAnswered("/wallet", { email, ...(month ? { month } : {}) }, WALLET_TIMEOUT_MS));
  } catch (err) {
    if (err instanceof HrmsAnswerError) return error(err.message, err.status);
    throw err;
  }
}
