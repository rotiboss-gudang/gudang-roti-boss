const CACHE_NAME = "roti-boss-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Network-first, biar data produk selalu update
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
