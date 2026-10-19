// Офлайн: приложение открывается и без сети. Сразу отдаём из кэша, а в фоне тянем свежую версию —
// после деплоя новая версия подхватится со следующего запуска.
const CACHE = 't2d-v3';
const FILES = ['./', './index.html', './app.js', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request)
      .then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })
      .catch(() => hit);
    return hit || net;
  }));
});
