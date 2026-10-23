// Сверка ядра Monochordum (core/worlds/monochord → t2d.wasm, слот 7) с эталоном — прежней JS-моделью и прежним worklet струн
// (tools/ref, ГСЧ с зерном): сухой выход по сэмплам (1e-6), энергия струн и флажолетов каждый блок, снимок. Плюс автострам ядра.
//   core/build.sh && node --test tools/test-mono-core.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTS, refPath, corePath, SLOT, ACT, FX_KEYS, AUTO_KEYS, HEAD } from './mono-scenarios.mjs';
import { loadT2d } from './t2d-core.mjs';

const EPS = 1e-6, SR = 48000;
const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
function same(a, b, what) {
  assert.equal(a.length, b.length, `${what}: length`);
  for (let k = 0; k < a.length; k++) if (!(Math.abs(a[k] - b[k]) <= EPS)) assert.fail(`${what}: sample ${k} (block ${Math.floor(k / 128)}): ${a[k]} vs ${b[k]}`);
}

function sameJson(a, b, what) {                         // тот же JSON: ключи по порядку, числа — до 1e-12
  if (typeof a === 'number' && typeof b === 'number') { assert.ok(Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)), `${what}: ${a} vs ${b}`); return; }
  if (a && typeof a === 'object') {
    assert.deepEqual(Object.keys(a), Object.keys(b), `${what}: keys`);
    for (const k of Object.keys(a)) sameJson(a[k], b[k], `${what}.${k}`);
    return;
  }
  assert.equal(a, b, what);
}

for (const name of Object.keys(ACTS)) {
  test(`sdk: Monochordum dry output matches the reference: ${name}`, () => {
    const r = refPath(ACTS[name]), c = corePath(ACTS[name]);
    assert.ok(rms(r.L) + rms(r.R) > 1e-3, `${name}: reference is silent`);
    same(c.L, r.L, `${name} L`); same(c.R, r.R, `${name} R`);
    r.meters.forEach((m, b) => m.forEach((q, i) => q.forEach((v, k) => {
      if (!(Math.abs(v - c.meters[b][i][k]) <= EPS)) assert.fail(`${name}: meter block ${b} string ${i} #${k}: ${c.meters[b][i][k]} vs ${v}`);
    })));
    sameJson(JSON.parse(c.snapshot), JSON.parse(r.snapshot), `${name}: snapshot`);   // числа — до 1e-12: pow в V8 и в libm расходятся на ulp (2^−0.5)
  });
}

// ---------- автострам в ядре: шаги по сэмплу, свой темп и сетка MIDI ----------
function autoRig({ seed = 9, bpm = 120, div = 1, pattern = 2, swing = 0, chance = 1 } = {}) {
  const c = loadT2d(); c.init(SR, seed);
  const par = (k, v) => c.action(SLOT, ACT.autopar, AUTO_KEYS.indexOf(k), [v]);
  par('bpm', bpm); par('div', div); par('pattern', pattern); par('swing', swing);
  c.action(SLOT, ACT.fx, FX_KEYS.indexOf('chance'), [chance]);
  const onsets = [];                                    // начала щипков: энергия струны выросла с нуля — грубо; точнее — по heard
  let t = 0;
  const run = (sec, { time = true } = {}) => {
    for (let n = Math.round((sec * SR) / 128); n > 0; n--) {
      if (time) c.exports.t2d_time(t);
      c.process(128);
      const h = c.heard(SLOT);
      if (h.length) onsets.push({ t, hits: h[0], step: h[1] });
      t += 128 / SR;
    }
  };
  return { c, par, run, onsets, get t() { return t; }, set t(v) { t = v; }, mirror: () => c.mirror(SLOT) };
}

test('autostrum: own tempo — one hit per step, steps 1/8 at 120 BPM = 0.25 s', () => {
  const r = autoRig();
  r.c.action(SLOT, ACT.auto, 0, [1]);
  r.run(3.05);
  const ts = r.onsets.map((o) => o.t);
  assert.ok(ts.length >= 12 && ts.length <= 13, `${ts.length} steps`);
  for (let k = 1; k < ts.length; k++) assert.ok(Math.abs(ts[k] - ts[k - 1] - 0.25) <= 128 / SR + 1e-9, `step ${k}: ${ts[k] - ts[k - 1]}`);
  assert.deepEqual(r.onsets.slice(0, 5).map((o) => o.step), [0, 1, 2, 3, 4]);
  assert.equal(r.mirror()[FX_KEYS.length + 2], 1, 'auto.on in the mirror');
});

test('autostrum: chance 0 — no hits; stop — no more hits', () => {
  const r = autoRig({ chance: 0 });
  r.c.action(SLOT, ACT.auto, 0, [1]); r.run(2);
  assert.equal(r.onsets.length, 0);
  const q = autoRig(); q.c.action(SLOT, ACT.auto, 0, [1]); q.run(1); const n = q.onsets.length;
  q.c.action(SLOT, ACT.auto, 0, [0]); q.run(1);
  assert.equal(q.onsets.length, n);
});

test('autostrum follows the MIDI grid: steps land on the beats, the first one after Start at once', () => {
  const r = autoRig({ bpm: 77 });
  const beat = 0.5, t0 = 1;                             // часы 120 BPM: доля каждые 0.5 с, первая — в 1 с
  for (let k = 0; k < 24 * 8; k++) {                    // тики до 4.9 с; пуск — перед первой долей
    const at = t0 + (k * beat) / 24;
    while (r.t + 128 / SR <= at) r.run(128 / SR);
    if (k === 0) r.c.exports.t2d_midi_byte(0, 0xFA, at - 0.01);
    r.c.exports.t2d_midi_byte(0, 0xF8, at);
    if (k === 24 + 1) r.c.action(SLOT, ACT.auto, 0, [1]);   // хост запустил мир по launch (вторая доля пришла)
  }
  const g = r.c.exports;
  const n = g.t2d_hmirror(), hm = Array.from(new Float64Array(g.memory.buffer, g.t2d_mbuf(), n));
  assert.equal(hm[0], 1, 'grid is on');
  assert.ok(Math.abs(hm[2] - 0.5) < 1e-6, `p ${hm[2]}`);
  const ts = r.onsets.map((o) => o.t);
  assert.ok(ts.length >= 8, `${ts.length} steps`);
  for (const t of ts.slice(1)) { const k = ((t - t0) / beat) * 2; assert.ok(Math.abs(k - Math.round(k)) * beat / 2 <= 128 / SR + 1e-6, `off grid: ${t}`); }
});

test('the hour-later case: autostrum started an hour after Start lands on the grid with bounded work', () => {
  const r = autoRig();
  r.t = 3600;
  for (let k = 0; k < 48; k++) { const at = 3600 + k / 48; while (r.t + 128 / SR <= at) r.run(128 / SR); if (!k) r.c.exports.t2d_midi_byte(0, 0xFA, at); r.c.exports.t2d_midi_byte(0, 0xF8, at); }
  r.c.action(SLOT, ACT.auto, 0, [1]);
  const t1 = performance.now(); r.run(1); const ms = performance.now() - t1;
  assert.ok(r.onsets.length >= 3, `${r.onsets.length}`);
  assert.ok(ms < 500, `${ms} ms`);
});

test('mirror: head layout, strings', () => {
  const c = loadT2d(); c.init(SR, 1);
  c.action(SLOT, ACT.sus, 2, [1]); c.action(SLOT, ACT.wind, 0, [0.4]);
  const m = c.mirror(SLOT);
  assert.equal(m.length, HEAD + 4 * 9);
  assert.equal(m[FX_KEYS.length], 0.4); assert.equal(m[HEAD + 2 * 9 + 1], 1);
});

test('speed: reference path vs t2d.wasm, scenario all (~6 s of sound)', () => {
  const t0 = performance.now(); refPath(ACTS.all); const t1 = performance.now(); corePath(ACTS.all); const t2 = performance.now();
  console.log(`  speed: JS ${(t1 - t0).toFixed(0)} ms, t2d.wasm (весь хост) ${(t2 - t1).toFixed(0)} ms`);
});

test('autostrum: swing — even steps longer (0.3 / 0.2 s at 120 BPM, 1/8, swing 0.4)', () => {
  const r = autoRig({ swing: 0.4 });
  r.c.action(SLOT, ACT.auto, 0, [1]); r.run(2.6);
  const ts = r.onsets.map((o) => o.t), d = ts.slice(1).map((t, k) => t - ts[k]);
  d.forEach((x, k) => assert.ok(Math.abs(x - (k % 2 === 0 ? 0.3 : 0.2)) <= 128 / SR + 1e-9, `interval ${k}: ${x}`));
});

test('autostrum: changing the division mid-run keeps it playing at the new rate', () => {
  const r = autoRig();
  r.c.action(SLOT, ACT.auto, 0, [1]); r.run(1);
  const n = r.onsets.length;
  r.par('div', 3); r.run(1);                            // 1/16: шаг 0.125 с
  const after = r.onsets.slice(n).map((o) => o.t);
  assert.ok(after.length >= 6 && after.length <= 9, `${after.length}`);   // уже назначенный шаг доигрывает прежнюю длину (как в JS)
});

// сетка из долей оболочки (t2d_midi_msg): пуск, доли n в t0 + n·p при bpm; autostrum — после launch
function gridRig(o = {}) {
  const r = autoRig(o), x = r.c.exports;
  r.beat = (n, at, bpm = 120) => { while (r.t + 128 / SR <= at) r.run(128 / SR); x.t2d_time(r.t); x.t2d_midi_msg(1, n, bpm, at); };
  r.start = (at) => { while (r.t + 128 / SR <= at) r.run(128 / SR); x.t2d_time(r.t); x.t2d_midi_msg(3, 0, 0, at); };
  r.beats = (from, to, t0 = 1, p = 0.5) => { for (let n = from; n <= to; n++) r.beat(n, t0 + n * p, 60 / p); };
  return r;
}

test('autostrum on the grid: 1/8T with swing — steps on stepTime + swing', () => {
  const r = gridRig({ div: 2, swing: 0.3 });
  r.start(0.99); r.beat(0, 1);
  r.c.action(SLOT, ACT.auto, 0, [1]);
  r.beats(1, 6);
  const ts = r.onsets.map((o) => o.t);
  assert.ok(ts.length >= 10, `${ts.length}`);
  const stepSec = 0.5 / 3;
  r.onsets.forEach(({ t, step }) => {
    const want = 1 + step * stepSec + (step % 2 ? 0.3 * 0.5 * (60 / 120 / 3) : 0);   // swing — от темпа модели (120 в риге), как swingAt в JS
    assert.ok(t <= want + 1e-9 && want - t < 128 / SR + 1e-9, `step ${step}: block ${t}, want ${want}`);
  });
});

test('autostrum started just after the downbeat plays step 0 at once (late < 30 ms)', () => {
  const r = gridRig();
  r.start(0.99); r.beat(0, 1);
  r.run(0.02);                                          // ~1.02: доля 0 была 20 мс назад
  r.c.action(SLOT, ACT.auto, 0, [1]); r.run(128 / SR);
  assert.equal(r.onsets.length, 1, 'played in the next block');
  assert.equal(r.onsets[0].step, 0, 'step 0, late — at once (as due() in JS: only the first step)');
});

test('a backward grid jump never fires steps out of order', () => {
  const r = gridRig();
  r.start(0.99); r.beat(0, 1); r.c.action(SLOT, ACT.auto, 0, [1]);
  r.beats(1, 4);
  r.beats(5, 9, 0.8);                                   // сетка прыгнула на 0.2 с назад
  const st = r.onsets.map((o) => o.step), ts = r.onsets.map((o) => o.t);
  for (let i = 1; i < st.length; i++) { assert.ok(st[i] > st[i - 1], `steps ${st}`); assert.ok(ts[i] > ts[i - 1]); }
  assert.ok(st.length >= 12, `${st.length}`);
});
