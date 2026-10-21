// Офлайн без залипания старой версии.
// Код и страница — сначала из сети (мимо HTTP-кеша), кеш — только запасной вариант без сети.
// Шрифты, иконки и гравюры не меняются — сразу из кеша.
const CACHE = 't2d-v135';   // при выкладке менять вместе с app.js?v= в index.html
const SHELL = ['./', './index.html', './app.js', './cymatica.js', './plate-worklet.js', './laboratorium.js', './natura.js', './inferno.js', './paradisus.js', './monochord.js', './monochord-worklet.js', './oceanus.js', './ocean-worklet.js', './horologium.js', './firmamentum.js', './pulsar-worklet.js', './tria.js', './manifest.webmanifest'];
const STATIC = ['./icon-180.png', './icon-192.png', './icon-512.png',
  './fonts/im-fell-english-latin-400-italic.woff2', './fonts/im-fell-english-latin-400-normal.woff2',
  './art/leo-viridis.png', './art/leo-viridis-wash.png', './art/fons-mercurialis.png', './art/terra-octobre.jpg'];
const NET_WAIT = 3500;      // плохая сеть — не ждать дольше, отдать кеш

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([...SHELL, ...STATIC].map((u) => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isStatic = (url) => /\.(png|jpg|woff2)$/.test(url.pathname);

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/_vercel/')) return;   // аналитика Vercel — мимо кеша, прямо в сеть
  e.respondWith(caches.open(CACHE).then(async (c) => {
    if (isStatic(url)) {
      const hit = await c.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }
    const cached = async () => {
      let hit = await c.match(e.request, { ignoreSearch: true });
      if (!hit && e.request.mode === 'navigate') hit = await c.match('./index.html');
      return hit;
    };
    // запрос страницы (navigate) переопределять нельзя — берём по адресу, мимо HTTP-кеша
    const net = fetch(url.href, { cache: 'no-store', credentials: 'same-origin' }).then((r) => {
      if (r.ok) c.put(e.request, r.clone());
      return r;
    });
    const timeout = new Promise((res) => setTimeout(res, NET_WAIT));
    try {
      const r = await Promise.race([net, timeout]);
      if (r) return r;
      return (await cached()) || (await net);   // сеть тормозит: кеш, а если его нет — всё-таки ждём сеть
    } catch (_) {
      return (await cached()) || Response.error();
    }
  }));
});
