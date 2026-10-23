// Firmamentum — звук: модель и пульсарный синтез живут в ядре SDK (core/worlds/firmamentum → t2d.wasm, узел хоста T.core, слот 10).
// Здесь — тонкая склейка с узлом: сухой выход мира ×2.5 (как прежняя шина) — в канал микшера; посыл в зал и фейдер — в ядре
// (core/worlds/firmamentum/world.cpp: hall²·1.5·2.5 — прежний ×2.5 после возврата зала). Порт ядра отдаётся фасаду модели (bind),
// зеркало — ему (sync). Метры из зеркала: gains (громкость голоса по слоту), counts (сколько пульсаретов). Что услышано (listen) —
// из записей «услышанного» ядра: { pulsed: [slot], dust: [[pan, a]], bolts: [slot] }.
import { SLOT, SMAX } from './model.js';

// запись услышанного (core/worlds/firmamentum/world.hpp): np, слоты звёзд с новым пульсаретом, nd, пары (pan, a), nb, слоты вспышек
export function parseHeard(recs) {
  const pulsed = [], dust = [], bolts = [];
  for (const h of recs) {
    let p = 0;
    const np = h[p++];
    for (let k = 0; k < np; k++) pulsed.push(h[p++]);
    const nd = h[p++];
    for (let k = 0; k < nd; k++, p += 2) dust.push([h[p], h[p + 1]]);
    const nb = h[p++];
    for (let k = 0; k < nb; k++) bolts.push(h[p++]);
  }
  return { pulsed, dust, bolts };
}

export function createEngine(T, model) {
  const { stars } = model.state;
  let k = null;
  const counts = new Array(SMAX).fill(0), gains = new Array(SMAX).fill(0), listeners = [];

  function build(ctx, input) {                           // новый контекст — новый узел ядра: сухой выход в канал, порт — фасаду
    k = T.core;
    const out = ctx.createGain(); out.gain.value = 2.5;
    k.dry[SLOT].connect(out).connect(input);
    model.bind(k.send);
    k.listen(heardFrom);
  }
  function heardFrom(d) {                                // ~60 раз в секунду: зеркало и услышанное
    const w = d.w && d.w[SLOT];
    if (!w) return;
    model.sync(w.mirror, d.n);
    gains.fill(0); counts.fill(0);
    for (const s of stars) { gains[s.slot] = s.gain || 0; counts[s.slot] = s.count || 0; }
    if (!w.heard.length) return;
    const heard = parseHeard(w.heard);
    for (const fn of listeners) fn(heard);
  }

  return {
    build,
    listen(fn) { listeners.push(fn); },
    get ready() { return !!(k && k.ready); }, get core() { return k && k.ready ? 'wasm' : null; }, counts, gains,
  };
}
