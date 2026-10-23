// Oceanus — звук: модель и сканирующий синтез живут в ядре SDK (core/worlds/oceanus → t2d.wasm, узел хоста T.core, слот 8).
// Здесь — тонкая склейка с узлом: сухой выход мира (уже ×1.6, шина — в ядре) — в канал микшера; посыл в зал и фейдер — в ядре.
// Порт ядра отдаётся фасаду модели (bind), зеркало — ему (sync). Метры — из зеркала: форма кольца (shape), место луны (moon,
// доля круга), уровни голосов (gains по слоту).
import { SLOT, VMAX } from './model.js';

export function createEngine(T, model) {
  const { voices } = model.state;
  let k = null;
  const gains = new Array(VMAX).fill(0);

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
    gains.fill(0);
    for (const v of voices) gains[v.slot] = v.gain || 0;
  }

  return {
    build,
    get ready() { return !!(k && k.ready); }, get core() { return k && k.ready ? 'wasm' : null; },
    get live() { return voices.length > 0 || gains.some((g) => g > 0.002); },
    get shape() { return model.state.shape; }, get moon() { return model.state.moon; }, get gains() { return gains; },
  };
}
