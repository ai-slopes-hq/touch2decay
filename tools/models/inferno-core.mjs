// Фасад модели Inferno (worlds/inferno/model.js — тот же, что в вебе) над t2d.wasm в Node, для тестов. Порт к ядру — имитация
// t2d-worklet.js: сообщения ядру ({t:'action'|'restore'}) и зеркало с числом применённых сообщений (sync(mirror, applied)).
// Порт синхронный: сообщение применяется сразу, зеркало — после каждого действия и шага. tick(dt) → process на round(dt·sr) сэмплов
// кусками ≤ 128, потом зеркало. scale — лад хоста {on, idx, root}: ядро берёт его из t2d_scale, фасад (картинка, ratios) — из host/scale.js.
import { loadT2d } from '../t2d-core.mjs';
import { createModel as facade, SLOT, ACT, SET_KEYS, FX_KEYS } from '../../worlds/inferno/model.js';
import { scl, snapSemi, scalePCs } from '../../host/scale.js';
import { seeded } from './util.mjs';

export { SLOT, ACT, SET_KEYS, FX_KEYS };
export const SR = 48000;
const hostScale = (sc) => ({
  get on() { return sc.on; },
  get pcs() { const keep = { ...scl }; Object.assign(scl, sc); const r = scalePCs(); Object.assign(scl, keep); return r; },
  snap(s) { const keep = { ...scl }; Object.assign(scl, sc); const r = snapSemi(s); Object.assign(scl, keep); return r; },
});

export function createModel({ seed = 1, scale = null, rng = seeded(seed) } = {}) {
  const sc = scale ? { ...scale } : { on: false, idx: 0, root: 0 };
  let core = null, sent = 0, applied = 0;
  const boot = (sd) => { core = loadT2d(); core.init(SR, sd); core.scale(sc.on, sc.idx, sc.root); sent = applied = 0; };
  boot(seed);
  const send = (d) => {                                  // как apply у t2d-worklet.js
    sent++; applied++;
    if (d.t === 'action') core.action(d.slot, d.kind, d.i | 0, d.a || []);
    else if (d.t === 'restore') core.restore(d.slot, d.js);
    return sent;
  };
  const deliver = () => m.sync(core.mirror(SLOT), applied);
  const m = facade({ scale: hostScale(sc), rng, send });
  const wrap = (fn) => (...a) => { const r = fn(...a); deliver(); return r; };
  const out = { ...m };
  for (const k of ['strike', 'setPos', 'hold', 'pin', 'setCirc', 'setFx', 'loadFx', 'clear', 'dice', 'restore']) out[k] = wrap(m[k]);
  out.tick = (dt) => {
    let n = Math.round(dt * SR);
    while (n > 0) { const k = Math.min(128, n); core.process(k); n -= k; }
    deliver();
  };
  Object.defineProperty(out, 'core', { get: () => core });
  out.deliver = deliver;
  out.rebind = (sd = seed + 1) => { boot(sd); m.bind(send); deliver(); };   // новый узел ядра (restartAudio → build)
  out.coreDice = () => { core.action(SLOT, ACT.dice); deliver(); };         // кубик ядра (его rng) — для сверки модели ядра с эталоном
  out.mirror = () => core.mirror(SLOT);
  out.heard = () => core.heard(SLOT);
  return out;
}
