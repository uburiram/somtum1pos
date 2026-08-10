/* Somtum POS PWA Service Worker */
const CACHE = 'somtum-pwa-v8';
const ASSETS = [
  './',
  './index.html',
  './pos.html',
  './firebase-config.js',
  './manifest.webmanifest',
  './icon/favicon-32.png',
  './icon/icon-192.png',
  './icon/icon-512.png',
  './icon/icon-maskable-192.png',
  './icon/icon-maskable-512.png',
  './icon/icon_256x256.png',
  './icon/apple-touch-icon-180.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('cache install', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firestore') ||
    url.hostname.includes('google.com') ||
    url.hostname.includes('cdnjs') ||
    url.hostname.includes('fonts.')
  ) {
    return; // network only for APIs/CDN
  }
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && url.origin === self.location.origin) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      // network-first for HTML so updates apply; cache fallback offline
      if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
        return network.then((r) => r || cached).catch(() => cached || caches.match('./index.html'));
      }
      return cached || network;
    })
  );
});
