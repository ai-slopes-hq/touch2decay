// Сценарии сверки ядра Goetia: одни и те же сообщения порта — в эталонный JS-worklet (tools/ref) и текстом в core/build/render-cli
// (звук, goetia.cpp). Шаг — сообщение ({t:'voice'|'fx'|'sett', …}) или { run: блоков } (блок — 128 сэмплов).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const SR = 48000, BLOCK = 128;
const OPS = ['|', '&', '^', '+', '*', '-', '%', '>'];
const lpOf = (fc) => 1 - Math.exp((-2 * Math.PI * fc) / SR);
const FX = { t: 'fx', spread: 0.6, wide: 0.35 };
const voice = (i, prog, o = {}) => ({ t: 'voice', i, on: true, prog, rate: 7040, lp: lpOf(2500), lvl: 0.24, legio: 1, pan: 0, rel: 1, trig: 9, ...o });
const SEAL = [['&', 5], ['|', 8], ['-', 4]];

export const SCENARIOS = {
  strike: [FX, voice(0, SEAL, { rel: 0.2 }), { run: 200 }],
  drone: [FX, voice(0, SEAL), { run: 200 }],
  ops: [FX, voice(0, [['|', 8], ['&', 5], ['^', 10], ['+', 6]], { pan: -0.6 }), voice(1, [['*', 11], ['-', 4], ['%', 9], ['>', 7]], { pan: 0.6, rel: 0.4, trig: 11 }), { run: 200 }],
  legion: [FX, voice(0, SEAL, { legio: 4 }), { run: 150 }, { t: 'fx', spread: 1, wide: 1 }, { run: 150 }],
  rebanish: [FX, voice(0, SEAL), { run: 100 }, voice(0, SEAL, { on: false }), { run: 20 }, voice(0, [['^', 10], ['+', 6]]), { run: 100 },
    voice(0, [['^', 10], ['+', 6]], { on: false }), { run: 2000 }, voice(0, [['*', 11], ['|', 8]]), { run: 100 }],
  glide: [FX, voice(0, SEAL), { run: 100 }, voice(0, SEAL, { rate: 14080 }), { run: 200 }],
  three: [FX, voice(0, SEAL, { pan: -0.6 }), voice(1, [['^', 10], ['%', 9]], { pan: 0, legio: 2, rel: 0.3, lp: lpOf(800) }),
    voice(2, [['>', 7], ['+', 6], ['&', 5]], { pan: 0.6, legio: 3, rate: 3520, lp: lpOf(9000) }), { run: 300 }],
  wrap: [FX, voice(0, SEAL), { t: 'sett', i: 0, t0: 2 ** 31 - 8000 }, { run: 1000 }],
};

const num = (x) => Number(x).toPrecision(17);
export function toScript(steps, sr = SR) {              // текст для render-cli: init, prog, voice, fx, sett, run
  const out = [`init ${sr}`];
  for (const s of steps) {
    if (s.run) out.push(`run ${s.run}`);
    else if (s.t === 'fx') out.push(`fx ${num(s.spread)} ${num(s.wide)}`);
    else if (s.t === 'sett') out.push(`sett ${s.i} ${num(s.t0)}`);
    else if (s.t === 'voice') {
      if (s.prog) out.push(`prog ${s.i} ${s.prog.map(([op, sh]) => `${Math.max(0, OPS.indexOf(op))} ${sh}`).join(' ')}`);
      out.push(`voice ${s.i} ${s.on ? 1 : 0} ${[s.rate, s.lp, s.lvl].map(num).join(' ')} ${s.legio} ${num(s.pan)} ${num(s.rel)} ${s.trig}`);
    }
  }
  return out.join('\n') + '\n';
}

export function sandbox(file, extra = {}) {                    // worklet в vm с заглушками AudioWorklet
  const posted = [], reg = {};
  const ctx = {
    sampleRate: SR, Math, Float32Array, Float64Array, Uint8Array, Int32Array, Array, Object, Number, String, JSON, Promise, WebAssembly,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (m) => posted.push(m), onmessage: null }; } },
    registerProcessor: (name, cls) => { reg[name] = cls; },
    ...extra,
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL(file, import.meta.url), 'utf8'), ctx);
  return { reg, posted };
}
export function loadRef() {
  const { reg, posted } = sandbox('./ref/goetia-worklet.js');
  return { proc: new reg.goetia({}), posted };
}

export function play(proc, steps, posted, block = BLOCK) {   // прогнать сценарий: L, R и метры {tt, g} (сообщения 'p'); block — размер блока
  const L = [], R = [];
  const from = posted ? posted.length : 0;
  for (const s of steps) {
    if (!s.run) { proc.port.onmessage({ data: s }); continue; }
    for (let b = 0; b < s.run; b++) {
      const l = new Float32Array(block), r = new Float32Array(block);
      proc.process([], [[l, r]], {});
      L.push(l); R.push(r);
    }
  }
  const cat = (bs) => { const o = new Float32Array(bs.length * block); bs.forEach((b, k) => o.set(b, k * block)); return o; };
  const meters = posted ? posted.slice(from).filter((m) => m.t === 'p').map(({ tt, g }) => ({ tt: [...tt], g: [...g] })) : [];
  return { L: cat(L), R: cat(R), meters };
}


// ---------- SDK: сценарии действиями (мир XV в t2d.wasm) ----------
// Шаг — действие модели (['seal', [узлы], {semi, tone, rel, legio, lvl}?], ['path', born, [узлы]], ['set', born, {…}], ['banish', born],
// ['fx', key, v], ['clear'], ['dice'], ['restore', js], ['scale', on, idx, root], ['sett', slot, t]) или { run: блоков }.
// born — порядок призыва (1, 2, … — и в эталоне, и в ядре). Эталонный путь: JS-модель (tools/ref/goetia-model.js) → сообщения, как прежний
// engine.js (sendSpirit, fx) → tools/ref/goetia-worklet.js → шина прежнего engine.js по сэмплам (busRef: эхо, ×1.6). Путь ядра: те же
// действия → t2d.wasm, сухой выход слота 15. Метры: эталон шлёт 'p' {tt, g} раз в round(sr/30) сэмплов — зеркало ядра — по тому же счёту.
import { createModel as jsModel, progOf, trigOf, fcOf } from './ref/goetia-model.js';
import { scl, snapSemi } from '../host/scale.js';
import { seeded } from './models/util.mjs';
import { loadT2d } from './t2d-core.mjs';
import { SLOT, ACT, SET_KEYS, FX_KEYS, HEAD, MSPIRIT, SEAL_MAX } from '../worlds/goetia/model.js';

export const SEED = 777, OUT = 1.6;
const EVERY = Math.round(SR / 30);
export const hostScale = (sc) => ({
  get on() { return sc.on; },
  snap(s) { const keep = { ...scl }; Object.assign(scl, sc); const r = snapSemi(s); Object.assign(scl, keep); return r; },
});

// Шина прежнего engine.js по сэмплам: GainNode-ы с setTargetAtTime(·, 0.05) от нуля, эхо — DelayNode 0.375 с (по каналу) → LP 2600 (Q 1 дБ,
// формулы Web Audio) → обратно × fb и в выход; выход — (сухое + эхо) ×1.6. Та же схема, что core/sdk/echo.hpp, — независимо на JS.
export function busRef(sr = SR) {
  const D = Math.round(0.375 * sr), c = 1 - Math.exp(-1 / (0.05 * sr));
  const w = (2 * Math.PI * 2600) / sr, cw = Math.cos(w), al = Math.sin(w) / (2 * 10 ** (1 / 20)), a0 = 1 + al;
  const B = [(1 - cw) / 2 / a0, (1 - cw) / a0, (1 - cw) / 2 / a0], A = [(-2 * cw) / a0, (1 - al) / a0];
  const ch = [0, 1].map(() => ({ buf: new Float32Array(D), w: 0, x1: 0, x2: 0, y1: 0, y2: 0, s: 0, f: 0 }));
  let sendTo = 0, fbTo = 0;
  return {
    set(echo) { sendTo = echo * 0.8; fbTo = echo * 0.55; },
    process(L, R) {                                     // на месте: L, R — сухой звук → выход мира
      [L, R].forEach((X, k) => {
        const q = ch[k];
        for (let i = 0; i < X.length; i++) {
          q.s += (sendTo - q.s) * c; q.f += (fbTo - q.f) * c;
          const x = q.buf[q.w];                         // D записей назад
          let y = B[0] * x + B[1] * q.x1 + B[2] * q.x2 - A[0] * q.y1 - A[1] * q.y2;
          q.x2 = q.x1; q.x1 = x; q.y2 = q.y1; q.y1 = y;
          let v = X[i] * q.s + y * q.f;
          if (Math.abs(v) < 1e-12) v = 0;
          q.buf[q.w] = v; q.w = (q.w + 1) % D;
          X[i] = (X[i] + Math.fround(y)) * OUT;
        }
        if (Math.abs(q.y1) < 1e-12 && Math.abs(q.y2) < 1e-12) q.y1 = q.y2 = 0;
      });
    },
  };
}

const ROLL = [2, 5, 0];                                 // & V, − IV, | VIII
export const ACTS = {
  drone: [['fx', 'echo', 0], ['seal', ROLL], { run: 400 }],
  strike: [['fx', 'echo', 0], ['seal', ROLL, { rel: 0.2 }], { run: 400 }],
  three: [['fx', 'echo', 0], ['seal', [0, 1, 2]], ['seal', [3, 6, 2, 7], { semi: 7, legio: 3, rel: 0.3, tone: 0.2 }], ['seal', [7, 3, 1], { semi: -12, legio: 2, tone: 0.9 }], { run: 300 }],
  draw: [['fx', 'echo', 0], ['seal', [1, 0]], { run: 50 }, ['path', 1, [1, 0, 5]], { run: 50 }, ['path', 1, [1, 0, 5, 2]], { run: 50 }, ['path', 1, [1, 0, 5, 2, 6, 3, 4, 7]], { run: 200 }],
  fourth: [['fx', 'echo', 0], ['seal', [0, 1]], ['seal', [2, 3]], ['seal', [4, 5]], { run: 100 }, ['seal', [6, 7]], { run: 200 }, ['banish', 3], { run: 100 }, ['seal', [1, 2, 3]], { run: 200 }],
  sheet: [['fx', 'echo', 0], ['seal', ROLL], { run: 100 }, ['set', 1, { semi: 12 }], { run: 100 }, ['set', 1, { tone: 0.9, rel: 0.4 }], { run: 200 }, ['set', 1, { legio: 4, lvl: 0.5 }], { run: 200 }],
  fx: [['fx', 'echo', 0], ['seal', ROLL], ['seal', [3, 6, 2]], { run: 200 }, ['fx', 'legio', 1], ['fx', 'spread', 1], { run: 200 }, ['fx', 'spread', 0], { run: 200 }, ['fx', 'hall', 0.9], { run: 100 }],
  echo: [['seal', ROLL, { rel: 0.2 }], { run: 300 }, ['fx', 'echo', 0.8], { run: 800 }, ['banish', 1], { run: 600 }, ['fx', 'echo', 0], { run: 400 }],
  relight: [['fx', 'echo', 0], ['seal', ROLL], { run: 100 }, ['banish', 1], { run: 20 }, ['seal', [3, 6]], { run: 100 }, ['banish', 2], { run: 2000 }, ['seal', [4, 0]], { run: 100 }],
  scale: [['fx', 'echo', 0], ['scale', true, 1, 3], ['seal', ROLL, { semi: 5 }], ['seal', [3, 6], { semi: -3 }], { run: 200 }, ['scale', true, 0, 5], ['set', 2, { semi: 4 }], { run: 200 },
    ['scale', false, 0, 0], ['set', 1, { semi: 6 }], { run: 200 }],
  wrap: [['fx', 'echo', 0], ['seal', ROLL], ['sett', 0, 2 ** 31 - 8000], { run: 1000 }],
  restore: [['seal', [0, 1]], { run: 100 }, ['restore', '{"s":[{"slot":2,"path":[1,0,5],"semi":0,"tone":0.45,"rel":1,"legio":2,"lvl":0.7},{"slot":0,"path":[3,6,2,7],"semi":7,"tone":0.35,"rel":0.3,"legio":1,"lvl":0.7}],"fx":{"legio":0.35,"echo":0.5,"spread":0.6,"hall":0.4}}'],
    { run: 600 }, ['clear'], { run: 300 }],
  dice: [['dice'], { run: 600 }, ['dice'], { run: 600 }, ['seal', [5, 4, 3]], { run: 200 }],
  all: [['dice'], ['fx', 'echo', 0.5], ['fx', 'legio', 0.8], { run: 1500 }, ['seal', [1, 2]], ...Array.from({ length: 5 }, (_, k) => [['path', 4, [1, 2, 3, 4, 5, 6].slice(0, 2 + k)], { run: 30 }]).flat(),
    { run: 1500 }, ['set', 4, { rel: 0.2, semi: -5 }], { run: 3000 }, ['dice'], ['set', 6, { legio: 3 }], { run: 3000 }, ['banish', 7], ['fx', 'hall', 0.9], { run: 1890 }],   // ~25 с
};

const cat = (bs) => { const o = new Float32Array(bs.length * BLOCK); bs.forEach((b, k) => o.set(b, k * BLOCK)); return o; };

export function refPath(steps, { seed = SEED } = {}) {   // эталон: JS-модель → сообщения как engine.js → goetia-worklet.js эталона → шина
  const { proc, posted } = loadRef();
  const bus = busRef();
  const sc = { on: false, idx: 0, root: 0 };
  const model = jsModel({ rng: seeded(seed), scale: hostScale(sc) });
  const { spirits, fx } = model.state;
  const send = (m) => proc.port.onmessage({ data: m });
  const applyFx = () => { bus.set(fx.echo); send({ t: 'fx', spread: fx.spread, wide: fx.legio }); };
  const sendSpirit = (s, on) => send({ t: 'voice', i: s.slot, on, prog: progOf(s.path), rate: model.rate(s), lp: 1 - Math.exp((-2 * Math.PI * fcOf(s)) / SR), lvl: s.lvl * 0.3, legio: s.legio, rel: s.rel, trig: trigOf(s), pan: [-0.6, 0, 0.6][s.slot] });
  model.listen((e) => { if (e.t === 'spirit') sendSpirit(e.s, e.on); else if (e.t === 'fx') applyFx(); });
  applyFx();                                            // build: шина и fx — до первого духа
  const byBorn = (b) => spirits.find((s) => s.born === b);
  const L = [], R = [], meters = [];
  let seen = 0;
  for (const s of steps) {
    if (s.run) {
      for (let b = 0; b < s.run; b++) {
        const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
        proc.process([], [[l, r]], {});
        const dl = Float64Array.from(l), dr = Float64Array.from(r);
        bus.process(dl, dr);
        L.push(Float32Array.from(dl)); R.push(Float32Array.from(dr));
        for (; seen < posted.length; seen++) {
          const d = posted[seen];
          if (d.t !== 'p') continue;
          meters.push({ at: L.length, s: spirits.map((q) => [q.born, d.tt[q.slot], d.g[q.slot]]) });
        }
      }
      continue;
    }
    const [a, x, y, z] = s;
    if (a === 'seal') model.summon(x, y || {});
    else if (a === 'path') { const q = byBorn(x); if (q) model.setSpirit(q, { path: y }); }
    else if (a === 'set') { const q = byBorn(x); if (q) model.setSpirit(q, y); }
    else if (a === 'banish') { const q = byBorn(x); if (q) model.banish(q); }
    else if (a === 'fx') model.setFx(x, y);
    else if (a === 'clear') model.clear();
    else if (a === 'dice') model.dice();
    else if (a === 'restore') model.restore(x);
    else if (a === 'scale') Object.assign(sc, { on: x, idx: y, root: z });
    else if (a === 'sett') send({ t: 'sett', i: x, t0: y });
  }
  return { L: cat(L), R: cat(R), meters, snapshot: model.snapshot() };
}

export function corePath(steps, { seed = SEED } = {}) { // ядро: те же действия → t2d.wasm, сухой выход мира XV
  const c = loadT2d();
  c.init(SR, seed);
  const L = [], R = [], meters = [];
  let count = 0;
  const DEF = { semi: 0, tone: 0.45, rel: 1, legio: 1, lvl: 0.8 };
  for (const s of steps) {
    if (s.run) {
      for (let b = 0; b < s.run; b++) {
        c.process(BLOCK);
        L.push(Float32Array.from(c.dry(SLOT, 0))); R.push(Float32Array.from(c.dry(SLOT, 1)));
        if ((count += BLOCK) < EVERY) continue;
        count = 0;
        const m = c.mirror(SLOT), N = MSPIRIT.length, ib = MSPIRIT.indexOf('born'), it = MSPIRIT.indexOf('t'), ig = MSPIRIT.indexOf('gain');
        meters.push({ at: L.length, s: Array.from({ length: m[HEAD - 1] }, (_, i) => [m[HEAD + i * N + ib], m[HEAD + i * N + it], m[HEAD + i * N + ig]]) });
      }
      continue;
    }
    const [a, x, y, z] = s;
    if (a === 'seal') { const o = { ...DEF, ...(y || {}) }; c.action(SLOT, ACT.summon, 0, [-1, 0, o.semi, o.tone, o.rel, o.legio, o.lvl, ...x]); }
    else if (a === 'path') c.action(SLOT, ACT.path, x, y);
    else if (a === 'set') for (const [k, v] of Object.entries(y)) c.action(SLOT, ACT.set, x, [SET_KEYS.indexOf(k), v]);   // как фасад: по SET на ключ
    else if (a === 'banish') c.action(SLOT, ACT.banish, x);
    else if (a === 'fx') c.action(SLOT, ACT.fx, FX_KEYS.indexOf(x), [y]);
    else if (a === 'clear' || a === 'dice') c.action(SLOT, ACT[a]);
    else if (a === 'restore') c.restore(SLOT, x);
    else if (a === 'scale') c.scale(x, y, z);
    else if (a === 'sett') c.action(SLOT, ACT.sett, x, [y]);
  }
  return { L: cat(L), R: cat(R), meters, snapshot: c.snapshot(SLOT) };
}
export { SEAL_MAX };
