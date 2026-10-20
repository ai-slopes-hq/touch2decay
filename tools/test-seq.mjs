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

test('keyNotes', () => {
  assert.deepEqual(Array.from(C.keyNotes(110, [0, 3, 5, 7, 10], 0)), [12, 15, 17, 19, 22, 24, 27, 29]);
  assert.deepEqual(Array.from(C.keyNotes(55, [0, 3, 5, 7, 10], 0)), [0, 3, 5, 7, 10, 12, 15, 17]);
  const minorC = [0, 2, 3, 5, 7, 8, 10].map((s) => (s + 3) % 12);
  const k = Array.from(C.keyNotes(110, minorC, 3));
  assert.equal(k[0], 3);
  assert.equal(k.length, 8);
  k.forEach((n) => assert.ok(minorC.includes(n % 12), `in the scale: ${n}`));
});

test('twistOrPinch', () => {
  assert.equal(C.twistOrPinch(0, 0.35, 100, 105), 'twist');
  assert.equal(C.twistOrPinch(0, 0.05, 100, 160), 'pinch');
  assert.equal(C.twistOrPinch(0, 0.05, 100, 105), null);
  assert.equal(C.twistOrPinch(3.1, -3.1, 100, 100), null);   // через ±180°: ≈4.6°, а не 355°
});
