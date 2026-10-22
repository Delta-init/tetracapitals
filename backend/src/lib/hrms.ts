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

/** One signed POST with a JSON body; the answer's `data`. (The signature covers sha256 of the body.) */
export async function hrmsPost<T>(path: string, payload: unknown): Promise<T> {
  const signedPath = `/api/v1/integrations${path}`;
  const raw = JSON.stringify(payload ?? {});
  const timestamp = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const canonical = ["POST", signedPath, timestamp, nonce, createHash("sha256").update(raw).digest("hex")].join("\n");
  const signature = createHmac("sha256", config.hrms.integrationSecret).update(canonical).digest("hex");
  let res: Response;
  try {
    res = await fetch(`${config.hrms.apiUrl}${signedPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Delta-Client": config.hrms.clientId, "X-Delta-Timestamp": timestamp, "X-Delta-Nonce": nonce, "X-Delta-Signature": signature },
      body: raw,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error("The HRMS could not be reached");
  }
  if (!res.ok) throw new Error(`The HRMS answered ${res.status}`);
  const body = (await res.json().catch(() => ({}))) as { data?: T };
  return body.data as T;
}

/* People's HRMS photos (the CS TV board, 2026-10-22) — as the Root portal's Sales TV gets them: the directory's
   work-modes, matched by email then name; each photo a signed link good for a few hours, so kept 1 hour. */
const photoCache = new Map<string, { url: string | null; at: number }>();
const PHOTO_TTL_MS = 60 * 60_000;
export async function hrmsPhotos(people: { email: string; name?: string }[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const want: { email: string; name?: string }[] = [];
  for (const p of people) {
    const e = String(p.email ?? "").trim().toLowerCase();
    if (!e) continue;
    const had = photoCache.get(e);
    if (had && Date.now() - had.at < PHOTO_TTL_MS) out.set(e, had.url);
    else want.push({ email: e, name: p.name });
  }
  if (want.length && hrmsConfigured()) {
    try {
      const rows = (await hrmsPost<any[]>("/directory/work-modes", { people: want.slice(0, 300) })) ?? [];
      rows.forEach((r, i) => {
        const e = String(r?.email ?? want[i]?.email ?? "").toLowerCase();
        const url = typeof r?.photoUrl === "string" && /^https?:\/\//.test(r.photoUrl) ? r.photoUrl : null;
        photoCache.set(e, { url, at: Date.now() });
        out.set(e, url);
      });
    } catch (err) {
      console.error("[hrms] photos", err instanceof Error ? err.message : err);
    }
  }
  return out;
}
