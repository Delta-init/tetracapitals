import { config } from "../config";

/* ────────────────────────────────────────────────────────────────────────────
   The Delta LMS's service API (/api/v1/service/…), as the Sales CRM and the
   Root portal call it: a static x-portal-secret header, the academy as
   remoteOrgId. When the LMS refuses it usually says exactly why — a clash, a
   meeting that isn't this person's — so its sentence is passed on.
──────────────────────────────────────────────────────────────────────────── */

const TIMEOUT_MS = 15_000;

export const lmsConfigured = (): boolean => !!(config.lms.apiUrl && config.lms.serviceSecret);

export class LmsError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function callLms<T>(
  path: string,
  init: { method?: "GET" | "POST" | "PATCH"; body?: unknown; query?: Record<string, string | undefined>; verb?: string } = {},
): Promise<T> {
  if (!lmsConfigured()) {
    throw new LmsError("The mentor calendar is not set up on this server — LMS_API_URL and LMS_SERVICE_SECRET", 503);
  }
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) params.set(k, v);
  if (config.lms.remoteOrgId) params.set("remoteOrgId", config.lms.remoteOrgId);
  const qs = params.toString();
  const verb = init.verb ?? "answer";

  let res: Response;
  try {
    res = await fetch(`${config.lms.apiUrl}/api/v1/service${path}${qs ? `?${qs}` : ""}`, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", "x-portal-secret": config.lms.serviceSecret },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new LmsError("The LMS could not be reached", 502);
  }
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const why = body?.error?.message ?? body?.message ?? `refused with ${res.status}`;
    // A bad secret is this server's misconfiguration, not something the person asking did.
    throw new LmsError(`The LMS would not ${verb}: ${why}`, res.status === 401 ? 502 : 409);
  }
  if (body?.data === undefined) throw new LmsError("The LMS returned nothing", 502);
  return body.data as T;
}
