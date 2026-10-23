// Служба MIDI-часов хоста: сетка долей, раздача пуска/стопа/темпа (host/midi.js, чистый Node).
//   node --test tools/test-midi.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMidi, due, stepTime } from '../host/midi.js';

const fake = (o = {}) => {
  const w = { calls: [], bpm: o.bpm ?? 120, on: !!o.playing };
  w.tempo = {
    get: () => w.bpm, set: (b) => { w.bpm = b; w.calls.push(['set', b]); },
    play: (on) => { w.on = on; w.calls.push(['play', on]); }, playing: () => w.on,
    armed: o.armed === undefined ? undefined : () => o.armed,
  };
  return w;
};
const rig = (ws = []) => {
  const r = { t: 10 };
  r.m = createMidi({ worlds: () => ws, now: () => r.t });
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
  const r = rig([a]);
  r.m.message({ t: 'start', ago: 0 });
  assert.equal(r.m.grid(), null);
  assert.deepEqual(a.calls, []);
  beat(r, 0, 10.2);
  assert.ok(Math.abs(r.m.grid().t0 - 10.2) < 1e-9);
  assert.deepEqual(a.calls.filter((c) => c[0] === 'play'), [['play', true]]);
});

test('start runs armed, playing and stopped-by-midi worlds only', () => {
  const w1 = fake({ armed: true }), w2 = fake({ armed: false, playing: true }), w3 = fake({ armed: false }), w4 = fake({ armed: false });
  const r = rig([w1, w2, w3, w4]);
  r.m.message({ t: 'stop', ago: 0 });                      // прошлый Stop: останавливает только 2
  assert.equal(w2.on, false);
  w4.on = true;                                            // 4 включили руками после Stop: не в наборе, но играет
  r.m.message({ t: 'start', ago: 0 });
  beat(r, 0, 10);
  const ran = (w) => w.calls.some((c) => c[0] === 'play' && c[1] === true);
  assert.deepEqual([w1, w2, w3, w4].map(ran), [true, true, false, true]);
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
  const r = rig([a]);
  r.m.message({ t: 'stop', ago: 0 });
  beat(r, 3, 10);
  assert.equal(r.m.grid(), null); assert.deepEqual(a.calls, []);
  r.m.message({ t: 'start', ago: 0 });
  beat(r, 0, 11);
  assert.ok(r.m.grid()); assert.equal(a.on, true);
});
