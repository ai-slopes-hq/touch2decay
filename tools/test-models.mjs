// Тесты моделей миров (worlds/<мир>/model.js) в Node без браузера: модель — только данные и алгоритм,
// без DOM, canvas и Web Audio, поэтому импортируется как есть. Миры появятся с шага 4 docs/refactor-plan.md.
//   node --test tools/test-models.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SL, slAdd, slFind, slRemove, slTick } from '../host/sl.js';

test.todo('Firmamentum: stars, comet, snapshot → restore (step 4)');

// LFO строк (host/sl.js): база — значение строки, качание ±depth/2 вокруг неё, снять — вернуть базу
test('LFO строки: ramp up вокруг базы, снятие возвращает базу', () => {
  const vals = { cut: 0.5 };
  const S = { lfo: { id: 'fx99', shapes: 'random' }, get: (k) => vals[k], set: (k, v) => { vals[k] = v; } };
  const e = slAdd(S, 'cut');
  assert.equal(slAdd(S, 'cut'), e);                 // вторая строка с тем же ключом — тот же LFO
  assert.equal(e.base, 0.5);
  e.spec.morph = 0; e.spec.rate = 1; e.spec.depth = 0.4;   // morph 0 — ramp up
  slTick(0.25);                                     // четверть периода: 2·0.25 − 1 = −0.5 → 0.5 − 0.2·0.5
  assert.ok(Math.abs(vals.cut - 0.4) < 1e-9, vals.cut);
  slTick(0.5);                                      // три четверти: +0.5 → 0.6
  assert.ok(Math.abs(vals.cut - 0.6) < 1e-9, vals.cut);
  assert.ok(Math.abs(e.spec.ph - 0.75) < 1e-9);
  slRemove(e);
  assert.equal(vals.cut, 0.5);
  assert.equal(slFind('fx99', 'cut'), undefined);
  assert.equal(SL.length, 0);
});
