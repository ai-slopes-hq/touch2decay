// Сверка ядра Horologium (core/worlds/horologium → t2d.wasm, слот 9) с эталоном — прежней JS-моделью и прежним worklet колеса
// (tools/ref, ГСЧ с зерном): колесо (P, F), ход часов u каждый блок, снимок (без inst). Звук — ударные, у него эталона нет:
// его проверяет core/tests/sdk_test.cpp. Плюс замок к такту MIDI и раскладка зеркала.
//   core/build.sh && node --test tools/test-horo-core.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTS, DECAY, refPath, corePath, SLOT, ACT, M } from './horo-scenarios.mjs';
import { loadT2d } from './t2d-core.mjs';

const SR = 48000;
const strip = (js) => { const o = JSON.parse(js); o.r.forEach((q) => delete q.inst); return o; };   // эталон inst не знает

for (const name of Object.keys(ACTS)) {
  test(`sdk: Horologium wheel and snapshot match the reference: ${name}`, () => {
    const r = refPath(ACTS[name]), c = corePath(ACTS[name]);
    r.wheel.forEach(([P, F], b) => { assert.ok(Math.abs(c.wheel[b][0] - P) < 1e-9 && Math.abs(c.wheel[b][1] - F) < 1e-9, `${name}: wheel block ${b}: ${c.wheel[b]} vs ${[P, F]}`); });
    assert.deepEqual(strip(c.snapshot), strip(r.snapshot), `${name}: snapshot`);
  });
}

test('the clock settles in the core like the reference model: u = 4 → 0 (τ 6 s), each block the same', () => {
  const r = refPath(DECAY, { ticks: true }), c = corePath(DECAY);
  r.us.forEach((u, b) => assert.ok(Math.abs(c.us[b] - u) < 1e-9, `block ${b}: ${c.us[b]} vs ${u}`));
  assert.ok(c.us[0] > 3.9 && c.us.at(-1) < 1.5, `${c.us[0]} → ${c.us.at(-1)}`);
});

// ---------- замок к такту MIDI: сетка хоста из долей (как у оболочки), колесо — оборот на такт ----------
function lockRig(F = 0.5) {
  const c = loadT2d(); c.init(SR, 1); const x = c.exports;
  let t = 0;
  const run = (sec) => { for (let n = Math.round((sec * SR) / 128); n > 0; n--) { x.t2d_time(t); c.process(128); t += 128 / SR; } };
  const beat = (n, at, bpm = 120) => { while (t + 128 / SR <= at) run(128 / SR); x.t2d_time(t); x.t2d_midi_msg(1, n, bpm, at); };
  const m = () => c.mirror(SLOT);
  c.action(SLOT, ACT.bpm, 0, [F * 240]);
  return { c, run, beat, m, get t() { return t; } };
}

test('lock: with MIDI clock, running at tempo, the wheel turns once per bar and its phase sits on the bar', () => {
  const r = lockRig(0.51);                              // свой темп чуть быстрее такта (2 %; темп часов ставит политика хоста) — замок держит фазу
  r.c.action(SLOT, ACT.run, 0, [1, 0]);
  r.c.exports.t2d_midi_msg(3, 0, 0, 0.99);
  for (let n = 0; n < 24; n++) r.beat(n, 1 + n * 0.5);
  const m = r.m(), P = m[M.P], bar = (r.t - 1) / 2;    // такт — 4 доли по 0.5 с
  assert.equal(m[M.locked], 1, 'locked');
  const err = ((P - bar) % 1 + 1.5) % 1 - 0.5;
  assert.ok(Math.abs(err) < 0.02, `wheel ${P} vs bar ${bar} (err ${err})`);
});

test('lock: off while the speed is raised (u ≠ 0), held, or stopped; ring ratios do not change', () => {
  const r = lockRig();
  r.c.action(SLOT, ACT.run, 0, [1, 2]); r.c.action(SLOT, ACT.speed, 0, [2, 2, 0]);
  r.c.exports.t2d_midi_msg(3, 0, 0, 0.99);
  for (let n = 0; n < 8; n++) r.beat(n, 1 + n * 0.5);
  assert.equal(r.m()[M.locked], 0, 'u = 2 — free');
  r.c.action(SLOT, ACT.speed, 0, [0, 0, 0]);
  for (let n = 8; n < 12; n++) r.beat(n, 1 + n * 0.5);
  assert.equal(r.m()[M.locked], 1, 'u = 0 — locked');
  r.c.action(SLOT, ACT.held, 0, [1]); r.run(0.1);
  assert.equal(r.m()[M.locked], 0, 'held — free');
});

test('lock: a phase error over 0.1 revolution snaps, small ones are pulled by ±3 %', () => {
  const r = lockRig(0.5);
  r.c.action(SLOT, ACT.run, 0, [1, 0]);
  r.c.exports.t2d_midi_msg(3, 0, 0, 0.99);
  for (let n = 0; n < 8; n++) r.beat(n, 1 + n * 0.5);
  r.c.action(SLOT, ACT.step, 0, [0.3]); r.run(0.5);    // спуск руками увёл колесо на 0.3 оборота — замок прыгает назад, как только ошибка > 0.1
  const m = r.m(), bar = (r.t - 1) / 2, err = ((m[M.P] - bar) % 1 + 1.5) % 1 - 0.5;
  assert.ok(Math.abs(err) <= 0.1, `err ${err}`);
});

test('mirror: head layout', () => {
  const c = loadT2d(); c.init(SR, 1);
  const m = c.mirror(SLOT);
  assert.equal(m.length, 15 + 8 * 6);
  assert.equal(m.length, 63);
  assert.equal(m[M.bpm], 100);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => m[15 + i * 6]), [1, 1, 1, 0, 0, 0, 0, 0], 'II, III, IV on');
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => m[15 + i * 6 + 4]), [0, 1, 2, 3, 4, 5, 6, 7], 'default kit: inst = ring');
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => m[15 + i * 6 + 5]), [16, 16, 16, 16, 16, 16, 16, 16], 'len 16');
});

test('speed: reference path vs t2d.wasm, scenario all (~10 s)', () => {
  const t0 = performance.now(); refPath(ACTS.all); const t1 = performance.now(); corePath(ACTS.all); const t2 = performance.now();
  console.log(`  speed: JS ${(t1 - t0).toFixed(0)} ms, t2d.wasm (весь хост) ${(t2 - t1).toFixed(0)} ms`);
});
