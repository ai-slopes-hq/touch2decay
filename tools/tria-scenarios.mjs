// Сверка модели Tria в ядре (t2d.wasm, слот 11) с эталоном — прежней JS-моделью (tools/ref/tria-model.js): одни действия, шаг —
// блок 128 сэмплов (эталон — tick(128/sr), ядро — process(128)); после каждого блока — тела (x, y, vx, vy, amp, hz), pairK, trem, флаги;
// вспышки (вид, тело, место) — те же и в том же блоке. ACTS — сценарии: [блок, действие, ...аргументы]; кубик — значения эталона после
// его dice (ядро получает их действием DICE, как от фасада).
import { createModel } from './ref/tria-model.js';
import { loadT2d } from './t2d-core.mjs';
import { seeded } from './models/util.mjs';

export const SR = 48000, BLOCK = 128, SLOT = 11;
export const ACT = { grab: 0, drop: 1, drag: 2, release: 3, anchor: 4, set: 5, fx: 6, lux: 7, plumb: 8, dice: 9, clear: 10 };
export const FX_KEYS = ['gravitas', 'flux', 'nexus', 'aspectus', 'decay', 'hall'];
export const HEAD = FX_KEYS.length + 5, BODY_M = 12;
const BKEYS = ['m', 'semi', 'fixed', 'level'];
const sec = (s) => Math.round((s * SR) / BLOCK);

const throwAt = (b, i, path, v) => [[b, 'grab', i], ...path.map(([x, y], k) => [b + k + 1, 'drag', i, x, y]), [b + path.length + 1, 'release', i, v]];
export const ACTS = {
  throw: { secs: 20, acts: throwAt(0, 1, [[0.1, 0.2], [0.2, 0.0], [0.3, -0.2]], { vx: 1.2, vy: -0.8 }) },
  dice: { secs: 20, acts: [[0, 'dice', 7]] },
  decay: { secs: 25, acts: [[0, 'dice', 3], [sec(1), 'fx', 'decay', 1]] },
  lux: { secs: 20, acts: [[0, 'lux'], [sec(12), 'fx', 'gravitas', 0.8]] },
  cadit: { secs: 12, acts: [[0, 'dice', 11], [sec(2), 'plumb'], [sec(8), 'plumb']] },
  bodies: { secs: 15, acts: [[0, 'dice', 5], [sec(1), 'anchor', 0], [sec(2), 'set', 1, 'm', 0.9], [sec(3), 'set', 2, 'semi', 0.7], [sec(4), 'set', 1, 'level', 0.3], [sec(6), 'anchor', 0], [sec(7), 'fx', 'flux', 0.9], [sec(8), 'fx', 'aspectus', 0.2], [sec(10), 'fx', 'aspectus', 0.9]] },
  lfo: { secs: 10, acts: [[0, 'dice', 21], ...Array.from({ length: 300 }, (_, k) => [10 + k * 12, 'fx', 'gravitas', 0.5 + 0.4 * Math.sin(k * 0.21)])] },
  tap: { secs: 8, acts: [[0, 'dice', 9], [sec(2), 'grab', 2], [sec(2) + 30, 'release', 2, null], [sec(4), 'grab', 0], [sec(4) + 50, 'drop', 0], [sec(5), 'clear'], [sec(6), 'dice', 13]] },
  restore: { secs: 10, acts: [[0, 'restore', '{"b":[{"x":0.2,"y":0.1,"vx":0.5,"vy":-0.3,"m":1.4,"fixed":false,"semi":0,"level":0.8},{"x":-0.4,"y":0.3,"vx":-0.2,"vy":0.6,"m":0.7,"fixed":false,"semi":7,"level":0.5},{"x":0.1,"y":-0.6,"vx":0.1,"vy":0.2,"m":1,"fixed":true,"semi":12,"level":1}],"fx":{"gravitas":0.7,"flux":0.3,"nexus":0.6,"aspectus":0.5,"decay":0,"hall":0.5},"still":false,"lux":false,"cadit":false}']] },
  scale: { secs: 8, scale: { on: true, idx: 1, root: 3 }, acts: [[0, 'dice', 17]] },
};

// эталон: прежняя JS-модель; scale — лад хоста (host/scale.js snapSemi)
export function refRun(name, scaleImpl, onBlock) {
  const sc = ACTS[name];
  let R = Math.random;                                  // кубик: случайность с зерном сценария
  const m = createModel({ scale: scaleImpl, rng: () => R() });
  const byB = new Map();
  for (const a of sc.acts) { if (!byB.has(a[0])) byB.set(a[0], []); byB.get(a[0]).push(a); }
  const nb = sec(sc.secs), out = [];
  for (let b = 0; b < nb; b++) {
    const coreActs = [];
    for (const [, k, ...x] of byB.get(b) || []) {
      if (k === 'dice') { R = seeded(x[0]); m.dice(); coreActs.push(['dice', m.state.bodies.flatMap((q) => [q.x, q.y, q.vx, q.vy, q.m, q.semi])]); }
      else if (k === 'grab') { m.grab(x[0]); coreActs.push([k, x[0]]); }
      else if (k === 'drop') { m.drop(x[0]); coreActs.push([k, x[0]]); }
      else if (k === 'drag') { m.drag(x[0], x[1], x[2]); coreActs.push([k, x[0], [x[1], x[2]]]); }
      else if (k === 'release') { m.release(x[0], x[1]); coreActs.push([k, x[0], x[1] ? [x[1].vx, x[1].vy] : []]); }
      else if (k === 'anchor') { m.anchor(x[0]); coreActs.push([k, x[0]]); }
      else if (k === 'set') { m.setBody(x[0], x[1], x[2]); coreActs.push([k, x[0], [BKEYS.indexOf(x[1]), x[2]]]); }
      else if (k === 'fx') { m.setFx(x[0], x[1]); coreActs.push([k, FX_KEYS.indexOf(x[0]), [x[1]]]); }
      else if (k === 'lux') { m.fiatLux(); coreActs.push([k, 0]); }
      else if (k === 'plumb') { m.plumb(); coreActs.push([k, 0]); }
      else if (k === 'clear') { m.clear(); coreActs.push([k, 0]); }
      else if (k === 'restore') { m.restore(x[0]); coreActs.push([k, x[0]]); }
    }
    const seen = new Set(m.state.flashes);
    m.tick(BLOCK / SR);
    const fresh = m.state.flashes.filter((f) => !seen.has(f));   // вспышки этого блока (список ≤ 30 — режется спереди)
    out.push(onBlock ? onBlock(m, b, coreActs, fresh) : null);
  }
  return { model: m, out };
}

export function coreBoot(scale) {
  const k = loadT2d();
  k.init(SR, 1);
  k.scale(scale.on, scale.idx, scale.root);
  return k;
}
export function coreApply(k, acts) {
  for (const [kind, i, a] of acts) {
    if (kind === 'dice') k.action(SLOT, ACT.dice, 0, i);
    else if (kind === 'restore') k.restore(SLOT, i);
    else k.action(SLOT, ACT[kind], i, a || []);
  }
}
export function coreBodies(mir) {
  return [0, 1, 2].map((i) => { const o = HEAD + i * BODY_M; const [x, y, vx, vy, m, fixed, semi, level, amp, hz, pairK, trem] = mir.slice(o, o + BODY_M); return { x, y, vx, vy, m, fixed: !!fixed, semi, level, amp, hz, pairK, trem }; });
}
// вспышки из услышанного ядра: [число, (i, вид, x, y, q)…]
export const KINDS = ['ring', 'ray', 'rim', 'conj'];
export function coreFlashes(h) {
  const out = [];
  if (!h.length) return out;
  for (let k = 0; k < h[0]; k++) { const p = 1 + k * 5; out.push({ i: h[p], kind: KINDS[h[p + 1]], x: h[p + 2], y: h[p + 3], q: h[p + 4] }); }
  return out;
}
