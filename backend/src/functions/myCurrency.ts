import { json } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { isMentorRole } from "../lib/roles";
import { locationOfUser } from "../lib/userLocation";

/**
 * POST /api/functions/getMyCurrency → { location: "dubai" | "bangalore", currency: "AED" | "INR" }
 * The currency the portal shows this person money in (the user, 2026-10-14): INR for anyone on a Bangalore team —
 * its CSs, CS Managers and mentors — AED for everyone else (admins, finance, broker admins, the CS Manager over
 * every team). "View as" answers for the person being viewed.
 */
export async function getMyCurrency(_req: Request, user: AuthUser): Promise<Response> {
  if (!isMentorRole(user.app_role)) return json({ location: "dubai", currency: "AED" });
  // The same rule that keeps Dubai and Bangalore apart (lib/userLocation.ts) — the CS Manager over every team by their own.
  const location = await locationOfUser(user.id);
  return json({ location, currency: location === "bangalore" ? "INR" : "AED" });
}
