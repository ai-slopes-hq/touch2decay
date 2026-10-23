// Тесты эталона Oceanus (tools/ref/ocean-worklet.js): звучит, детерминирован, по звуку — как прежний worklet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, SEED, BLOCK, toScript, loadRef, loadOld, loadWasm, play, SR, WASM } from './ocean-scenarios.mjs';

const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
const run = (load, name, steps = SCENARIOS[name]) => { const { proc, posted } = load(); return play(proc, steps, posted); };
const cut = (steps, max) => { const o = []; let n = 0; for (const s of steps) { if (!s.run) { o.push(s); continue; } if (n >= max) break; const r = Math.min(s.run, max - n); o.push({ run: r }); n += r; } return o; };

test('reference sounds', () => {
  assert.ok(rms(run(() => loadRef(), 'one').L) > 0.01);
});

test('reference is deterministic', () => {
  const steps = cut(SCENARIOS.all, 1000);
  const a = run(() => loadRef(SEED), 'all', steps), b = run(() => loadRef(SEED), 'all', steps), c = run(() => loadRef(SEED + 1), 'all', steps);
  assert.deepEqual(a.L, b.L); assert.deepEqual(a.R, b.R);
  assert.notDeepEqual(a.L, c.L);
});

// Ветер и шторм случайны: с обеих сторон — среднее по 8 прогонам (эталон — с разными зёрнами, прежний — на xorshift32 от номера прогона).
test('reference sounds like the old worklet', () => {
  const RUNS = 8;
  const mean = (load, name) => {
    let e = [0, 0];
    for (let i = 0; i < RUNS; i++) { const r = run(() => load(i), name); e[0] += rms(r.L) ** 2; e[1] += rms(r.R) ** 2; }
    return { L: Math.sqrt(e[0] / RUNS), R: Math.sqrt(e[1] / RUNS) };
  };
  const db = (x, y) => Math.abs(20 * Math.log10(x / y));
  for (const name of ['wind', 'sway']) {
    const r = mean((i) => loadRef(SEED + i), name), o = mean((i) => loadOld(i), name);
    assert.ok(db(r.L, o.L) <= 0.5, `${name} L: ${r.L} vs ${o.L}`);
    assert.ok(db(r.R, o.R) <= 0.5, `${name} R: ${r.R} vs ${o.R}`);
  }
});

// Ядро C++ (core/worlds/oceanus) против эталона по сэмплам, допуск 1e-6: core/build.sh
const EPS = 1e-6;
const CLI = fileURLToPath(new URL('../core/build/render-cli', import.meta.url));
function same(a, b, what) {                             // каждый отсчёт — не дальше EPS; первое расхождение — в сообщении
  assert.equal(a.length, b.length, `${what}: length`);
  for (let k = 0; k < a.length; k++) if (!(Math.abs(a[k] - b[k]) <= EPS)) assert.fail(`${what}: sample ${k}: ${a[k]} vs ${b[k]}`);
}
function cli(steps) {                                   // render-cli: блоки по 128 — L, затем R
  const p = spawnSync(CLI, { input: toScript(steps), maxBuffer: 1 << 28 });
  assert.equal(p.status, 0, String(p.stderr));
  const f = new Float32Array(p.stdout.buffer.slice(p.stdout.byteOffset, p.stdout.byteOffset + p.stdout.byteLength));
  const n = f.length / (2 * BLOCK), L = new Float32Array(n * BLOCK), R = new Float32Array(n * BLOCK);
  for (let b = 0; b < n; b++) { L.set(f.subarray(2 * b * BLOCK, (2 * b + 1) * BLOCK), b * BLOCK); R.set(f.subarray((2 * b + 1) * BLOCK, (2 * b + 2) * BLOCK), b * BLOCK); }
  return { L, R };
}
for (const name of Object.keys(SCENARIOS)) {
  test(`render-cli matches the reference: ${name}`, (t) => {
    if (!existsSync(CLI)) return t.skip('core/build/render-cli is not built — core/build.sh');
    const r = run(() => loadRef(), name), c = cli(SCENARIOS[name]);
    same(c.L, r.L, `${name} L`); same(c.R, r.R, `${name} R`);
  });
}

// ---------- WASM: ocean-worklet.js (обёртка) + ocean.wasm ----------

const sameMeters = (a, b, what) => {
  assert.equal(a.length, b.length, `${what}: meter count`);
  a.forEach((m, k) => { same(m.x, b[k].x, `${what} x #${k}`); same([m.moon], [b[k].moon], `${what} moon #${k}`); same(m.g, b[k].g, `${what} g #${k}`); });
};
async function wasm(steps, sr = SR, seed = SEED, block = BLOCK) { const w = loadWasm(seed, sr); await w.ready; return play(w.proc, steps, w.posted, block); }

for (const name of Object.keys(SCENARIOS)) {
  test(`wasm matches the reference: ${name}`, async () => {
    const r = run(() => loadRef(), name), w = await wasm(SCENARIOS[name]);
    same(w.L, r.L, `${name} L`); same(w.R, r.R, `${name} R`); sameMeters(w.meters, r.meters, name);
  });
}

test('wasm has no imports', () => {
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(readFileSync(WASM))), []);
});

test('messages before ready keep their order', async () => {
  const steps = SCENARIOS.fingers, first = steps.findIndex((s) => s.run);
  const w = loadWasm();
  for (const s of steps.slice(0, first)) w.proc.port.onmessage({ data: s });   // ещё не готов — в очередь
  await w.ready;
  const got = play(w.proc, steps.slice(first), w.posted), r = run(() => loadRef(), 'fingers');
  same(got.L, r.L, 'fingers L'); same(got.R, r.R, 'fingers R');
});

test('blocks longer than 128 samples', async () => {
  const steps = SCENARIOS.one.map((s) => (s.run ? { run: 375 } : s));
  const { proc, posted } = loadRef(), r = play(proc, steps, posted, 256), w = await wasm(steps, SR, SEED, 256);
  same(w.L, r.L, '256 L'); same(w.R, r.R, '256 R');
});

test('a voice index out of range is ignored', async () => {
  const bad = [{ t: 'voice', i: 6, on: true, f: 90, lvl: 0.5 }, { t: 'voice', i: -1, on: true, f: 90 }];
  const steps = SCENARIOS.one, w = await wasm([...steps.slice(0, -1), ...bad, ...steps.slice(-1)]), r = run(() => loadRef(), 'one');
  same(w.L, r.L, 'one L'); same(w.R, r.R, 'one R');
});

test('at 44.1 kHz', async () => {
  for (const name of ['sway', 'all']) {
    const steps = cut(SCENARIOS[name], 2000), { proc, posted } = loadRef(SEED, 44100), r = play(proc, steps, posted), w = await wasm(steps, 44100);
    same(w.L, r.L, `${name} L`); same(w.R, r.R, `${name} R`); sameMeters(w.meters, r.meters, name);
  }
});

test('speed: 60 s, six voices, storm and wind', async () => {
  const blocks = Math.round((60 * SR) / BLOCK);
  const steps = [...SCENARIOS.all.filter((s) => !s.run), { run: blocks }];
  const time = (proc) => { const t0 = performance.now(); play(proc, steps); return performance.now() - t0; };
  const js = time(loadRef().proc), w = loadWasm(); await w.ready;
  const ms = time(w.proc);
  console.log(`  speed, 60 s of sound: JS ${js.toFixed(0)} ms, WASM ${ms.toFixed(0)} ms (x${(js / ms).toFixed(2)})`);
});
