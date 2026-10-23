// Тесты эталона Oceanus (tools/ref/ocean-worklet.js): звучит, детерминирован, по звуку — как прежний worklet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, SEED, BLOCK, toScript, loadRef, loadOld, play } from './ocean-scenarios.mjs';

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

// ---------- SDK: мир VIII в t2d.wasm (модель ядра + ocean.cpp + шина) против эталона: JS-модель → engine.js → ocean-worklet.js ----------
// Сухой L/R (×1.6) — 1e-6 на сэмпл; метры (форма кольца, луна, громкость каждого города) — те же, в те же блоки; снимок — тот же JSON.
const { ACTS, refPath, corePath } = await import('./ocean-scenarios.mjs');
for (const name of Object.keys(ACTS)) {
  test(`sdk: dry output matches the reference: ${name}`, () => {
    const r = refPath(ACTS[name]), c = corePath(ACTS[name]);
    assert.ok(rms(r.L) + rms(r.R) > 1e-3, `${name}: reference is silent`);
    same(c.L, r.L, `${name} L`); same(c.R, r.R, `${name} R`);
    assert.equal(c.meters.length, r.meters.length, `${name}: meter count`);
    r.meters.forEach((m, k) => {
      const q = c.meters[k], at = `${name} meter #${k} (block ${m.at})`;
      assert.equal(q.at, m.at, `${at}: block`);
      same(q.x, m.x, `${at}: shape`); same([q.moon], [m.moon], `${at}: moon`);
      assert.deepEqual(q.g.map((p) => p[0]), m.g.map((p) => p[0]), `${at}: voices`);
      same(q.g.map((p) => p[1]), m.g.map((p) => p[1]), `${at}: gains`);
    });
    assert.equal(c.snapshot, r.snapshot, `${name}: snapshot`);
  });
}

test('speed: the reference path vs t2d.wasm, scenario all (30 s of sound)', () => {
  const t0 = performance.now(); refPath(ACTS.all); const t1 = performance.now(); corePath(ACTS.all); const t2 = performance.now();
  console.log(`  speed: JS ${(t1 - t0).toFixed(0)} ms, t2d.wasm (весь хост: 4 ревербера, 3 мира) ${(t2 - t1).toFixed(0)} ms (×${((t1 - t0) / (t2 - t1)).toFixed(1)})`);
});

