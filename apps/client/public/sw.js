// Kill switch for the retired PWA (laptop only now, docs/future_feature.md). Browsers that
// installed the old service worker fetch this file on their next visit: it deletes every cache,
// unregisters itself and reloads its open tabs, so nobody keeps a stale cached app.
// Delete this file after 1 Dec 2026, once old installs have had time to visit.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) await caches.delete(key);
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
    })(),
  );
});
