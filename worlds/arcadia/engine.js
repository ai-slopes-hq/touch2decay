// Arcadia — звук: странники, страна, синтез по рельефу и шина (фейзер, хор, посыл в hall) живут в ядре SDK (core/worlds/arcadia →
// t2d.wasm, узел хоста T.core, слот 12). Здесь — тонкая склейка: сухой выход мира (уже ×1.5) — в канал микшера; посыл в зал и фейдер —
// в ядре. Порт — фасаду модели (bind), зеркало — ему (sync). Метры для картинки — из зеркала: centers ([cx, cy, rs] петли), gains.
import { SLOT } from './model.js';

export function createEngine(T, model) {
  const { loops } = model.state;
  let k = null;

  function build(ctx, input) {                           // новый контекст — новый узел ядра: сухой выход в канал, порт — фасаду
    k = T.core;
    k.dry[SLOT].connect(input);
    model.bind(k.send);
    k.listen(mirrorFrom);
  }
  function mirrorFrom(d) {                               // ~60 раз в секунду
    const w = d.w && d.w[SLOT];
    if (w) model.sync(w.mirror, d.n);
  }

  return {
    build, start() {}, on() {},
    listen() {},
    get ready() { return !!(k && k.ready); }, get core() { return k && k.ready ? 'wasm' : null; },
    get centers() { return loops.centers; }, get gains() { return loops.gains; },
  };
}
