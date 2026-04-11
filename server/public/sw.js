const CACHE_NAME = 'hot-potato-v3';
const ASSETS = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Skip socket.io and non-GETs entirely
  if (e.request.url.includes('/socket.io/') || e.request.method !== 'GET') return;
  // Never cache API routes — they must always hit the live server. Otherwise
  // the SW can hand back stale data like an old VAPID public key, which
  // causes push subscriptions to be bound to keys the server no longer has.
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/health')) {
    return; // let the browser fetch normally, no SW caching
  }
  e.respondWith(
    fetch(e.request).then(r => {
      const clone = r.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      return r;
    }).catch(() => caches.match(e.request))
  );
});

// --- Web Push: incoming potato notification ---
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || '🥔🔥 INCOMING POTATO!';
  const body = data.body || 'A friend tossed ye a hot potato — toss it back before it burns!';
  const options = {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'potato-incoming',
    renotify: true,
    requireInteraction: false,
    vibrate: [120, 60, 120, 60, 200],
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Click on the notification → focus an existing tab or open the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      // Focus the first same-origin tab we already have open
      try {
        const url = new URL(client.url);
        if (url.origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client) { try { await client.navigate(target); } catch (_) {} }
          return;
        }
      } catch (_) {}
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(target);
    }
  })());
});
