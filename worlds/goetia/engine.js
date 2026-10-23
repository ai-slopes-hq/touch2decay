// Goetia — звук: модель, bytebeat, эхо и шина живут в ядре SDK (core/worlds/goetia → t2d.wasm, узел хоста T.core, слот 15).
// Здесь — тонкая склейка с узлом: сухой выход мира (уже ×1.6, с эхом) — в канал микшера; посыл в зал и фейдер — в ядре.
// Порт ядра отдаётся фасаду модели (bind), зеркало — ему (sync). Метры — из зеркала: уровни голосов (gains по слоту) и счётчик t
// каждого духа (tt и когда пришёл — at, мс): по ним view мигает узлами и ведёт огонёк. Новый дух — t с нуля (on, до зеркала).
import { SLOT, SMAX } from './model.js';

export function createEngine(T, model) {
  const { spirits } = model.state;
  let k = null;
  const gains = new Array(SMAX).fill(0), tt = new Array(SMAX).fill(0), at = new Array(SMAX).fill(0);

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
    const now = performance.now();
    gains.fill(0);
    for (const s of spirits) { gains[s.slot] = s.gain || 0; tt[s.slot] = s.t || 0; at[s.slot] = now; }
  }
  function on(e) {                                       // событие модели: новый дух — огонёк с начала печати, пока зеркало не пришло
    if (e.t === 'spirit' && e.added) { tt[e.s.slot] = 0; at[e.s.slot] = performance.now(); }
  }

  return {
    build, on,
    get ready() { return !!(k && k.ready); }, get core() { return k && k.ready ? 'wasm' : null; }, get gains() { return gains; }, tt, at,
  };
}
