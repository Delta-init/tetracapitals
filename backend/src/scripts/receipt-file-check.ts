/**
 * The receipt viewer's file route (finance/receiptFile.ts): which addresses it reads, and what it answers — with the
 * bucket stood in for (no network, no database).
 *
 *   bun src/scripts/receipt-file-check.ts
 */
import { fetchReceipt, receiptHostAllowed } from "../finance/receiptFile";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);

process.env.R2_PUBLIC_URL = "https://media.example-academy.com/";
process.env.RECEIPT_FILE_HOSTS = " files.example.org , ";
const BUCKET = "https://pub-0123abcd.r2.dev";

step("Which addresses");
check("a public R2 bucket", receiptHostAllowed(`${BUCKET}/enrolment-receipts/a/1-IMG_1.HEIC`));
check("this server's own R2_PUBLIC_URL", receiptHostAllowed("https://media.example-academy.com/portal/x.png"));
check("a host in RECEIPT_FILE_HOSTS", receiptHostAllowed("https://files.example.org/x.pdf"));
check("not plain http", !receiptHostAllowed("http://pub-0123abcd.r2.dev/x.png"));
check("not another site", !receiptHostAllowed("https://example.com/x.png"));
check("not a look-alike (r2.dev.evil.com)", !receiptHostAllowed("https://pub-1.r2.dev.evil.com/x.png"));
check("not a sub-sub-domain of r2.dev", !receiptHostAllowed("https://a.b.r2.dev/x.png"));
check("not the private R2 endpoint", !receiptHostAllowed("https://acct.r2.cloudflarestorage.com/bucket/x.png"));
check("not with a user in it", !receiptHostAllowed("https://u:p@pub-0123abcd.r2.dev/x.png"));
check("not local", !receiptHostAllowed("https://127.0.0.1/x.png") && !receiptHostAllowed("https://localhost/x.png"));
check("not garbage", !receiptHostAllowed("") && !receiptHostAllowed("not a url"));

step("What it answers");
const heic = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);   // ....ftypheic
const asked: { url: string; redirect?: string }[] = [];
let answer: () => Response = () => new Response(heic, { headers: { "Content-Type": "image/heic" } });
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  asked.push({ url: String(url), redirect: init?.redirect });
  return answer();
}) as typeof fetch;

let r = await fetchReceipt(`${BUCKET}/enrolment-receipts/a/1-IMG_1.HEIC`);
check("a HEIC photo: 200, its bytes, its type", r.status === 200 && r.headers.get("content-type") === "image/heic"
  && new Uint8Array(await r.arrayBuffer()).join() === heic.join(), `${r.status} ${r.headers.get("content-type")}`);
check("…the portal may read it (CORS) and the browser won't guess its type", !!r.headers.get("access-control-allow-origin") && r.headers.get("x-content-type-options") === "nosniff");
check("…no redirect followed", asked.at(-1)?.redirect === "manual");

answer = () => new Response("<html>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
r = await fetchReceipt(`${BUCKET}/x`);
check("a page, not a file: sent as plain bytes, never as HTML", r.headers.get("content-type") === "application/octet-stream");

answer = () => new Response("%PDF", { headers: { "Content-Type": "application/pdf" } });
r = await fetchReceipt(`${BUCKET}/x.pdf`);
check("a PDF keeps its type", r.headers.get("content-type") === "application/pdf");

answer = () => new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
r = await fetchReceipt(`${BUCKET}/gone.jpg`);
let body: any = await r.json();
check("gone from the bucket: 404 { gone: true }", r.status === 404 && body.gone === true, JSON.stringify(body));

answer = () => new Response(null, { status: 302, headers: { Location: "https://example.com/" } });
r = await fetchReceipt(`${BUCKET}/moved.jpg`);
check("a redirect: 502, not followed", r.status === 502);

answer = () => new Response("x", { status: 403 });
r = await fetchReceipt(`${BUCKET}/private.jpg`);
body = await r.json();
check("refused by the bucket: 502, not \"gone\"", r.status === 502 && !body.gone);

answer = () => new Response(new Uint8Array(26 * 1024 * 1024), { headers: { "Content-Type": "image/jpeg" } });
r = await fetchReceipt(`${BUCKET}/huge.jpg`);
check("over 25 MB: 413", r.status === 413);

const before = asked.length;
r = await fetchReceipt("https://example.com/x.png");
check("another site: 400, never asked", r.status === 400 && asked.length === before);

globalThis.fetch = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
r = await fetchReceipt(`${BUCKET}/x.jpg`);
check("the bucket doesn't answer: 502", r.status === 502);

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
