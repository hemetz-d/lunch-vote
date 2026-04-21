// Minimal service worker — present so the PWA is "installable" per Chrome's
// heuristics (installability requires a reachable SW with a fetch handler).
// Deliberately no caching: the app is tiny, always-online, and caching stale
// menus/votes would cause confusion.
self.addEventListener("install", event => { self.skipWaiting(); });
self.addEventListener("activate", event => { event.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", () => {});
