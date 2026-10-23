// Horologium — звук: колесо, кольца, ход часов и замок к такту MIDI живут в ядре SDK (core/worlds/horologium → t2d.wasm, узел хоста
// T.core, слот 9). Здесь — тонкая склейка: сухой выход мира (уже ×2.4) — в канал микшера; посыл в зал и фейдер — в ядре. Порт — фасаду
// модели (bind), зеркало — ему (sync). Метры: P, F (колесо), tP (когда пришло, performance.now), strikes. Что услышано (listen):
// { hits, P } — какие кольца ударили (вспышки, луч concursus — во view).
import { SLOT } from './model.js';

export function createEngine(T, model) {
  const { wheel } = model.state;
  let k = null, tP = 0;
  const listeners = [];
  const heard = (e) => { for (const fn of listeners) fn(e); };

  function build(ctx, input) {                           // новый контекст — новый узел ядра: сухой выход в канал, порт — фасаду
    k = T.core;
    k.dry[SLOT].connect(input);
    model.bind(k.send);
    k.listen(mirrorFrom);
  }
  function mirrorFrom(d) {                               // ~60 раз в секунду
    const w = d.w && d.w[SLOT];
    if (!w) return;
    model.sync(w.mirror, d.n);
    tP = performance.now();
    for (const h of w.heard || []) if (h[0] > 0) heard({ hits: h.slice(2, 2 + h[0]), P: h[1] });
  }

  return {
    build, start() {}, on() {},
    listen(fn) { listeners.push(fn); },
    get ready() { return !!(k && k.ready); }, get core() { return k && k.ready ? 'wasm' : null; }, get live() { return !!(k && k.ready); },
    get P() { return wheel.P; }, get F() { return wheel.F; }, get tP() { return tP; }, get strikes() { return wheel.strikes; }, get locked() { return wheel.locked; },
  };
}
