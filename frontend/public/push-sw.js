// Delta CS Portal — notifications on this phone or computer (Web Push), as in the Sales CRM.
// The server sends them (backend/src/lib/notify.ts): a new student, the day's follow-ups, a WhatsApp message,
// students who haven't joined a live class (students/liveNotJoinedPush.ts).

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let p = {};
  try {
    p = event.data ? event.data.json() : {};
  } catch {
    p = { title: "Delta", body: event.data ? event.data.text() : "" };
  }
  // Not joined yet: its own long buzz, and it stays until tapped (the sound is the device's own; an open portal plays its tone).
  const urgent = (p.data || {}).type === "live_not_joined";
  const options = {
    body: p.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: p.tag || "delta",
    renotify: !!p.renotify,
    data: { url: p.url || "/", ...(p.data || {}) },
    vibrate: urgent ? [600, 150, 600, 150, 600, 150, 1000] : [200, 100, 200],
    ...(urgent ? { requireInteraction: true } : {}),
  };
  event.waitUntil((async () => {
    await self.registration.showNotification(p.title || "Delta", options);
    // A portal that is open refreshes its bell straight away.
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of open) c.postMessage({ type: "PUSH", data: { ...(p.data || {}), tag: p.tag || "", title: p.title || "" } });
  })());
});

// A tap opens what it is about — in the portal tab already open, else a new one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of open) {
      if (c.url.startsWith(self.location.origin) && "focus" in c) {
        c.postMessage({ type: "NAVIGATE", url });
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
