// Тесты эталона Firmamentum (tools/ref/pulsar-worklet.js): звучит, детерминирован, по звуку — как прежний worklet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, SEED, SR, BLOCK, toScript, loadRef, loadOld, play, ACTS, refPath, corePath } from './firm-scenarios.mjs';

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
// (эталон — с разными зёрнами, прежний — на xorshift32 от номера прогона, детерминированно); допуски из плана — на среднее.
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
    const r = mean((i) => loadRef(SEED + i), name), o = mean((i) => loadOld(i), name);
    assert.ok(db(r.L, o.L) <= 0.5, `${name} L: ${r.L} vs ${o.L}`);
    assert.ok(db(r.R, o.R) <= 0.5, `${name} R: ${r.R} vs ${o.R}`);
    for (const key of ['k', 'f']) assert.ok(Math.abs(r[key] - o[key]) <= 0.25 * Math.max(r[key], o[key], 1), `${name} ${key}: ${r[key]} vs ${o[key]}`);
  }
});

// Звук мира SDK (core/worlds/firmamentum/sound.cpp, голоса напрямую — render-cli) против эталона по сэмплам, допуск 1e-6: core/build.sh.
// Прежние pulsar.cpp / pulsar.wasm / pulsar-worklet.js удалены (задача 7 SDK A) — их место занял sound.cpp в t2d.wasm, сверка ниже.
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

// ---------- SDK: мир X в t2d.wasm (модель ядра + звук на блоках SDK) против эталона: JS-модель → engine.js → pulsar-worklet.js ----------
// Сухой L/R — 1e-6 на сэмпл; услышанное (pulsed, dust, bolts) — те же сообщения, в том же порядке, теми же значениями.
const ACT_SANITY = {                                   // сценарий что-то проверяет: звук, треск, вспышки, кометы
  fx: (r) => r.heard.some((h) => h.dust.length) && r.heard.some((h) => h.bolts.length),
  all: (r) => r.heard.some((h) => h.dust.length) && r.heard.some((h) => h.bolts.length) && r.comets >= 2,
  comet: (r) => r.comets >= 2,
};
for (const name of Object.keys(ACTS)) {
  test(`sdk: dry output matches the reference: ${name}`, () => {
    const r = refPath(ACTS[name]), c = corePath(ACTS[name]);
    assert.ok(rms(r.L) + rms(r.R) > 1e-3, `${name}: reference is silent`);
    if (ACT_SANITY[name]) assert.ok(ACT_SANITY[name](r), `${name}: scenario does not exercise what it should`);
    same(c.L, r.L, `${name} L`); same(c.R, r.R, `${name} R`);
    assert.equal(c.heard.length, r.heard.length, `${name}: heard count`);
    r.heard.forEach((h, k) => {
      const q = c.heard[k], at = `${name} heard #${k} (block ${h.at})`;
      assert.equal(q.at, h.at, `${at}: block`);
      assert.deepEqual(q.pulsed, h.pulsed, `${at}: pulsed`);
      assert.equal(q.dust.length, h.dust.length, `${at}: dust count`);
      h.dust.forEach((p, j) => same(q.dust[j], p, `${at}: dust ${j}`));
      assert.deepEqual(q.bolts, h.bolts, `${at}: bolts`);
    });
    assert.ok(r.heard.some((h) => h.pulsed.length), `${name}: no pulsed`);
    assert.equal(c.comets, r.comets, `${name}: comets`);
  });
}
