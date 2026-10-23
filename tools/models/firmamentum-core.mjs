// Фасад модели Firmamentum (worlds/firmamentum/model.js — тот же, что в вебе) над t2d.wasm в Node, для тестов. Порт к ядру — имитация
// t2d-worklet.js: сообщения ядру ({t:'action'|'restore'}) и зеркало с числом применённых сообщений (sync(mirror, applied)).
// Синхронный порт (по умолчанию): сообщение применяется сразу, зеркало — после каждого действия и шага. Асинхронный (async: true):
// сообщения копятся, пока не позвать flush(), зеркало — только по deliver(), как ~60 раз в секунду в вебе.
// tick(dt) → process на round(dt·sr) сэмплов кусками ≤ 128 (в асинхронном — сначала flush), потом зеркало.
import { loadT2d } from '../t2d-core.mjs';
import { createModel as facade, SLOT, ACT, SET_KEYS, FX_KEYS } from '../../worlds/firmamentum/model.js';
import { scl, snapSemi } from '../../host/scale.js';
import { seeded } from './util.mjs';

export { SLOT, ACT, SET_KEYS, FX_KEYS };
export const SR = 48000;
// свод ядра: place(s) = {x: u, y: −h·K}, комета разгоняет звёзды ближе R (core/worlds/firmamentum/model.hpp);
// на 390×844 одна единица свода по горизонтали — S px (RX · 0.94 у горизонта), так что R·S = 90 px, как было на экране
export const RX = 187, S = RX * 0.94, K = 1.75 / 0.94, R = 90 / S;
export const sky = (s) => ({ x: S * s.u, y: -S * K * s.h });   // свод → px на 390×844: для JS-модели (порог 90 px) и cometAt
// лад хоста {on, idx, root} для фасада: snapSemi из host/scale.js (у него общее состояние scl — ставим на время вызова)
export const hostScale = (sc) => ({
  get on() { return sc.on; },
  snap(s) { const keep = { ...scl }; Object.assign(scl, sc); const r = snapSemi(s); Object.assign(scl, keep); return r; },
});

export function createModel({ seed = 1, scale = null, place = sky, rng = seeded(seed), async = false } = {}) {
  const sc = scale ? { ...scale } : { on: false, idx: 0, root: 0 };
  let core = null, sent = 0, applied = 0;
  const queue = [];
  const boot = (sd) => { core = loadT2d(); core.init(SR, sd); core.scale(sc.on, sc.idx, sc.root); sent = applied = 0; queue.length = 0; };
  boot(seed);
  function apply(d) {                                   // как apply у t2d-worklet.js
    applied++;
    if (d.t === 'action') core.action(d.slot, d.kind, d.i | 0, d.a || []);
    else if (d.t === 'restore') core.restore(d.slot, d.js);
  }
  const flush = () => { while (queue.length) apply(queue.shift()); };
  const deliver = () => m.sync(core.mirror(SLOT), applied);
  const send = (d) => { sent++; if (async) queue.push(d); else apply(d); return sent; };
  const m = facade({ scale: hostScale(sc), place, rng, send });
  // синхронный порт: зеркало — сразу после каждого действия (как прежний фасад над ядром)
  const wrap = (fn) => (...a) => { const r = fn(...a); if (!async) deliver(); return r; };
  const out = { ...m };
  for (const k of ['addStar', 'closeStar', 'moveStar', 'setStar', 'setFx', 'loadFx', 'clear', 'dice', 'restore', 'launch']) out[k] = wrap(m[k]);
  out.tick = (dt) => {
    if (async) flush();
    let n = Math.round(dt * SR);
    while (n > 0) { const k = Math.min(128, n); core.process(k); n -= k; }
    deliver();
  };
  Object.defineProperty(out, 'core', { get: () => core });
  out.flush = flush; out.deliver = deliver;
  out.rebind = (sd = seed + 1) => { boot(sd); m.bind(send); if (!async) deliver(); };   // новый узел ядра (restartAudio → build)
  out.coreDice = () => { core.action(SLOT, ACT.dice); deliver(); };   // кубик ядра (его rng) — для сверки модели ядра с эталоном
  out.coreStar = (id) => {                              // звезда в зеркале ядра по id (сейчас, без фасада) — для проверок гонок
    const x = core.mirror(SLOT), n = x[16], N = 14;
    for (let i = 0; i < n; i++) if (x[17 + i * N + 1] === id) return { slot: x[17 + i * N], id, h: x[17 + i * N + 2], u: x[17 + i * N + 3] };
    return null;
  };
  out.coreIds = () => { const x = core.mirror(SLOT), n = x[16]; return Array.from({ length: n }, (_, i) => x[17 + i * 14 + 1]); };
  return out;
}
