// Тесты модели Goetia (worlds/goetia/model.js) в Node: печать → программа bytebeat, духи в треугольниках, снимок, кубик.
//   node --test tools/models/goetia.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel, SMAX, NODES, progOf, formula, numOf, spiritOf, trigOf } from '../../worlds/goetia/model.js';
import { seeded } from './util.mjs';

test('Goetia: печать (знаки по порядку) → программа, формула, имя духа и удар', () => {
  const path = [1, 0, 5];                                // & V, | VIII, − IV
  assert.deepEqual(progOf(path), [['&', 5], ['|', 8], ['-', 4]]);
  assert.equal(formula(path), 't*((t>>5|t>>8)-(t>>4))');
  assert.equal(spiritOf({ path }).name, 'Glasya-Labolas');
  assert.equal(numOf(path), numOf([...path]));           // детерминированно
  assert.equal(trigOf({ path }), 9);                     // не чаще бита IX
  assert.equal(trigOf({ path: [2, 4] }), 11);
  assert.deepEqual(progOf([3, 6, 2, 7]), [['+', 6], ['%', 9], ['^', 10], ['>', 7]]);
  assert.equal(formula([3, 6, 2, 7]), 't*(((t>>6%(t>>9))^t>>10)>>(t>>7&7))');
  assert.equal(formula([]), '');
  assert.equal(NODES.length, 8);
  const m = createModel(), ev = [];
  m.listen((e) => ev.push(e));
  const s = m.summon(path);
  assert.deepEqual(progOf(s.path), progOf(path));
  assert.deepEqual(ev.map((e) => [e.t, e.on, !!e.added]), [['spirit', true, true]]);
  m.setSpirit(s, { path: [...path, 2] });                // дописали узел — та же душа, новая программа
  assert.deepEqual(progOf(s.path).at(-1), ['^', 10]);
  assert.equal(ev.at(-1).s, s); assert.equal(ev.at(-1).added, undefined);
});

test('Goetia: высота — скорость t, лад — ступени', () => {
  const m = createModel();
  const s = m.summon([0, 1], { semi: 12 });
  assert.equal(m.rate(s), 128 * 55 * 2);
  const q = createModel({ scale: { on: true, snap: (x) => x - (x % 2) } });   // лад: только чётные ступени
  const t = q.summon([0, 1], { semi: 7 });
  assert.equal(q.semi(t), 6);
});

test('Goetia: духов не больше трёх — четвёртый изгоняет самого старого', () => {
  const m = createModel(), ev = [];
  m.listen((e) => ev.push(e));
  for (const p of [[0, 1], [2, 3], [4, 5]]) m.summon(p);
  assert.deepEqual(m.state.spirits.map((s) => s.slot), [0, 1, 2]);
  const s4 = m.summon([6, 7]);
  assert.equal(m.state.spirits.length, SMAX);
  assert.equal(s4.slot, 0);
  assert.deepEqual(m.state.spirits.map((s) => s.path[0]).sort(), [2, 4, 6]);
  assert.deepEqual(ev.slice(-2).map((e) => `${e.s.path[0]}${e.on ? '+' : '-'}`), ['0-', '6+']);
  const born = m.state.spirits.map((s) => s.born);
  assert.equal(new Set(born).size, 3);
  m.summon([1, 2]);                                      // следующий — снова старший: [2, 3]
  assert.deepEqual(m.state.spirits.map((s) => s.path[0]).sort(), [1, 4, 6]);
});

test('Goetia: изгнать — слот свободен, тишина', () => {
  const m = createModel(), ev = [];
  m.listen((e) => ev.push(e));
  const a = m.summon([0, 1]), b = m.summon([2, 3]);
  m.banish(a);
  assert.deepEqual(m.state.spirits, [b]);
  assert.equal(ev.at(-1).s, a); assert.equal(ev.at(-1).on, false);
  assert.equal(m.summon([4, 5]).slot, 0);
  m.setSpirit(a, { semi: 5 });                           // изгнанного не трогать
  assert.equal(a.semi, 0);
  m.clear();
  assert.ok(!m.sounding());
});

test('Goetia: снимок → восстановление — тот же JSON', () => {
  const js = '{"s":[{"slot":0,"path":[1,0,5],"semi":0,"tone":0.45,"rel":1,"legio":2,"lvl":0.7},{"slot":1,"path":[3,6,2,7],"semi":7,"tone":0.35,"rel":0.3,"legio":1,"lvl":0.7}],"fx":{"legio":0.35,"echo":0.2,"spread":0.6,"hall":0.4}}';
  const m = createModel(), ev = [];
  m.listen((e) => ev.push(e));
  m.summon([2, 4, 6]);
  m.restore(js);
  assert.equal(m.snapshot(), js);
  assert.equal(ev.at(-1).t, 'fx');
  const n = createModel(); n.restore(m.snapshot()); assert.equal(n.snapshot(), js);
  const old = createModel(); old.restore('{"s":[{"slot":0,"path":[0,1],"semi":0,"tone":0.5,"legio":1,"lvl":0.8}],"fx":{"legio":0.1,"echo":0,"spread":0,"hall":0}}');
  assert.equal(old.state.spirits[0].rel, 1);              // старый снимок без release — дрон
});

test('Goetia: кубик с зерном повторяем — 2–3 духа, печати 3–5 разных узлов', () => {
  const a = createModel({ rng: seeded(7) }), b = createModel({ rng: seeded(7) });
  a.dice(); b.dice();
  assert.equal(a.snapshot(), b.snapshot());
  for (let k = 0; k < 20; k++) {
    a.dice();
    const ss = a.state.spirits;
    assert.ok(ss.length >= 2 && ss.length <= 3);
    for (const s of ss) { assert.ok(s.path.length >= 3 && s.path.length <= 5); assert.equal(new Set(s.path).size, s.path.length); assert.ok([-12, -5, 0, 7, 12].includes(s.semi)); }
  }
});
