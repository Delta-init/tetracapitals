import { config } from "../config";

/* ────────────────────────────────────────────────────────────────────────────
   Abzer (BillXpro / SmartInvoice): a hosted payment link for an amount, as the
   LMS's checkout makes them (lms/backend/src/services/abzer.service.ts; API
   v5.1):

     POST /authenticate { accessKey, secretKey }        → { token } (60 min; kept 50)
     POST /direct-payment-request/extended { … }       → { id }
     GET  /direct-payment-request/{id}/link-generate   → { mailLink, isLinkExpired }

   Payment confirmations go to the account's one webhook — the LMS's, which
   answers 200 and ignores a reference it has no order for — so nothing here
   hears of a payment. Links only: nothing here moves money.
──────────────────────────────────────────────────────────────────────────── */

const TIMEOUT_MS = 20_000;

export const abzerConfigured = (): boolean => !!(config.abzer.accessKey && config.abzer.secretKey && config.abzer.baseUrl);

/** Abzer said no, or couldn't be reached — its reason, for the page. */
export class AbzerError extends Error {}

let token: { value: string; until: number } | null = null;

async function call<T>(path: string, init: { method: "GET" | "POST"; body?: unknown; signedIn?: boolean }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.abzer.baseUrl}${path}`, {
      method: init.method,
      headers: {
        "content-type": "application/json",
        ...(init.signedIn ? { authorization: `Bearer ${await signIn()}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof AbzerError) throw err;
    throw new AbzerError("Abzer could not be reached");
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON: its text says why */ }
  if (!res.ok) {
    if (res.status === 401 && init.signedIn) token = null;   // a token Abzer no longer takes: a fresh one next time
    const why = data?.message ?? data?.error ?? data?.title ?? (text.trim().slice(0, 200) || `answered ${res.status}`);
    throw new AbzerError(`Abzer refused (${res.status}): ${why}`);
  }
  return data as T;
}

/** A sign-in token, kept 50 of its 60 minutes. */
async function signIn(): Promise<string> {
  if (token && Date.now() < token.until) return token.value;
  const data = await call<{ token?: string }>("/authenticate", {
    method: "POST",
    body: { accessKey: config.abzer.accessKey, secretKey: config.abzer.secretKey },
  });
  if (!data?.token) throw new AbzerError("Abzer gave no sign-in token");
  token = { value: data.token, until: Date.now() + 50 * 60_000 };
  return data.token;
}

/** Only Abzer's sign-in — checks the keys and makes nothing. */
export async function checkAbzerKeys(): Promise<void> {
  token = null;
  await signIn();
}

/**
 * A hosted payment link for `amount` in the account's currency (AED), for the student — `reference` is echoed back
 * as the payment's invoice number. → { id, url } (Abzer's request id, and the link).
 */
export async function createAbzerLink(o: { amount: number; reference: string; name: string; email: string; phone?: string }): Promise<{ id: string; url: string }> {
  if (!abzerConfigured()) throw new AbzerError("Abzer isn't set up on this server (ABZER_ACCESS_KEY, ABZER_SECRET_KEY)");
  const parts = o.name.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || "Student";
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : firstName;   // Abzer wants both
  const created = await call<{ id?: string }>("/direct-payment-request/extended", {
    method: "POST",
    signedIn: true,
    body: {
      templateConfiguration: { code: config.abzer.templateCode },
      firstName,
      lastName,
      email: o.email,
      mobileNo: o.phone ?? "",
      amount: o.amount,
      referenceNumber: o.reference,
      successUrl: config.abzer.returnUrl,
      failureUrl: config.abzer.returnUrl,
      cancelUrl: config.abzer.returnUrl,
    },
  });
  if (!created?.id) throw new AbzerError("Abzer made no payment request");
  const link = await call<{ mailLink?: string; isLinkExpired?: boolean }>(
    `/direct-payment-request/${encodeURIComponent(created.id)}/link-generate`,
    { method: "GET", signedIn: true },
  );
  if (!link?.mailLink || link.isLinkExpired) throw new AbzerError("Abzer gave no payment link");
  return { id: String(created.id), url: link.mailLink };
}
