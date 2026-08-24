/* FCM background service worker — ต้องอยู่ที่ root ของ GitHub Pages
 * ปรับปรุง: เสียง + vibration + requireInteraction เพื่อให้เตือนได้เมื่อแอพอยู่พื้นหลัง
 */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyC4aJKI-HbwWhA6AcZqOS5Wx8ShKvCWN8U",
  authDomain: "pos1-4d72a.firebaseapp.com",
  projectId: "pos1-4d72a",
  storageBucket: "pos1-4d72a.firebasestorage.app",
  messagingSenderId: "598519354918",
  appId: "1:598519354918:web:c41df74ea126644725f8e7"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
  const title = (payload.notification && payload.notification.title) || '🔔 ออเดอร์ใหม่ — ส้มตำนายหนึ่ง';
  const body = (payload.notification && payload.notification.body) || 'มีออเดอร์เข้ามาในระบบ · เปิด POS เพื่อดู';
  const options = {
    body: body,
    icon: './icon/icon-192.png',
    badge: './icon/favicon-32.png',
    tag: 'somtum-order',
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: [200, 100, 200, 100, 400],
    data: payload.data || {},
    actions: [
      { action: 'open', title: 'เปิด POS' }
    ]
  };
  return self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const urlToOpen = './pos.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url && c.url.indexOf('pos.html') !== -1 && 'focus' in c) {
          return c.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })
  );
});
