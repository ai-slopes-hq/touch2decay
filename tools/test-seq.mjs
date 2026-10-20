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
