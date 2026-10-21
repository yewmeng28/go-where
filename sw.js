'use strict';
const CACHE = 'gw-v8';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(SHELL);
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET') return;
  // only the app's own files are cached; the map library, tiles and search always go to the network
  if (u.origin !== location.origin) return;
  e.respondWith(caches.match(r).then(hit => {
    const net = fetch(r).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(r, res.clone()));
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
