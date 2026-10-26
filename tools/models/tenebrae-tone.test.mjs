// Формулы звука Tenebrae (worlds/tenebrae/tone.js) = числа старого кода из app.js до переноса.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignCoeffs, beatHz, cutoffOf, freqOf, shiftHz, waveCoeffs } from '../../worlds/tenebrae/tone.js';
import { WAVES } from '../../host/waves.js';

const near = (a, b, e) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b} (±${e})`);
const OFF = { on: false, inScale: () => true };

test('shiftHz: края и мёртвая зона', () => {
  assert.equal(shiftHz(0.5), 0); assert.equal(shiftHz(0.51), 0);
  near(shiftHz(1), 1500, 1e-9); near(shiftHz(0), -1500, 1e-9);
  const old = [[0, -1500], [0.25, -27.5584843568271], [0.49, 0], [0.52, 1.6270977400466388e-16], [0.75, 27.5584843568271], [1, 1500]];
  for (const [t, hz] of old) near(shiftHz(t), hz, 1e-12);
});

test('cutoffOf / freqOf / beatHz = старый код', () => {
  const cuts = [[0, 0.5, 0, 40], [1, 0.5, 0, 18000], [0.68, 0, 0, 535.7066166038331], [0.68, 1, 1, 20000]];
  for (const [c, y, fm, hz] of cuts) near(cutoffOf(c, y, fm), hz, 1e-9);
  near(freqOf(0, OFF), 55, 1e-9); near(freqOf(0.5, OFF), 195.55990961719434, 1e-9); near(freqOf(1, OFF), 1760, 1e-9);
  assert.equal(beatHz(3.5), 3.5);       // в app.js beat хранится в Гц: c2 = f + beat
});

test('freqOf: лад подтягивает к ноте', () => {
  const on = { on: true, inScale: (n) => n % 12 === 0 };   // только ноты A
  near(freqOf(0.5, on), 220, 1e-9);                        // 21.9 полутона → ближайшая A, 24
});

const LEVELS = [0.44281316711356045, 0.3433958454022937, 0.5170390267134094, 0.31600616540941445, 0.3692910356736056, 0.48500624427132627, 0.3035786553761644, 0.3394111131373871, 0.46040448690660135];
const W = WAVES.map((w) => waveCoeffs(w.fn));

test('waveCoeffs: level всех форм и гармоники пилы = старый makeWave', () => {
  assert.equal(W.length, 9);
  LEVELS.forEach((l, i) => near(W[i].level, l, 1e-12));
  const s = W[2];
  assert.equal(s.re.length, 220);
  near(s.re[1], -0.11190665233704732, 1e-12); near(s.im[1], -0.49507745376429213, 1e-12);
  near(s.re[7], -0.003955298346632679, 1e-12); near(s.im[7], -0.07415036856137089, 1e-12);
});

test('alignCoeffs: модуль своей гармоники, фаза пилы', () => {
  const al = alignCoeffs(W);
  for (let i = 0; i < W.length; i++) {
    for (let h = 1; h < 220; h++) {
      const m = Math.hypot(W[i].re[h], W[i].im[h]);
      near(Math.hypot(al[i].re[h], al[i].im[h]), m, 1e-12);
      if (m > 1e-9) near(Math.atan2(al[i].im[h], al[i].re[h]), Math.atan2(W[2].im[h], W[2].re[h]), 1e-9);
    }
  }
});
