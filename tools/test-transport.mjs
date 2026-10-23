// Сверка транспорта ядра (core/sdk/transport.hpp в хосте t2d.wasm) с прежним JS (tools/ref/midi.js — clockParser + createMidi):
// одни и те же байты MIDI-часов с теми же отметками времени → та же сетка {t0, p} после каждого блока (1e-9) и запуск миров на той же
// доле (событие LAUNCH ядра — там, где эталон звал play). Время идёт блоками по 128 сэмплов; байты блока доходят в его начале.
//   core/build.sh && node --test tools/test-transport.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockParser, createMidi } from './ref/midi.js';
import { loadT2d } from './t2d-core.mjs';
import { seeded } from './models/util.mjs';

const SR = 48000, DT = 128 / SR, EV = ['', 'start', 'stop', 'tempo', 'beat', 'launch'];

function ticks(from, bpm, beats, { jitter = 0, rng = seeded(3) } = {}) {   // 0xF8 от from: 24 на долю
  const out = [], step = 60 / bpm / 24;
  for (let k = 0; k < beats * 24; k++) out.push([0xF8, from + k * step + (jitter ? (rng() - 0.5) * 2 * jitter : 0)]);
  return out;
}

function run(bytes, until) {                            // → по блокам: сетка эталона и ядра, запуски эталона, события ядра
  bytes = bytes.slice().sort((a, b) => a[1] - b[1]);
  let now = 0;
  const launches = [], world = { tempo: { bpm: 0, on: false, get: () => world.tempo.bpm, set: (b) => { world.tempo.bpm = b; }, play: (on) => { world.tempo.on = on; if (on) launches.push(now); }, playing: () => world.tempo.on, armed: () => true } };
  const midi = createMidi({ worlds: () => [world], now: () => now, current: () => world });
  const parse = clockParser((m, at) => midi.message({ ...m, ago: now - at }));
  const c = loadT2d(); c.init(SR, 1);
  const x = c.exports, mb = () => new Float64Array(x.memory.buffer, x.t2d_mbuf(), 512);
  const out = { grids: [], launches, coreLaunch: [], coreEv: [] };
  let j = 0;
  for (let b = 0; b * DT < until; b++) {
    now = b * DT;
    x.t2d_time(now);
    while (j < bytes.length && bytes[j][1] < now) {     // байты, пришедшие до начала блока
      const [s, at] = bytes[j++];
      parse(s, at);
      x.t2d_midi_byte(0, s, at);
    }
    midi.tick();
    c.process(128);
    const n = x.t2d_hevents(), e = Array.from(mb().subarray(0, n));
    for (let i = 0; i < n; i += 2) { out.coreEv.push([EV[e[i]], e[i + 1], now]); if (e[i] === 5) out.coreLaunch.push(now); }
    x.t2d_time(now);                                    // сетка — на начало блока, как видит её эталон
    const hn = x.t2d_hmirror(), h = Array.from(mb().subarray(0, hn)), g = midi.grid();
    out.grids.push({ now, ref: g ? [g.t0, g.p] : null, core: h[0] ? [h[1], h[2]] : null });
  }
  return out;
}
function sameGrids(o, what) {
  for (const { now, ref, core } of o.grids) {
    assert.equal(!!core, !!ref, `${what} @${now.toFixed(4)}: grid ${ref ? 'on' : 'off'} in the reference, ${core ? 'on' : 'off'} in the core`);
    if (ref) for (let k = 0; k < 2; k++) assert.ok(Math.abs(ref[k] - core[k]) < 1e-9, `${what} @${now.toFixed(4)}: ${['t0', 'p'][k]} ${core[k]} vs ${ref[k]}`);
  }
  assert.deepEqual(o.coreLaunch.map((t) => t.toFixed(6)), o.launches.map((t) => t.toFixed(6)), `${what}: launches`);
}

test('steady clock with jitter: Start, 8 beats — same grid, one launch on the first beat', () => {
  const o = run([[0xFA, 0.995], ...ticks(1, 120, 8, { jitter: 0.001 })], 5.2);
  sameGrids(o, 'steady');
  assert.equal(o.launches.length, 1);
  assert.ok(o.grids.some((g) => g.core), 'grid appears');
  assert.ok(o.coreEv.some((e) => e[0] === 'start') && o.coreEv.filter((e) => e[0] === 'beat').length >= 7);
});

test('Stop ×3 (Elektron), then Start again — grid off after stop, back after start', () => {
  const o = run([[0xFA, 0.5], ...ticks(0.5, 120, 4), [0xFC, 2.51], [0xFC, 2.52], [0xFC, 2.53], ...ticks(2.6, 120, 2), [0xFA, 3.6], ...ticks(3.6, 120, 4)], 6);
  sameGrids(o, 'stops');
  assert.equal(o.launches.length, 2);
  assert.ok(o.coreEv.filter((e) => e[0] === 'stop').length === 3);
});

test('tempo jump over 2× (120 → 50 BPM) is taken within a few beats, same as the reference', () => {
  const o = run([[0xFA, 0.5], ...ticks(0.5, 120, 6), ...ticks(3.5, 50, 6)], 10.3);
  sameGrids(o, 'jump');
  const last = o.grids[o.grids.length - 1].core;
  assert.ok(last && Math.abs(last[1] - 1.2) < 0.01, `p ${last && last[1]}`);
});

test('late beat 20 ms, pause 0.6 s (tempo forgotten), clock lost after 1 s', () => {
  const t = ticks(0.5, 120, 6);
  t[48][1] += 0.02;                                     // доля 2 опоздала
  const o = run([[0xFA, 0.49], ...t, ...ticks(4.1, 120, 3), [0xFA, 6], ...ticks(6, 100, 3)], 10);
  sameGrids(o, 'late+lost');
  assert.ok(o.grids.some((g) => g.now > 4.02 && g.now < 4.5 && !g.core), 'lost after a second without beats');
});

test('ticks without Start only set the tempo: no grid, no launch', () => {
  const o = run(ticks(0.5, 97, 6), 3.6);
  sameGrids(o, 'tempo only');
  assert.ok(o.grids.every((g) => !g.core));
  assert.ok(o.coreEv.filter((e) => e[0] === 'tempo').length >= 5);
  const bpm = o.coreEv.filter((e) => e[0] === 'tempo').pop()[1];
  assert.ok(Math.abs(bpm - 97) < 0.01, `${bpm}`);
});

test('parsed beat messages from the iOS shell (t2d_midi_msg) build the same grid', () => {
  const c = loadT2d(); c.init(SR, 1); const x = c.exports;
  x.t2d_time(1); x.t2d_midi_msg(3, 0, 0, 0.99);         // START = 3 у MidiMsg::Type? — нет: NONE 0, BEAT 1, TEMPO 2, START 3, STOP 4
  for (let n = 0; n < 4; n++) { x.t2d_time(1 + n * 0.5 + 0.001); x.t2d_midi_msg(1, n, 120, 1 + n * 0.5); c.process(128); }
  const k = x.t2d_hmirror(), h = Array.from(new Float64Array(x.memory.buffer, x.t2d_mbuf(), k));
  assert.equal(h[0], 1); assert.ok(Math.abs(h[1] - 1) < 1e-9 && Math.abs(h[2] - 0.5) < 1e-9, `${h}`);
});
