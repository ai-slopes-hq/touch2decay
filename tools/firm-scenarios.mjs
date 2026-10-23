// Сценарии сверки ядра Firmamentum: одни и те же сообщения порта — в эталонный JS-worklet (tools/ref), в обёртку над wasm
// и текстом в core/build/render-cli. Шаг — сообщение ({t:'voice'|'fx', …}) или { run: блоков } (блок — 128 сэмплов).
import { sandbox } from './goetia-scenarios.mjs';

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
export function loadOld(sr = SR) {                       // прежняя случайность (Math.random) в том же коде
  const r = loadRef(1, sr);
  r.proc.rnd = Math.random;
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
