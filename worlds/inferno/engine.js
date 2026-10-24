// Inferno — звук: модель и звук живут в ядре SDK (core/worlds/inferno → t2d.wasm, узел хоста T.core, слот 5). Здесь — тонкая склейка
// с узлом: сухой выход мира — в канал микшера, посыл в зал (дым) и фейдер — в ядре (core/worlds/inferno/world.cpp). Порт ядра отдаётся
// фасаду модели (bind), зеркало — ему (sync). Что услышано (listen) — { strike: k }: удар прозвучал (угольки во view).
import { SLOT } from './model.js';

export function createEngine(T, model) {
  let k = null, strikes = 0;
  const listeners = [];

  function build(ctx, input) {                           // новый контекст — новый узел ядра: сухой выход в канал, порт — фасаду
    k = T.core;
    k.dry[SLOT].connect(input);
    model.bind(k.send);
    k.listen(heardFrom);
  }
  function heardFrom(d) {                                // ~60 раз в секунду: зеркало и услышанное
    const w = d.w && d.w[SLOT];
    if (!w) return;
    model.sync(w.mirror, d.n);
    for (const h of w.heard) for (let i = 0; i < h[0]; i++) { strikes++; for (const fn of listeners) fn({ strike: h[1 + i] }); }
  }

  return {
    build,
    listen(fn) { listeners.push(fn); },
    get strikes() { return strikes; },
    get live() { return !!(k && k.ready && (strikes > 0 || model.sounding())); },
    get ready() { return !!(k && k.ready); }, get core() { return k && k.ready ? 'wasm' : null; },
  };
}
