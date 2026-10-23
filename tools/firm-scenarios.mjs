// Сценарии сверки ядра Firmamentum: одни и те же сообщения порта — в эталонный JS-worklet (tools/ref) и текстом в core/build/render-cli
// (звук мира SDK, sound.cpp). Шаг — сообщение ({t:'voice'|'fx', …}) или { run: блоков } (блок — 128 сэмплов).
// Ниже (SDK) — сценарии действиями модели для мира X в t2d.wasm.
import { sandbox } from './goetia-scenarios.mjs';
import { createModel as jsModel } from './ref/firmamentum-model.js';
import { scl, snapSemi } from '../host/scale.js';
import { seeded } from './models/util.mjs';
import { loadT2d } from './t2d-core.mjs';
import { sky, ACT, SET_KEYS, FX_KEYS, SLOT } from './models/firmamentum-core.mjs';

export const SR = 48000, BLOCK = 128, SEED = 12345;
const FX = { t: 'fx', jit: 0, spread: 0.6, crep: 0, fulg: 0 };
const star = (i, o) => ({ t: 'voice', i, on: true, fp: 4, ff: 600, cyc: 2, win: 0, mask: 0, lvl: 0.44, pan: 0, ...o });
const SIX = [FX, ...[[-1, 3, 400], [-0.6, 55, 900], [-0.2, 110, 1500], [0.2, 7, 700], [0.6, 80, 2200], [1, 220, 3000]]
  .map(([pan, fp, ff], i) => star(i, { pan, fp, ff, win: (i % 3) / 2 })), { t: 'fx', jit: 0, spread: 1, crep: 0, fulg: 0 }];

export const SCENARIOS = {
  rhythm: [FX, star(0, { fp: 2, ff: 750 }), { run: 375 * 2 }],
  tone: [FX, star(0, { fp: 110, ff: 1200 }), { run: 375 }],
  windows: [FX, star(0, { fp: 30, win: 0 }), star(1, { fp: 45, win: 0.5 }), star(2, { fp: 60, win: 1 }), { run: 375 }],
  mask: [FX, star(0, { fp: 40, mask: 0.5 }), { run: 375 }],
  scintilla: [{ ...FX, jit: 0.6 }, star(0, { fp: 60 }), { run: 375 }],
  drag: [FX, star(0, { fp: 50 }), { run: 100 }, { t: 'voice', i: 0, fp: 200 }, { run: 200 }, { t: 'voice', i: 0, ff: 3000 }, { run: 200 }],
  dragEarly: [FX, star(0, { fp: 50 }), { t: 'voice', i: 0, fp: 80 }, { run: 300 }],
  relight: [FX, star(0, {}), { run: 200 }, { t: 'voice', i: 0, on: false }, { run: 30 }, { t: 'voice', i: 0, on: true, fp: 90 }, { run: 200 },
    { t: 'voice', i: 0, on: false }, { run: 3000 }, { t: 'voice', i: 0, on: true }, { run: 200 }],
  six: [...SIX, { run: 375 }],
  crepitus: [FX, star(0, {}), { t: 'fx', jit: 0, spread: 0.6, crep: 0.3, fulg: 0 }, { run: 750 }, { t: 'fx', jit: 0, spread: 0.6, crep: 1, fulg: 0 }, { run: 750 }],
  fulgur: [FX, star(0, { fp: 8 }), { t: 'fx', jit: 0, spread: 0.6, crep: 0, fulg: 1 }, { run: 1500 }],
  all: [...SIX, { t: 'fx', jit: 0.3, spread: 1, crep: 0.6, fulg: 0.7 }, { t: 'voice', i: 1, mask: 0.2 }, { t: 'voice', i: 4, mask: 0.2 }, { run: 11250 }],
};

const num = (x) => Number(x).toPrecision(17);
const VK = ['fp', 'ff', 'cyc', 'win', 'mask', 'lvl', 'pan'];
export function toScript(steps, sr = SR, seed = SEED) {  // текст для render-cli: init, voice, fx, run; поля держим слитыми
  const out = ['world firmamentum', `init ${sr} ${seed}`];
  const vo = Array.from({ length: 6 }, () => ({ fp: 4, ff: 600, cyc: 2, win: 0, mask: 0, lvl: 0.8, pan: 0 }));
  const fx = { jit: 0, spread: 0.6, crep: 0, fulg: 0 };
  for (const s of steps) {
    if (s.run) out.push(`run ${s.run}`);
    else if (s.t === 'fx') {
      for (const k of Object.keys(fx)) if (s[k] != null) fx[k] = s[k];
      out.push(`fx ${Object.values(fx).map(num).join(' ')}`);
    } else if (s.t === 'voice') {
      const o = vo[s.i];
      for (const k of VK) if (s[k] != null) o[k] = s[k];
      const on = s.on == null ? -1 : s.on ? 1 : 0;
      out.push(`voice ${s.i} ${on} ${VK.map((k) => num(o[k])).join(' ')}`);
    }
  }
  return out.join('\n') + '\n';
}

export function loadRef(seed = SEED, sr = SR) {          // эталон с зерном
  const { reg, posted } = sandbox('./ref/pulsar-worklet.js', { sampleRate: sr });
  return { proc: new reg.pulsar({ processorOptions: { seed } }), posted };
}
export function loadOld(i = 0, sr = SR) {                // прежний код с независимым источником случайности (xorshift32 от номера прогона — не mulberry32 эталона)
  const r = loadRef(1, sr);
  let s = (0x9E3779B9 ^ (i + 1)) >>> 0 || 1;
  r.proc.rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  return r;
}

export function play(proc, steps, posted, block = BLOCK) {   // L, R, метры {c, g} и события {k, f} (сообщения 'p')
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
  const ps = posted ? posted.slice(from).filter((m) => m.t === 'p') : [];
  return {
    L: cat(L), R: cat(R),
    meters: ps.map(({ c, g }) => ({ c: [...c], g: [...g] })),
    events: ps.map(({ k, f }) => ({ k: k.map((p) => [...p]), f: [...f] })),
  };
}

// ---------- SDK: сценарии действиями (мир X в t2d.wasm) ----------
// Шаг — действие модели (['add', h, u], ['set', id, {…}], ['move', id, h, u], ['close', id], ['fx', key, v], ['clear'], ['dice'],
// ['launch'], ['scale', on, idx, root]) или { run: блоков }. Эталонный путь: JS-модель (worlds/firmamentum/model.js, тот же place, что
// у ядра) → события в сообщения, как engine.js (sendStar: lvl·0.55, pan = u·0.8; fp / ff — частично; fx → jit, spread, crep, fulg) →
// tools/ref/pulsar-worklet.js. Путь ядра: те же действия → t2d.wasm, сухой выход слота 10. Модель шагает после блока звука (как в process
// мира); услышанное эталона — его сообщения 'p' (раз в round(sr/30) сэмплов), ядро спрашиваем по тому же расписанию.

export const soundSeed = (seed) => (seed ^ 0x9E3779B9) >>> 0;   // зерно звука мира — от зерна мира (core/worlds/firmamentum/world.cpp)
const EVERY = Math.round(SR / 30);                     // как count / every эталона

const L1 = 0.5355;                                      // чуть выше limen (0.5287): уже тон
const SIX6 = [[0.1, -0.9], [0.62, -0.5], [0.75, -0.15], [0.3, 0.2], [0.68, 0.55], [0.9, 0.85]];
export const ACTS = {
  rhythm: [['add', 0.15, 0.1], { run: 750 }],
  tone: [['add', 0.85, 0.3], { run: 375 }],
  six: [...SIX6.flatMap(([h, u], i) => [['add', h, u], ['set', i + 1, { win: (i % 3) / 2, cyc: 1 + i, mask: i === 3 ? 0.4 : 0 }]]),
    ['add', 0.5, 0], ['fx', 'spread', 1], { run: 375 }],
  drag: [['add', 0.3, -0.4], { run: 50 },
    ...Array.from({ length: 40 }, (_, k) => [['move', 1, 0.3 + k * 0.015, -0.4 + k * 0.02], { run: 5 }]).flat(), { run: 100 }],
  relight: [['add', 0.6, 0], { run: 200 }, ['close', 1], { run: 30 }, ['add', 0.7, 0.2], { run: 200 }, ['close', 2], { run: 3000 },
    ['add', 0.65, -0.3], { run: 200 }],
  fx: [['add', 0.2, -0.3], ['add', L1 + 0.2, 0.5], ['fx', 'scintilla', 0.6], { run: 375 }, ['fx', 'crepitus', 0.5], { run: 750 },
    ['fx', 'fulgur', 1], { run: 1500 }, ['fx', 'spread', 0], { run: 200 }, ['fx', 'spread', 1], ['fx', 'crepitus', 0], ['fx', 'fulgur', 0], { run: 400 }],
  drift: [['fx', 'drift', 1], ['add', 0.7, -0.6], ['add', 0.8, 0], ['add', 0.25, 0.6], { run: 1500 }],
  comet: [['fx', 'cometa', 1], ['fx', 'drift', 0], ['add', 0.55, -0.4], ['add', 0.35, 0.1], ['add', 0.2, 0.6], ['add', 0.7, -0.8], ['launch'], { run: 7500 }],
  scale: [['scale', true, 1, 3], ['add', 0.8, 0.2], ['add', 0.65, -0.5], { run: 100 },
    ...Array.from({ length: 30 }, (_, k) => [['move', 1, 0.8 - k * 0.006, 0.2], { run: 4 }]).flat(),
    ['scale', true, 0, 5], ['move', 2, 0.66, -0.5], { run: 200 }, ['scale', false, 0, 0], ['move', 2, 0.67, -0.5], { run: 200 }],
  all: [['dice'], ['fx', 'scintilla', 0.3], ['fx', 'crepitus', 0.6], ['fx', 'fulgur', 0.7], ['fx', 'spread', 1], ['fx', 'drift', 0.6],
    ['fx', 'cometa', 0.8], ['launch'], { run: 1500 }, ['add', 0.62, 0.4], ['set', 5, { mask: 0.2, lvl: 0.6 }], { run: 1500 },
    ...Array.from({ length: 20 }, (_, k) => [['move', 2, 0.6 + k * 0.01, -0.5 + k * 0.03], { run: 3 }]).flat(), { run: 3000 },
    ['dice'], ['set', 7, { win: 0.9, cyc: 7 }], { run: 3000 }, ['close', 8], ['fx', 'hall', 0.9], { run: 2190 }],   // 30 с
};

const sclOf = (sc) => ({                                // лад хоста для JS-модели: snapSemi из host/scale.js (общее scl — на время вызова)
  get on() { return sc.on; },
  snap(s) { const keep = { ...scl }; Object.assign(scl, sc); const r = snapSemi(s); Object.assign(scl, keep); return r; },
});

export function refPath(steps, { seed = SEED } = {}) {   // эталон: JS-модель → сообщения как engine.js → pulsar-worklet.js эталона
  const { proc, posted } = loadRef(soundSeed(seed));
  const sc = { on: false, idx: 0, root: 0 };
  const model = jsModel({ rng: seeded(seed), place: sky, scale: sclOf(sc) });
  const { stars, fx } = model.state;
  const send = (m) => proc.port.onmessage({ data: m });
  const applyFx = () => send({ t: 'fx', jit: fx.scintilla, spread: fx.spread, crep: fx.crepitus, fulg: fx.fulgur });
  const sendStar = (s, on = true) => send({ t: 'voice', i: s.slot, on, fp: model.fp(s), ff: model.ff(s), cyc: s.cyc, win: s.win, mask: s.mask, lvl: s.lvl * 0.55, pan: s.u * 0.8 });
  model.listen((e) => {
    if (e.t === 'star') sendStar(e.s, e.on);
    else if (e.t === 'fp') send({ t: 'voice', i: e.s.slot, fp: model.fp(e.s) });
    else if (e.t === 'ff') send({ t: 'voice', i: e.s.slot, ff: model.ff(e.s) });
    else if (e.t === 'fx') applyFx();
  });
  applyFx();                                            // build: fx — до первой звезды
  const byId = (id) => stars.find((s) => s.id === id);
  const L = [], R = [], heard = [];
  let counts = new Array(6).fill(0), seen = 0;
  for (const s of steps) {
    if (s.run) {
      for (let b = 0; b < s.run; b++) {
        const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
        proc.process([], [[l, r]], {});
        L.push(l); R.push(r);
        model.tick(BLOCK / SR);
        for (; seen < posted.length; seen++) {         // как engine.js: пульсарет прозвучал — звезда в pulsed
          const d = posted[seen];
          if (d.t !== 'p') continue;
          const pulsed = stars.filter((q) => d.c[q.slot] !== counts[q.slot]).map((q) => q.slot);
          counts = d.c;
          heard.push({ at: L.length, pulsed, dust: d.k.map((p) => [...p]), bolts: [...d.f] });
        }
      }
      continue;
    }
    const [a, x, y, z] = s;
    if (a === 'add') model.addStar(x, y);
    else if (a === 'set') { const q = byId(x); if (q) model.setStar(q, y); }
    else if (a === 'move') { const q = byId(x); if (q) model.moveStar(q, y, z); }
    else if (a === 'close') { const q = byId(x); if (q) model.closeStar(q); }
    else if (a === 'fx') model.setFx(x, y);
    else if (a === 'clear') model.clear();
    else if (a === 'dice') model.dice();
    else if (a === 'launch') model.launch();
    else if (a === 'scale') Object.assign(sc, { on: x, idx: y, root: z });
  }
  return { L: cat(L), R: cat(R), heard, comets: model.state.comets };
}

export function corePath(steps, { seed = SEED } = {}) { // ядро: те же действия → t2d.wasm, сухой выход мира X
  const c = loadT2d();
  c.init(SR, seed);
  const L = [], R = [], heard = [];
  let count = 0;
  for (const s of steps) {
    if (s.run) {
      for (let b = 0; b < s.run; b++) {
        c.process(BLOCK);
        L.push(Float32Array.from(c.dry(SLOT, 0))); R.push(Float32Array.from(c.dry(SLOT, 1)));
        if ((count += BLOCK) < EVERY) continue;
        count = 0;
        const h = c.heard(SLOT);                        // [np, slot…, nd, (pan, a)…, nb, slot…]
        let p = 0;
        const np = h[p++], pulsed = h.slice(p, (p += np)), nd = h[p++], dust = [];
        for (let k = 0; k < nd; k++, p += 2) dust.push([h[p], h[p + 1]]);
        const nb = h[p++], bolts = h.slice(p, p + nb);
        heard.push({ at: L.length, pulsed, dust, bolts });
      }
      continue;
    }
    const [a, x, y, z] = s;
    if (a === 'add') c.action(SLOT, ACT.add, 0, [x, y]);
    else if (a === 'set') for (const [k, v] of Object.entries(y)) c.action(SLOT, ACT.set, x, [SET_KEYS.indexOf(k), v]);   // как фасад: по SET на ключ
    else if (a === 'move') c.action(SLOT, ACT.move, x, [y, z]);
    else if (a === 'close') c.action(SLOT, ACT.close, x);
    else if (a === 'fx') c.action(SLOT, ACT.fx, FX_KEYS.indexOf(x), [y]);
    else if (a === 'clear' || a === 'dice' || a === 'launch') c.action(SLOT, ACT[a]);
    else if (a === 'scale') c.scale(x, y, z);
  }
  return { L: cat(L), R: cat(R), heard, comets: c.mirror(SLOT)[1] };
}
const cat = (bs) => { const o = new Float32Array(bs.length * BLOCK); bs.forEach((b, k) => o.set(b, k * BLOCK)); return o; };
