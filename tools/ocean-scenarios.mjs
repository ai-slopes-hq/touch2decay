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
