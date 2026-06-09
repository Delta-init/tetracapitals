import { config } from "../config";

function cors(headers: Record<string, string> = {}): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": config.corsOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Impersonate-User-Id",
    ...headers,
  };
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: cors({
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    }),
  });
}

export function text(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    ...init,
    headers: cors({
      "Content-Type": "text/plain",
      ...(init.headers as Record<string, string> | undefined),
    }),
  });
}

export function error(message: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, { status });
}

export function notFound(message = "Not found"): Response {
  return error(message, 404);
}

export function unauthorized(message = "Unauthorized"): Response {
  return error(message, 401);
}

export function forbidden(message = "Forbidden"): Response {
  return error(message, 403);
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: cors() });
}
