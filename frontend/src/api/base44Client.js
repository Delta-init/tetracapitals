/**
 * Drop-in replacement for the Base44 SDK client.
 *
 * The React code already uses `base44.entities.<Entity>.list/filter/get/create/update/delete/bulkCreate`,
 * `base44.auth.me()`, and `base44.integrations.Core.<Integration>(...)`. This shim implements those
 * methods against the custom Bun + MongoDB backend we ship in /backend.
 *
 * Configure via Vite env: `VITE_API_URL` (default: http://localhost:4000).
 *
 *   .env.development
 *   VITE_API_URL=http://localhost:4000
 *
 * Authentication: after a successful POST /api/auth/login, the JWT is stored in
 * localStorage under "st_token". All subsequent calls include `Authorization: Bearer <token>`.
 */

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");
const TOKEN_KEY = "st_token";
const IMPERSONATION_KEY = "impersonated_user";   // keep in sync with ImpersonationContext.jsx

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function setToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {}
}

// When the user is impersonating, return the target id so we can ship it to
// the backend as a header. The backend honors it ONLY when the real user is
// super_admin / admin, so this header is safe to send unconditionally.
function getImpersonationId() {
  try {
    const raw = sessionStorage.getItem(IMPERSONATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.targetUser?.id || null;
  } catch {
    return null;
  }
}

async function api(path, { method = "GET", body, isForm = false } = {}) {
  const headers = {};
  if (!isForm) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  // Pass through impersonation when active — the backend treats it as "act as
  // this user" for permission checks and audit trail.
  const impId = getImpersonationId();
  if (impId) headers["X-Impersonate-User-Id"] = impId;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get("content-type") || "";
  const payload = ct.includes("application/json") ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const msg = (payload && payload.error) || res.statusText || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.payload = payload;
    // Axios-shaped, for legacy SDK callers that read `error.response.data.error`.
    err.response = { data: payload, status: res.status };
    throw err;
  }
  return payload;
}

/** Wrap a JSON response in the axios shape Base44-SDK callers expect. */
async function apiWrap(path, opts) {
  const data = await api(path, opts);
  return { data, status: 200 };
}

function buildEntity(name) {
  const base = `/api/entities/${name}`;
  return {
    // The Base44 SDK list() with no limit returned every row. Match that here
    // by sending a very high default so callers like `Student.list()` get the
    // full collection instead of being silently truncated to 100.
    list: async (order, limit, skip = 0) => {
      const qs = new URLSearchParams();
      if (order) qs.set("order", order);
      qs.set("limit", String(limit ?? 100_000));
      qs.set("skip", String(skip ?? 0));
      return api(`${base}?${qs.toString()}`);
    },
    filter: async (query, order, limit, skip = 0) => {
      return api(`${base}/filter`, {
        method: "POST",
        body: { query: query || {}, order: order || null, limit: limit ?? 100_000, skip: skip ?? 0 },
      });
    },
    get: async (id) => api(`${base}/${encodeURIComponent(id)}`),
    create: async (data) => api(base, { method: "POST", body: data }),
    bulkCreate: async (items) => api(`${base}/bulk`, { method: "POST", body: items }),
    update: async (id, data) => api(`${base}/${encodeURIComponent(id)}`, { method: "PATCH", body: data }),
    delete: async (id) => api(`${base}/${encodeURIComponent(id)}`, { method: "DELETE" }),
  };
}

// Build the entity proxy lazily so any entity name the frontend references works.
const entitiesProxy = new Proxy({}, {
  get(_target, key) {
    if (typeof key !== "string") return undefined;
    return buildEntity(key);
  },
});

const auth = {
  me: () => api("/api/auth/me"),
  login: async ({ email, password }) => {
    const out = await api("/api/auth/login", { method: "POST", body: { email, password } });
    if (out?.token) setToken(out.token);
    return out;
  },
  register: async (data) => {
    const out = await api("/api/auth/register", { method: "POST", body: data });
    if (out?.token) setToken(out.token);
    return out;
  },
  logout: (redirectTo) => {
    setToken(null);
    if (typeof window !== "undefined" && redirectTo === true) window.location.href = "/Login";
  },
  // Aliases preserved from the Base44 SDK so legacy callers keep working.
  redirectToLogin: () => {
    if (typeof window !== "undefined") window.location.href = "/Login";
  },
  changePassword: (current_password, new_password) =>
    api("/api/auth/change-password", { method: "POST", body: { current_password, new_password } }),
};

const Core = {
  UploadFile: async (fileOrFormData) => {
    let form;
    if (fileOrFormData instanceof FormData) {
      form = fileOrFormData;
    } else if (fileOrFormData?.file instanceof File) {
      form = new FormData();
      form.append("file", fileOrFormData.file);
    } else if (fileOrFormData instanceof File) {
      form = new FormData();
      form.append("file", fileOrFormData);
    } else {
      throw new Error("UploadFile expects a File, FormData, or { file }");
    }
    return api("/api/integrations/UploadFile", { method: "POST", body: form, isForm: true });
  },
  SendEmail: (data) => api("/api/integrations/SendEmail", { method: "POST", body: data }),
  SendSMS: (data) => api("/api/integrations/SendSMS", { method: "POST", body: data }),
  InvokeLLM: (data) => api("/api/integrations/InvokeLLM", { method: "POST", body: data }),
  GenerateImage: (data) => api("/api/integrations/GenerateImage", { method: "POST", body: data }),
  ExtractDataFromUploadedFile: (data) =>
    api("/api/integrations/ExtractDataFromUploadedFile", { method: "POST", body: data }),
};

// Two forms the SDK supports — both return the axios-shaped { data, status }
// envelope so callers that read `res.data.users` keep working.
//   base44.functions.createReferralRequest(body)         → { data, status }
//   base44.functions.invoke('createReferralRequest', body) → { data, status }
const functions = new Proxy({}, {
  get(_t, key) {
    if (typeof key !== "string") return undefined;
    if (key === "invoke") {
      return (name, body = {}) =>
        apiWrap(`/api/functions/${encodeURIComponent(name)}`, { method: "POST", body });
    }
    return (body = {}) =>
      apiWrap(`/api/functions/${encodeURIComponent(key)}`, { method: "POST", body });
  },
});

// Catch-all no-op proxy for SDK surfaces we haven't implemented (e.g. `appLogs`,
// analytics, telemetry). Any property access returns an async no-op so legacy
// callers like `base44.appLogs.logUserInApp(...)` resolve to a quiet success.
const noopAsync = () => Promise.resolve();
const noopProxy = new Proxy(noopAsync, {
  get(_t, key) {
    if (key === "then") return undefined;          // not thenable
    if (typeof key === "symbol") return undefined;
    return noopProxy;                              // any.deep.chain works
  },
  apply() { return Promise.resolve(); },
});

export const base44 = {
  entities: entitiesProxy,
  auth,
  integrations: { Core },
  functions,
  // asServiceRole is a no-op proxy: our backend already enforces auth via JWT roles.
  asServiceRole: { entities: entitiesProxy, functions },
  // Quiet stubs for Base44-only SDK surfaces (logging, analytics, etc).
  appLogs: { logUserInApp: noopAsync, log: noopAsync },
  analytics: noopProxy,
  app: noopProxy,
};

export default base44;
