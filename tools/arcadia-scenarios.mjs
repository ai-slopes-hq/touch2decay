// Сценарии сверки ядра Arcadia (мир XII в t2d.wasm) с эталоном: прежняя JS-модель (tools/ref/arcadia-model.js) → сообщения, как прежний
// engine.js (terrain, params, voice: f = hzOf, дом, петля, lvl·0.7, путь, pan = u·0.8) → прежний worklet (tools/ref/terrain-worklet.js, ГСЧ
// с зерном) → ×1.5 (out прежнего engine; фейзер и хор — 0: шину с ними сверяет tools/arcadia-bus.py в браузере).
// Новая страна в ядре звучит через LAND_BLOCKS блоков (считается по кускам) — эталон шлёт её worklet-у тогда же; пути, которые модель
// пересчитала до того, эталон берёт по звучащей стране (как ядро), а на готовой — заново для всех.
// Шаг — действие или { run: блоков }: ['add', u, v, {oct, r, fig, mode, sp, lvl}], ['drop', k], ['move', k, u, v], ['set', k, {key: v}, route],
// ['fx', key, v], ['land', seed], ['scale', on, idx, root], ['clear'], ['restore', js]; k — номер странника в порядке добавления.
import { createModel as jsModel } from './ref/arcadia-model.js';
import { sandbox, SR, BLOCK } from './goetia-scenarios.mjs';
import { loadT2d } from './t2d-core.mjs';
import { hostScale } from './models/sdk-facade.mjs';

export const SEED = 1212, OUT = 1.5, SLOT = 12, LAND_BLOCKS = 59;
export const ACT = { add: 0, drop: 1, move: 2, set: 3, fx: 4, land: 5, clear: 6 };
export const FX_KEYS = ['relief', 'pace', 'wind', 'chorus', 'phaser', 'spread', 'hall'], T_KEYS = ['u', 'v', 'oct', 'r', 'fig', 'mode', 'sp', 'lvl'];
export const HEAD = FX_KEYS.length + 2, SLOT_M = 14;

const DRY = [['fx', 'chorus', 0]];                      // шина без хора и фейзера: сухой выход = worklet × 1.5
export const ACTS = {
  still: [...DRY, ['add', -0.3, -0.5, { mode: 0 }], { run: 300 }],
  circuit: [...DRY, ['add', 0.2, 0.1, { mode: 1, fig: 1, r: 0.3 }], { run: 500 }],
  wander: [...DRY, ['fx', 'wind', 0.6], ['add', -0.1, 0.3, { mode: 2, r: 0.25 }], { run: 700 }],
  river: [...DRY, ['add', 0.1, 0.5, { mode: 3, fig: 2 }], { run: 900 }],
  summit: [...DRY, ['add', 0.1, -0.2, { mode: 4, oct: -1, sp: 0.4 }], ['fx', 'pace', 0.9], { run: 900 }],
  four: [...DRY, ['fx', 'relief', 0.8], ['fx', 'spread', 1], ['add', -0.6, -0.7, { mode: 1 }], ['add', 0.5, -0.2, { mode: 2, fig: 2 }], ['add', -0.2, 0.6, { mode: 3 }], ['add', 0.7, 0.8, { mode: 4, lvl: 0.5 }], { run: 900 }],
  edit: [...DRY, ['add', 0, 0, { mode: 2 }], { run: 200 }, ['move', 0, 0.3, 0.6], { run: 200 }, ['set', 0, { r: 0.45 }], { run: 200 }, ['set', 0, { fig: 2 }], ['set', 0, { mode: 3 }, true], { run: 300 }, ['set', 0, { oct: 1 }], { run: 200 }],
  drop: [...DRY, ['add', -0.4, 0, {}], ['add', 0.4, 0.2, { mode: 1 }], { run: 200 }, ['drop', 0], { run: 400 }, ['add', 0.1, -0.6, { fig: 1 }], { run: 300 }],
  land: [...DRY, ['add', 0.1, 0.5, { mode: 3 }], ['add', -0.5, -0.4, { mode: 4 }], { run: 100 }, ['land', 4242], { run: 20 }, ['move', 1, -0.4, -0.3], { run: 10 }, ['land', 777], { run: 300 }],
  scale: [...DRY, ['scale', true, 1, 5], ['add', -0.3, -0.2, {}], ['add', 0.3, 0.7, { mode: 1 }], { run: 400 }],
  restore: [...DRY, ['add', 0, 0, {}], { run: 100 }, ['restore', '{"seed":31337,"t":[{"u":0.2,"v":-0.4,"oct":0,"r":0.2,"fig":1,"mode":3,"sp":0.3,"lvl":0.7},{"u":-0.5,"v":0.5,"oct":-1,"r":0.1,"fig":0,"mode":2,"sp":0.2,"lvl":0.8}],"fx":{"relief":0.5,"pace":0.6,"wind":0.3,"chorus":0,"phaser":0,"spread":0.6,"hall":0.4}}'], { run: 600 }],
  clear: [...DRY, ['add', 0, 0, {}], ['add', 0.5, 0.5, { mode: 4 }], { run: 200 }, ['clear'], { run: 400 }],
  all: [...DRY, ['fx', 'wind', 0.4], ['add', -0.6, -0.7, { mode: 1, fig: 1 }], ['add', 0.5, -0.2, { mode: 2, fig: 2 }], { run: 1500 }, ['add', 0.1, 0.5, { mode: 3 }], ['fx', 'relief', 0.7], { run: 1500 },
    ['land', 99], { run: 600 }, ['drop', 1], ['fx', 'pace', 0.8], { run: 1000 }],   // ~10 с
};

const cat = (bs) => { const o = new Float32Array(bs.length * BLOCK); bs.forEach((b, k) => o.set(b, k * BLOCK)); return o; };

export function refPath(steps, { seed = SEED } = {}) {
  const { reg } = sandbox('./ref/terrain-worklet.js');
  const proc = new reg.terrain({ processorOptions: { seed: seed + 1 } });
  const sc = { on: false, idx: 0, root: 0 };
  const model = jsModel({ scale: hostScale(sc) }), calc = jsModel();   // calc — пути по звучащей стране
  const { travellers, fx } = model.state;
  const send = (m) => proc.port.onmessage({ data: m });
  const terrain = (land, now) => send({ t: 'terrain', z: land.z, lake: land.lake, gx: 80, gy: 160, asp: 3.2, ...(now ? { now: true } : {}) });
  const params = () => send({ t: 'params', relief: fx.relief, speed: 0.01 * 40 ** fx.pace, wind: fx.wind, spread: fx.spread });
  const sendT = (t, on, withRoute) => {
    const m = { t: 'voice', i: t.slot, on, f: model.hzOf(t), hx: t.u, hy: t.v, r: t.r, fig: t.fig, lvl: t.lvl * 0.7, mode: t.mode, sp: t.sp, pan: t.u * 0.8 };
    if (withRoute) m.route = t.mode >= 3 ? calc.routeOf(t) : null;
    send(m);
  };
  let pending = 0, held = null;
  calc.state.land = model.state.land;
  model.listen((e) => {
    if (e.t === 'trav') sendT(e.tr, e.on, e.route);
    else if (e.t === 'land') { pending = LAND_BLOCKS; held = e.land; }
    else if (e.t === 'fx') params();
  });
  terrain(model.state.land, true); params();             // start прежнего engine: страна сразу, ручки
  const L = [], R = [], centers = [], gains = [];
  for (const s of steps) {
    if (s.run) {
      for (let b = 0; b < s.run; b++) {
        if (pending && --pending === 0) {               // новая страна готова: перетекание, пути по ней
          calc.state.land = held; terrain(held, false);
          for (const t of travellers) sendT(t, true, true);
        }
        const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
        proc.process([], [[l, r]], {});
        L.push(l.map((x) => x * OUT)); R.push(r.map((x) => x * OUT));
        centers.push(proc.vo.map((o) => [o.cx, o.cy, o.rs])); gains.push(proc.vo.map((o) => o.g * Math.min(1, Math.sqrt(o.env) * o.ag * 2.2)));
      }
      continue;
    }
    const [a, x, y, z] = s;
    if (a === 'add') model.addT(x, y, z);
    else if (a === 'drop') model.dropT(travellers[x]);
    else if (a === 'move') model.moveT(travellers[x], y, z);
    else if (a === 'set') model.setT(travellers[x], y, !!z);
    else if (a === 'fx') model.setFx(x, y);
    else if (a === 'land') model.newLand(x);
    else if (a === 'scale') Object.assign(sc, { on: x, idx: y, root: z });
    else if (a === 'clear') model.clear();
    else if (a === 'restore') model.restore(x);
  }
  return { L: cat(L), R: cat(R), centers, gains, snapshot: model.snapshot(), hz: travellers.map((t) => model.hzOf(t)) };
}

export function corePath(steps, { seed = SEED } = {}) {
  const c = loadT2d();
  c.init(SR, seed);
  let order = [];
  const free = () => [0, 1, 2, 3].find((s) => !order.includes(s));
  const L = [], R = [], centers = [], gains = [];
  for (const s of steps) {
    if (s.run) {
      for (let b = 0; b < s.run; b++) {
        c.process(BLOCK);
        L.push(Float32Array.from(c.dry(SLOT, 0))); R.push(Float32Array.from(c.dry(SLOT, 1)));
        const m = c.mirror(SLOT);
        centers.push([0, 1, 2, 3].map((i) => m.slice(HEAD + i * SLOT_M + 10, HEAD + i * SLOT_M + 13)));
        gains.push([0, 1, 2, 3].map((i) => m[HEAD + i * SLOT_M + 13]));
      }
      continue;
    }
    const [a, x, y, z] = s;
    if (a === 'add') {
      const slot = free(); if (slot == null) continue;
      const o = { u: x, v: y, oct: 0, r: 0.16, fig: 0, mode: 2, sp: 0.22, lvl: 0.8, ...z };
      c.action(SLOT, ACT.add, slot, T_KEYS.map((k) => o[k])); order.push(slot);
    } else if (a === 'drop') { c.action(SLOT, ACT.drop, order[x]); order.splice(x, 1); }
    else if (a === 'move') c.action(SLOT, ACT.move, order[x], [y, z]);
    else if (a === 'set') { const ks = Object.entries(y); ks.forEach(([k, v], j) => c.action(SLOT, ACT.set, order[x], [T_KEYS.indexOf(k), v, j === ks.length - 1 && z ? 1 : 0])); }
    else if (a === 'fx') c.action(SLOT, ACT.fx, FX_KEYS.indexOf(x), [y]);
    else if (a === 'land') c.action(SLOT, ACT.land, 0, [x]);
    else if (a === 'scale') c.scale(x, y, z);
    else if (a === 'clear') { c.action(SLOT, ACT.clear); order = []; }
    else if (a === 'restore') { c.restore(SLOT, x); order = JSON.parse(x).t.slice(0, 4).map((_, i) => i); }
  }
  const m = c.mirror(SLOT);
  return { L: cat(L), R: cat(R), centers, gains, snapshot: c.snapshot(SLOT), hz: order.map((s) => m[HEAD + s * SLOT_M + 9]), core: c };
}
