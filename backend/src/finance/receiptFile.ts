import { requireAuth } from "../auth/middleware";
import { cors, error } from "../lib/response";

/* ────────────────────────────────────────────────────────────────────────────
   A payment receipt's file, read for the portal (the user, 2026-10-31: "show
   HEIC in the viewer too"). Receipts live in Cloudflare R2's public buckets —
   finance's and the sales CRMs' — which answer a link but don't let a web page
   read the bytes (no CORS). The receipt viewer needs the bytes to turn an
   iPhone photo (HEIC) into one the browser can draw, and to tell a file that
   is gone from one it only can't show; so it asks here.

     GET /api/receipts/file?url=<the receipt's address>     signed in

   Only from a public R2 bucket (*.r2.dev), this server's own R2_PUBLIC_URL, or
   a host named in RECEIPT_FILE_HOSTS (comma-separated) — never anywhere else,
   and no redirect followed. 404 { gone: true } when the bucket hasn't the file.
──────────────────────────────────────────────────────────────────────────── */

const MAX_BYTES = 25 * 1024 * 1024;

const hostOf = (u: string | undefined) => {
  try { return u ? new URL(u).host.toLowerCase() : ""; } catch { return ""; }
};

/** May a receipt be read from here? https, and a bucket of ours. */
export function receiptHostAllowed(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const host = u.host.toLowerCase();
  const named = String(process.env.RECEIPT_FILE_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return /^[a-z0-9-]+\.r2\.dev$/.test(host) || host === hostOf(process.env.R2_PUBLIC_URL) || named.includes(host);
}

/** The file's bytes, as the bucket has them; a type that isn't a picture or a PDF goes as plain bytes. */
export async function fetchReceipt(raw: string): Promise<Response> {
  if (!receiptHostAllowed(raw)) return error("Not a receipt address", 400);
  let res: Response;
  try {
    res = await fetch(raw, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
  } catch {
    return error("The receipt's storage didn't answer", 502);
  }
  if (res.status === 404) return error("This receipt is no longer in storage", 404, { gone: true });
  if (!res.ok) return error(`The receipt's storage answered ${res.status}`, 502);
  if (Number(res.headers.get("content-length")) > MAX_BYTES) return error("The receipt is too big to show here", 413);
  const body = await res.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return error("The receipt is too big to show here", 413);
  const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  return new Response(body, {
    headers: cors({
      "Content-Type": /^image\/[a-z0-9.+-]+$/.test(type) || type === "application/pdf" ? type : "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    }),
  });
}

export async function handleReceiptFile(req: Request, url: URL): Promise<Response> {
  const user = await requireAuth(req);
  if (user instanceof Response) return user;
  return fetchReceipt(url.searchParams.get("url") ?? "");
}
