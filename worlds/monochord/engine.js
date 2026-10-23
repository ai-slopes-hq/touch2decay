// Monochordum — звук: модель, струны, дека, хор и автострам живут в ядре SDK (core/worlds/monochord → t2d.wasm, узел хоста T.core,
// слот 7). Здесь — тонкая склейка с узлом: сухой выход мира (уже ×2.2, с декой и хором) — в канал микшера; посыл в зал и фейдер — в ядре.
// Порт ядра отдаётся фасаду модели (bind), зеркало — ему (sync). Шаги автострама ставит ядро (свой темп или сетка MIDI — с точностью до
// сэмпла); удар — «услышано» из ядра: listen → { hit: true } (Земля вспыхивает). Энергия струн — в state.str из зеркала.
import { SLOT } from './model.js';

export function createEngine(T, model) {
  let k = null;
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
    for (const h of w.heard || []) if (h[0] > 0) heard({ hit: true, step: h[1] });
  }

  return {
    build, start() {}, on() {},
    listen(fn) { listeners.push(fn); },
    get ready() { return !!(k && k.ready); }, get core() { return k && k.ready ? 'wasm' : null; },
    get live() { return !!(k && k.ready); }, get chorus() { return model.state.fx.chorus > 0.01; },
  };
}
