// Офлайн без залипания старой версии.
// Код и страница — сначала из сети (мимо HTTP-кеша), кеш — только запасной вариант без сети.
// Шрифты, иконки и гравюры не меняются — сразу из кеша.
const CACHE = 't2d-v200';   // при выкладке менять вместе с ?v= у модулей в index.html
const PAGE = ['./', './index.html', './manifest.webmanifest'];
// ES-модули — те же, что <script type="module"> в index.html, в том же порядке; host/ — их импортирует app.js
const HOST = ['./host/util.js', './host/fonts.js', './host/draw.js', './host/scale.js', './host/registry.js', './host/undo.js', './host/audio.js',
  './host/touch.js', './host/waves.js', './host/sl.js', './host/sheet.js', './host/ui-top.js', './host/legend.js', './host/strain.js', './host/deck.js', './host/concordia.js', './host/mixer.js', './host/map.js', './host/audio-panel.js', './host/clock.js', './host/midi.js', './host/webmidi.js', './host/build.js'];
const MODULES = [...HOST, './app.js', './worlds/cymatica/index.js', './laboratorium.js', './worlds/natura/index.js', './worlds/inferno/index.js', './worlds/paradisus/index.js', './worlds/monochord/index.js', './worlds/oceanus/index.js', './worlds/horologium/index.js', './worlds/firmamentum/index.js', './worlds/tria/index.js', './worlds/arcadia/index.js', './worlds/portus/index.js', './worlds/goetia/index.js', './prisma.js', './vitrea.js',
  './worlds/arcadia/model.js', './worlds/arcadia/engine.js', './worlds/arcadia/view.js', './worlds/firmamentum/model.js', './worlds/firmamentum/engine.js', './worlds/firmamentum/view.js', './worlds/goetia/model.js', './worlds/goetia/engine.js', './worlds/goetia/view.js', './worlds/monochord/model.js', './worlds/monochord/engine.js', './worlds/monochord/view.js', './worlds/oceanus/model.js', './worlds/oceanus/engine.js', './worlds/oceanus/view.js', './worlds/tria/model.js', './worlds/tria/engine.js', './worlds/tria/view.js',
  './worlds/inferno/model.js', './worlds/inferno/engine.js', './worlds/inferno/view.js', './worlds/paradisus/model.js', './worlds/paradisus/engine.js', './worlds/paradisus/view.js',
  './worlds/tenebrae/tone.js', './worlds/tenebrae/engine.js',
  './worlds/portus/model.js', './worlds/portus/engine.js', './worlds/portus/view.js',
  './worlds/horologium/model.js', './worlds/horologium/engine.js', './worlds/horologium/view.js',
  './worlds/natura/model.js', './worlds/natura/engine.js', './worlds/natura/view.js', './worlds/natura/scene.js',
  './worlds/cymatica/core.js', './worlds/cymatica/model.js', './worlds/cymatica/engine.js', './worlds/cymatica/view.js'];   // части миров (worlds/<мир>/) — их импортирует index.js мира
// модули AudioWorklet — грузятся из миров через addModule(`…?v=`)
const WORKLETS = ['./clock-worklet.js', './t2d-worklet.js', './t2d.wasm'];   // t2d.wasm — ядро SDK (хост, ревербы, MIDI-часы, Firmamentum, Goetia, Oceanus, Monochordum, Horologium, Arcadia, звук Tenebrae), его грузит host/audio.js
const SHELL = [...PAGE, ...MODULES, ...WORKLETS];
const STATIC = ['./icon-180.png', './icon-192.png', './icon-512.png',
  './fonts/im-fell-english-latin-400-italic.woff2', './fonts/im-fell-english-latin-400-normal.woff2', './fonts/eb-garamond-latin-400-normal.woff2', './fonts/eb-garamond-latin-400-italic.woff2'];
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
