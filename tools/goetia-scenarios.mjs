// Сценарии сверки ядра Goetia: одни и те же сообщения порта — в эталонный JS-worklet (tools/ref), в обёртку над goetia.wasm
// и текстом в core/build/render-cli. Шаг — сообщение ({t:'voice'|'fx'|'sett', …}) или { run: блоков } (блок — 128 сэмплов).
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

function sandbox(file, extra = {}) {                    // worklet в vm с заглушками AudioWorklet
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

export function play(proc, steps, posted) {             // прогнать сценарий: L, R и метры {tt, g} (сообщения 'p')
  const L = [], R = [];
  const from = posted ? posted.length : 0;
  for (const s of steps) {
    if (!s.run) { proc.port.onmessage({ data: s }); continue; }
    for (let b = 0; b < s.run; b++) {
      const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
      proc.process([], [[l, r]], {});
      L.push(l); R.push(r);
    }
  }
  const cat = (bs) => { const o = new Float32Array(bs.length * BLOCK); bs.forEach((b, k) => o.set(b, k * BLOCK)); return o; };
  const meters = posted ? posted.slice(from).filter((m) => m.t === 'p').map(({ tt, g }) => ({ tt: [...tt], g: [...g] })) : [];
  return { L: cat(L), R: cat(R), meters };
}

export const WASM = new URL('../goetia.wasm', import.meta.url);
export function loadWasm() {                            // обёртка goetia-worklet.js над goetia.wasm; ready — когда пришло {t:'ready'}
  const { reg, posted } = sandbox('../goetia-worklet.js');
  const bytes = readFileSync(WASM);
  const proc = new reg.goetia({ processorOptions: { wasm: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } });
  const ready = new Promise((res, rej) => {
    const post = proc.port.postMessage;
    proc.port.postMessage = (m) => { post(m); if (m.t === 'ready') res(); else if (m.t === 'err') rej(new Error(m.msg)); };
  });
  return { proc, posted, ready };
}
