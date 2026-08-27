/* Somtum POS PWA Service Worker */
const CACHE = 'somtum-pwa-v84';
const ASSETS = [
  './',
  './index.html',
  './pos.html',
  './firebase-config.js',
  './css/customer.css',
  './css/pos.css',
  './js/common.js',
  './js/customer-shared.js',
  './js/customer-core.js',
  './js/customer-pay.js',
  './js/customer-table.js',
  './js/customer-member.js',
  './js/customer-order.js',
  './js/customer-boot.js',
  './js/customer-sw.js',
  './js/pos-shared.js',
  './js/pos-core.js',
  './js/pos-ops.js',
  './js/pos-member.js',
  './js/pos-pay.js',
  './js/pos-settings.js',
  './js/pos-boot.js',
  './js/pos-pwa.js',
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
      // network-first for HTML/JS/CSS so ร้านได้แพตช์ทันที; cache fallback offline
      const isShell = req.mode === 'navigate'
        || (req.headers.get('accept') || '').includes('text/html')
        || /\.(js|css|webmanifest)$/i.test(url.pathname);
      if (isShell) {
        return network.then((r) => r || cached).catch(() => cached || caches.match('./index.html'));
      }
      return cached || network;
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url && c.url.includes('pos.html') && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow('./pos.html');
    })
  );
});
