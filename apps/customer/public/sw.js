// Minimal service worker: the app shell opens instantly (and offline shows the
// last shell instead of an error). API calls are never cached — balances and
// bookings always come live from the server.
const SHELL = "arena-shell-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon.svg"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/v1/")) return;
  // Network first for navigations (fresh app), cache as fallback; cache first for hashed assets.
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then((r) => (caches.open(SHELL).then((c) => c.put("/", r.clone())), r)).catch(() => caches.match("/")));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(caches.match(e.request).then((hit) => hit ?? fetch(e.request).then((r) => (caches.open(SHELL).then((c) => c.put(e.request, r.clone())), r))));
  }
});
