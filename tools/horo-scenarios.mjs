// Сценарии сверки ядра Horologium (мир IX в t2d.wasm) с эталоном: прежняя JS-модель (tools/ref/horologium-model.js) → сообщения, как
// прежний engine.js (set: кольца, B, F, fx; step) → прежний worklet (tools/ref/horo-worklet.js, ГСЧ с зерном) → ×2.4 (out прежнего engine).
// Шаг — действие или { run: блоков }: ['ring', i, key, v], ['fx', key, v], ['run', on, u?], ['bpm', v], ['step', d], ['speed', u, uT, strip],
// ['scale', on, idx, root], ['clear'], ['restore', js]. Эталон шлёт скорость, когда модель сочтёт нужным (tick: сменилась > 0.4 %) — сравнивать
// по сэмплам сценарии с постоянной скоростью; ход часов (u) сравнивается каждый блок — dt блока у обоих тот же.
import { createModel as jsModel } from './ref/horologium-model.js';
import { sandbox, SR, BLOCK } from './goetia-scenarios.mjs';
import { loadT2d } from './t2d-core.mjs';

export const SEED = 909, OUT = 2.4, SLOT = 9;
export const ACT = { ring: 0, fx: 1, run: 2, held: 3, step: 4, bpm: 5, speed: 6, clear: 7 };
export const FX_KEYS = ['aequalis', 'materia', 'concursus', 'chance', 'hall'], RING_KEYS = ['on', 'under', 'phi', 'lvl'];
export const HEAD = FX_KEYS.length + 10, M = { run: 5, u: 6, uT: 7, bpm: 8, strip: 9, held: 10, P: 11, F: 12, strikes: 13, locked: 14 };

export const ACTS = {
  still: [{ run: 100 }, ['ring', 4, 'on', 1], { run: 50 }],                          // колесо стоит — тишина
  tick: [['run', true, 0], { run: 1500 }],                                           // IV : V : VI на 100 BPM, медленно — тиканье
  fast: [['run', true, 5], ['speed', 5, 5, false], { run: 800 }],                   // за limen — тон
  under: [['ring', 2, 'under', 1], ['ring', 3, 'under', 1], ['run', true, 1], ['speed', 1, 1, false], { run: 1000 }],
  phase: [['ring', 3, 'phi', 0.25], ['fx', 'concursus', 1], ['run', true, 0], { run: 1200 }],
  materia: [['fx', 'materia', 0], ['run', true, 0], { run: 800 }, ['fx', 'materia', 1], { run: 800 }],
  aequalis: [['fx', 'aequalis', 1], ['ring', 5, 'on', 1], ['run', true, 3], ['speed', 3, 3, false], { run: 800 }],
  chance: [['fx', 'chance', 0.5], ['run', true, 2], ['speed', 2, 2, false], { run: 1000 }],
  step: [{ run: 20 }, ['step', 0.25], { run: 200 }, ['step', 0.25], { run: 200 }],
  scale: [['scale', true, 1, 5], ['run', true, 4], ['speed', 4, 4, false], { run: 600 }],
  rings: [['ring', 0, 'on', 1], ['ring', 6, 'on', 1], ['ring', 4, 'lvl', 0.3], ['run', true, 0], { run: 600 }, ['ring', 6, 'on', 0], { run: 400 }],
  stop: [['run', true, 0], { run: 400 }, ['run', false], { run: 400 }],
  clear: [['run', true, 0], { run: 400 }, ['clear'], { run: 400 }],
  restore: [['run', true, 0], { run: 200 }, ['restore', '{"r":[{"on":true,"under":false,"phi":0,"lvl":0.8},{"on":true,"under":false,"phi":0.5,"lvl":0.8},{"on":false,"under":false,"phi":0,"lvl":0.8},{"on":true,"under":false,"phi":0,"lvl":0.6},{"on":false,"under":false,"phi":0,"lvl":0.8},{"on":false,"under":false,"phi":0,"lvl":0.8},{"on":false,"under":false,"phi":0,"lvl":0.8},{"on":false,"under":false,"phi":0,"lvl":0.8}],"fx":{"aequalis":0,"materia":0.8,"concursus":0.4,"chance":1,"hall":0.35},"bpm":120,"run":true,"u":0,"uT":0}'], { run: 800 }],
  all: [['run', true, 1], ['speed', 1, 1, false], { run: 3000 }, ['ring', 7, 'on', 1], ['fx', 'materia', 0.1], { run: 3000 }, ['speed', 6, 6, false], { run: 2000 }],   // ~10 с
};
const DECAY = [['run', true, 4], { run: 4000 }];                                     // бросок: u = 4 → к 0 с τ 6 с

const hostScale = (sc) => ({ get on() { return sc.on; }, get root() { return sc.on ? sc.root : 0; } });
const cat = (bs) => { const o = new Float32Array(bs.length * BLOCK); bs.forEach((b, k) => o.set(b, k * BLOCK)); return o; };

export function refPath(steps, { seed = SEED, ticks = false } = {}) {
  const { reg, ctx } = sandbox('./ref/horo-worklet.js', { currentTime: 0 });
  const proc = new reg.horo({ processorOptions: { seed: seed + 1 } });
  const sc = { on: false, idx: 0, root: 0 };
  const model = jsModel({ scale: hostScale(sc) });
  const { rings, fx } = model.state;
  const send = (m) => proc.port.onmessage({ data: m });
  const ringsMsg = () => rings.map(({ on, under, phi, lvl }) => ({ on, under, phi, lvl }));
  const applyFx = () => send({ t: 'set', mat: fx.materia, conc: fx.concursus, chance: fx.chance, aeq: fx.aequalis });
  model.listen((e) => {
    if (e.t === 'all') send({ t: 'set', rings: ringsMsg(), B: model.baseB(), F: model.Fnow() });
    else if (e.t === 'rings') send({ t: 'set', rings: ringsMsg() });
    else if (e.t === 'speed') send(e.B === undefined ? { t: 'set', F: e.F } : { t: 'set', F: e.F, B: e.B });
    else if (e.t === 'step') send({ t: 'step', d: e.d });
    else if (e.t === 'fx') applyFx();
  });
  applyFx(); model.sendAll();                            // build, затем ready → sendAll
  const L = [], R = [], us = [], wheel = [];
  for (const s of steps) {
    if (s.run) {
      for (let b = 0; b < s.run; b++) {
        if (ticks) model.tick(BLOCK / SR);
        const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
        proc.process([], [[l, r]], {});
        ctx.currentTime += BLOCK / SR;
        L.push(l.map((x) => x * OUT)); R.push(r.map((x) => x * OUT));
        us.push(model.state.clock.u); wheel.push([proc.P, proc.F]);
      }
      continue;
    }
    const [a, x, y, z] = s;
    if (a === 'ring') model.setRing(x, y, z);
    else if (a === 'fx') model.setFx(x, y);
    else if (a === 'run') { if (x) model.setRun(true, y ?? model.state.clock.uT); else model.stop(); }
    else if (a === 'bpm') model.setBpm(x);
    else if (a === 'step') send({ t: 'step', d: x });
    else if (a === 'speed') Object.assign(model.state.clock, { u: x, uT: y, strip: z });
    else if (a === 'scale') Object.assign(sc, { on: x, idx: y, root: z });
    else if (a === 'clear') model.clear();
    else if (a === 'restore') model.restore(x);
    model.tick(0);                                       // скорость и тоника — в worklet, как кадр хоста
  }
  return { L: cat(L), R: cat(R), us, wheel, snapshot: model.snapshot() };
}

export function corePath(steps, { seed = SEED } = {}) {
  const c = loadT2d();
  c.init(SR, seed);
  const L = [], R = [], us = [], wheel = [];
  for (const s of steps) {
    if (s.run) {
      for (let b = 0; b < s.run; b++) {
        c.process(BLOCK);
        L.push(Float32Array.from(c.dry(SLOT, 0))); R.push(Float32Array.from(c.dry(SLOT, 1)));
        const m = c.mirror(SLOT);
        us.push(m[M.u]); wheel.push([m[M.P], m[M.F]]);
      }
      continue;
    }
    const [a, x, y, z] = s;
    if (a === 'ring') c.action(SLOT, ACT.ring, x, [RING_KEYS.indexOf(y), z]);
    else if (a === 'fx') c.action(SLOT, ACT.fx, FX_KEYS.indexOf(x), [y]);
    else if (a === 'run') c.action(SLOT, ACT.run, 0, x ? (y == null ? [1] : [1, y]) : [0]);
    else if (a === 'bpm') c.action(SLOT, ACT.bpm, 0, [x]);
    else if (a === 'step') c.action(SLOT, ACT.step, 0, [x]);
    else if (a === 'speed') c.action(SLOT, ACT.speed, 0, [x, y, z ? 1 : 0]);
    else if (a === 'scale') c.scale(x, y, z);
    else if (a === 'clear') c.action(SLOT, ACT.clear);
    else if (a === 'restore') c.restore(SLOT, x);
  }
  return { L: cat(L), R: cat(R), us, wheel, snapshot: c.snapshot(SLOT) };
}
export { DECAY };
