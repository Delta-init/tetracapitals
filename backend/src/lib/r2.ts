import { S3Client } from "bun";

/* ────────────────────────────────────────────────────────────────────────────
   Cloudflare R2 — the LMS's bucket, our own folder (the user, 2026-10-26:
   "storing in R2, the same learnos-media bucket"). Bun's own S3 client: no
   package to add.

     R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY   the LMS's keys
     R2_BUCKET_NAME   learnos-media unless said
     R2_PUBLIC_URL    the bucket's public address (as the LMS has it) — files are read from there

   Everything the portal puts there is under PREFIX.
──────────────────────────────────────────────────────────────────────────── */

const PREFIX = "portal/";

export const r2Configured = () =>
  !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_PUBLIC_URL);

let client: S3Client | null = null;
function r2(): S3Client {
  if (!r2Configured()) throw new Error("R2 isn't set up on this server (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL)");
  client ??= new S3Client({
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET_NAME || "learnos-media",
    // R2_ENDPOINT only to point elsewhere (a test's stand-in); else the account's own.
    endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  });
  return client;
}

/** Where a file of ours is read from, by anyone. */
export const r2PublicUrl = (key: string) => `${String(process.env.R2_PUBLIC_URL).replace(/\/+$/, "")}/${PREFIX}${key}`;

/** Puts a file at portal/<key>. → its public address. */
export async function r2Put(key: string, body: Uint8Array, type: string): Promise<string> {
  await r2().write(`${PREFIX}${key}`, body, { type });
  return r2PublicUrl(key);
}

/** Removes portal/<key>; nothing there is fine. */
export async function r2Delete(key: string): Promise<void> {
  await r2().delete(`${PREFIX}${key}`).catch(() => {});
}
