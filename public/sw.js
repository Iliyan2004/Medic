// Service worker: makes the app open offline. API calls are never cached (health data must not linger on shared phones).
//
// App code (HTML/JS/CSS) is NETWORK-FIRST: when online you always get the current version, so old and new
// files are never mixed after an update. The cache is used only when the network fails (offline).
// Big third-party files (/vendor: map library, QR library) are versioned and rarely change → cache-first.
const VERSION = 'sy-v7';
const SHELL = ['/', '/index.html', '/css/app.css', '/js/app.js', '/js/tilt.js', '/js/i18n.js', '/js/phone.js', '/js/tools.js', '/js/ur.js',
  ...['_shared', '_map', 'home', 'emergency', 'care', 'pharmacy', 'records', 'map', 'auth', 'insurance', 'support', 'community', 'energy', 'privacy', 'work'].map((v) => `/js/views/${v}.js`),
  '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// ── Dose reminders on a locked phone. Pushes are empty, so the text is generic; discreet mode
// (saved by the page into a tiny cache entry) removes even the word "medicine".
self.addEventListener('message', (e) => {
  if (e.data?.type === 'prefs') e.waitUntil(caches.open('sy-prefs').then((c) => c.put('/__prefs', new Response(JSON.stringify(e.data.prefs)))));
});
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let discreet = false;
    try { discreet = !!(await (await (await caches.open('sy-prefs')).match('/__prefs'))?.json())?.discreet; } catch { /* default */ }
    await self.registration.showNotification(discreet ? 'Planner' : 'Sehatyab', {
      body: discreet ? 'You have a reminder' : 'Time to take your medicine — tap to mark it taken',
      icon: discreet ? undefined : '/icon.svg', tag: 'dose', renotify: true, data: { url: '/#/care' },
    });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = all.find((c) => new URL(c.url).origin === location.origin);
    if (open) { await open.focus(); open.navigate?.(e.notification.data?.url || '/'); } else await self.clients.openWindow(e.notification.data?.url || '/');
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/__')) return;
  const isNav = e.request.mode === 'navigate';
  const key = isNav ? '/index.html' : e.request;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    if (url.pathname.startsWith('/vendor/')) {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }
    try {
      const res = await fetch(e.request, { cache: 'no-cache' });
      if (res.ok) cache.put(key, res.clone());
      return res;
    } catch {
      return (await cache.match(key)) || Response.error();
    }
  }));
});
