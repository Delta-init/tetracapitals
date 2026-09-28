/**
 * A stand-in for the Root portal, for the portal-link e2e only.
 *
 *   GET /issue?email=…                  hands out a one-time token (test only)
 *   GET /api/auth/verify-sso-token?token=…
 *       the real portal's contract: { data: { id, email, name, role } } once,
 *       401 for an unknown, spent or expired token.
 */
const tokens = new Map<string, string>();
const port = Number(process.env.E2E_PORTAL_PORT ?? 0);

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/issue") {
      const token = crypto.randomUUID();
      tokens.set(token, String(url.searchParams.get("email") ?? ""));
      return Response.json({ token });
    }
    if (url.pathname === "/api/auth/verify-sso-token") {
      const token = String(url.searchParams.get("token") ?? "");
      const email = tokens.get(token);
      if (!email) return Response.json({ success: false, message: "Invalid or expired SSO token" }, { status: 401 });
      tokens.delete(token);
      return Response.json({ success: true, data: { id: "portal-admin", email, name: email, role: "Super Admin" } });
    }
    return new Response("not found", { status: 404 });
  },
});
console.log(`fake root portal on ${server.port}`);
