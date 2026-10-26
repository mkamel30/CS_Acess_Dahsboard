// SmartCS Service Worker Auto-Cleaner & Purge Engine v4.9.3
// Completely purges all legacy caches and unregisters to prevent stale cache lock-in
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => {
        console.log('[SW] Purging stale cache:', key);
        return caches.delete(key);
      }));
    }).then(() => {
      return self.registration.unregister();
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Note: No fetch listener. All requests pass directly to network without SW interception.
