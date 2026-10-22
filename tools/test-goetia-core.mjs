// Сверка ядра Goetia (core/worlds/goetia, C++) с прежним JS-worklet (tools/ref/goetia-worklet.js) по сэмплам, допуск 1e-6.
//   core/build.sh && node --test tools/test-goetia-core.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, BLOCK, SR, WASM, toScript, loadRef, loadWasm, play } from './goetia-scenarios.mjs';

const EPS = 1e-6;
const CLI = fileURLToPath(new URL('../core/build/render-cli', import.meta.url));
const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
function same(a, b, what) {                             // каждый отсчёт — не дальше EPS; первое расхождение — в сообщении
  assert.equal(a.length, b.length, `${what}: length`);
  for (let k = 0; k < a.length; k++) if (!(Math.abs(a[k] - b[k]) <= EPS)) assert.fail(`${what}: sample ${k}: ${a[k]} vs ${b[k]}`);
}
const ref = (name) => { const { proc, posted } = loadRef(); return play(proc, SCENARIOS[name], posted); };

test('reference sounds', () => {
  const r = ref('drone');
  assert.ok(rms(r.L) > 0.01, `drone RMS ${rms(r.L)}`);
});

function cli(steps) {                                   // render-cli: блоки по 128 — L, затем R
  const p = spawnSync(CLI, { input: toScript(steps), maxBuffer: 1 << 28 });
  assert.equal(p.status, 0, String(p.stderr));
  const f = new Float32Array(p.stdout.buffer.slice(p.stdout.byteOffset, p.stdout.byteOffset + p.stdout.byteLength));
  const n = f.length / (2 * BLOCK), L = new Float32Array(n * BLOCK), R = new Float32Array(n * BLOCK);
  for (let b = 0; b < n; b++) { L.set(f.subarray(2 * b * BLOCK, (2 * b + 1) * BLOCK), b * BLOCK); R.set(f.subarray((2 * b + 1) * BLOCK, (2 * b + 2) * BLOCK), b * BLOCK); }
  return { L, R };
}
for (const name of Object.keys(SCENARIOS)) {
  test(`render-cli matches the JS worklet: ${name}`, (t) => {
    if (!existsSync(CLI)) return t.skip('core/build/render-cli is not built — core/build.sh');
    const r = ref(name), c = cli(SCENARIOS[name]);
    same(c.L, r.L, `${name} L`); same(c.R, r.R, `${name} R`);
  });
}

// ---------- WASM: goetia-worklet.js (обёртка) + goetia.wasm ----------

const sameMeters = (a, b, what) => {
  assert.equal(a.length, b.length, `${what}: meter count`);
  a.forEach((m, k) => { same(m.tt, b[k].tt, `${what} tt #${k}`); same(m.g, b[k].g, `${what} g #${k}`); });
};
async function wasm(steps) { const w = loadWasm(); await w.ready; return play(w.proc, steps, w.posted); }

for (const name of Object.keys(SCENARIOS)) {
  test(`wasm matches the JS worklet: ${name}`, async () => {
    const r = ref(name), w = await wasm(SCENARIOS[name]);
    same(w.L, r.L, `${name} L`); same(w.R, r.R, `${name} R`); sameMeters(w.meters, r.meters, name);
  });
}

test('wasm has no imports', () => {
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(readFileSync(WASM))), []);
});

test('messages before ready keep their order', async () => {
  const steps = SCENARIOS.ops, first = steps.findIndex((s) => s.run);
  const w = loadWasm();
  for (const s of steps.slice(0, first)) w.proc.port.onmessage({ data: s });   // ещё не готов — в очередь
  await w.ready;
  const got = play(w.proc, steps.slice(first), w.posted), r = ref('ops');
  same(got.L, r.L, 'ops L'); same(got.R, r.R, 'ops R');
});

test('a partial voice message keeps the other fields', async () => {
  const steps = [...SCENARIOS.drone, { t: 'voice', i: 0, rate: 9000 }, { run: 100 }];
  const { proc, posted } = loadRef(), r = play(proc, steps, posted), w = await wasm(steps);
  same(w.L, r.L, 'partial L'); same(w.R, r.R, 'partial R');
});

test('speed: 60 s, three spirits, legion 4', async () => {
  const blocks = Math.round((60 * SR) / BLOCK);
  const steps = [...SCENARIOS.three.filter((s) => !s.run).map((s) => (s.t === 'voice' ? { ...s, legio: 4 } : s)), { run: blocks }];
  const time = (proc) => { const t0 = performance.now(); play(proc, steps); return performance.now() - t0; };
  const js = time(loadRef().proc), w = loadWasm(); await w.ready;
  const ms = time(w.proc);
  console.log(`  speed, 60 s of sound: JS ${js.toFixed(0)} ms, WASM ${ms.toFixed(0)} ms (×${(js / ms).toFixed(2)})`);
});

test('blocks longer than 128 samples', async () => {
  const steps = SCENARIOS.three.map((s) => (s.run ? { run: 150 } : s));
  const { proc, posted } = loadRef(), r = play(proc, steps, posted, 256);
  const w = loadWasm(); await w.ready;
  const got = play(w.proc, steps, w.posted, 256);
  same(got.L, r.L, '256 L'); same(got.R, r.R, '256 R');
});

test('a voice index out of range is ignored', async () => {
  const bad = [{ t: 'voice', i: 3, on: true, prog: [['|', 8]], rate: 7040, lp: 0.3, lvl: 0.2, legio: 1, pan: 0, rel: 1, trig: 9 }, { t: 'sett', i: 3, t0: 5 }, { t: 'sett', i: -1, t0: 5 }];
  const steps = SCENARIOS.drone, w = loadWasm(); await w.ready;
  const got = play(w.proc, [...steps.slice(0, -1), ...bad, ...steps.slice(-1)], w.posted), r = ref('drone');
  same(got.L, r.L, 'drone L'); same(got.R, r.R, 'drone R');
});
