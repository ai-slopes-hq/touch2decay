// Фасад модели мира SDK (worlds/<мир>/model.js — тот же, что в вебе) над t2d.wasm в Node, для тестов. Порт к ядру — имитация
// t2d-worklet.js: сообщения ядру ({t:'action'|'restore'}) и зеркало с числом применённых сообщений (sync(mirror, applied)).
// Синхронный порт (по умолчанию): сообщение применяется сразу, зеркало — после каждого действия и шага. Асинхронный (async: true):
// сообщения копятся, пока не позвать flush(), зеркало — только по deliver(), как ~60 раз в секунду в вебе.
// tick(dt) → tick фасада и process на round(dt·sr) сэмплов кусками ≤ 128 (в асинхронном — сначала flush), потом зеркало.
// Так же устроен tools/models/firmamentum-core.mjs (Firmamentum — первым, со своими помощниками).
import { loadT2d } from '../t2d-core.mjs';
import { scl, snapSemi, SCALES } from '../../host/scale.js';
import { seeded } from './util.mjs';

export const SR = 48000;
// лад хоста {on, idx, root} для фасада: snapSemi из host/scale.js (у него общее состояние scl — ставим на время вызова)
export const hostScale = (sc) => ({
  get on() { return sc.on; }, get root() { return sc.root; },
  get pcs() { return sc.on ? SCALES[sc.idx].steps.map((x) => (x + sc.root) % 12) : null; },   // классы высот лада, как scalePCs в host/scale.js
  snap(s) { const keep = { ...scl }; Object.assign(scl, sc); const r = snapSemi(s); Object.assign(scl, keep); return r; },
});

// facade — createModel мира, slot — его слот в ядре, actions — методы фасада, после которых синхронный порт сразу шлёт зеркало
// wake — код action, которым мир просыпается при входе (Oceanus), — шлётся сразу после init, как enter у вошедшего мира;
// heard — фасаду нужно услышанное ядра (sync(mirror, applied, [запись])) — Tria: вспышки; chunk(core) — после каждого куска process (Cymatica собирает услышанное)
export function sdkFacade(facade, slot, actions, { seed = 1, scale = null, rng = seeded(seed), async = false, wake = null, heard = false, chunk = null, ...opts } = {}) {
  const sc = scale ? { ...scale } : { on: false, idx: 0, root: 0 };
  let core = null, sent = 0, applied = 0;
  const queue = [];
  const boot = (sd) => { core = loadT2d(); core.init(SR, sd); core.scale(sc.on, sc.idx, sc.root); if (wake != null) core.action(slot, wake); sent = applied = 0; queue.length = 0; };
  boot(seed);
  function apply(d) {                                   // как apply у t2d-worklet.js
    applied++;
    if (d.t === 'action') core.action(d.slot, d.kind, d.i | 0, d.a || []);
    else if (d.t === 'restore') core.restore(d.slot, d.js);
  }
  const flush = () => { while (queue.length) apply(queue.shift()); };
  const deliver = () => { const h = heard ? core.heard(slot) : []; m.sync(core.mirror(slot), applied, h.length ? [h] : []); };   // heard — услышанное ядра (вспышки Tria)
  const send = (d) => { sent++; if (async) queue.push(d); else apply(d); return sent; };
  const m = facade({ scale: hostScale(sc), rng, send, ...opts });
  const wrap = (fn) => (...a) => { const r = fn(...a); if (!async) deliver(); return r; };
  const out = { ...m };
  for (const k of actions) out[k] = wrap(m[k]);
  out.tick = (dt) => {
    if (async) flush();
    m.tick(dt);
    let n = Math.round(dt * SR);
    while (n > 0) { const k = Math.min(128, n); core.process(k); if (chunk) chunk(core); n -= k; }
    deliver();
  };
  Object.defineProperty(out, 'core', { get: () => core });
  out.flush = flush; out.deliver = deliver;
  out.setScale = (on, idx, root) => { Object.assign(sc, { on, idx, root }); core.scale(on, idx, root); if (!async) deliver(); };
  out.rebind = (sd = seed + 1) => { boot(sd); m.bind(send); if (!async) deliver(); };   // новый узел ядра (restartAudio → build)
  out.mirror = () => core.mirror(slot);
  return out;
}
