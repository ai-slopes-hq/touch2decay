// Сверка ядра Goetia (core/worlds/goetia, C++) с прежним JS-worklet (tools/ref/goetia-worklet.js) по сэмплам, допуск 1e-6:
// звук — через render-cli, мир SDK целиком (модель, звук, эхо, шина) — через t2d.wasm (ниже).
//   core/build.sh && node --test tools/test-goetia-core.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, BLOCK, toScript, loadRef, play } from './goetia-scenarios.mjs';

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

// ---------- SDK: мир XV в t2d.wasm (модель ядра + goetia.cpp + эхо и шина) против эталона: JS-модель → engine.js → goetia-worklet.js → шина ----------
// Сухой L/R (с эхом, ×1.6) — 1e-6 на сэмпл; метры (t и громкость каждого духа) — те же, в те же блоки; снимок — тот же JSON.
const { ACTS, refPath, corePath } = await import('./goetia-scenarios.mjs');
for (const name of Object.keys(ACTS)) {
  test(`sdk: dry output matches the reference: ${name}`, () => {
    const r = refPath(ACTS[name]), c = corePath(ACTS[name]);
    assert.ok(rms(r.L) + rms(r.R) > 1e-3, `${name}: reference is silent`);
    same(c.L, r.L, `${name} L`); same(c.R, r.R, `${name} R`);
    assert.equal(c.meters.length, r.meters.length, `${name}: meter count`);
    r.meters.forEach((m, k) => {
      const q = c.meters[k], at = `${name} meter #${k} (block ${m.at})`;
      assert.equal(q.at, m.at, `${at}: block`);
      assert.deepEqual(q.s.map((p) => p[0]), m.s.map((p) => p[0]), `${at}: spirits`);
      same(q.s.map((p) => p[1]), m.s.map((p) => p[1]), `${at}: t`); same(q.s.map((p) => p[2]), m.s.map((p) => p[2]), `${at}: gain`);
    });
    assert.equal(c.snapshot, r.snapshot, `${name}: snapshot`);
  });
}

test('sdk: the echo repeats a strike after 0.375 s', () => {
  const steps = [['fx', 'echo', 0.8], ['seal', [2, 5, 0], { rel: 0.05 }], { run: 30 }, ['banish', 1], { run: 400 }];
  const c = corePath(steps), noEcho = corePath([['fx', 'echo', 0], ...steps.slice(1)]);
  const after = (x) => rms(x.L.subarray(150 * 128, 400 * 128));   // через ~0.4–1 с после изгнания — только эхо
  assert.ok(after(c) > 20 * after(noEcho), `echo tail ${after(c)} vs dry tail ${after(noEcho)}`);
});

test('speed: the reference path vs t2d.wasm, scenario all (~25 s of sound)', () => {
  const t0 = performance.now(); refPath(ACTS.all); const t1 = performance.now(); corePath(ACTS.all); const t2 = performance.now();
  console.log(`  speed: JS ${(t1 - t0).toFixed(0)} ms, t2d.wasm (весь хост: 4 ревербера, 3 мира) ${(t2 - t1).toFixed(0)} ms (×${((t1 - t0) / (t2 - t1)).toFixed(1)})`);
});
