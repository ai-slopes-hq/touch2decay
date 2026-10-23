// Тесты эталона Firmamentum (tools/ref/pulsar-worklet.js): звучит, детерминирован, по звуку — как прежний worklet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, SEED, BLOCK, toScript, loadRef, loadOld, play } from './firm-scenarios.mjs';

const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
const run = (load, name, steps = SCENARIOS[name]) => { const { proc, posted } = load(); return play(proc, steps, posted); };
const cut = (steps, max) => { const o = []; let n = 0; for (const s of steps) { if (!s.run) { o.push(s); continue; } if (n >= max) break; const r = Math.min(s.run, max - n); o.push({ run: r }); n += r; } return o; };

test('reference sounds', () => {
  assert.ok(rms(run(() => loadRef(), 'tone').L) > 0.01);
});

test('reference is deterministic', () => {
  const steps = cut(SCENARIOS.all, 1000);
  const a = run(() => loadRef(SEED), 'all', steps), b = run(() => loadRef(SEED), 'all', steps), c = run(() => loadRef(SEED + 1), 'all', steps);
  assert.deepEqual(a.L, b.L); assert.deepEqual(a.R, b.R);
  assert.notDeepEqual(a.L, c.L);
});

// Треск и вспышки случайны (стайки): у одного прогона разброс ±50 %, поэтому с обеих сторон — среднее по N прогонам
// (эталон — с разными зёрнами, прежний — на Math.random); допуски из плана — на среднее.
test('reference sounds like the old worklet', () => {
  const RUNS = { all: 8, crepitus: 250 };               // треск дисперсный — ему нужно больше прогонов
  const mean = (load, name) => {
    const N = RUNS[name];
    let e = [0, 0], k = 0, f = 0;
    for (let i = 0; i < N; i++) {
      const r = run(() => load(i), name);
      e[0] += rms(r.L) ** 2; e[1] += rms(r.R) ** 2;
      for (const ev of r.events) { k += ev.k.length; f += ev.f.length; }
    }
    return { L: Math.sqrt(e[0] / N), R: Math.sqrt(e[1] / N), k: k / N, f: f / N };
  };
  const db = (x, y) => Math.abs(20 * Math.log10(x / y));
  for (const name of ['all', 'crepitus']) {
    const r = mean((i) => loadRef(SEED + i), name), o = mean(() => loadOld(), name);
    assert.ok(db(r.L, o.L) <= 0.5, `${name} L: ${r.L} vs ${o.L}`);
    assert.ok(db(r.R, o.R) <= 0.5, `${name} R: ${r.R} vs ${o.R}`);
    for (const key of ['k', 'f']) assert.ok(Math.abs(r[key] - o[key]) <= 0.25 * Math.max(r[key], o[key], 1), `${name} ${key}: ${r[key]} vs ${o[key]}`);
  }
});

// Ядро C++ (core/worlds/firmamentum) против эталона по сэмплам, допуск 1e-6: core/build.sh
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
