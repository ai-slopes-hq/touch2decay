// Сценарии сверки ядра Oceanus: одни и те же сообщения порта — в эталонный JS-worklet (tools/ref), в обёртку над wasm
// и текстом в core/build/render-cli. Шаг — сообщение ({t:'params'|'voice'|'push'|'splash', …}) или { run: блоков } (блок — 128 сэмплов).
import { readFileSync } from 'node:fs';
import { sandbox } from './goetia-scenarios.mjs';

export const WASM = new URL('../ocean.wasm', import.meta.url);
export const SR = 48000, BLOCK = 128, SEED = 12345, N = 64;
// параметры, как шлёт engine при fx по умолчанию
const PARAMS = { t: 'params', kt: 0.004 * 60 ** 0.45, damp: 0.00003 * 300 ** 0.4, kc: 0.0015 + 0.004 * 0.55, wind: 0, tide: 0.55 * 0.9, moonRate: 0.005 * 40 ** 0.3, storm: 0, sway: 0, swayTo: 0 };
const voice = (i, o) => ({ t: 'voice', i, on: true, f: 110, lvl: 0.64, path: 0, ...o });
const SIX = [PARAMS, ...[55, 82, 110, 165, 220, 330].map((f, i) => voice(i, { f }))];
const press = (id, a, d, k) => ({ t: 'push', id, a, d, ...(k != null ? { k } : {}) });

export const SCENARIOS = {
  one: [PARAMS, voice(0, {}), { run: 750 }],
  six: [...SIX, { run: 375 }],
  paths: [PARAMS, voice(0, { path: 0 }), voice(1, { path: 1, f: 165 }), voice(2, { path: 2, f: 220 }), { run: 375 }],
  stiff: [voice(0, {}), { ...PARAMS, kt: 0.004 * 60, damp: 0.00003 * 300 }, { run: 375 }, { ...PARAMS, kt: 0.004, damp: 0.00003 }, { run: 375 }],
  tide: [PARAMS, voice(0, {}), { ...PARAMS, tide: 0.9, moonRate: 0.2 }, { run: 750 }],
  sway: [voice(0, {}), { ...PARAMS, storm: 0.7, sway: 0.6, swayTo: 0 }, { run: 375 }, { ...PARAMS, storm: 0.7, sway: 0.6, swayTo: 1 }, { run: 375 },
    { ...PARAMS, storm: 0.7, sway: 0.6, swayTo: 2 }, { run: 375 }],
  wind: [PARAMS, voice(0, {}), { ...PARAMS, wind: 0.8 }, { run: 750 }],
  fingers: [PARAMS, voice(0, {}), press(1, 0.25, 1.2), { run: 200 }, press(2, 0.7, -1), { run: 200 }, press(1, 0.3, 0.6, 0.2), { run: 200 }, { t: 'push', id: 1, off: true }, { run: 200 }],
  splash: [PARAMS, voice(0, {}), { t: 'splash', a: 0.3, amt: 0.4 }, { run: 250 }, { t: 'splash', a: 0.8, amt: -0.5 }, { run: 250 }],
  relight: [PARAMS, voice(0, {}), { run: 200 }, { t: 'voice', i: 0, on: false }, { run: 30 }, voice(0, { f: 150 }), { run: 200 },
    { t: 'voice', i: 0, on: false }, { run: 2000 }, voice(0, {}), { run: 200 }],
  partial: [PARAMS, voice(0, {}), { run: 200 }, { t: 'voice', i: 0, on: true }, { run: 200 }, { t: 'voice', i: 0, on: true, f: 0 }, { run: 200 }, { t: 'params', wind: 0.5 }, { run: 200 }],
  ceiling: [PARAMS, voice(0, {}), press(1, 0.25, 5, 0.5), press(2, 0.75, -5, 0.5), { run: 500 }],   // цели за потолком ±3: срабатывают обе границы
  all: [...SIX, { ...PARAMS, storm: 0.5, wind: 0.4, sway: 0.5, swayTo: 1 }, press(1, 0.2, 1), press(2, 0.6, -1), { t: 'splash', a: 0.4, amt: 0.3 }, { run: 5000 },
    { t: 'splash', a: 0.9, amt: -0.4 }, press(1, 0.5, 0.5, 0.2), { run: 6250 }],
};

const num = (x) => Number(x).toPrecision(17);
const PK = ['kt', 'damp', 'kc', 'wind', 'tide', 'moonRate', 'storm', 'sway', 'swayTo'];
export function toScript(steps, sr = SR, seed = SEED) {  // текст для render-cli: init, params, push, release, splash, voice, run; поля держим слитыми
  const out = ['world oceanus', `init ${sr} ${seed}`];
  const pr = { kt: 0.03, damp: 0.002, kc: 0.004, wind: 0, tide: 0.5, moonRate: 0.04, storm: 0, sway: 0, swayTo: 0 };
  const vo = Array.from({ length: 6 }, () => ({ f: 110, lvl: 0.8, path: 0 }));
  for (const s of steps) {
    if (s.run) out.push(`run ${s.run}`);
    else if (s.t === 'params') {
      for (const k of PK) if (s[k] != null) pr[k] = s[k];
      out.push(`params ${PK.map((k) => num(pr[k])).join(' ')}`);
    } else if (s.t === 'push') {
      if (s.off) out.push(`release ${s.id}`); else out.push(`push ${s.id} ${num(s.a)} ${num(s.d)} ${num(s.k || 0.08)}`);
    } else if (s.t === 'splash') out.push(`splash ${num(s.a)} ${num(s.amt)}`);
    else if (s.t === 'voice') {
      const o = vo[s.i];
      if (s.f) o.f = s.f;
      if (s.lvl != null) o.lvl = s.lvl;
      if (s.path != null) o.path = s.path;
      out.push(`voice ${s.i} ${s.on ? 1 : 0} ${num(o.f)} ${num(o.lvl)} ${o.path}`);
    }
  }
  return out.join('\n') + '\n';
}

export function loadRef(seed = SEED, sr = SR) {          // эталон с зерном
  const { reg, posted } = sandbox('./ref/ocean-worklet.js', { sampleRate: sr });
  return { proc: new reg.ocean({ processorOptions: { seed } }), posted };
}
export function loadWasm(seed = SEED, sr = SR) {         // обёртка ocean-worklet.js над ocean.wasm; ready — когда пришло {t:'ready'}
  const { reg, posted } = sandbox('../ocean-worklet.js', { sampleRate: sr });
  const bytes = readFileSync(WASM);
  const proc = new reg.ocean({ processorOptions: { wasm: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), seed } });
  const ready = new Promise((res, rej) => {
    const post = proc.port.postMessage;
    proc.port.postMessage = (m) => { post(m); if (m.t === 'ready') res(); else if (m.t === 'err') rej(new Error(m.msg)); };
  });
  return { proc, posted, ready };
}
export function loadOld(i = 0, sr = SR) {                // прежний код: ветер и шторм — на независимом xorshift32 от номера прогона (начальные фазы голосов — из зерна 1 конструктора, одни и те же)
  const r = loadRef(1, sr);
  let s = (0x9E3779B9 ^ (i + 1)) >>> 0 || 1;
  r.proc.rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  return r;
}

export function play(proc, steps, posted, block = BLOCK) {   // L, R и метры {x, moon, g} (сообщения 'shape', массивы скопированы)
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
  const ps = posted ? posted.slice(from).filter((m) => m.t === 'shape') : [];
  return { L: cat(L), R: cat(R), meters: ps.map(({ x, moon, g }) => ({ x: [...x], moon, g: [...g] })) };
}

// ---------- SDK: сценарии действиями (мир VIII в t2d.wasm) ----------
// Шаг — действие модели (['add', ang, rn, pinned], ['drop', id], ['move', id, ang, rn], ['set', id, {lvl, oct, path}], ['fx', key, v],
// ['luna', key, v], ['push', id, a, d], ['release', id], ['splash', a, amt], ['clear'], ['dice'], ['restore', js], ['scale', on, idx, root])
// или { run: блоков }. id города — порядковый номер его появления (1, 2, … — и в эталоне, и в ядре; кубик и restore тоже считаются).
// Эталонный путь: JS-модель (tools/ref/oceanus-model.js) → сообщения, как прежний engine.js (sendVoice: hz, lvl·0.8, path; sendParams;
// push k 0.06, release, splash) → tools/ref/ocean-worklet.js, сухой ×1.6. Путь ядра: те же действия → t2d.wasm, сухой выход слота 8.
// Метры: эталон шлёт 'shape' раз в round(sr/30) сэмплов (по счёту блоков) — зеркало ядра берём по тому же расписанию.
import { createModel as jsModel } from './ref/oceanus-model.js';
import { scl, snapSemi } from '../host/scale.js';
import { seeded } from './models/util.mjs';
import { loadT2d } from './t2d-core.mjs';
import { SLOT, ACT, SET_KEYS, FX_KEYS, LUNA_KEYS, HEAD, MVOICE } from '../worlds/oceanus/model.js';

export const soundSeed = (seed) => (seed ^ 0x85EBCA6B) >>> 0;   // зерно звука мира — от зерна мира (core/worlds/oceanus/world.hpp)
export const OUT = 1.6;
const EVERY = Math.round(SR / 30);
const T = Math.PI * 2;
export const hostScale = (sc) => ({                     // лад хоста {on, idx, root} для JS-модели: snapSemi из host/scale.js
  get on() { return sc.on; }, get root() { return sc.root; },
  snap(s) { const keep = { ...scl }; Object.assign(scl, sc); const r = snapSemi(s); Object.assign(scl, keep); return r; },
});

const SNAP = '{"v":[{"ang":0.6,"rn":0.84,"lvl":0.7,"oct":-1,"path":2},{"ang":3.2,"rn":0.18,"lvl":0.9,"oct":0,"path":1}],"fx":{"tension":0.7,"damping":0.2,"wind":0.3,"tide":0.8,"hall":0.6},"luna":{"orbit":0.8,"storm":1,"sway":0.5,"to":1}}';
export const ACTS = {
  one: [['add', 1.0, 0.85, true], { run: 750 }],
  six: [...[0, 1, 2, 3, 4, 5].map((k) => ['add', k * 1.1, [0.9, 0.5, 0.2][k % 3], k % 2 === 0]), ['set', 2, { path: 1 }], ['set', 4, { path: 2, oct: 1 }], { run: 375 }],
  drag: [['add', 0.2, 0.85, false], { run: 40 }, ...Array.from({ length: 40 }, (_, k) => [['move', 1, 0.2 + k * 0.05, 0.85 - k * 0.018], { run: 4 }]).flat(), { run: 100 }],
  fingers: [['add', 2, 0.5, true], ['push', 11, 0.25, 1.2], { run: 200 }, ['push', 12, 0.7, -1], { run: 200 }, ['push', 11, 0.3, 0.6], { run: 200 }, ['release', 11], { run: 200 },
    ['splash', 0.3, 0.35], { run: 250 }, ['splash', 0.8, -0.35], ['release', 12], { run: 250 }],
  fx: [['add', 0.5, 0.85, true], ['add', 3, 0.5, true], { run: 200 }, ['fx', 'tension', 0.9], ['fx', 'damping', 0.1], { run: 300 }, ['fx', 'wind', 0.7], { run: 300 },
    ['fx', 'tide', 0.95], ['luna', 'orbit', 0.9], { run: 300 }, ['luna', 'storm', 1], ['luna', 'sway', 0.6], { run: 300 }, ['luna', 'to', 1], { run: 300 }, ['luna', 'to', 2], { run: 300 },
    ['fx', 'hall', 0.9], { run: 100 }],
  relight: [['add', 1, 0.85, true], { run: 200 }, ['drop', 1], { run: 30 }, ['add', 2, 0.5, false], { run: 200 }, ['drop', 2], { run: 2000 }, ['add', 4, 0.2, true], { run: 200 }],
  levels: [['add', 1, 0.85, true], { run: 100 }, ['set', 1, { lvl: 0.3 }], { run: 200 }, ['set', 1, { oct: -1 }], { run: 200 }, ['set', 1, { oct: 1, path: 2, lvl: 1 }], { run: 200 }],
  scale: [['scale', true, 1, 3], ['add', 0.7, 0.85, true], ['add', 2.4, 0.5, true], { run: 100 },
    ...Array.from({ length: 30 }, (_, k) => [['move', 1, 0.7 + k * 0.07, 0.85], { run: 4 }]).flat(),
    ['scale', true, 0, 5], ['move', 2, 2.5, 0.5], { run: 200 }, ['scale', false, 0, 0], ['move', 2, 2.6, 0.5], { run: 200 }],
  restore: [['add', 1, 0.85, false], { run: 100 }, ['restore', SNAP], { run: 750 }, ['clear'], { run: 300 }],
  dice: [['dice'], { run: 600 }, ['dice'], { run: 600 }, ['add', 5, 0.5, false], { run: 200 }],
  all: [['dice'], ['luna', 'storm', 1], ['fx', 'wind', 0.4], ['luna', 'sway', 0.5], ['luna', 'to', 1], { run: 1500 },
    ['add', 0.3, 0.84, true], ['push', 1, 0.2, 1], ['splash', 0.4, 0.3], { run: 1500 },
    ...Array.from({ length: 20 }, (_, k) => [['move', 4, 0.3 + k * 0.2, 0.84 - k * 0.03], { run: 3 }]).flat(), ['release', 1], { run: 3000 },
    ['dice'], ['set', 7, { path: 1, lvl: 0.5 }], { run: 3000 }, ['drop', 8], ['fx', 'hall', 0.9], { run: 2190 }],   // 30 с
};

const cat = (bs) => { const o = new Float32Array(bs.length * BLOCK); bs.forEach((b, k) => o.set(b, k * BLOCK)); return o; };

export function refPath(steps, { seed = SEED } = {}) {   // эталон: JS-модель → сообщения как engine.js → ocean-worklet.js эталона
  const { proc, posted } = loadRef(soundSeed(seed));
  const sc = { on: false, idx: 0, root: 0 };
  const model = jsModel({ rng: seeded(seed), scale: hostScale(sc) });
  const { fx, luna } = model.state;
  const send = (m) => proc.port.onmessage({ data: m });
  const sendParams = () => send({ t: 'params', kt: 0.004 * 60 ** fx.tension, damp: 0.00003 * 300 ** fx.damping, kc: 0.0015 + 0.004 * fx.tide, wind: fx.wind * fx.wind, tide: fx.tide * 0.9, moonRate: 0.005 * 40 ** luna.orbit, storm: luna.storm, sway: luna.sway, swayTo: luna.to });
  const ids = new Map();                                // город → id (порядок появления)
  let serial = 0;
  model.listen((e) => {
    if (e.t === 'voice') { if (e.added) ids.set(e.v, ++serial); send({ t: 'voice', i: e.v.slot, on: e.on, f: model.hz(e.v), lvl: e.v.lvl * 0.8, path: e.v.path || 0 }); }
    else if (e.t === 'fx') sendParams();
    else if (e.t === 'push') send({ t: 'push', id: e.id, a: e.a, d: e.d, k: 0.06 });
    else if (e.t === 'release') send({ t: 'push', id: e.id, off: true });
    else if (e.t === 'splash') send({ t: 'splash', a: e.a, amt: e.amt });
  });
  sendParams();                                         // build: параметры — до первого города
  const byId = (id) => model.state.voices.find((v) => ids.get(v) === id);
  const L = [], R = [], meters = [];
  let seen = 0;
  for (const s of steps) {
    if (s.run) {
      for (let b = 0; b < s.run; b++) {
        const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
        proc.process([], [[l, r]], {});
        L.push(l.map((x) => x * OUT)); R.push(r.map((x) => x * OUT));
        for (; seen < posted.length; seen++) {
          const d = posted[seen];
          if (d.t !== 'shape') continue;
          meters.push({ at: L.length, x: [...d.x], moon: d.moon, g: model.state.voices.map((v) => [ids.get(v), d.g[v.slot]]) });
        }
      }
      continue;
    }
    const [a, x, y, z] = s;
    if (a === 'add') model.addVoice(x, y, z);
    else if (a === 'drop') { const v = byId(x); if (v) model.dropVoice(v); }
    else if (a === 'move') { const v = byId(x); if (v) model.moveVoice(v, y, z); }
    else if (a === 'set') { const v = byId(x); if (v) model.setVoice(v, y); }
    else if (a === 'fx') model.setFx(x, y);
    else if (a === 'luna') model.setLuna({ [x]: y });
    else if (a === 'push') model.push(x, y, z);
    else if (a === 'release') model.release(x);
    else if (a === 'splash') model.splash(x, y);
    else if (a === 'clear') model.clear();
    else if (a === 'dice') model.dice();
    else if (a === 'restore') model.restore(x);
    else if (a === 'scale') Object.assign(sc, { on: x, idx: y, root: z });
  }
  return { L: cat(L), R: cat(R), meters, snapshot: model.snapshot() };
}

export function corePath(steps, { seed = SEED } = {}) { // ядро: те же действия → t2d.wasm, сухой выход мира VIII
  const c = loadT2d();
  c.init(SR, seed);
  const L = [], R = [], meters = [];
  let count = 0;
  for (const s of steps) {
    if (s.run) {
      for (let b = 0; b < s.run; b++) {
        c.process(BLOCK);
        L.push(Float32Array.from(c.dry(SLOT, 0))); R.push(Float32Array.from(c.dry(SLOT, 1)));
        if ((count += BLOCK) < EVERY) continue;
        count = 0;
        const m = c.mirror(SLOT), nf = FX_KEYS.length + LUNA_KEYS.length, NV = MVOICE.length;
        const g = Array.from({ length: m[HEAD - 1] }, (_, i) => [m[HEAD + i * NV + 1], m[HEAD + i * NV + 9]]);
        meters.push({ at: L.length, x: m.slice(nf + 1, nf + 1 + N), moon: m[nf], g });
      }
      continue;
    }
    const [a, x, y, z] = s;
    if (a === 'add') c.action(SLOT, ACT.add, 0, [x, y, z ? 1 : 0]);
    else if (a === 'drop') c.action(SLOT, ACT.drop, x);
    else if (a === 'move') c.action(SLOT, ACT.move, x, [y, z]);
    else if (a === 'set') for (const [k, v] of Object.entries(y)) c.action(SLOT, ACT.set, x, [SET_KEYS.indexOf(k), v]);   // как фасад: по SET на ключ
    else if (a === 'fx') c.action(SLOT, ACT.fx, FX_KEYS.indexOf(x), [y]);
    else if (a === 'luna') c.action(SLOT, ACT.luna, LUNA_KEYS.indexOf(x), [y]);
    else if (a === 'push') c.action(SLOT, ACT.push, 0, [x, y, z]);
    else if (a === 'release') c.action(SLOT, ACT.release, 0, [x]);
    else if (a === 'splash') c.action(SLOT, ACT.splash, 0, [x, y]);
    else if (a === 'clear' || a === 'dice') c.action(SLOT, ACT[a]);
    else if (a === 'restore') c.restore(SLOT, x);
    else if (a === 'scale') c.scale(x, y, z);
  }
  return { L: cat(L), R: cat(R), meters, snapshot: c.snapshot(SLOT) };
}
