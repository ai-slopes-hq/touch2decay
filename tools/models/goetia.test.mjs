// Тесты модели Goetia в Node: печать → программа bytebeat, духи в треугольниках, снимок, кубик.
// Каждый тест модели — дважды: против эталонной JS-модели (tools/ref/goetia-model.js) и против модели ядра (t2d.wasm) через фасад
// веба worlds/goetia/model.js (порт — goetia-core.mjs). Ниже — лад хоста в ядре и фасад на асинхронном порту (дух под пальцем).
//   core/build.sh && node --test tools/models/goetia.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel as jsModel, SMAX, NODES, progOf, formula, numOf, spiritOf, trigOf } from '../ref/goetia-model.js';
import * as facade from '../../worlds/goetia/model.js';
import { createModel as coreModel, SLOT, ACT } from './goetia-core.mjs';
import { hostScale } from './sdk-facade.mjs';
import { seeded, near } from './util.mjs';

const FACTORIES = {
  js: ({ seed = 1, rng, scale } = {}) => jsModel({ rng: rng || seeded(seed), ...(scale ? { scale } : {}) }),
  core: ({ seed = 1, rng, async } = {}) => coreModel({ seed, rng, async }),
};

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
  for (const k of ['NODES', 'SPIRITS', 'FX_DEF', 'SMAX', 'PMAX']) assert.deepEqual(facade[k], { NODES, SMAX, PMAX: 8, FX_DEF: facade.FX_DEF, SPIRITS: facade.SPIRITS }[k], k);
  for (const p of [path, [3, 6, 2, 7], [0, 1, 2, 3, 4, 5, 6, 7]]) {   // чистые функции фасада — те же, что у эталона
    assert.equal(facade.formula(p), formula(p)); assert.equal(facade.numOf(p), numOf(p)); assert.deepEqual(facade.progOf(p), progOf(p));
  }
});

for (const [name, make] of Object.entries(FACTORIES)) {
  test(`Goetia [${name}]: призыв — программа печати, дописанный узел — та же душа`, () => {
    const m = make(), ev = [];
    m.listen((e) => ev.push(e));
    const path = [1, 0, 5], s = m.summon(path);
    assert.deepEqual(progOf(s.path), progOf(path));
    assert.deepEqual(ev.map((e) => [e.t, e.on, !!e.added]), [['spirit', true, true]]);
    m.setSpirit(s, { path: [...path, 2] });              // дописали узел — та же душа, новая программа
    assert.deepEqual(progOf(s.path).at(-1), ['^', 10]);
    assert.equal(ev.at(-1).s, s); assert.equal(ev.at(-1).added, undefined);
  });

  test(`Goetia [${name}]: высота — скорость t`, () => {
    const m = make();
    const s = m.summon([0, 1], { semi: 12 });
    assert.equal(m.rate(s), 128 * 55 * 2);
  });

  test(`Goetia [${name}]: духов не больше трёх — четвёртый изгоняет самого старого`, () => {
    const m = make(), ev = [];
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
    m.summon([1, 2]);                                    // следующий — снова старший: [2, 3]
    assert.deepEqual(m.state.spirits.map((s) => s.path[0]).sort(), [1, 4, 6]);
  });

  test(`Goetia [${name}]: изгнать — слот свободен, тишина`, () => {
    const m = make(), ev = [];
    m.listen((e) => ev.push(e));
    const a = m.summon([0, 1]), b = m.summon([2, 3]);
    m.banish(a);
    assert.deepEqual(m.state.spirits, [b]);
    assert.equal(ev.at(-1).s, a); assert.equal(ev.at(-1).on, false);
    assert.equal(m.summon([4, 5]).slot, 0);
    m.setSpirit(a, { semi: 5 });                         // изгнанного не трогать
    assert.equal(a.semi, 0);
    m.clear();
    assert.ok(!m.sounding());
  });

  test(`Goetia [${name}]: снимок → восстановление — тот же JSON`, () => {
    const js = '{"s":[{"slot":0,"path":[1,0,5],"semi":0,"tone":0.45,"rel":1,"legio":2,"lvl":0.7},{"slot":1,"path":[3,6,2,7],"semi":7,"tone":0.35,"rel":0.3,"legio":1,"lvl":0.7}],"fx":{"legio":0.35,"echo":0.2,"spread":0.6,"hall":0.4}}';
    const m = make(), ev = [];
    m.listen((e) => ev.push(e));
    m.summon([2, 4, 6]);
    m.restore(js);
    assert.equal(m.snapshot(), js);
    assert.equal(ev.at(-1).t, 'fx');
    const n = make(); n.restore(m.snapshot()); assert.equal(n.snapshot(), js);
    const old = make(); old.restore('{"s":[{"slot":0,"path":[0,1],"semi":0,"tone":0.5,"legio":1,"lvl":0.8}],"fx":{"legio":0.1,"echo":0,"spread":0,"hall":0}}');
    assert.equal(old.state.spirits[0].rel, 1);            // старый снимок без release — дрон
  });

  test(`Goetia [${name}]: кубик с зерном повторяем — 2–3 духа, печати 3–5 разных узлов`, () => {
    const a = make({ rng: seeded(7) }), b = make({ rng: seeded(7) });
    a.dice(); b.dice();
    assert.equal(a.snapshot(), b.snapshot());
    for (let k = 0; k < 20; k++) {
      a.dice();
      const ss = a.state.spirits;
      assert.ok(ss.length >= 2 && ss.length <= 3);
      for (const s of ss) { assert.ok(s.path.length >= 3 && s.path.length <= 5); assert.equal(new Set(s.path).size, s.path.length); assert.ok([-12, -5, 0, 7, 12].includes(s.semi)); }
    }
  });
}

test('Goetia: лад — ступени (эталон с игрушечным ладом)', () => {
  const q = jsModel({ scale: { on: true, snap: (x) => x - (x % 2) } });   // лад: только чётные ступени
  const t = q.summon([0, 1], { semi: 7 });
  assert.equal(q.semi(t), 6);
});

test('Goetia: кубик фасада и кубик эталона с одним зерном — одна сцена, у ядра — она же', () => {
  for (const seed of [1, 42, 99]) {
    const a = FACTORIES.js({ seed }), b = FACTORIES.core({ seed });
    a.dice(); b.dice();
    assert.equal(b.snapshot(), a.snapshot());
    assert.equal(b.core.snapshot(SLOT), a.snapshot());
  }
});

test('Goetia [core]: кубик ядра (его rng) = кубик эталона с тем же зерном', () => {
  for (const seed of [3, 17]) {
    const a = FACTORIES.js({ seed }), b = coreModel({ seed });
    a.dice(); b.core.action(SLOT, ACT.dice);
    assert.equal(b.core.snapshot(SLOT), a.snapshot());
  }
});

test('Goetia [core]: лад хоста — rate фасада = rate эталона, ядро звучит той же высотой', () => {
  for (const [idx, root] of [[0, 0], [1, 3], [3, 7]]) {
    const sc = { on: true, idx, root };
    for (const semi of [-12, -5, 1, 4, 11]) {
      const m = coreModel({ scale: sc }), ref = jsModel({ scale: hostScale(sc) });   // свежий треугольник: у занятого скорость скользит к новой
      const s = m.summon([0, 1, 2], { semi }), r = ref.summon([0, 1, 2], { semi });
      assert.ok(near(m.rate(s), ref.rate(r)), `semi ${semi}`);
      const t0 = m.coreSpirit(s.born).t;
      m.tick(0.1);
      assert.ok(Math.abs((m.coreSpirit(s.born).t - t0) / 0.1 - m.rate(s)) < m.rate(s) * 0.01, 'the core counts t at that rate');
    }
  }
});

// ---------- фасад на асинхронном порту: как в вебе, зеркало приходит позже действий ----------
const facadeAsync = (seed = 1) => coreModel({ seed, async: true });

test('Goetia фасад: рисуемый дух — тот же объект после зеркала, печать в пути зеркало не перетирает', () => {
  const m = facadeAsync(), s = m.summon([1, 0]);
  m.tick(0.02);
  assert.equal(m.state.spirits[0], s, 'the same live object');
  assert.ok(s.t > 0 && s.gain > 0, 't and gain came with the mirror');
  m.setSpirit(s, { path: [1, 0, 5] });                  // ядро ещё на [1, 0]
  m.deliver();
  assert.deepEqual(s.path, [1, 0, 5], 'a stale mirror does not cut the seal');
  m.setSpirit(s, { path: [1, 0, 5, 2] }); m.tick(0.01);
  assert.deepEqual(m.coreSpirit(s.born).path, [1, 0, 5, 2]);
  const b = m.summon([3, 4]); m.deliver();
  assert.ok(m.state.spirits.includes(b), 'a spirit summoned here survives a mirror that has not seen it');
  m.banish(s); m.deliver();
  assert.ok(!m.state.spirits.includes(s) && m.state.spirits.length === 1, 'a spirit banished here does not come back');
  m.tick(0.01);
  assert.deepEqual(m.state.spirits.map((q) => q.born), m.coreBorns());
});

test('Goetia фасад: четвёртый дух без зеркала — старший уходит и в ядре, born совпадают', () => {
  const m = facadeAsync(2);
  for (const p of [[0, 1], [2, 3], [4, 5]]) m.summon(p);
  const d = m.summon([6, 7]);
  m.flush();
  assert.deepEqual(m.coreBorns(), m.state.spirits.map((s) => s.born));
  assert.equal(m.coreSpirit(d.born).slot, d.slot);
});

test('Goetia фасад: кубик / restore / новый узел — сразу summon без зеркала: born тот же в ядре, правка и изгнание попадают в него', () => {
  for (const how of ['dice', 'restore', 'rebind', 'clear']) {
    const m = facadeAsync(5);
    m.summon([0, 1, 2]); m.tick(0.01);
    if (how === 'dice') m.dice();
    else if (how === 'clear') m.clear();
    else if (how === 'restore') m.restore('{"s":[{"slot":0,"path":[3,6],"semi":7,"tone":0.3,"rel":1,"legio":2,"lvl":0.7}],"fx":{"echo":0.5}}');
    else m.rebind();
    const a = m.summon([5, 4]);
    const local = m.state.spirits.map((s) => `${s.slot}:${s.born}`).join();
    m.flush();
    const c = m.coreSpirit(a.born);
    assert.ok(c, `${how}: the new spirit is in the core by its born ${a.born}`);
    assert.deepEqual([c.slot, c.path], [a.slot, [5, 4]], `${how}: the same spirit`);
    m.deliver();
    assert.equal(m.state.spirits.map((s) => `${s.slot}:${s.born}`).join(), local, `${how}: the mirror agrees with the facade`);
    assert.ok(m.state.spirits.includes(a), `${how}: the same object`);
    m.setSpirit(a, { semi: 5 }); m.flush();
    assert.equal(m.coreSpirit(a.born).semi, 5, `${how}: set hits it`);
    const others = m.coreBorns().filter((b) => b !== a.born);
    m.banish(a); m.flush();
    assert.equal(m.coreSpirit(a.born), null, `${how}: banish hits it`);
    assert.deepEqual(m.coreBorns(), others, `${how}: the others stay`);
  }
});

test('Goetia фасад: снимок → restore → зеркало — снимок тот же, у ядра та же сцена', () => {
  const m = FACTORIES.core({ seed: 4 });
  m.dice(); m.setFx('echo', 0.1 + 0.2); m.setSpirit(m.state.spirits[0], { tone: 1 / 3 });
  const js = m.snapshot();
  m.tick(0.05);
  assert.equal(m.snapshot(), js);
  const q = facadeAsync(8);
  q.restore(js);
  assert.equal(q.snapshot(), js, 'restore — at once, before the core');
  q.tick(0.05);
  assert.equal(q.snapshot(), js, 'and after the mirror');
  assert.equal(q.core.snapshot(SLOT), js, 'the core has the same scene (numbers — bit for bit)');
});
