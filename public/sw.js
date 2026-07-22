// Minimal service worker — presence alone satisfies PWA installability
// criteria. No offline caching strategy yet; add one if that's wanted.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Pass-through — no caching yet.
});
