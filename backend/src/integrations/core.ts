import { mkdir, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config";
import { json, error, unauthorized } from "../lib/response";
import { getAuthUser } from "../auth/middleware";

/**
 * POST /api/integrations/UploadFile
 * multipart/form-data with field `file`. Returns { file_url }.
 * Saves to UPLOAD_DIR and exposes under PUBLIC_BASE_URL/uploads/<file>.
 */
export async function handleUploadFile(req: Request): Promise<Response> {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const form = await req.formData().catch(() => null);
  if (!form) return error("Expected multipart/form-data", 400);
  const file = form.get("file");
  if (!(file instanceof File)) return error("Missing 'file' field", 400);

  await mkdir(config.uploadDir, { recursive: true });
  const ext = extname(file.name) || "";
  const safeName = `${Date.now()}-${randomUUID()}${ext}`;
  const fullPath = join(config.uploadDir, safeName);
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(fullPath, buf);
  const file_url = `${config.publicBaseUrl.replace(/\/$/, "")}/uploads/${safeName}`;
  return json({ file_url, name: file.name, size: file.size, type: file.type });
}

/**
 * POST /api/integrations/SendEmail
 * Body: { to, subject, body, from? }.
 * If SMTP env vars aren't set, logs and returns success. Replace with a real provider
 * (nodemailer / Resend / SendGrid) when you wire one up.
 */
export async function handleSendEmail(req: Request): Promise<Response> {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  const body: any = await req.json().catch(() => null);
  if (!body?.to || !body?.subject) return error("to and subject are required", 400);
  if (!config.smtp.host) {
    console.log("[SendEmail STUB]", { to: body.to, subject: body.subject });
    return json({ ok: true, stub: true });
  }
  // TODO: integrate a real SMTP/HTTP email provider here.
  console.log("[SendEmail]", { to: body.to, subject: body.subject });
  return json({ ok: true });
}

/** POST /api/integrations/SendSMS — stub that logs the request. */
export async function handleSendSMS(req: Request): Promise<Response> {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  const body: any = await req.json().catch(() => null);
  if (!body?.to || !body?.message) return error("to and message are required", 400);
  console.log("[SendSMS STUB]", { to: body.to, message: body.message });
  return json({ ok: true, stub: true });
}

/**
 * POST /api/integrations/InvokeLLM
 * Body: { prompt, model?, response_json_schema? }
 * Calls Anthropic Messages API if ANTHROPIC_API_KEY is set, otherwise returns a stub.
 */
export async function handleInvokeLLM(req: Request): Promise<Response> {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  const body: any = await req.json().catch(() => null);
  if (!body?.prompt) return error("prompt is required", 400);

  if (!config.anthropicApiKey) {
    return json({ output: `(LLM stub) ${String(body.prompt).slice(0, 200)}`, stub: true });
  }

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: body.model ?? "claude-sonnet-4-6",
      max_tokens: body.max_tokens ?? 1024,
      messages: [{ role: "user", content: String(body.prompt) }],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return error((data as any)?.error?.message ?? "LLM call failed", r.status);
  const text = (data as any)?.content?.[0]?.text ?? "";
  return json({ output: text, raw: data });
}

/** POST /api/integrations/GenerateImage — stub. */
export async function handleGenerateImage(req: Request): Promise<Response> {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  return json({ url: "", stub: true, message: "GenerateImage not yet implemented" });
}

/** POST /api/integrations/ExtractDataFromUploadedFile — naive text passthrough. */
export async function handleExtractDataFromUploadedFile(req: Request): Promise<Response> {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  const body: any = await req.json().catch(() => null);
  if (!body?.file_url) return error("file_url is required", 400);
  return json({ data: null, stub: true, message: "ExtractDataFromUploadedFile not yet implemented" });
}
