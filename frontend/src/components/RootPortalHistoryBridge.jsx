import { useEffect } from "react";

const CHANNEL = "root-portal-history-v1";
const ROOT_ORIGINS = new Set([
  "https://root-sales-crm.deltainstitutions.com",
  "http://localhost:3100",
  "http://127.0.0.1:3100",
]);

function safePath(value) {
  if (typeof value !== "string" || value.length > 4096 || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname === "/sso" || url.pathname.startsWith("/api/")) return null;
    for (const key of ["token", "ssoToken", "access_token", "refresh_token", "id_token", "code"]) url.searchParams.delete(key);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function rootOrigin() {
  try {
    const referrerOrigin = document.referrer ? new URL(document.referrer).origin : "";
    if (ROOT_ORIGINS.has(referrerOrigin)) {
      sessionStorage.setItem("root-portal-origin", referrerOrigin);
      return referrerOrigin;
    }
    const remembered = sessionStorage.getItem("root-portal-origin");
    return remembered && ROOT_ORIGINS.has(remembered) ? remembered : null;
  } catch {
    return null;
  }
}

/**
 * Keeps the Root portal's address bar and back button in step while this app
 * runs inside its frame: reports each page it moves to, and follows a
 * navigation the portal asks for. Only ever talks to the portal's own origins,
 * only when actually framed by one; only same-origin paths are accepted, and
 * sign-in tokens are stripped before a path leaves the frame. The same bridge
 * finance, Media ERP, the LMS and the CRM run.
 */
export default function RootPortalHistoryBridge() {
  useEffect(() => {
    if (window.parent === window) return;
    const targetOrigin = rootOrigin();
    if (!targetOrigin) return;

    let lastPath = "";
    const report = (type) => {
      const path = safePath(`${window.location.pathname}${window.location.search}${window.location.hash}`);
      if (!path || (type === "route" && path === lastPath)) return;
      lastPath = path;
      window.parent.postMessage({ channel: CHANNEL, type, path }, targetOrigin);
    };

    const receiveNavigation = (event) => {
      if (event.origin !== targetOrigin || event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.channel !== CHANNEL || message.type !== "navigate") return;
      const path = safePath(message.path);
      if (path && path !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
        window.location.assign(path);
      }
    };

    const onHistoryChange = () => report("route");
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    const pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      queueMicrotask(onHistoryChange);
      return result;
    };
    const replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      queueMicrotask(onHistoryChange);
      return result;
    };
    window.history.pushState = pushState;
    window.history.replaceState = replaceState;
    window.addEventListener("message", receiveNavigation);
    window.addEventListener("popstate", onHistoryChange);
    window.addEventListener("hashchange", onHistoryChange);
    window.addEventListener("pageshow", onHistoryChange);
    report("ready");

    return () => {
      window.removeEventListener("message", receiveNavigation);
      window.removeEventListener("popstate", onHistoryChange);
      window.removeEventListener("hashchange", onHistoryChange);
      window.removeEventListener("pageshow", onHistoryChange);
      if (window.history.pushState === pushState) window.history.pushState = originalPushState;
      if (window.history.replaceState === replaceState) window.history.replaceState = originalReplaceState;
    };
  }, []);

  return null;
}

