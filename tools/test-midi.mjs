// Служба MIDI-часов хоста: сетка долей (ядро, core/sdk/transport.hpp), раздача пуска/стопа/темпа (host/midi.js) — в Node над t2d.wasm.
// Разбор байтов прежним JS (clockParser) — эталон, с ним ядро сверяет tools/test-transport.mjs; его тесты остались здесь.
//   node --test tools/test-midi.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { due, stepTime } from '../host/midi.js';
import { clockParser } from './ref/midi.js';
import { coreMidi } from './midi-core.mjs';

const fake = (o = {}) => {
  const w = { calls: [], bpm: o.bpm ?? 120, on: !!o.playing };
  w.tempo = {
    get: () => w.bpm, set: (b) => { w.bpm = b; w.calls.push(['set', b]); },
    play: (on) => { w.on = on; w.calls.push(['play', on]); }, playing: () => w.on,
    armed: o.armed === undefined ? undefined : () => o.armed,
  };
  return w;
};
const rig = (ws = [], cur = null) => {
  const r = { t: 10, cur };
  r.m = coreMidi({ worlds: () => ws, now: () => r.t, current: () => r.cur });
  return r;
};
const beat = (r, n, at, bpm = 120) => { r.t = at; r.m.message({ t: 'beat', n, bpm, ago: 0 }); };

test('smooths a beat 20 ms late back within 3 beats', () => {
  const r = rig();
  beat(r, 0, 10); beat(r, 1, 10.5);
  const before = stepTime(r.m.grid(), 8, 4);              // доля 2 по старой сетке
  beat(r, 2, 11.02);
  assert.ok(Math.abs(stepTime(r.m.grid(), 8, 4) - before) <= 0.01 + 1e-9);
  beat(r, 3, 11.5); beat(r, 4, 12); beat(r, 5, 12.5);
  assert.ok(Math.abs(stepTime(r.m.grid(), 20, 4) - 12.5) < 0.003);
});

test('takes a jump over 50 ms at once', () => {
  const r = rig();
  beat(r, 0, 10); beat(r, 1, 10.5); beat(r, 2, 11); beat(r, 3, 11.5);
  beat(r, 4, 12.08);
  assert.ok(Math.abs(stepTime(r.m.grid(), 16, 4) - 12.08) < 1e-9);
});

test('start waits for the first beat', () => {
  const a = fake({ armed: true });
  const r = rig([a], a);                                   // мир на экране, с узором
  r.m.message({ t: 'start', ago: 0 });
  assert.equal(r.m.grid(), null);
  assert.deepEqual(a.calls, []);
  beat(r, 0, 10.2);
  assert.ok(Math.abs(r.m.grid().t0 - 10.2) < 1e-9);
  assert.deepEqual(a.calls.filter((c) => c[0] === 'play'), [['play', true]]);
});

test('start runs worlds the user started this session, the one on screen, and stopped-by-midi', () => {
  const nat = fake({ armed: true });                       // стартовый патч есть, но мир не трогали и не смотрят на него
  const cym = fake({ armed: true }), por = fake({ armed: true }), mono = fake({ armed: false }), horo = fake({ armed: true });
  const r = rig([nat, cym, por, mono, horo], por);
  cym.on = true; r.m.tick(); cym.on = false; r.m.tick();   // Cymatica запускали руками и остановили
  mono.on = true; r.m.tick();                              // автострам играет
  r.m.message({ t: 'stop', ago: 0 });                      // MIDI Stop: останавливает автострам
  r.m.message({ t: 'start', ago: 0 });
  beat(r, 0, 10);
  const ran = (w) => w.calls.some((c) => c[0] === 'play' && c[1] === true);
  assert.deepEqual([nat, cym, por, mono, horo].map(ran), [false, true, true, true, false]);
});

test('a world started by hand just before the first beat joins', () => {
  const w = fake({ armed: true });
  const r = rig([w]);
  r.m.message({ t: 'start', ago: 0 });
  w.on = true;                                             // тика ещё не было
  beat(r, 0, 10);
  assert.deepEqual(w.calls.filter((c) => c[0] === 'play'), [['play', false], ['play', true]]);
});

test('a world the service started does not count as started by hand', () => {
  const w = fake({ armed: true }), other = fake({ armed: true });
  const r = rig([w, other], w);
  r.m.message({ t: 'start', ago: 0 }); beat(r, 0, 10); r.m.tick();
  assert.equal(w.on, true);                                // на экране — запустила служба
  w.on = false; r.m.tick();                                // остановил руками
  r.cur = other;                                           // ушёл в другой мир
  r.m.message({ t: 'start', ago: 0 }); beat(r, 0, 12);
  assert.equal(w.on, false);
  assert.equal(other.on, true);
});

test('start restarts a playing world', () => {
  const w = fake({ armed: false, playing: true });
  const r = rig([w]);
  r.m.message({ t: 'start', ago: 0 });
  beat(r, 0, 10);
  assert.deepEqual(w.calls.filter((c) => c[0] === 'play'), [['play', false], ['play', true]]);
});

test('stop stops every sequencer', () => {
  const a = fake({ playing: true }), b = fake({ playing: true }), c = fake();
  const r = rig([a, b, c]);
  beat(r, 0, 10);
  r.m.message({ t: 'stop', ago: 0 });
  assert.equal(a.on, false); assert.equal(b.on, false);
  assert.deepEqual(c.calls, []);
  assert.equal(r.m.grid(), null);
});

test('tempo goes to every world over 0.3 BPM', () => {
  const a = fake(), b = fake();
  const r = rig([a, b]);
  beat(r, 0, 10, 120.2);
  assert.deepEqual([a.calls, b.calls], [[], []]);
  beat(r, 1, 10.5, 120.4);
  assert.deepEqual(a.calls, [['set', 120.4]]); assert.deepEqual(b.calls, [['set', 120.4]]);
});

test('tempo knob is overridden at the next beat', () => {
  const a = fake({ playing: true, bpm: 100 });
  const r = rig([a]);
  beat(r, 0, 10, 120);
  assert.deepEqual(a.calls, [['set', 120]]);
});

test('beats return without start', () => {
  const a = fake({ playing: true });
  const r = rig([a]);
  beat(r, 0, 10); beat(r, 1, 10.5);
  r.t = 12; r.m.tick();
  assert.equal(r.m.grid(), null);
  beat(r, 9, 20);
  const g = r.m.grid();
  assert.ok(Math.abs(g.t0 - (20 - 9 * g.p)) < 1e-9);
  assert.deepEqual(a.calls.filter((c) => c[0] === 'play'), []);
});

test('clock lost after 1 s', () => {
  const a = fake({ armed: true });
  const r = rig([a]);
  beat(r, 0, 10);
  r.t = 10.5; r.m.tick(); assert.ok(r.m.grid());
  r.t = 11.01; r.m.tick();
  assert.equal(r.m.grid(), null);
  assert.deepEqual(a.calls.filter((c) => c[0] === 'play'), []);
});

test('due plays the first late step now, skips others', () => {
  assert.ok(Math.abs(due(0.98, 1, true) - 1.005) < 1e-9);
  assert.equal(due(0.98, 1, false), null);
  assert.equal(due(0.96, 1, true), null);
  assert.equal(due(1.5, 1, false), 1.5);
});

test('a world without play/playing does not break start and stop', () => {
  const bad = { tempo: { get: () => 120, set() {} } }, odd = { tempo: { get: () => 120, set() {}, play() { throw new Error('boom'); }, playing: () => true } };
  const a = fake({ armed: true, playing: true });
  const r = rig([bad, odd, a]);
  r.m.message({ t: 'stop', ago: 0 });
  assert.equal(a.on, false);
  r.m.message({ t: 'start', ago: 0 });
  beat(r, 0, 10);
  assert.equal(a.on, true);
});

test('repeated stop keeps who was playing', () => {
  const a = fake({ armed: false, playing: true });
  const r = rig([a]);
  r.m.message({ t: 'stop', ago: 0 }); r.m.message({ t: 'stop', ago: 0 });
  r.m.message({ t: 'start', ago: 0 });
  beat(r, 0, 10);
  assert.equal(a.on, true);
});

test('beats after stop are ignored until the next start', () => {
  const a = fake({ armed: true });
  const r = rig([a], a);
  r.m.message({ t: 'stop', ago: 0 });
  beat(r, 3, 10);
  assert.equal(r.m.grid(), null); assert.deepEqual(a.calls, []);
  r.m.message({ t: 'start', ago: 0 });
  beat(r, 0, 11);
  assert.ok(r.m.grid()); assert.equal(a.on, true);
});

// ---------- новый AudioContext (restartAudio): время пошло назад ----------
test('a new AudioContext (time goes back) rebuilds the grid in the new time with p > 0', () => {
  const r = rig();
  for (let i = 0; i < 40; i++) beat(r, i, 100 + i * 0.5);
  assert.ok(Math.abs(r.m.grid().p - 0.5) < 1e-9);
  r.t = 0.2; r.m.tick();                                   // контекст пересоздан: currentTime ≈ 0
  assert.equal(r.m.grid(), null);
  for (let i = 0; i < 6; i++) beat(r, 40 + i, 0.3 + i * 0.5);
  const g = r.m.grid();
  assert.ok(g.p > 0 && Math.abs(g.p - 0.5) < 1e-9, `p ${g.p}`);
  assert.ok(Math.abs(stepTime(g, 4 * 45, 4) - (0.3 + 5 * 0.5)) < 1e-6, 'beat 45 at its new-time moment');
});

test('a beat arriving after the time went back drops the old grid without tick', () => {
  const r = rig();
  for (let i = 0; i < 10; i++) beat(r, i, 100 + i * 0.5);
  beat(r, 10, 0.3);
  assert.ok(r.m.grid().p > 0 && Math.abs(r.m.grid().t0 - (0.3 - 10 * 0.5)) < 1e-6);
});

test('an implausible beat interval does not change p', () => {
  const r = rig();
  for (let i = 0; i < 8; i++) beat(r, i, 10 + i * 0.5);
  beat(r, 8, 17.5);                                      // пауза 4 с на одну долю
  assert.ok(Math.abs(r.m.grid().p - 0.5) < 1e-9, `p ${r.m.grid().p}`);
});

// ---------- резкий прыжок темпа больше чем вдвое (шаг темпа в DAW) ----------
const jump = (from, to) => {
  const r = rig();
  let t = 10, n = 0;
  for (; n < 8; n++, t += 60 / from) beat(r, n, t, from);
  for (let k = 0; k < 3; k++, n++, t += 60 / to) beat(r, n, t, to);
  return { r, n, t };
};
test('an abrupt tempo jump over 2x is picked up within 3 beats', () => {
  for (const [from, to] of [[120, 250], [200, 86]]) {
    const { r, n, t } = jump(from, to);
    assert.ok(Math.abs(r.m.grid().p - 60 / to) < 1e-6, `${from}→${to}: p ${r.m.grid().p}`);
    assert.ok(Math.abs(stepTime(r.m.grid(), 4 * n, 4) - t) < 1e-6, `${from}→${to}: next beat on the grid`);
  }
});
test('two outliers that disagree do not change p', () => {
  const r = rig();
  for (let i = 0; i < 8; i++) beat(r, i, 10 + i * 0.5);
  beat(r, 8, 15.5); beat(r, 9, 15.6);                      // пауза 2 с, потом 0.1 с — не новый темп
  assert.ok(Math.abs(r.m.grid().p - 0.5) < 1e-9, `p ${r.m.grid().p}`);
});

// Web MIDI: байты часов → те же сообщения, что шлёт оболочка iOS
const clock = () => { const out = []; return { out, p: clockParser((m, at) => out.push({ ...m, at })) }; };
const ticks = (c, from, n, bpm = 120) => { const d = 60 / bpm / 24; for (let i = 0; i < n; i++) c.p(0xF8, from + i * d); return from + n * d; };

test('clock parser: one message per beat, tempo from the ticks', () => {
  const c = clock();
  let t = ticks(c, 0, 48);                                // стоят: только темп, раз в долю
  assert.deepEqual(c.out.map((m) => m.t), ['tempo', 'tempo']);
  assert.equal(c.out[0].bpm, 0);                          // меньше доли тиков — темп неизвестен
  c.p(0xFA, t); t = ticks(c, t, 48);
  const beats = c.out.filter((m) => m.t === 'beat');
  assert.deepEqual(beats.map((m) => m.n), [0, 1]);
  assert.ok(Math.abs(beats[0].bpm - 120) < 1e-6 && Math.abs(beats[1].at - (t - 24 * 60 / 120 / 24)) < 1e-9);
  c.p(0xFC, t); c.p(0xFB, t + 1);                         // Stop, Continue — счёт долей не сброшен
  ticks(c, t + 1, 1);
  assert.deepEqual(c.out.slice(-3).map((m) => m.t), ['stop', 'start', 'beat']);
  assert.equal(c.out.at(-1).n, 2);
});

test('clock parser: a gap over 0.5 s forgets the old tempo', () => {
  const c = clock();
  let t = ticks(c, 0, 48, 120);
  c.p(0xFA, t + 2); ticks(c, t + 2, 25, 90);
  const b = c.out.filter((m) => m.t === 'beat');
  assert.equal(b[0].bpm, 0);                              // после паузы тиков ещё нет
  assert.ok(Math.abs(b[1].bpm - 90) < 1e-6, `tempo after the gap: ${b[1].bpm}`);
});

test('a first beat with unknown tempo waits for the next one, tempo 0 is never set', () => {
  const w = fake({ bpm: 100 }), r = rig([w]);
  r.t = 10; r.m.message({ t: 'tempo', bpm: 0, ago: 0 });
  r.m.message({ t: 'start', ago: 0 });
  beat(r, 0, 10, 0);
  assert.equal(r.m.grid(), null);
  assert.ok(!w.calls.some(([k, b]) => k === 'set' && !(b > 0)));
  beat(r, 1, 10.5, 120);
  assert.ok(Math.abs(r.m.grid().t0 - 10) < 1e-9 && Math.abs(r.m.grid().p - 0.5) < 1e-9);
});
