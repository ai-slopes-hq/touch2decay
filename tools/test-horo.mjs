// Тесты колеса Horologium без браузера: horo-worklet.js грузится в vm с заглушками AudioWorklet.
//   node --test tools/test-horo.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../horo-worklet.js', import.meta.url), 'utf8');
const FS = 48000, BLK = 128;

function seeded(seed = 12345) {
  const m = Object.create(Math);
  m.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return m;
}
function load() {
  const posted = [], reg = {};
  const ctx = {
    sampleRate: FS, currentTime: 0, Math: seeded(), Float32Array, Array, Object, Number,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (m) => posted.push(m), onmessage: null }; } },
    registerProcessor: (name, cls) => { reg[name] = cls; },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, posted, reg };
}
function horo(over = [2, 3, 5, 7], under = [4], F = 0.5) {
  const { ctx, posted, reg } = load();
  const proc = new reg.horo();
  const send = (data) => proc.port.onmessage({ data });
  const rings = Array.from({ length: 8 }, (_, i) => ({ on: over.includes(i + 2) || under.includes(i + 2), under: under.includes(i + 2) }));
  send({ t: 'set', rings, F, chance: 1 });
  return { proc, send, posted, ctx };
}
// прогнать секунды звука, двигая currentTime поблочно
function run(h, seconds) {
  for (let n = 0; n < Math.round((seconds * FS) / BLK); n++) {
    h.proc.process([], [[new Float32Array(BLK), new Float32Array(BLK)]], {});
    h.ctx.currentTime += BLK / FS;
  }
}
const wrap = (x) => x - Math.floor(x + 0.5);
const hitsPerRing = (h) => { const c = Array(8).fill(0); for (const m of h.posted) if (m.t === 'p') for (const i of m.hits) c[i]++; return c; };

test('lockRate pulls the wheel phase to the bar', () => {
  const { ctx } = load(), lock = { t0: 0, bar: 2 }, rate = (P) => ctx.lockRate(wrap((1 - lock.t0) / lock.bar - P));   // ошибка фазы считается один раз (в процессоре), здесь — как там
  assert.ok(rate(0.48) > 1, 'behind -> faster');
  assert.ok(rate(0.52) < 1, 'ahead -> slower');
  assert.equal(rate(0.5), 1);
  assert.equal(rate(0.1), 1.03, 'clamped');
  assert.equal(rate(0.9), 0.97, 'clamped');
});

test('lock-on snaps the phase once; small t0 updates and tempo nudges do not jump P', () => {
  const h = horo([2], [], 0);
  h.proc.P = 7.37;
  h.ctx.currentTime = 1;
  h.send({ t: 'lock', t0: 0.5, bar: 2 });          // фаза такта (1 − 0.5)/2 = 0.25
  run(h, 0.01);
  assert.ok(Math.abs(wrap(h.proc.P - 0.25)) < 1e-3, `snap: ${h.proc.P}`);
  assert.equal(Math.round(h.proc.P - 0.25), 7, 'nearest revolution');
  const P1 = h.proc.P;
  h.send({ t: 'lock', t0: 0.51, bar: 2 });          // обычный сдвиг сетки от сглаживания — 10 мс = 0.005 оборота
  run(h, 0.01);
  assert.equal(h.proc.P, P1, 'P stands: F = 0 and no snap');
  h.send({ t: 'lock', off: true });
  h.proc.P += 0.3;                                  // увели руками — при выключенном замке не возвращаем
  const P2 = h.proc.P; run(h, 0.01);
  assert.equal(h.proc.P, P2);
  const tOn = h.ctx.currentTime;
  h.send({ t: 'lock', t0: 0.5, bar: 2 });           // снова включили — снова один щелчок к фазе
  run(h, 0.01);
  assert.ok(Math.abs(wrap(h.proc.P - (tOn - 0.5) / 2)) < 1e-3, `re-snap: ${h.proc.P}`);
});

test('a phase error above 0.1 revolution snaps', () => {
  const h = horo([2], [], 0);
  h.ctx.currentTime = 1;
  h.send({ t: 'lock', t0: 0.5, bar: 2 });
  run(h, 0.01);
  h.proc.P += 0.2;
  const tNow = h.ctx.currentTime;
  run(h, 0.01);
  assert.ok(Math.abs(wrap(h.proc.P - (tNow - 0.5) / 2)) < 1e-3, `back: ${h.proc.P}`);
});

test('the wheel phase follows the bar even when the tempo is off', () => {
  const h = horo([2, 3], [], 0.51);                 // колесо чуть быстрее такта (2 %)
  h.send({ t: 'lock', t0: 0, bar: 2 });
  run(h, 8);
  const err = Math.abs(wrap(h.ctx.currentTime / 2 - h.proc.P));
  assert.ok(err < 0.03, `phase error ${err}`);       // без замка за 8 с набежало бы 0.08 оборота
});

test('ring ratios hold under the lock', () => {
  const h = horo([2, 3, 5, 7], [4], 0.5);
  h.send({ t: 'lock', t0: 0, bar: 2 });
  run(h, 8);
  const c = hitsPerRing(h);
  for (const n of [2, 3, 5, 7]) assert.ok(Math.abs(c[n - 2] - n * 4) <= 1, `ring ${n}: ${c[n - 2]}`);
  assert.ok(Math.abs(c[2] - 12) <= 1, `12/4: ${c[2]}`);
});

test('a lock with bar <= 0 is ignored (wheel phase stays finite)', () => {
  for (const bar of [0, -2]) {
    const h = horo([2], [], 0.5);
    h.send({ t: 'lock', t0: 0, bar });
    run(h, 0.2);
    assert.ok(Number.isFinite(h.proc.P) && h.proc.lock === null, `bar ${bar}: P ${h.proc.P}`);
  }
});
