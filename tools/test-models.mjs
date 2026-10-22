// Тесты моделей миров (worlds/<мир>/model.js) в Node без браузера: модель — только данные и алгоритм,
// без DOM, canvas и Web Audio, поэтому импортируется как есть. Миры появятся с шага 4 docs/refactor-plan.md.
//   node --test tools/test-models.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SL, slAdd, slFind, slRemove, slTick } from '../host/sl.js';
import { createModel as firmModel, SMAX, LIMEN } from '../worlds/firmamentum/model.js';

// повторяемая случайность для моделей (mulberry32)
const seeded = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

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

// ---------- Firmamentum (worlds/firmamentum/model.js) ----------
const sky = (s) => ({ x: 100 * s.u, y: -100 * s.h });   // простая проекция свода на плоскость: 1 = 100 px

test('Firmamentum: звёзды занимают слоты, лишняя не встаёт, закрытая освобождает слот', () => {
  const m = firmModel({ rng: seeded(1), place: sky }), ev = [];
  m.listen((e) => ev.push(e));
  const ss = Array.from({ length: SMAX }, (_, i) => m.addStar(0.3, i / SMAX - 0.5));
  assert.deepEqual(ss.map((s) => s.slot), [0, 1, 2, 3, 4, 5]);
  assert.equal(m.addStar(0.5, 0), null);
  assert.ok(m.sounding());
  m.closeStar(ss[2]);
  assert.equal(m.addStar(0.5, 0).slot, 2);
  assert.deepEqual(ev.filter((e) => e.t === 'star').map((e) => `${e.s.slot}${e.on ? '+' : '-'}${e.added ? 'a' : ''}`).slice(-2), ['2-', '2+a']);
  m.clear();
  assert.equal(m.state.stars.length, 0); assert.ok(!m.sounding());
});

test('Firmamentum: высота — частота пульсаций (limen — 20 Гц), место по своду — формант, лад — ступени', () => {
  const m = firmModel();
  assert.ok(near(m.fp({ h: 0 }), 0.7)); assert.ok(near(m.fp({ h: 1 }), 520)); assert.ok(near(m.fp({ h: LIMEN }), 20));
  assert.ok(near(m.ff({ u: -1 }), 140)); assert.ok(near(m.ff({ u: 1 }), 4800));
  const q = firmModel({ scale: { on: true, snap: (st) => 2 * Math.round(st / 2) } });   // лад: только чётные полутоны от 55 Гц
  const f = q.fp({ h: 0.85 }), st = 12 * Math.log2(f / 55);
  assert.ok(near(st, Math.round(st), 1e-6) && Math.round(st) % 2 === 0, `${f} Hz — ${st} st`);
  assert.ok(near(q.fp({ h: 0.1 }), m.fp({ h: 0.1 })));   // ниже 27.5 Гц — ритм, лад не трогает
});

test('Firmamentum: комета пролетает по своду, звезда на её пути пульсирует до двух октав быстрее, потом отпускает', () => {
  const m = firmModel({ rng: seeded(7), place: sky }), fps = [];
  m.listen((e) => { if (e.t === 'fp') fps.push(m.fp(e.s)); });
  const s = m.addStar(0.3, 0);
  m.setFx('cometa', 1); m.launch(); m.tick(0.01);
  const c = m.state.comet;
  assert.ok(c && m.state.comets === 1, 'comet launched');
  assert.ok(c.dur >= 3.5 && c.dur <= 6.5);
  const base = m.fp({ ...s, cm: 1 });
  m.tick(c.dur / 2 - 0.01);                             // середина пути — поставить звезду прямо туда
  const at = m.cometAt(), q = { h: -at.y / 100, u: at.x / 100 };
  m.moveStar(s, q.h, q.u); m.tick(0.04);                // частота уходит в звук не чаще ~30 раз в секунду
  assert.ok(s.cm > 3.7 && s.cm <= 4, `cm ${s.cm}`);
  assert.ok(Math.max(...fps) > 3.5 * m.fp({ ...s, cm: 1 }), 'fp sent faster');
  m.tick(c.dur);                                        // пролетела — пульсация прежняя
  assert.equal(m.state.comet, null); assert.equal(s.cm, 1);
  assert.ok(near(m.fp(s), m.fp({ ...s, cm: 1 }))); assert.ok(base > 0);
});

test('Firmamentum: drift — форманты плывут, раз в 0.1 с', () => {
  const m = firmModel({ rng: seeded(3) }), ff = [];
  m.listen((e) => { if (e.t === 'ff') ff.push(m.ff(e.s)); });
  m.addStar(0.5, 0); m.setFx('drift', 1);
  for (let i = 0; i < 60; i++) m.tick(1 / 60);
  assert.ok(ff.length >= 8 && ff.length <= 11, `${ff.length} updates per second`);
  assert.ok(new Set(ff.map((x) => x.toFixed(3))).size > 3, 'formant moves');
});

test('Firmamentum: снимок → restore — та же сцена; кубик с тем же зерном — та же сцена', () => {
  const a = firmModel({ rng: seeded(11) }), b = firmModel({ rng: seeded(11) });
  a.dice(); b.dice();
  assert.equal(a.snapshot(), b.snapshot());
  const n = a.state.stars.length;
  assert.ok(n >= 3 && n <= 4, `dice: ${n} stars`);
  assert.equal(a.state.stars.filter((s) => s.h < LIMEN).length, 1, 'one rhythm below limen');
  a.setFx('hall', 0.9);
  const js = a.snapshot(), c = firmModel({ rng: seeded(5) });
  c.addStar(0.9, 0.9);
  c.restore(js);
  assert.equal(c.snapshot(), js);
});
