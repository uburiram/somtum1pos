/* Service Worker — cache ไฟล์คงที่ ไม่แตะข้อมูล Firestore */
const CACHE = 'somtum-pos-v6';
const ASSETS = [
  './',
  './index.html',
  './pos.html',
  './firebase-config.js',
  './manifest.webmanifest',
  './icon/favicon-32.png',
  './icon/icon-192.png',
  './icon/icon-512.png',
  './icon/apple-touch-icon-180.png',
  './icon/icon-maskable-192.png',
  './icon/icon-maskable-512.png',
  './icon/icon_256x256.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // ไม่แคช API ของ Google/Firebase
  if (url.hostname.includes('googleapis.com') ||
      url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('gstatic.com') ||
      url.hostname.includes('firestore.googleapis.com')) {
    return;
  }
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetched = fetch(e.request).then((res) => {
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
