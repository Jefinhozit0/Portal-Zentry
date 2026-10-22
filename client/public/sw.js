// Service worker of the Zentry portal. When the server cannot be reached (the notebook
// that runs it is off or asleep), show the "em manutenção" page instead of the browser's error.
// It also shows the app notifications (end of the file).
// It never caches the portal itself, so a new deploy is always picked up.

const CACHE = "zentry-manutencao-v1";
const OFFLINE_PAGE = "/manutencao.html";
const LOGO = "/zentry-logo.png";
// Funnel may hold the connection open for a long time while the notebook sleeps.
const TIMEOUT_MS = 10000;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_PAGE, LOGO])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function offlinePage() {
  const cached = await caches.match(OFFLINE_PAGE);
  return cached || new Response("Portal em manutenção. Tente novamente em alguns minutos.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

async function navigate(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(request, { signal: controller.signal });
    // Bad gateway / unavailable / timeout from the tunnel: the server behind it is not answering.
    if (response.status >= 502 && response.status <= 504) return offlinePage();
    return response;
  } catch {
    return offlinePage();
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (request.mode === "navigate") {
    event.respondWith(navigate(request));
    return;
  }
  // The maintenance page shows the logo even with the server off.
  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.pathname === LOGO) {
    event.respondWith(fetch(request).catch(() => caches.match(LOGO)));
  }
});

// App notifications (sent by server/_core/push.ts): reply from the team, status change, new document.
self.addEventListener("push", (event) => {
  let message = {};
  try { message = event.data ? event.data.json() : {}; } catch { message = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(message.title || "Zentry Soluções", {
    body: message.body || "Há uma novidade no seu processo.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    lang: "pt-BR",
    // Same kind replaces the previous notice instead of piling up.
    tag: message.tag || "zentry",
    renotify: true,
    data: { url: message.url || "/" },
  }));
});

// Tapping the notice brings the portal to the front (an open window if there is one) on the right screen.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin);
  // Only ever opens the portal itself.
  const url = target.origin === self.location.origin ? target.href : self.location.origin + "/";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      if ("navigate" in open) return open.navigate(url).catch(() => undefined);
      return undefined;
    }
    return self.clients.openWindow(url);
  })());
});
