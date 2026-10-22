// Сверка ядра Goetia (core/worlds/goetia, C++) с прежним JS-worklet (tools/ref/goetia-worklet.js) по сэмплам, допуск 1e-6.
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
