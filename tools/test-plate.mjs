// Тесты звука пластины без браузера: plate-worklet.js грузится в vm с заглушками AudioWorklet.
//   node --test tools/test-plate.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../plate-worklet.js', import.meta.url), 'utf8');
const FS = 48000;

// шум смычка — Math.random: в тестах с фиксированным зерном, чтобы проверки не плавали
function seeded(seed = 12345) {
  const m = Object.create(Math);
  m.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return m;
}
function load() {
  const posted = [];
  const reg = {};
  const ctx = {
    sampleRate: FS, currentTime: 0, Math: seeded(), Float32Array, Float64Array, Array, Object, Number, JSON,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (m) => posted.push(m), onmessage: null }; } },
    registerProcessor: (name, cls) => { reg[name] = cls; },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, posted, reg };
}
const P = load().ctx;
const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const lerpLog = (a, b, t) => a * (b / a) ** t;

// прогнать процессор: секунды звука → левый канал
function run(proc, seconds) {
  const out = [];
  for (let n = 0; n < Math.round((seconds * FS) / 128); n++) {
    const L = new Float32Array(128), R = new Float32Array(128);
    proc.process([], [[L, R]], {});
    for (const x of L) out.push(x);
  }
  return out;
}
const rms = (a, t0, t1) => { const i0 = Math.round(t0 * FS), i1 = Math.round(t1 * FS); let e = 0; for (let i = i0; i < i1; i++) e += a[i] * a[i]; return Math.sqrt(e / (i1 - i0)); };
const peak = (a) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
const finite = (a) => a.every((x) => Number.isFinite(x));
function plate() {
  const { reg, posted } = load();
  const proc = new reg.plate();
  const send = (data) => proc.port.onmessage({ data });
  send({ t: 'f0', hz: 110 });
  return { proc, send, posted };
}

test('besselJ zeros', () => {
  close(P.besselJ(0, 2.404825557695773), 0, 1e-6, 'J0');
  close(P.besselJ(1, 3.831705970207512), 0, 1e-6, 'J1');
  close(P.besselJ(3, 6.380161895923983), 0, 1e-6, 'J3');
});

test('modes order', () => {
  assert.equal(P.MODES.length, 24);
  assert.deepEqual(Array.from(P.MODES.slice(0, 4), (d) => [d.m, d.n]), [[0, 1], [1, 1], [2, 1], [0, 2]]);
  for (let k = 1; k < 24; k++) assert.ok(P.MODES[k].j > P.MODES[k - 1].j, `j grows at ${k}`);
});

test('ratios', () => {                          // тела по лучу structure — опоры через 1/7: струна … калимба
  const s = P.modeRatios(0);
  for (let k = 0; k < 24; k++) assert.equal(s[k], k + 1);
  close(P.modeRatios(1 / 7)[1], 1.5933, 1e-3, 'membrane');
  close(P.modeRatios(2 / 7)[1], 2.5387, 1e-3, 'plate');
  const b = P.modeRatios(3 / 7);
  [0.5, 1, 1.2, 1.5, 2, 2.5].forEach((x, k) => close(b[k], x, 1e-9, `bell ${k}`));
  const bowl = P.modeRatios(4 / 7);                  // поющая чаша: пары мод чуть врозь — биения
  [1, 1.004, 2.71, 2.71 * 1.004].forEach((x, k) => close(bowl[k], x, 1e-9, `bowl ${k}`));
  const hang = P.modeRatios(5 / 7);
  [1, 2, 3].forEach((x, k) => close(hang[k], x, 1e-9, `handpan ${k}`));
  const mar = P.modeRatios(6 / 7);
  [1, 4, 10].forEach((x, k) => close(mar[k], x, 1e-9, `marimba ${k}`));
  const kal = P.modeRatios(1);                       // калимба: язычок, закреплённый с одного конца
  close(kal[1], 6.267, 1e-3, 'kalimba 1'); close(kal[2], 17.547, 1e-2, 'kalimba 2');
  for (const r of [bowl, hang, mar, kal]) for (let k = 1; k < 24; k++) assert.ok(r[k] >= r[k - 1], 'ratios do not fall');
  const mid = Math.sqrt(P.modeRatios(1 / 7)[1] * P.modeRatios(2 / 7)[1]);
  close(P.modeRatios(1.5 / 7)[1], mid, 1e-6, 'log interpolation');
});

test('strike gains', () => {
  const c = P.strikeGains(0, 0);
  P.MODES.forEach((d, k) => { if (d.m > 0) assert.ok(c[k] < 1e-9, `center mode ${k}`); });
  close(c[0], 1, 1e-6, 'center (0,1)');
  assert.ok(P.strikeGains(1, 0)[0] < 1e-6, 'edge (0,1)');
  assert.ok(P.strikeGains(1.2, 0).every((x) => x === 0), 'outside the plate');
});

test('t60', () => {
  const r = P.modeRatios(2 / 3);
  const a = P.t60s(r, 0.5, 0);
  for (let k = 1; k < 24; k++) assert.ok(a[k] < a[k - 1], `shorter up the modes at ${k}`);
  const b = P.t60s(r, 0.5, 1);
  for (let k = 0; k < 24; k++) close(b[k], lerpLog(0.08, 12, 0.5), 1e-9, `flat at ${k}`);
});

test('resCoefs', () => {
  const { b1, b2 } = P.resCoefs(440, 2, FS);
  const R = Math.sqrt(-b2);
  assert.ok(R > 0.99 && R < 1, `R ${R}`);
  assert.ok(b2 > -1);
  assert.ok(Math.abs(b1) < 2);
});

test('pickVoice', () => {
  const v = [{ hz: 110, level: 0.5 }, { hz: 220, level: 0.1 }, { hz: 330, level: 0.3 }, { hz: 440, level: 0.9 }];
  assert.equal(P.pickVoice(v, 330.5), 2);
  assert.equal(P.pickVoice(v, 500), 1);
});

test('processor strike decays', () => {
  const { proc, send } = plate();
  send({ t: 'strike', x: 0.3, y: 0.1, vel: 1, hard: 0.5 });
  const a = run(proc, 1);
  assert.ok(finite(a), 'no NaN');
  assert.ok(peak(a) < 1, `peak ${peak(a)}`);
  assert.ok(rms(a, 0, 0.1) > 1e-3, 'audible');
  assert.ok(rms(a, 0.9, 1) < 0.5 * rms(a, 0, 0.1), 'decays');
});

test('processor bow sustains', () => {
  const { proc, send } = plate();
  send({ t: 'bow', id: 1, x: 0.4, y: 0, on: true, exciter: 0, pressure: 0.6, amp: 1 });
  const a = run(proc, 1.5);
  assert.ok(finite(a), 'no NaN');
  assert.ok(peak(a) < 1, `peak ${peak(a)}`);
  assert.ok(rms(a, 1, 1.5) > 0.3 * rms(a, 0.2, 0.5), 'sustains');
  assert.ok(rms(a, 0.2, 0.5) > 1e-3, 'audible');
  send({ t: 'bow', id: 1, on: false });
  const b = run(proc, 3);
  assert.ok(rms(b, 2.9, 3) < 0.01, 'stops after release');
});

test('strike flood', () => {
  const { proc, send } = plate();
  for (let i = 0; i < 40; i++) send({ t: 'strike', x: Math.cos(i) * 0.5, y: Math.sin(i) * 0.5, vel: 1, hard: 1 });
  assert.ok(proc.strikes.length <= 16, `strikes ${proc.strikes.length}`);
  const a = run(proc, 0.5);
  assert.ok(finite(a), 'no NaN');
  assert.ok(peak(a) < 1, `peak ${peak(a)}`);
});

test('center vs edge', () => {
  const lastEnergy = (posted) => posted.filter((m) => m.t === 'energy').pop().e;
  const c = plate();
  c.send({ t: 'strike', x: 0, y: 0, vel: 1, hard: 0.5 });
  run(c.proc, 0.2);
  const ec = lastEnergy(c.posted), mc = Math.max(...ec);
  P.MODES.forEach((d, k) => { if (d.m > 0) assert.ok(ec[k] < 1e-3 * mc, `center mode ${k}`); });
  const e = plate();
  e.send({ t: 'strike', x: 0.6, y: 0, vel: 1, hard: 0.5 });
  run(e.proc, 0.2);
  const ee = lastEnergy(e.posted), me = Math.max(...ee);
  assert.ok(ee[1] > 1e-2 * me, 'edge wakes (1,1)');
});

test('shapes posted once', () => {
  const { proc, posted } = plate();
  run(proc, 0.1);
  const s = posted.filter((m) => m.t === 'shapes');
  assert.equal(s.length, 1);
  assert.equal(s[0].n, 96);
  assert.equal(s[0].grid.length, 24 * 96 * 96);
});

test('first process is cheap', () => {          // сетка форм мод не считается целиком в одном блоке звука
  const { proc } = plate();
  const L = new Float32Array(128), R = new Float32Array(128);
  const t = performance.now(); proc.process([], [[L, R]], {}); const ms = performance.now() - t;
  assert.ok(ms < 3, `first block ${ms.toFixed(2)} ms`);
});

test('strike loudness holds across pitch', () => {   // маленькая пластина звенит не тише большой
  const loud = (hz) => {
    const { proc, send } = plate();
    send({ t: 'f0', hz });
    send({ t: 'strike', x: 0.3, y: 0.1, vel: 1, hard: 0.5, hz });
    return rms(run(proc, 0.2), 0, 0.2);
  };
  const db = 20 * Math.log10(loud(880) / loud(110));
  assert.ok(Math.abs(db) < 6, `880 vs 110 Hz: ${db.toFixed(1)} dB`);
});

test('goes idle in silence', () => {             // в тишине резонаторы не считаются, выход — нули
  const { proc, send } = plate();
  send({ t: 'strike', x: 0.3, y: 0.1, vel: 1, hard: 0.5 });
  run(proc, 8);
  assert.ok(proc.voices.every((v) => !v.awake), 'all voices asleep');
  const a = run(proc, 0.01);
  assert.ok(a.every((x) => x === 0), 'silent output');
});

// ---------- часы секвенсера ----------
const slots = (f) => Array.from({ length: 16 }, (_, i) => f(i));
const seqMsg = (o = {}) => ({
  t: 'seq', bpm: 120, playing: true,
  rhythm: { len: 16, steps: slots(() => null) }, melody: { len: 7, steps: slots(() => null) }, ...o,
});
const hit = { x: 0.3, y: 0, vel: 1 };
const stepsOf = (posted) => posted.filter((m) => m.t === 'step');
function blocks(proc, n) { for (let i = 0; i < n; i++) proc.process([], [[new Float32Array(128), new Float32Array(128)]], {}); }

test('stepSamples', () => {
  assert.equal(P.stepSamples(120, 48000), 6000);
  assert.equal(P.stepSamples(96, 48000), 7500);
});

test('steps on time', () => {
  const { proc, send, posted } = plate();
  send(seqMsg({ rhythm: { len: 16, steps: slots((i) => (i === 0 ? hit : null)) } }));
  run(proc, 1);
  const t = stepsOf(posted).map((m) => m.time);
  assert.equal(t.length, 8);
  t.forEach((x, i) => close(x, i * 0.125, 1 / FS, `tick ${i}`));
});

test('polymeter', () => {
  const { proc, send, posted } = plate();
  send(seqMsg({ bpm: 200 }));
  run(proc, 8.5);
  const pairs = stepsOf(posted).slice(0, 113).map((m) => `${m.r},${m.m}`);
  assert.equal(new Set(pairs.slice(0, 112)).size, 112);
  assert.equal(pairs[112], pairs[0]);
});

test('melody note', () => {
  const a = plate();
  a.send({ t: 'f0', hz: 110 });
  a.send(seqMsg({ rhythm: { len: 16, steps: slots(() => hit) }, melody: { len: 7, steps: slots((i) => (i === 0 ? 24 : null)) } }));
  run(a.proc, 0.01);
  assert.ok(a.proc.voices.some((v) => v.awake && Math.abs(v.hz - 220) < 0.5), 'note 24 → 220 Hz');
  const b = plate();
  b.send({ t: 'f0', hz: 330 });
  b.send(seqMsg({ rhythm: { len: 16, steps: slots(() => hit) } }));
  run(b.proc, 0.01);
  assert.ok(b.proc.voices.some((v) => v.awake && Math.abs(v.hz - 330) < 0.5), 'empty note → plate pitch');
});

test('empty pattern', () => {
  const { proc, send, posted } = plate();
  send(seqMsg());
  const a = run(proc, 0.5);
  assert.ok(a.every((x) => x === 0), 'silent');
  assert.equal(stepsOf(posted).length, 5);         // run(0.5) — 188 блоков = 24064 отсчёта: тики 0 … 0.5 с
});

test('tempo change mid-run', () => {
  const { proc, send, posted } = plate();
  send(seqMsg());
  run(proc, 0.3);
  send(seqMsg({ bpm: 60 }));
  run(proc, 0.6);
  const t = stepsOf(posted).map((m) => m.time);
  close(t[3], 0.5, 1 / FS, 'next tick one new step after the last');
  const c = plate();
  c.send(seqMsg({ bpm: 200 }));
  while (stepsOf(c.posted).length < 11) blocks(c.proc, 1);
  assert.equal(stepsOf(c.posted).at(-1).r, 10);
  c.send(seqMsg({ bpm: 200, rhythm: { len: 4, steps: slots(() => null) } }));
  while (stepsOf(c.posted).length < 12) blocks(c.proc, 1);
  const r = stepsOf(c.posted).at(-1).r;
  assert.ok(r >= 0 && r < 4, `r ${r}`);
});

test('no double hit after a live strike', () => {
  const pattern = seqMsg({ rhythm: { len: 16, steps: slots((i) => (i < 2 ? hit : null)) } });
  const a = plate();
  a.send(pattern);
  blocks(a.proc, 35);                                // 4480 отсчётов — 0.0317 с до тика шага 1 (6000)
  a.send({ t: 'strike', x: 0.5, y: 0, vel: 1, hard: 0.5, rec: true });   // удар при записи
  blocks(a.proc, 12);                                // до 6016: тик только что прошёл
  assert.equal(a.proc.strikes.length, 0, 'step 1 skipped after a live strike');
  const b = plate();
  b.send(pattern);
  blocks(b.proc, 47);
  assert.equal(b.proc.strikes.length, 1, 'step 1 plays without a live strike');
});

test('live strike without recording keeps the pattern', () => {   // играешь поверх узора — его удары не пропадают
  const { proc, send } = plate();
  send(seqMsg({ rhythm: { len: 16, steps: slots((i) => (i < 2 ? hit : null)) } }));
  blocks(proc, 35);
  send({ t: 'strike', x: 0.5, y: 0, vel: 1, hard: 0.5 });
  blocks(proc, 12);
  assert.equal(proc.strikes.length, 1, 'step 1 still plays');
});

test('tempo change does not recompute strike gains', () => {   // тянешь темп или длину — в звуковом потоке ничего тяжёлого
  const { ctx, reg } = load();
  const proc = new reg.plate(), send = (data) => proc.port.onmessage({ data });
  send(seqMsg({ rhythm: { len: 16, steps: slots(() => hit) } }));
  let calls = 0; const orig = ctx.strikeGains;
  ctx.strikeGains = (x, y) => { calls++; return orig(x, y); };
  send(seqMsg({ bpm: 90, rhythm: { len: 8, steps: slots(() => hit) } }));
  assert.equal(calls, 0, 'same points — gains reused');
  send(seqMsg({ bpm: 90, rhythm: { len: 8, steps: slots((i) => (i === 3 ? { x: 0.1, y: 0.2, vel: 1 } : hit)) } }));
  assert.equal(calls, 1, 'one moved step — one recompute');
});
