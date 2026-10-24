// Сценарии сверки ядра Cymatica: одни и те же сообщения (формат прежнего worklet: params, f0, strike, seq, lock, bow) — в эталонный
// JS-worklet (tools/ref/plate-worklet.js, ГСЧ с зерном), текстом в core/build/render-cli (мир SDK через action) и в t2d.wasm (слот 2).
// Шаг — сообщение или { run: блоков } (блок — 128 сэмплов). Время ядра — сэмплы от старта: `lock.t0` — в секундах от старта.
import { sandbox } from './goetia-scenarios.mjs';
import { ACT, SLOT, toAction, parseHeard } from '../worlds/cymatica/bridge.js';
import { loadT2d } from './t2d-core.mjs';

export const SR = 48000, BLOCK = 128, SEED = 12345;
export { SLOT };

// узор в формате seqMessage: r — шаги ритма (индекс → {vel, chance}), m — шаги мелодии (индекс → {s, x, y})
const SL = 16;
export function pat({ bpm = 120, playing = true, chance = 1, rlen = 8, mlen = 5, r = {}, m = {} } = {}) {
  const rs = Array.from({ length: SL }, (_, i) => (r[i] ? { vel: r[i].vel ?? 1, chance: r[i].chance ?? 1 } : null));
  const ms = Array.from({ length: SL }, (_, i) => (m[i] ? { s: m[i].s, x: m[i].x, y: m[i].y } : null));
  return { t: 'seq', bpm, playing, chance, rhythm: { len: rlen, steps: rs }, melody: { len: mlen, steps: ms } };
}
const hit = (x = 1, chance) => ({ vel: x, chance });
const R8 = { 0: hit(), 2: hit(0.8), 3: hit(), 5: hit(0.6), 7: hit() };                     // евклидов ритм 5 из 8
const M5 = { 0: { s: 12, x: 0.3, y: 0.1 }, 1: { s: 19, x: -0.5, y: 0.4 }, 2: { s: 7, x: 0.1, y: -0.8 }, 3: { s: 24, x: 0.7, y: 0.2 }, 4: { s: 0, x: -0.2, y: -0.2 } };
const strike = (o) => ({ t: 'strike', x: 0.3, y: 0.1, hz: 220, vel: 1, hard: 0.5, ...o });

export const SCENARIOS = {
  strike: [strike({}), { run: 400 }],
  hard: [strike({ hard: 0 }), { run: 150 }, strike({ hard: 1, hz: 330 }), { run: 150 }, strike({ vel: 0.4, hz: 147 }), { run: 150 }],
  bodies: [0, 2 / 7, 4 / 7, 5 / 7, 1].flatMap((st, i) => [{ t: 'params', structure: st, damping: 0.5, brightness: 0.5 }, strike({ x: -0.4, y: 0.5, hz: 110 * (1 + i / 4) }), { run: 200 }]),
  damping: [{ t: 'params', structure: 0.66, damping: 0.1, brightness: 0.2 }, strike({}), { run: 150 },
    { t: 'params', structure: 0.66, damping: 0.95, brightness: 0.9 }, strike({ hz: 165 }), { run: 400 }, { t: 'params', structure: 0.3, damping: 0.5, brightness: 0.5 }, { run: 200 }],
  voices: [220, 330, 440, 110, 165, 220.5, 330, 247].flatMap((hz, i) => [strike({ hz, x: 0.15 * i - 0.5, y: 0.3 }), { run: 8 }]).concat([{ run: 600 }]),
  pitch: [{ t: 'f0', hz: 440 }, strike({ hz: undefined }), { run: 100 }, { t: 'f0', hz: 30 }, strike({ hz: undefined, y: -0.3 }), { run: 100 }, { t: 'f0', hz: 2000 }, strike({ hz: 0 }), { run: 100 }],
  edge: [strike({ x: 0.97, y: 0.1, hz: 55 }), strike({ x: 0.95, y: -0.2, hz: 55 }), strike({ x: -0.9, y: 0.3, hz: 58 }), strike({ x: 0.9, y: 0.4, hz: 55 }), { run: 200 }],
  outside: [strike({ x: 1.4, y: 0.2 }), { run: 50 }, strike({ x: 0, y: 0 }), { run: 150 }],
  seq: [pat({ r: R8, m: M5 }), { run: 1500 }],
  poly: [pat({ rlen: 8, mlen: 5, r: R8, m: M5 }), { run: 3000 }, pat({ rlen: 11, mlen: 4, r: { 0: hit(), 3: hit(), 4: hit(0.7), 8: hit() }, m: M5 }), { run: 3000 }],
  chance: [pat({ chance: 0.6, r: { 0: hit(1, 0.5), 1: hit(1, 0.9), 2: hit(0.8), 3: hit(1, 0.3), 4: hit(), 5: hit(0.6, 0.7), 6: hit(), 7: hit() }, m: M5 }), { run: 4000 }],
  tempo: [pat({ bpm: 90, r: R8, m: M5 }), { run: 400 }, pat({ bpm: 140, r: R8, m: M5 }), { run: 400 }, pat({ bpm: 60, r: R8, m: M5 }), { run: 600 },
    pat({ bpm: 60, playing: false, r: R8, m: M5 }), { run: 300 }, pat({ bpm: 100, r: R8, m: M5 }), { run: 600 }],
  edit: [pat({ r: R8, m: M5 }), { run: 300 }, pat({ r: { ...R8, 1: hit() }, m: { ...M5, 2: { s: 14, x: 0.1, y: -0.8 }, 3: null } }), { run: 300 },
    pat({ rlen: 6, mlen: 3, r: R8, m: M5 }), { run: 600 }],
  rec: [pat({ r: R8, m: M5 }), { run: 120 }, strike({ rec: true, x: -0.3, y: 0.3 }), { run: 8 }, strike({ rec: true, hz: 330 }), { run: 300 }],
  lock: [{ t: 'lock', t0: 0.013, p: 0.5 }, pat({ r: R8, m: M5 }), { run: 1200 }, { t: 'lock', t0: 0.9, p: 0.4 }, { run: 800 },
    { t: 'lock', t0: 0.9, p: 0.45 }, { run: 400 }, { t: 'lock', off: true }, { run: 600 }, { t: 'lock', t0: 7.3, p: 0.5 }, { run: 400 }],
  lockStart: [{ t: 'lock', t0: 0.1, p: 0.5 }, { run: 37 }, pat({ r: R8, m: M5 }), { run: 600 }, pat({ playing: false, r: R8, m: M5 }), { run: 200 },
    { run: 41 }, pat({ r: R8, m: M5 }), { run: 600 }],
  bows: [{ t: 'bow', id: 1, on: true, x: 0.2, y: 0.3, exciter: 0, pressure: 0.5, amp: 0.8 }, { run: 400 },
    { t: 'bow', id: 1, on: true, x: -0.3, y: 0.1 }, { t: 'bow', id: 2, on: true, x: 0.5, y: -0.4, exciter: 0.6, pressure: 0.7, amp: 1 }, { run: 400 },
    { t: 'f0', hz: 165 }, { run: 200 }, { t: 'bow', id: 1, on: false }, { run: 200 }, { t: 'bow', id: 2, on: false }, { run: 800 }],
  all: [{ t: 'params', structure: 0.5, damping: 0.6, brightness: 0.4 }, { t: 'f0', hz: 147 }, pat({ chance: 0.8, r: R8, m: M5 }), { run: 500 }, strike({ rec: true }),
    { t: 'bow', id: 'x', on: true, x: 0.1, y: 0.1, exciter: 0.3 }, { run: 1000 }, { t: 'lock', t0: 0.37, p: 0.48 }, pat({ bpm: 125, chance: 0.8, rlen: 11, mlen: 7, r: R8, m: M5 }), { run: 1500 }],
};

// ---------- эталон ----------
export function loadRef(seed = SEED, sr = SR) {
  const { reg, posted, ctx } = sandbox('./ref/plate-worklet.js', { sampleRate: sr, currentTime: 0 });
  return { proc: new reg.plate({ processorOptions: { seed } }), posted, ctx };
}
// прогон: сообщения — между блоками, время контекста — начало следующего блока
export function playRef(steps, seed = SEED) {
  const { proc, posted, ctx } = loadRef(seed);
  const L = [], R = [];
  let frame = 0;
  for (const s of steps) {
    ctx.currentTime = frame / SR;
    if (!s.run) { proc.port.onmessage({ data: s }); continue; }
    for (let b = 0; b < s.run; b++) {
      ctx.currentTime = frame / SR;
      const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
      proc.process([], [[l, r]], {});
      L.push(l); R.push(r); frame += BLOCK;
    }
  }
  return { ...cat(L, R), steps: posted.filter((m) => m.t === 'step').map(({ r, m, time, hit }) => ({ t: 'step', r, m, time, hit })) };
}
function cat(L, R) {
  const f = (bs) => { const o = new Float32Array(bs.length * BLOCK); bs.forEach((b, k) => o.set(b, k * BLOCK)); return o; };
  return { L: f(L), R: f(R) };
}

// ---------- render-cli: текст команд ----------
const num = (x) => (Number.isNaN(x) ? 'nan' : Number(x).toPrecision(17));
export function bowIds() { const m = new Map(); return (id) => { if (!m.has(id)) m.set(id, m.size + 1); return m.get(id); }; }
export function toScript(steps, sr = SR, seed = SEED) {
  const out = ['world cymatica', `init ${sr} ${seed}`], idOf = bowIds();
  for (const s of steps) {
    if (s.run) { out.push(`run ${s.run}`); continue; }
    const a = toAction(s, idOf);
    if (a) out.push(`act ${a.kind} ${a.i} ${a.a.length} ${a.a.map(num).join(' ')}`);
  }
  return out.join('\n') + '\n';
}

// ---------- t2d.wasm: слот 2 ----------
export function playCore(steps, seed = SEED) {
  const c = loadT2d();
  c.init(SR, seed);
  const idOf = bowIds(), L = [], R = [], heard = [];
  for (const s of steps) {
    if (!s.run) { const a = toAction(s, idOf); if (a) c.action(SLOT, a.kind, a.i, a.a); continue; }
    for (let b = 0; b < s.run; b++) {
      c.process(BLOCK);
      L.push(Float32Array.from(c.dry(SLOT, 0))); R.push(Float32Array.from(c.dry(SLOT, 1)));
      const h = c.heard(SLOT);
      if (h.length) heard.push(...parseHeard([h]));
    }
  }
  return { ...cat(L, R), steps: heard, core: c };
}
export { ACT };
