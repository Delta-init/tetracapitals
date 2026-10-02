import { config } from "../config";

/* ────────────────────────────────────────────────────────────────────────────
   Tabby payment links — Tabby's Custom Payment Links
   (https://docs.tabby.ai/offline-payment-methods/custom-payment-links):

     POST /api/v2/checkout                          a session for the amount: "created", or "rejected"
                                                    when Tabby won't take this student for it (pre-scoring)
     POST /api/v2/checkout/{session}/send_hpp_link  Tabby texts the student the link (SMS / push)
     GET  /api/v2/payments/{payment}                where it stands: CREATED → AUTHORIZED / CLOSED (paid),
                                                    REJECTED or EXPIRED
     POST /api/v2/checkout/{session}/cancel         expire a link that isn't paid yet

   Links only: nothing here captures, refunds or closes a payment. A session
   lasts 20 minutes (Tabby's default), and the payment turns EXPIRED 5 minutes
   after. The same Tabby account as the LMS (TABBY_* — see config.ts).
──────────────────────────────────────────────────────────────────────────── */

export const tabbyConfigured = (): boolean => !!(config.tabby.secretKey && config.tabby.merchantCode);

/** Tabby's own words for a student it won't take — its QA checks they are shown as given, so they are not reworded. */
const REJECTION: Record<string, string> = {
  not_available: "Sorry, Tabby is unable to approve this purchase. Please use an alternative payment method for your order.",
  order_amount_too_high: "This purchase is above your current spending limit with Tabby, try a smaller cart or use another payment method",
  order_amount_too_low: "The purchase amount is below the minimum amount required to use Tabby, try adding more items or use another payment method",
};
export const rejectionMessage = (reason?: string | null): string => REJECTION[reason ?? ""] ?? REJECTION.not_available;

/** Tabby ids are UUIDs. They go into the path of a call made with the secret key, so nothing else is let through. */
const TABBY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isTabbyId = (v: unknown): v is string => typeof v === "string" && TABBY_ID.test(v);

/** Tabby answers a string over 255 characters with 400 bad_data. */
const field = (v: string, max = 255): string => (v.length <= max ? v : `${v.slice(0, max - 1)}…`);

export class TabbyError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
    this.name = "TabbyError";
  }
}

async function call(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 20_000): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${config.tabby.apiUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${config.tabby.secretKey}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new TabbyError(`Tabby could not be reached (${err instanceof Error ? err.message : String(err)})`);
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    // The whole answer can echo the student's details back: the server log has it, the browser gets Tabby's short reason.
    console.error(`[tabby] ${method} ${path.replace(/[0-9a-f-]{36}/gi, ":id")} → ${res.status}: ${text.slice(0, 500)}`);
    throw new TabbyError(String(data?.error || data?.message || `Tabby answered ${res.status}`).slice(0, 200), res.status);
  }
  return data;
}

export interface LinkRequest {
  /** "1500.00" */
  amount: string;
  /** What it is for — the item on the Tabby page. */
  description: string;
  /** Our number for it, on Tabby's Merchant Dashboard. */
  referenceId: string;
  lang: "en" | "ar";
  /** phone "+9715…" (required — the link goes there); name and email when known. */
  buyer: { phone: string; name?: string; email?: string };
  /** When the student joined (ISO) — Tabby scores on it. */
  registeredSince?: string;
  /** e.g. the student's code. */
  customer?: string;
}

export type SessionResult =
  | { status: "created"; sessionId: string; paymentId: string; url: string }
  | { status: "rejected"; reason: string; message: string; sessionId: string; paymentId: string };

/** A session for the amount — or Tabby's no, with its reason. */
export async function createSession(r: LinkRequest): Promise<SessionResult> {
  const data = await call("POST", "/api/v2/checkout", {
    payment: {
      amount: r.amount,
      currency: config.tabby.currency,
      description: field(r.description),
      buyer: {
        phone: r.buyer.phone,
        ...(r.buyer.name ? { name: field(r.buyer.name) } : {}),
        ...(r.buyer.email ? { email: r.buyer.email } : {}),
      },
      ...(r.registeredSince ? { buyer_history: { registered_since: r.registeredSince, loyalty_level: 0 } } : {}),
      order: {
        reference_id: r.referenceId,
        updated_at: new Date().toISOString(),
        items: [{ title: field(r.description), quantity: 1, unit_price: r.amount, category: "Digital Services" }],
      },
      meta: { order_id: r.referenceId, ...(r.customer ? { customer: r.customer } : {}) },
    },
    lang: r.lang,
    merchant_code: config.tabby.merchantCode,
  }, 30_000);
  const sessionId = isTabbyId(data?.id) ? data.id : "";
  const paymentId = isTabbyId(data?.payment?.id) ? data.payment.id : "";
  if (data?.status === "rejected") {
    const reason = String(data?.configuration?.products?.installments?.rejection_reason || "not_available");
    return { status: "rejected", reason, message: rejectionMessage(reason), sessionId, paymentId };
  }
  const url = String(data?.configuration?.available_products?.installments?.[0]?.web_url ?? "");
  if (data?.status !== "created" || !sessionId || !paymentId) {
    console.error(`[tabby] session not opened: status ${data?.status}, session ${sessionId ? "ok" : "missing"}, payment ${paymentId ? "ok" : "missing"}`);
    throw new TabbyError("Tabby did not open a payment for this");
  }
  return { status: "created", sessionId, paymentId, url };
}

/** Tabby texts the student the session's link. */
export async function sendLink(sessionId: string): Promise<void> {
  if (!isTabbyId(sessionId)) throw new TabbyError("Not a Tabby session");
  await call("POST", `/api/v2/checkout/${sessionId}/send_hpp_link`);
}

/** Expire a link not paid yet. "finalized": too late — it was paid, declined or had expired (check the payment). */
export async function cancelSession(sessionId: string): Promise<"cancelled" | "finalized"> {
  if (!isTabbyId(sessionId)) throw new TabbyError("Not a Tabby session");
  try {
    await call("POST", `/api/v2/checkout/${sessionId}/cancel`);
    return "cancelled";
  } catch (err) {
    if (err instanceof TabbyError && err.status === 400 && /finali[sz]ed/i.test(err.message)) return "finalized";
    throw err;
  }
}

/** Where a payment stands — CREATED, AUTHORIZED, CLOSED, REJECTED or EXPIRED (Tabby's words, upper case). */
export async function getPayment(paymentId: string): Promise<{ status: string; captured: boolean }> {
  if (!isTabbyId(paymentId)) throw new TabbyError("Not a Tabby payment");
  const data = await call("GET", `/api/v2/payments/${paymentId}`);
  return { status: String(data?.status ?? "").toUpperCase(), captured: Array.isArray(data?.captures) && data.captures.length > 0 };
}
