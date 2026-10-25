/* AETHERION service worker: offline shell only. Never caches API/model traffic or cross-origin requests. */
const V = 'ae-v6-7';
const SHELL = ['/', '/playground/', '/assets/brand.css?v=3', '/assets/site.css?v=6', '/assets/playground.css?v=7', '/assets/playground.js?v=8', '/assets/brand/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // network-first so deploys show up immediately; fall back to cache when offline
  e.respondWith(fetch(e.request).then(r => { if (r.ok && !u.pathname.startsWith('/config/') && !u.pathname.startsWith('/content/')) { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); } return r; }).catch(() => caches.match(e.request).then(r => r || caches.match(u.pathname.startsWith('/playground') ? '/playground/' : '/'))));
});
