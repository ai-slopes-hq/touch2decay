// Tria corpora — звук: тела, физика, колокола, тимпан, шорох, дрон пары с FM по кругу и шина (tanh, посыл в hall) живут в ядре SDK
// (core/worlds/tria → t2d.wasm, узел хоста T.core, слот 11; узлы прежнего engine — на sdk::Param, эталон — tools/ref/tria-engine.js).
// Здесь — тонкая склейка: сухой выход мира (уже ×1.6) — в канал микшера; посыл в зал и фейдер — в ядре. Порт — фасаду модели (bind),
// зеркало и услышанное (вспышки) — ему (sync). Метры strikes, encounters — из зеркала.
import { SLOT } from './model.js';

export function createEngine(T, model) {
  const { counts } = model.state;
  let k = null;

  function build(ctx, input) {                           // новый контекст — новый узел ядра: сухой выход в канал, порт — фасаду
    k = T.core;
    k.dry[SLOT].connect(input);
    model.bind(k.send);
    k.listen(mirrorFrom);
  }
  function mirrorFrom(d) {                               // ~60 раз в секунду
    const w = d.w && d.w[SLOT];
    if (w) model.sync(w.mirror, d.n, w.heard);
  }

  return {
    build, start() {}, on() {},                          // услышанного для картинки нет: вспышки — в state.flashes фасада
    get ready() { return !!(k && k.ready); }, get core() { return k && k.ready ? 'wasm' : null; },
    get strikes() { return counts.strikes; }, get encounters() { return counts.encounters; },
  };
}
