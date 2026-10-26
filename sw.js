// Smart Cards PWA Service Worker v4.9.2
const CACHE_NAME = 'smartcards-v4.9.2';
const ASSETS_TO_CACHE = [
  '/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log(`[SW] Purging old stale cache: ${key}`);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Bypass API calls, events streams, diagnostic tunnels, favicon, and HTML documents completely
  if (url.pathname.startsWith('/api/') || 
      url.pathname === '/favicon.ico' || 
      url.pathname === '/' || 
      url.pathname.endsWith('.html') || 
      e.request.destination === 'document') {
    return; // Pass through directly to network
  }

  // Network-first strategy with safe fallback that never rejects or returns undefined
  e.respondWith(
    fetch(e.request)
      .then((networkRes) => {
        // Cache successful basic GET requests (excluding scripts with dynamic query params)
        if (networkRes && networkRes.status === 200 && e.request.method === 'GET' && !url.search) {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone)).catch(() => {});
        }
        return networkRes;
      })
      .catch(async () => {
        const cached = await caches.match(e.request);
        if (cached) return cached;
        // Never return undefined or throw Failed to convert value to 'Response'
        if (e.request.destination === 'document') {
          const fallbackDoc = await caches.match('/index.html');
          if (fallbackDoc) return fallbackDoc;
        }
        return new Response('', { status: 204, statusText: 'No Content (Offline Safe Fallback)' });
      })
  );
});
