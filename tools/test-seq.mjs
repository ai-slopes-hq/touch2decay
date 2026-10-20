// Тесты помощников секвенсера Cymatica без браузера: cymatica.js грузится в vm с заглушками хозяина.
//   node --test tools/test-seq.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../cymatica.js', import.meta.url), 'utf8');
const window = { t2d: {}, T2D: { registerWorld() {}, snapSemi: (s) => s } };
const ctx = { window, document: { currentScript: null }, location: { href: 'http://x/' }, Math, Float32Array, Float64Array, Array, Object, JSON, Number, Map, Set };
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const C = window.t2d.cym.core;
const plain = (a) => Array.from(a, (x) => !!x);

test('euclid', () => {
  assert.deepEqual(plain(C.euclid(3, 8)), [true, false, false, true, false, false, true, false]);
  const e = plain(C.euclid(5, 8));
  assert.equal(e.filter(Boolean).length, 5);
  assert.equal(e[0], true);
  assert.ok(plain(C.euclid(0, 4)).every((x) => !x));
  assert.ok(plain(C.euclid(4, 4)).every((x) => x));
});

test('nearestStep', () => {
  assert.equal(C.nearestStep(1000 + 0.4 * 125, 1000, 3, 125, 16), 3);
  assert.equal(C.nearestStep(1000 + 0.6 * 125, 1000, 3, 125, 16), 4);
  assert.equal(C.nearestStep(1000 + 0.6 * 125, 1000, 15, 125, 16), 0);
});

test('walkMelody', () => {
  const list = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  const w = Array.from(C.walkMelody(7, 12, list));
  assert.equal(w.length, 7);
  w.forEach((s) => assert.ok(list.includes(s), `in the scale: ${s}`));
  for (let i = 1; i < w.length; i++) assert.ok(Math.abs(list.indexOf(w[i]) - list.indexOf(w[i - 1])) <= 2, 'small steps');
});

const seq16 = () => Array.from({ length: 16 }, (_, i) => i);

test('rotateSteps', () => {
  assert.deepEqual(Array.from(C.rotateSteps(seq16(), 16, 2)), [14, 15, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual(Array.from(C.rotateSteps(seq16(), 4, 1)), [3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.deepEqual(Array.from(C.rotateSteps(seq16(), 4, -1)), [1, 2, 3, 0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
});

test('transposeMelody', () => {
  const list = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
  const steps = [12, null, 15, ...Array(13).fill(null)];
  assert.deepEqual(Array.from(C.transposeMelody(steps, 2, list)).slice(0, 3), [17, null, 19]);
  assert.equal(C.transposeMelody(steps, 99, list)[0], 24);
  assert.equal(C.transposeMelody(steps, -99, list)[2], 0);
});

test('twistOrPinch', () => {
  assert.equal(C.twistOrPinch(0, 0.35, 100, 105), 'twist');
  assert.equal(C.twistOrPinch(0, 0.05, 100, 160), 'pinch');
  assert.equal(C.twistOrPinch(0, 0.05, 100, 105), null);
  assert.equal(C.twistOrPinch(3.1, -3.1, 100, 100), null);   // через ±180°: ≈4.6°, а не 355°
});

test('snapToGrid', () => {
  assert.equal(C.snapToGrid(3, 2, 16), 4);
  assert.equal(C.snapToGrid(5, 4, 16), 4);
  assert.equal(C.snapToGrid(15, 4, 16), 0);             // по кругу
  assert.equal(C.snapToGrid(6, 4, 7), 0);               // длина не кратна сетке: ближайшая доля по кругу
  assert.equal(C.snapToGrid(5, 1, 16), 5);
});

test('quantizeRhythm', () => {
  const h = (n) => ({ x: n, y: 0, vel: 1 });
  const s = Array(16).fill(null); s[1] = h(1); s[2] = h(2); s[7] = h(7); s[12] = h(12);
  const q = Array.from(C.quantizeRhythm(s, 8, 4));
  assert.deepEqual(q.map((x, i) => (x ? i : -1)).filter((i) => i >= 0), [0, 4, 12]);   // 1→0, 2→4, 7→8→0 занято; 12 — за длиной, не трогается
  assert.equal(q[0].x, 1);                                // в занятое гнездо встаёт первый
});

const list5 = Array.from({ length: 61 }, (_, s) => s).filter((s) => [0, 3, 5, 7, 10].includes(s % 12));

test('noteList and degPerOct without a scale: minor pentatonic up to 60', () => {
  assert.deepEqual(Array.from(C.noteList()), list5);
  assert.equal(C.degPerOct(), 5);
});

test('cellIdx: sectors from the top clockwise, rings by area, centre is the top ring', () => {
  assert.equal(C.cellIdx(0, -0.95, 2, 5), 2);           // верх, край — кольцо 0, сектор 0
  assert.equal(C.cellIdx(0.95, 0, 2, 5), 3);            // справа — 90°, сектор 1
  assert.equal(C.cellIdx(0, 0, 2, 5), 12);              // центр — кольцо 2
  assert.equal(C.cellIdx(0, 0.7, 2, 5), 2 + 5 + 2);     // низ, середина — кольцо 1, сектор 2
  assert.equal(C.cellIdx(0, 1.2, 2, 5), null);          // за краем пластины
});

test('noteAt: note of the cell, null beyond the list', () => {
  assert.equal(C.noteAt(0, -0.95, 2, 5, list5), list5[2]);
  assert.equal(C.noteAt(0, 0, list5.length - 3, 5, list5), null);
  assert.equal(C.noteAt(0, 1.2, 2, 5, list5), null);
});

test('cellOf and cellCenter round trip', () => {
  for (const n of [5, 7, 12]) {
    for (let idx = 2; idx < 2 + 3 * n; idx++) {
      const c = C.cellOf(idx, 2, n), p = C.cellCenter(c.ring, c.sector, n);
      assert.equal(C.cellIdx(p.x, p.y, 2, n), idx, `n=${n} idx=${idx}`);
    }
  }
  assert.equal(C.cellOf(1, 2, 5), null);
  assert.equal(C.cellOf(17, 2, 5), null);
});

test('transposeHits: k steps up, hit moves to the new cell, clamped to the rings', () => {
  const t = Array.from(C.transposeHits([{ x: 0, y: -0.95, vel: 0.7 }, null], 2, 2, 5, list5));
  assert.equal(C.cellIdx(t[0].x, t[0].y, 2, 5), 4);
  assert.equal(t[0].vel, 0.7);
  assert.equal(t[1], null);
  const u = C.transposeHits([{ x: 0, y: -0.95, vel: 1 }], 99, 2, 5, list5)[0];
  assert.equal(C.cellIdx(u.x, u.y, 2, 5), 16);
  const v = C.transposeHits([{ x: 0, y: -0.95, vel: 1 }], -99, 2, 5, list5)[0];
  assert.equal(C.cellIdx(v.x, v.y, 2, 5), 2);
});
