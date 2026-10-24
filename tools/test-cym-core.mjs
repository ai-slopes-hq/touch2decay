// Сверка ядра Cymatica (core/worlds/cymatica) с эталоном tools/ref/plate-worklet.js: звучит, детерминирован, ядро (render-cli и t2d.wasm)
// совпадает с эталоном по сэмплам (допуск 1e-6), шаги секвенсера — те же (r, m, hit, время). Сборка ядра — core/build.sh.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, SEED, SR, SLOT, BLOCK, playRef as playRefRaw, playCore, toScript } from './cym-scenarios.mjs';
import { loadT2d } from './t2d-core.mjs';

const EPS = 1e-6;
const refCache = new Map();                              // эталон считается долго — один прогон на сценарий и зерно
const playRef = (steps, seed = SEED) => { const k = `${seed}:${Object.keys(SCENARIOS).find((n) => SCENARIOS[n] === steps)}`; if (!refCache.has(k)) refCache.set(k, playRefRaw(steps, seed)); return refCache.get(k); };
const CLI = fileURLToPath(new URL('../core/build/render-cli', import.meta.url));
const WASM = new URL('../t2d.wasm', import.meta.url);
const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
const peak = (a) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

function same(a, b, what) {                             // каждый отсчёт — не дальше EPS; первое расхождение — в сообщении
  assert.equal(a.length, b.length, `${what}: length`);
  for (let k = 0; k < a.length; k++) if (!(Math.abs(a[k] - b[k]) <= EPS)) assert.fail(`${what}: sample ${k} (block ${Math.floor(k / BLOCK)}): ${a[k]} vs ${b[k]}`);
}
function cli(steps) {                                   // render-cli: блоки по 128 — L, затем R
  const p = spawnSync(CLI, { input: toScript(steps), maxBuffer: 1 << 28 });
  assert.equal(p.status, 0, String(p.stderr));
  const f = new Float32Array(p.stdout.buffer.slice(p.stdout.byteOffset, p.stdout.byteOffset + p.stdout.byteLength));
  const n = f.length / (2 * BLOCK), L = new Float32Array(n * BLOCK), R = new Float32Array(n * BLOCK);
  for (let b = 0; b < n; b++) { L.set(f.subarray(2 * b * BLOCK, (2 * b + 1) * BLOCK), b * BLOCK); R.set(f.subarray((2 * b + 1) * BLOCK, (2 * b + 2) * BLOCK), b * BLOCK); }
  return { L, R };
}

// что сценарий должен проверять (иначе сверка пустая): звук, шаги, шанс, колено выхода
const SANITY = {
  strike: (r) => rms(r.L) > 1e-3,
  seq: (r) => r.steps.length >= 20 && r.steps.some((s) => s.hit) && rms(r.L) > 1e-3,
  poly: (r) => r.steps.some((s) => s.r >= 8) && r.steps.length > 40,
  chance: (r) => r.steps.some((s) => !s.hit) && r.steps.some((s) => s.hit),
  edge: (r) => peak(r.L) > 0.8 || peak(r.R) > 0.8,        // выход ушёл за колено — прямая 0.8 кончилась
  lock: (r) => r.steps.length > 20,
  lockStart: (r) => r.steps.length > 10,
  bows: (r) => rms(r.L) > 1e-3,
  all: (r) => r.steps.length > 20 && rms(r.L) > 1e-3,
};

test('reference sounds and is deterministic', () => {
  const a = playRef(SCENARIOS.seq), b = playRef(SCENARIOS.seq), c = playRef(SCENARIOS.seq, SEED + 1);
  assert.ok(rms(a.L) > 1e-3);
  assert.deepEqual(a.L, b.L); assert.deepEqual(a.steps, b.steps);
  const chance = [playRef(SCENARIOS.chance), playRef(SCENARIOS.chance, SEED + 1)];
  assert.notDeepEqual(chance[0].steps.map((s) => s.hit), chance[1].steps.map((s) => s.hit));   // шанс — от зерна
  assert.ok(c.L.length === a.L.length);
});

for (const name of Object.keys(SCENARIOS)) {
  test(`render-cli matches the reference: ${name}`, (t) => {
    if (!existsSync(CLI)) return t.skip('core/build/render-cli is not built — core/build.sh');
    const r = playRef(SCENARIOS[name]), c = cli(SCENARIOS[name]);
    assert.ok(rms(r.L) + rms(r.R) > 1e-4, `${name}: reference is silent`);
    if (SANITY[name]) assert.ok(SANITY[name](r), `${name}: scenario does not exercise what it should`);
    same(c.L, r.L, `${name} L`); same(c.R, r.R, `${name} R`);
  });
}

// t2d.wasm: слот 2 (хост + ядро в одном модуле) — сухой выход и услышанные шаги против эталона
const HAS_WASM = existsSync(WASM) && readFileSync(WASM).length > 0 && (() => { const c = loadT2d(); c.init(SR, SEED); return c.mirror(SLOT).length > 0; })();   // старый t2d.wasm — без слота 2
for (const name of Object.keys(SCENARIOS)) {
  test(`t2d.wasm matches the reference: ${name}`, (t) => {
    if (!HAS_WASM) return t.skip('t2d.wasm is not built — core/build.sh');
    const r = playRef(SCENARIOS[name]), c = playCore(SCENARIOS[name]);
    same(c.L, r.L, `${name} L`); same(c.R, r.R, `${name} R`);
    assert.equal(c.steps.length, r.steps.length, `${name}: step count`);
    r.steps.forEach((s, k) => {
      const q = c.steps[k];
      assert.equal(q.r, s.r, `${name} step #${k}: r`); assert.equal(q.m, s.m, `${name} step #${k}: m`);
      assert.equal(q.hit, s.hit, `${name} step #${k}: hit`);
      assert.ok(Math.abs(q.time - s.time) < 1e-9, `${name} step #${k}: time ${q.time} vs ${s.time}`);
    });
  });
}
