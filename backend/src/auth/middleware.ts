import { col } from "../db";
import { verifyJwt } from "./jwt";
import { serialize } from "../lib/id";
import { toObjectId } from "../lib/id";
import { getDownlineIds } from "../lib/scope";

export interface AuthUser {
  id: string;
  email: string;
  full_name?: string;
  app_role: string;
  commission_rate?: number;
  upline_commission_percentage?: number;
  [k: string]: unknown;
}

/**
 * Resolve the authenticated user from a request's Authorization header.
 * Loads the latest user document from MongoDB so role changes take effect immediately.
 *
 * Impersonation: if the request carries an `X-Impersonate-User-Id` header
 * AND the real (token-bearing) user is super_admin or admin, the returned
 * AuthUser is the impersonated target — so downstream handlers see the
 * impersonated identity for permission checks and ownership comparisons.
 * The original admin id is preserved on `_impersonatedBy` for auditing.
 */
export async function getAuthUser(req: Request): Promise<AuthUser | null> {
  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!auth) return null;
  const [scheme, token] = auth.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  const claims = await verifyJwt(token);
  if (!claims) return null;
  const oid = toObjectId(claims.sub);
  if (!oid) return null;
  const userDoc = await col("users").findOne({ _id: oid });
  if (!userDoc) return null;
  // An account switched off from the Root portal stops working at once, not
  // when its token next expires.
  if ((userDoc as any).status === "inactive") return null;
  // Strip password before exposing.
  const { password_hash, ...safe } = userDoc as any;
  const realUser = serialize(safe) as AuthUser;

  // Impersonation handoff.
  const impersonateId = req.headers.get("x-impersonate-user-id") ?? req.headers.get("X-Impersonate-User-Id");
  // A team's leader — a Chief Mentor or CS Manager — views as a CS of their own team only (the user, 2026-10-08).
  const leads = realUser.app_role === "chief_mentor" || realUser.app_role === "cs_manager";
  if (impersonateId && (["super_admin", "admin"].includes(realUser.app_role) || leads)) {
    const targetOid = toObjectId(impersonateId);
    if (targetOid) {
      const targetDoc = await col("users").findOne({ _id: targetOid });
      const teamCs = leads && (targetDoc as any)?.app_role === "cs" && (await getDownlineIds(realUser.id)).includes(impersonateId);
      // Anybody but a Super Admin — the Personnel page never offers one, and the server doesn't take one either.
      if (targetDoc && (targetDoc as any).app_role !== "super_admin" && (!leads || teamCs)) {
        const { password_hash: _pw, ...targetSafe } = targetDoc as any;
        const target = serialize(targetSafe) as AuthUser;
        // Stamp the real admin so audit logs and request-scoped logic can read it.
        (target as any)._impersonatedBy = { id: realUser.id, email: realUser.email, full_name: realUser.full_name };
        return target;
      }
    }
  }

  return realUser;
}

export async function requireAuth(req: Request): Promise<AuthUser | Response> {
  const user = await getAuthUser(req);
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return user;
}
