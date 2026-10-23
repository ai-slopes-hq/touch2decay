// Сверка ядра Arcadia (core/worlds/arcadia → t2d.wasm, слот 12) с эталоном — прежней JS-моделью и прежним worklet рельефа (tools/ref,
// ГСЧ с зерном): сухой выход по сэмплам (1e-6), центры петель и уровни каждый блок, нота, снимок; страна ядра — та же, что у genLand.
//   core/build.sh && node --test tools/test-arcadia-core.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTS, refPath, corePath, SLOT, ACT, HEAD, SLOT_M, LAND_BLOCKS } from './arcadia-scenarios.mjs';
import { genLand, GX, GY, SEED0 } from './ref/arcadia-model.js';
import { loadT2d } from './t2d-core.mjs';

const EPS = 1e-6, SR = 48000;
const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
function same(a, b, what) {
  assert.equal(a.length, b.length, `${what}: length`);
  for (let k = 0; k < a.length; k++) if (!(Math.abs(a[k] - b[k]) <= EPS)) assert.fail(`${what}: sample ${k} (block ${Math.floor(k / 128)}): ${a[k]} vs ${b[k]}`);
}

for (const name of Object.keys(ACTS)) {
  test(`sdk: Arcadia dry output matches the reference: ${name}`, () => {
    const r = refPath(ACTS[name]), c = corePath(ACTS[name]);
    assert.ok(rms(r.L) + rms(r.R) > 1e-3, `${name}: reference is silent`);
    same(c.L, r.L, `${name} L`); same(c.R, r.R, `${name} R`);
    r.centers.forEach((bl, b) => bl.forEach((q, i) => q.forEach((x, j) => assert.ok(Math.abs(c.centers[b][i][j] - x) < 1e-9, `${name}: center ${i}.${j} block ${b}: ${c.centers[b][i][j]} vs ${x}`))));
    r.gains.forEach((bl, b) => bl.forEach((g, i) => assert.ok(Math.abs(c.gains[b][i] - g) < 1e-9, `${name}: gain ${i} block ${b}`)));
    r.hz.forEach((f, i) => assert.ok(Math.abs(c.hz[i] - f) < 1e-9, `${name}: hz ${i}: ${c.hz[i]} vs ${f}`));
    assert.equal(c.snapshot, r.snapshot, `${name}: snapshot`);
  });
}

test('land: the core grows the same country as genLand — z and the water mask, bit for bit; it sounds after LAND_BLOCKS blocks', () => {
  const c = loadT2d(); c.init(SR, 1); const x = c.exports;
  const view = (w) => Array.from(new Float32Array(x.memory.buffer, x.t2d_arc_land(w), GX * GY));
  const check = (seed) => { const L = genLand(seed); assert.deepEqual(view(0), Array.from(L.z), `z ${seed}`); assert.deepEqual(view(1), Array.from(L.lake), `lake ${seed}`); };
  check(SEED0);
  for (const seed of [1, 4242, 777, 2147483000, 31337]) {
    c.action(SLOT, ACT.land, 0, [seed]);
    for (let b = 1; b < LAND_BLOCKS; b++) { c.process(128); assert.equal(c.mirror(SLOT)[HEAD - 1], 1, `pending at ${b}`); }
    c.process(128);
    const m = c.mirror(SLOT);
    assert.equal(m[HEAD - 1], 0, 'ready'); assert.equal(m[HEAD - 2], seed);
    check(seed);
  }
});

test('land: a block with a piece of the new country stays cheap (median over seeds, each block ≤ 1/8 of real time; WASM in Node)', () => {
  const c = loadT2d(); c.init(SR, 1);
  for (let k = 0; k < 2000; k++) c.process(128);         // разогрев
  const per = Array.from({ length: LAND_BLOCKS }, () => []);
  for (let s = 0; s < 21; s++) {
    c.action(SLOT, ACT.land, 0, [100 + s]);
    for (let b = 0; b < LAND_BLOCKS; b++) { const t = performance.now(); c.process(128); per[b].push(performance.now() - t); }
  }
  const med = per.map((a) => a.sort((x, y) => x - y)[10]), worst = Math.max(...med), blk = (128 / SR) * 1000;
  console.log(`  block with a piece of land, median: worst ${worst.toFixed(3)} ms (block = ${blk.toFixed(2)} ms)`);
  assert.ok(worst < blk / 8, `${worst} ms`);
});

test('mirror: head layout, slots', () => {
  const c = loadT2d(); c.init(SR, 1);
  c.action(SLOT, ACT.add, 2, [0.1, 0.2, -1, 0.3, 1, 4, 0.25, 0.6]);
  const m = c.mirror(SLOT);
  assert.equal(m.length, HEAD + 4 * SLOT_M);
  assert.equal(m[HEAD - 2], SEED0); assert.equal(m[HEAD - 1], 0);
  const o = HEAD + 2 * SLOT_M;
  assert.deepEqual(m.slice(o, o + 9), [1, 0.1, 0.2, -1, 0.3, 1, 4, 0.25, 0.6]);
  assert.ok(Math.abs(m[o + 9] - 110 * 2 ** (20 / 12) / 2) < 1e-9, `f ${m[o + 9]}`);   // v 0.2 — 20 полутонов от A2, октавой ниже
  assert.equal(m[HEAD], 0, 'no wanderer in slot 0');
});

test('silence: Arcadia with no wanderers costs about nothing (the whole core, empty, vs one wanderer)', () => {
  const run = (setup) => { const c = loadT2d(); c.init(SR, 1); setup(c); for (let k = 0; k < 600; k++) c.process(128); const t = performance.now(); for (let k = 0; k < 3000; k++) c.process(128); return performance.now() - t; };
  const quiet = Math.min(run(() => {}), run(() => {})), one = Math.min(run((c) => c.action(SLOT, ACT.add, 0, [0, 0])), run((c) => c.action(SLOT, ACT.add, 0, [0, 0])));
  console.log(`  8 s of the core: empty ${quiet.toFixed(0)} ms, one wanderer ${one.toFixed(0)} ms`);
  assert.ok(one > quiet, 'a wanderer costs something');
});

test('speed: reference path vs t2d.wasm, scenario all (~10 s)', () => {
  const t0 = performance.now(); refPath(ACTS.all); const t1 = performance.now(); corePath(ACTS.all); const t2 = performance.now();
  console.log(`  speed: JS ${(t1 - t0).toFixed(0)} ms, t2d.wasm (весь хост) ${(t2 - t1).toFixed(0)} ms`);
});
