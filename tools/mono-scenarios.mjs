// Сценарии сверки ядра Monochordum (мир VII в t2d.wasm) с эталоном: прежняя JS-модель (tools/ref/monochord-model.js) → сообщения,
// как прежний engine.js (retune, pluck, harm, bow, sus, wind, couple) → прежний worklet струн (tools/ref/monochord-worklet.js, ГСЧ с
// зерном). Шаг — действие модели или { run: блоков } (блок — 128 сэмплов):
//   ['pluck', i, pos, vel], ['harm', i, n, vel], ['bow', i, amp], ['sus', i, on], ['bridge', i, r], ['string', i, key, v],
//   ['wind', v], ['fx', key, v], ['scale', on, idx, root], ['clear'], ['restore', js]
// Сравнивается сухой выход струн: в эталоне — выход worklet ×2.2 (out прежнего engine.js), в ядре — сухой выход слота 7 при body = 0 и
// chorus = 0 (дека и хор — ×0, шина — прямой провод ×2.2). Энергия струн и флажолетов — каждый блок; снимок — тот же JSON.
import { createModel as jsModel, FX_DEF } from './ref/monochord-model.js';
import { sandbox, SR, BLOCK } from './goetia-scenarios.mjs';
import { scl, snapSemi } from '../host/scale.js';
import { seeded } from './models/util.mjs';
import { loadT2d } from './t2d-core.mjs';

export const SEED = 4242, OUT = 2.2, SLOT = 7;
export const ACT = { pluck: 0, harm: 1, bow: 2, sus: 3, bridge: 4, string: 5, wind: 6, fx: 7, auto: 8, autopar: 9, clear: 10 };
export const FX_KEYS = Object.keys(FX_DEF), STR_KEYS = ['pitch', 'bright', 'decay', 'level', 'r'], AUTO_KEYS = ['on', 'bpm', 'div', 'pattern', 'strength', 'swing'];
export const HEAD = FX_KEYS.length + 2 + AUTO_KEYS.length + 1, STR_M = 9;
const hostScale = (sc) => ({
  get on() { return sc.on; }, get root() { return sc.on ? sc.root : 0; },
  snap(s) { const keep = { ...scl }; Object.assign(scl, sc); const r = snapSemi(s); Object.assign(scl, keep); return r; },
});
const DRY = [['fx', 'body', 0], ['fx', 'chorus', 0]];
const clamp = (x) => Math.min(1, Math.max(0, x));

export const ACTS = {
  pluck: [...DRY, ['pluck', 0, 0.3, 0.9], { run: 300 }],
  four: [...DRY, ['pluck', 0, 0.1, 1], ['pluck', 1, 0.3, 0.7], ['pluck', 2, 0.5, 0.5], ['pluck', 3, 0.2, 0.3], { run: 400 }],
  harm: [...DRY, ['pluck', 2, 0.3, 0.8], { run: 50 }, ['harm', 2, 3, 0.9], { run: 200 }, ['harm', 1, 2, 0.6], { run: 300 }],
  bow: [...DRY, ['bow', 1, 0.6], { run: 300 }, ['bow', 1, 0.2], { run: 200 }, ['bow', 1, 0], { run: 300 }],
  sus: [...DRY, ['sus', 0, true], ['sus', 3, true], { run: 400 }, ['sus', 0, false], { run: 200 }],
  wind: [...DRY, ['wind', 0.6], { run: 400 }, ['wind', 0], { run: 300 }],
  sympathy: [...DRY, ['fx', 'sympathy', 1], ['bridge', 1, 2 / 3], ['pluck', 0, 0.2, 1], { run: 600 }],
  bridge: [...DRY, ['pluck', 0, 0.3, 0.9], { run: 100 }, ['bridge', 0, 0.505], ['pluck', 0, 0.3, 0.9], { run: 100 }, ['string', 0, 'pitch', 0.3], ['pluck', 0, 0.3, 0.9], { run: 200 }],
  sheet: [...DRY, ['string', 2, 'bright', 0.95], ['string', 2, 'decay', 0.1], ['string', 2, 'level', 0.4], ['pluck', 2, 0.25, 0.9], { run: 200 }, ['fx', 'decay', 1], ['fx', 'bright', 0.1], ['pluck', 2, 0.25, 0.9], { run: 400 }],
  scale: [...DRY, ['scale', true, 1, 3], ['bridge', 1, 0.6], ['bridge', 2, 0.71], ['pluck', 1, 0.3, 0.9], ['pluck', 2, 0.3, 0.9], { run: 300 }],
  clear: [...DRY, ['sus', 1, true], ['wind', 0.4], ['bow', 2, 0.5], { run: 200 }, ['clear'], { run: 400 }],
  restore: [...DRY, ['pluck', 0, 0.3, 0.9], { run: 50 },
    ['restore', '{"str":[{"r":0.75,"sus":true,"bright":0.3,"decay":0.9,"level":0.8},{"r":0.5,"sus":false,"bright":0.55,"decay":0.55,"level":0.8},{"r":0.4444444444444444,"sus":true,"bright":0.8,"decay":0.4,"level":0.6},{"r":0.3333333333333333,"sus":false,"bright":0.55,"decay":0.55,"level":0.8}],"fx":{"decay":0.6,"bright":0.5,"body":0,"sympathy":0.7,"chorus":0,"chance":1,"hall":0.35},"wind":0.2,"auto":{"on":false,"bpm":90,"div":1,"pattern":1,"strength":0.6,"swing":0}}'],
    { run: 500 }],
  all: [...DRY, ['sus', 2, true], ['wind', 0.3], ...Array.from({ length: 40 }, (_, k) => [['pluck', k % 4, 0.1 + (k % 5) * 0.08, 0.4 + (k % 3) * 0.2], { run: 37 }]).flat(),
    ['bow', 0, 0.5], { run: 400 }, ['harm', 3, 4, 0.8], { run: 2000 }],   // ~6 с
};

const cat = (bs) => { const o = new Float32Array(bs.length * BLOCK); bs.forEach((b, k) => o.set(b, k * BLOCK)); return o; };

export function refPath(steps, { seed = SEED } = {}) {   // эталон: JS-модель → сообщения как engine.js → worklet эталона ×2.2
  const { reg } = sandbox('./ref/monochord-worklet.js', { currentTime: 0 });
  const proc = new reg.monochord({ processorOptions: { seed: seed + 1 } });
  const sc = { on: false, idx: 0, root: 0 };
  const model = jsModel({ rng: seeded(seed), scale: hostScale(sc) });
  const { str, fx } = model.state;
  const send = (m) => proc.port.onmessage({ data: m });
  const retune = (i) => { const s = str[i]; send({ t: 'tune', i, f: model.hzOf(i), bright: clamp(s.bright * 0.5 + fx.bright * 0.5), decay: clamp(s.decay * 0.5 + fx.decay * 0.5), level: s.level }); };
  const applyFx = () => { send({ t: 'couple', amt: 0.0015 * fx.sympathy }); for (let i = 0; i < 4; i++) retune(i); };
  model.listen((e) => {
    if (e.t === 'tune') retune(e.i);
    else if (e.t === 'pluck') send({ t: 'pluck', i: e.i, pos: e.pos, vel: e.vel });
    else if (e.t === 'harm') send({ t: 'harm', i: e.i, n: e.n, vel: e.vel });
    else if (e.t === 'bow') send({ t: 'bow', i: e.i, amp: e.amp });
    else if (e.t === 'sus') send({ t: 'sus', i: e.i, on: e.on });
    else if (e.t === 'wind') send({ t: 'wind', amt: e.amt });
    else if (e.t === 'fx') applyFx();
  });
  applyFx();
  const L = [], R = [], meters = [];
  for (const s of steps) {
    if (s.run) {
      for (let b = 0; b < s.run; b++) {
        const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
        proc.process([], [[l, r]], {});
        L.push(l.map((x) => x * OUT)); R.push(r.map((x) => x * OUT));
        meters.push(proc.s.map((q) => [Math.sqrt(q.en), Math.sqrt(q.h.en), q.h.n]));
      }
      continue;
    }
    act(model, s, sc);
  }
  return { L: cat(L), R: cat(R), meters, snapshot: model.snapshot() };
}
function act(model, [a, x, y, z], sc) {
  if (a === 'pluck') model.pluck(x, y, z);
  else if (a === 'harm') model.harm(x, y, z);
  else if (a === 'bow') model.bow(x, y);
  else if (a === 'sus') model.setSus(x, y);
  else if (a === 'bridge') model.setBridge(x, y);
  else if (a === 'string') model.setString(x, y, z);
  else if (a === 'wind') model.setWind(x);
  else if (a === 'fx') model.setFx(x, y);
  else if (a === 'clear') model.clear();
  else if (a === 'restore') model.restore(x);
  else if (a === 'scale') Object.assign(sc, { on: x, idx: y, root: z });
}

export function corePath(steps, { seed = SEED } = {}) { // ядро: те же действия → t2d.wasm, сухой выход мира VII
  const c = loadT2d();
  c.init(SR, seed);
  const L = [], R = [], meters = [];
  for (const s of steps) {
    if (s.run) {
      for (let b = 0; b < s.run; b++) {
        c.process(BLOCK);
        L.push(Float32Array.from(c.dry(SLOT, 0))); R.push(Float32Array.from(c.dry(SLOT, 1)));
        const m = c.mirror(SLOT);
        meters.push([0, 1, 2, 3].map((i) => [6, 7, 8].map((k) => m[HEAD + i * STR_M + k])));
      }
      continue;
    }
    const [a, x, y, z] = s;
    if (a === 'pluck') c.action(SLOT, ACT.pluck, x, [y, z]);
    else if (a === 'harm') c.action(SLOT, ACT.harm, x, [y, z]);
    else if (a === 'bow') c.action(SLOT, ACT.bow, x, [y]);
    else if (a === 'sus') c.action(SLOT, ACT.sus, x, [y ? 1 : 0]);
    else if (a === 'bridge') c.action(SLOT, ACT.bridge, x, [y]);
    else if (a === 'string') c.action(SLOT, ACT.string, x, [STR_KEYS.indexOf(y), z]);
    else if (a === 'wind') c.action(SLOT, ACT.wind, 0, [x]);
    else if (a === 'fx') c.action(SLOT, ACT.fx, FX_KEYS.indexOf(x), [y]);
    else if (a === 'clear') c.action(SLOT, ACT.clear);
    else if (a === 'restore') c.restore(SLOT, x);
    else if (a === 'scale') c.scale(x, y, z);
  }
  return { L: cat(L), R: cat(R), meters, snapshot: c.snapshot(SLOT) };
}
