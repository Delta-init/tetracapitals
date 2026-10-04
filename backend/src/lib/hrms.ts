import { createHash, createHmac, randomBytes } from "node:crypto";
import { config } from "../config";

/* ────────────────────────────────────────────────────────────────────────────
   The HRMS's signed directory (/api/v1/integrations/…), as the Root portal
   calls it: X-Delta-Client, -Timestamp, -Nonce and -Signature — an HMAC of
   METHOD \n PATH_WITH_QUERY \n TIMESTAMP \n NONCE \n sha256(body), byte for
   byte the HRMS's buildCanonical (a mismatch is a blanket 401). Read only.
──────────────────────────────────────────────────────────────────────────── */

const TIMEOUT_MS = 15_000;

export const hrmsConfigured = (): boolean => !!(config.hrms.apiUrl && config.hrms.clientId && config.hrms.integrationSecret);

/** One signed GET; the answer's `data`. Throws with a sentence fit to show. */
export async function hrmsGet<T>(path: string, query: Record<string, string>): Promise<T> {
  // Signed as fetched: the path with its query, built once.
  const signedPath = `/api/v1/integrations${path}?${new URLSearchParams(query).toString()}`;
  const timestamp = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const canonical = ["GET", signedPath, timestamp, nonce, createHash("sha256").update("").digest("hex")].join("\n");
  const signature = createHmac("sha256", config.hrms.integrationSecret).update(canonical).digest("hex");
  let res: Response;
  try {
    res = await fetch(`${config.hrms.apiUrl}${signedPath}`, {
      headers: { "X-Delta-Client": config.hrms.clientId, "X-Delta-Timestamp": timestamp, "X-Delta-Nonce": nonce, "X-Delta-Signature": signature },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error("The HRMS could not be reached");
  }
  if (res.status === 401) throw new Error("The HRMS refused this server's credentials (HRMS_CLIENT_ID / HRMS_INTEGRATION_SECRET)");
  if (res.status === 404) throw new Error("The HRMS does not have working hours yet — its server needs the new code");
  if (!res.ok) throw new Error(`The HRMS answered ${res.status}`);
  const body = (await res.json().catch(() => ({}))) as { data?: T };
  return body.data as T;
}
