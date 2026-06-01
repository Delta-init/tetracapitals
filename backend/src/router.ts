import { stat, readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import { config } from "./config";
import { json, notFound, corsPreflight } from "./lib/response";
import { handleRegister, handleLogin, handleMe, handleChangePassword } from "./auth/routes";
import {
  listEntity, filterEntity, getEntityById, createEntity,
  bulkCreateEntity, updateEntity, deleteEntity,
} from "./entities/crud";
import {
  handleUploadFile, handleSendEmail, handleSendSMS,
  handleInvokeLLM, handleGenerateImage, handleExtractDataFromUploadedFile,
} from "./integrations/core";
import { invokeFunction, listFunctions } from "./functions/index";

/**
 * Main HTTP router. The API is namespaced under /api.
 *   POST   /api/auth/register
 *   POST   /api/auth/login
 *   GET    /api/auth/me
 *   POST   /api/auth/change-password
 *
 *   GET    /api/entities/:entity                  (list, query: order, limit, skip)
 *   POST   /api/entities/:entity/filter           (filter: body { query, order, limit, skip })
 *   GET    /api/entities/:entity/:id              (get by id)
 *   POST   /api/entities/:entity                  (create)
 *   POST   /api/entities/:entity/bulk             (bulk create)
 *   PATCH  /api/entities/:entity/:id              (update)
 *   DELETE /api/entities/:entity/:id              (delete)
 *
 *   POST   /api/functions/:name                   (invoke custom function)
 *   POST   /api/integrations/UploadFile           (multipart upload)
 *   POST   /api/integrations/SendEmail | SendSMS | InvokeLLM | GenerateImage | ExtractDataFromUploadedFile
 *
 *   GET    /uploads/:filename                     (static file)
 *   GET    /health
 */
export async function route(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return corsPreflight();
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/health") return json({ ok: true, time: new Date().toISOString() });

  // ---- Auth ----
  if (path === "/api/auth/register" && req.method === "POST") return handleRegister(req);
  if (path === "/api/auth/login" && req.method === "POST") return handleLogin(req);
  if (path === "/api/auth/me" && req.method === "GET") return handleMe(req);
  if (path === "/api/auth/change-password" && req.method === "POST") return handleChangePassword(req);

  // ---- Entities ----
  const entityMatch = path.match(/^\/api\/entities\/([A-Za-z0-9_]+)(?:\/([^/]+))?$/);
  if (entityMatch) {
    const [, entityName, segment] = entityMatch;
    if (!segment) {
      if (req.method === "GET") return listEntity(req, entityName);
      if (req.method === "POST") return createEntity(req, entityName);
    } else if (segment === "filter" && req.method === "POST") {
      return filterEntity(req, entityName);
    } else if (segment === "bulk" && req.method === "POST") {
      return bulkCreateEntity(req, entityName);
    } else {
      if (req.method === "GET") return getEntityById(req, entityName, segment);
      if (req.method === "PATCH" || req.method === "PUT") return updateEntity(req, entityName, segment);
      if (req.method === "DELETE") return deleteEntity(req, entityName, segment);
    }
    return notFound();
  }

  // ---- Functions ----
  const fnMatch = path.match(/^\/api\/functions\/([A-Za-z0-9_]+)$/);
  if (fnMatch) {
    if (req.method !== "POST") return notFound();
    return invokeFunction(req, fnMatch[1]);
  }
  if (path === "/api/functions" && req.method === "GET") {
    return json({ functions: listFunctions() });
  }

  // ---- Integrations ----
  if (path === "/api/integrations/UploadFile" && req.method === "POST") return handleUploadFile(req);
  if (path === "/api/integrations/SendEmail" && req.method === "POST") return handleSendEmail(req);
  if (path === "/api/integrations/SendSMS" && req.method === "POST") return handleSendSMS(req);
  if (path === "/api/integrations/InvokeLLM" && req.method === "POST") return handleInvokeLLM(req);
  if (path === "/api/integrations/GenerateImage" && req.method === "POST") return handleGenerateImage(req);
  if (path === "/api/integrations/ExtractDataFromUploadedFile" && req.method === "POST") return handleExtractDataFromUploadedFile(req);

  // ---- Static uploads ----
  if (path.startsWith("/uploads/") && req.method === "GET") {
    const rel = path.replace(/^\/uploads\//, "");
    // Prevent path traversal
    if (rel.includes("..") || rel.includes("\0")) return notFound();
    const full = normalize(join(config.uploadDir, rel));
    const root = normalize(config.uploadDir);
    if (!full.startsWith(root + sep) && full !== root) return notFound();
    try {
      const st = await stat(full);
      if (!st.isFile()) return notFound();
      const body = await readFile(full);
      return new Response(body);
    } catch {
      return notFound();
    }
  }

  return notFound();
}
