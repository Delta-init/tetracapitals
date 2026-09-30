import { config } from "../config";

/* ────────────────────────────────────────────────────────────────────────────
   The 3CX API (XAPI, V20): sign in with the API client (client credentials,
   token valid an hour), then plain GETs. Read-only — nothing here changes
   anything on the phone system.
──────────────────────────────────────────────────────────────────────────── */

export const threecxConfigured = (): boolean => !!(config.threecx.url && config.threecx.clientId && config.threecx.apiKey);

export class ThreecxError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
  }
}

let token: { value: string; until: number } | null = null;

async function getToken(fresh = false): Promise<string> {
  if (!fresh && token && Date.now() < token.until) return token.value;
  let res: Response;
  try {
    res = await fetch(`${config.threecx.url}/connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.threecx.clientId,
        client_secret: config.threecx.apiKey,
      }).toString(),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new ThreecxError(`Could not reach 3CX at ${config.threecx.url}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    throw new ThreecxError(
      res.status === 400 || res.status === 401 ? "3CX refused the API client ID / key" : `3CX sign-in failed (HTTP ${res.status})`,
      res.status,
    );
  }
  const data: any = await res.json().catch(() => null);
  if (!data?.access_token) throw new ThreecxError("3CX gave no access token");
  const seconds = Number(data.expires_in) > 0 ? Number(data.expires_in) : 3600;
  token = { value: String(data.access_token), until: Date.now() + Math.max(60, seconds - 60) * 1000 };
  return token.value;
}

/** A GET on the 3CX API (`path` starts with /xapi/…). Signs in again once if the token was refused. */
export async function threecxFetch(path: string, opts: { timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<Response> {
  if (!threecxConfigured()) throw new ThreecxError("3CX is not connected (THREECX_URL / THREECX_CLIENT_ID / THREECX_API_KEY)");
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${config.threecx.url}${path}`, {
        headers: { Authorization: `Bearer ${await getToken(attempt > 0)}`, ...opts.headers },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      });
    } catch (err) {
      if (err instanceof ThreecxError) throw err;
      throw new ThreecxError(`3CX did not answer: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status === 401 && attempt === 0) continue;
    return res;
  }
}

/** A GET that must return JSON; a clear error otherwise (403 = the API client's role is too low). */
export async function threecxJson<T = any>(path: string, timeoutMs = 120_000): Promise<T> {
  const res = await threecxFetch(path, { timeoutMs });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
    const what = path.split("?")[0].replace(/\(.*$/, "");
    throw new ThreecxError(
      res.status === 403
        ? `3CX refused ${what} (403) — give the API client the System Owner role`
        : `3CX ${what} failed (HTTP ${res.status})${body ? `: ${body}` : ""}`,
      res.status,
    );
  }
  return (await res.json()) as T;
}
