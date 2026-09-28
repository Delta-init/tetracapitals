import { col } from "../db";
import { config } from "../config";
import { json, error } from "../lib/response";
import { serialize } from "../lib/id";
import { signJwt } from "./jwt";

/**
 * POST /api/auth/sso   { token }
 *
 * Signing in from the Root portal. The portal is where this estate signs people
 * in — once, there, and then into each system from it. What arrives is a
 * single-use token this server cannot validate alone, so it asks the portal
 * whether the token is good and whose it is, then signs that person in exactly
 * as a password login would.
 *
 * No account is created here, deliberately: the token is the only thing
 * vouching for the address, and it is checked by asking the very system that
 * would be spoofed. An account has to be given on purpose first — by an admin
 * here, or from the portal's Users page.
 */
export async function handleSso(req: Request): Promise<Response> {
  // Unset means unavailable, never a default host: falling back to localhost
  // would mean asking whatever happens to listen there to vouch for the token.
  const portal = config.rootErpApiUrl.trim().replace(/\/+$/, "");
  if (!portal) return error("Signing in from the Root portal is not configured on this server", 503);

  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token || token.length > 512) return error("A sign-in token is required", 400);

  let email = "";
  try {
    const res = await fetch(`${portal}/api/auth/verify-sso-token?token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return error("This sign-in link has expired or was already used. Open Tetra Commission from the portal again.", 401);
    const payload = (await res.json().catch(() => ({}))) as { data?: { email?: unknown } };
    email = String(payload.data?.email ?? "").trim().toLowerCase();
    if (!email) return error("The portal did not say who this is", 401);
  } catch {
    return error("The Root portal could not be reached", 503);
  }

  const userDoc = await col("users").findOne({ email });
  if (!userDoc) {
    return error(`There is no account here for ${email}. It has to be created before signing in from the portal.`, 403);
  }
  // The same gate a password login applies: switching somebody off from the
  // portal has to close every door, not only the one with a password on it.
  if ((userDoc as { status?: string }).status === "inactive") {
    return error("This account has been switched off", 403);
  }

  const { password_hash: _pw, ...safe } = userDoc as Record<string, unknown>;
  const user = serialize(safe as never);
  const jwt = await signJwt({ sub: user.id, email: user.email, app_role: user.app_role, full_name: user.full_name });
  console.log(`[sso] ${email} signed in from the Root portal`);
  return json({ token: jwt, user });
}
