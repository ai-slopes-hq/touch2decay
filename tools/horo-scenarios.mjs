// Сценарии сверки ядра Horologium (мир IX в t2d.wasm) с эталоном: прежняя JS-модель (tools/ref/horologium-model.js) → сообщения, как
// прежний engine.js (set: кольца, B, F, fx; step) → прежний worklet (tools/ref/horo-worklet.js, ГСЧ с зерном) → ×2.4 (out прежнего engine).
// Шаг — действие или { run: блоков }: ['ring', i, key, v], ['fx', key, v], ['run', on], ['bpm', v],
// ['scale', on, idx, root], ['clear'], ['restore', js]. Эталон шлёт скорость, когда модель сочтёт нужным (tick: сменилась > 0.4 %) — сравнивать
// по сэмплам сценарии с постоянной скоростью.
import { createModel as jsModel } from './ref/horologium-model.js';
import { sandbox, SR, BLOCK } from './goetia-scenarios.mjs';
import { loadT2d } from './t2d-core.mjs';

export const SEED = 909, OUT = 2.4, SLOT = 9;
export const ACT = { ring: 0, fx: 1, run: 2, held: 3, step: 4, bpm: 5, speed: 6, clear: 7 };   // held / step / speed выведены (ядро их игнорирует), номера остались
export const FX_KEYS = ['aequalis', 'materia', 'concursus', 'chance', 'hall'], RING_KEYS = ['on', 'under', 'phi', 'lvl'];
export const HEAD = FX_KEYS.length + 6, M = { run: 5, bpm: 6, P: 7, F: 8, strikes: 9, locked: 10 };

export const ACTS = {
  still: [{ run: 100 }, ['ring', 4, 'on', 1], { run: 50 }],                          // колесо стоит — тишина
  tick: [['run', true], { run: 1500 }],                                           // IV : V : VI на 100 BPM, медленно — тиканье
  fast: [['bpm', 3200], ['run', true], { run: 800 }],                   // за limen — тон
  under: [['ring', 2, 'under', 1], ['ring', 3, 'under', 1], ['bpm', 200], ['run', true], { run: 1000 }],
  phase: [['ring', 3, 'phi', 0.25], ['fx', 'concursus', 1], ['run', true], { run: 1200 }],
  materia: [['fx', 'materia', 0], ['run', true], { run: 800 }, ['fx', 'materia', 1], { run: 800 }],
  aequalis: [['fx', 'aequalis', 1], ['ring', 5, 'on', 1], ['bpm', 800], ['run', true], { run: 800 }],
  chance: [['fx', 'chance', 0.5], ['bpm', 400], ['run', true], { run: 1000 }],
  scale: [['scale', true, 1, 5], ['bpm', 1600], ['run', true], { run: 600 }],
  rings: [['ring', 0, 'on', 1], ['ring', 6, 'on', 1], ['ring', 4, 'lvl', 0.3], ['run', true], { run: 600 }, ['ring', 6, 'on', 0], { run: 400 }],
  stop: [['run', true], { run: 400 }, ['run', false], { run: 400 }],
  clear: [['run', true], { run: 400 }, ['clear'], { run: 400 }],
  restore: [['run', true], { run: 200 }, ['restore', '{"r":[{"on":true,"under":false,"phi":0,"lvl":0.8},{"on":true,"under":false,"phi":0.5,"lvl":0.8},{"on":false,"under":false,"phi":0,"lvl":0.8},{"on":true,"under":false,"phi":0,"lvl":0.6},{"on":false,"under":false,"phi":0,"lvl":0.8},{"on":false,"under":false,"phi":0,"lvl":0.8},{"on":false,"under":false,"phi":0,"lvl":0.8},{"on":false,"under":false,"phi":0,"lvl":0.8}],"fx":{"aequalis":0,"materia":0.8,"concursus":0.4,"chance":1,"hall":0.35},"bpm":120,"run":true,"u":0,"uT":0}'], { run: 800 }],
  all: [['bpm', 200], ['run', true], { run: 3000 }, ['ring', 7, 'on', 1], ['fx', 'materia', 0.1], { run: 3000 }, ['bpm', 6400], { run: 2000 }],   // ~10 с
};

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
    else if (e.t === 'fx') applyFx();
  });
  applyFx(); model.sendAll();                            // build, затем ready → sendAll
  const L = [], R = [], wheel = [];
  for (const s of steps) {
    if (s.run) {
      for (let b = 0; b < s.run; b++) {
        if (ticks) model.tick();
        const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
        proc.process([], [[l, r]], {});
        ctx.currentTime += BLOCK / SR;
        L.push(l.map((x) => x * OUT)); R.push(r.map((x) => x * OUT));
        wheel.push([proc.P, proc.F]);
      }
      continue;
    }
    const [a, x, y, z] = s;
    if (a === 'ring') model.setRing(x, y, z);
    else if (a === 'fx') model.setFx(x, y);
    else if (a === 'run') { if (x) model.setRun(true); else model.stop(); }
    else if (a === 'bpm') model.setBpm(x);
    else if (a === 'scale') Object.assign(sc, { on: x, idx: y, root: z });
    else if (a === 'clear') model.clear();
    else if (a === 'restore') model.restore(x);
    model.tick(0);                                       // скорость и тоника — в worklet, как кадр хоста
  }
  return { L: cat(L), R: cat(R), wheel, snapshot: model.snapshot() };
}

export function corePath(steps, { seed = SEED } = {}) {
  const c = loadT2d();
  c.init(SR, seed);
  const L = [], R = [], wheel = [];
  for (const s of steps) {
    if (s.run) {
      for (let b = 0; b < s.run; b++) {
        c.process(BLOCK);
        L.push(Float32Array.from(c.dry(SLOT, 0))); R.push(Float32Array.from(c.dry(SLOT, 1)));
        const m = c.mirror(SLOT);
        wheel.push([m[M.P], m[M.F]]);
      }
      continue;
    }
    const [a, x, y, z] = s;
    if (a === 'ring') c.action(SLOT, ACT.ring, x, [RING_KEYS.indexOf(y), z]);
    else if (a === 'fx') c.action(SLOT, ACT.fx, FX_KEYS.indexOf(x), [y]);
    else if (a === 'run') c.action(SLOT, ACT.run, 0, [x ? 1 : 0]);
    else if (a === 'bpm') c.action(SLOT, ACT.bpm, 0, [x]);
    else if (a === 'scale') c.scale(x, y, z);
    else if (a === 'clear') c.action(SLOT, ACT.clear);
    else if (a === 'restore') c.restore(SLOT, x);
  }
  return { L: cat(L), R: cat(R), wheel, snapshot: c.snapshot(SLOT) };
}

