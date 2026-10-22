// Тесты модели Monochordum (worlds/monochord/model.js) в Node: струны, автострам, ветер, снимок, кубик с зерном.
//   node --test tools/models/monochord.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel, F_OPEN, MARKS, FX_DEF } from '../../worlds/monochord/model.js';

// повторяемая случайность для моделей (mulberry32)
const seeded = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const events = (m) => { const ev = []; m.listen((e) => ev.push(e)); return ev; };

test('Monochordum: подставка прилипает к пифагоровым ладам, высота — открытая струна / r, лад — ступени от тоники', () => {
  const m = createModel(), ev = events(m), s = m.state.str[0];
  m.setBridge(0, 0.505); assert.equal(s.r, 1 / 2);    // рядом с Sol — ровно 1/2
  assert.ok(near(m.hzOf(0), F_OPEN[0] * 2));
  m.setBridge(0, 0.56); assert.equal(s.r, 0.56);      // между ладами — как есть
  m.setBridge(0, 2 / 3 + 0.004); assert.equal(s.r, 2 / 3);
  assert.deepEqual(ev.map((e) => [e.t, e.i]), [['tune', 0], ['tune', 0], ['tune', 0]]);
  assert.ok(MARKS.some(([r]) => r === s.r));
  const q = createModel({ scale: { on: true, root: 3, snap: (st) => 2 * Math.round(st / 2) } });   // лад: чётные полутоны, тоника +3
  q.setBridge(1, 0.6); const st = -12 * Math.log2(q.state.str[1].r);
  assert.ok(near(st, Math.round(st), 1e-9) && Math.round(st) % 2 === 0, `${st}`);
  assert.ok(near(q.hzOf(1), (F_OPEN[1] * 2 ** (3 / 12)) / q.state.str[1].r));
});

test('Monochordum: щипок, флажолет, смычок, Эолова струна, плашка — события и состояние', () => {
  const m = createModel(), ev = events(m), s = m.state.str[2];
  m.pluck(2, 0.3); m.pluck(1, 0.5, 0.4); m.harm(2, 3);
  assert.deepEqual(ev.splice(0), [{ t: 'pluck', i: 2, pos: 0.3, vel: 0.9 }, { t: 'pluck', i: 1, pos: 0.5, vel: 0.4 }, { t: 'harm', i: 2, n: 3, vel: 0.9 }]);
  assert.equal(m.sounding(), false);                  // щипок затухает сам — мир не «звучит»
  m.bow(2, 0.6); assert.equal(s.bow, 0.6); assert.ok(m.sounding());
  m.bow(2, 0); assert.ok(!m.sounding());
  m.toggleSus(2); assert.ok(s.sus && m.sounding());
  m.toggleSus(2); assert.ok(!s.sus);
  assert.deepEqual(ev.splice(0), [{ t: 'bow', i: 2, amp: 0.6 }, { t: 'bow', i: 2, amp: 0 }, { t: 'sus', i: 2, on: true }, { t: 'sus', i: 2, on: false }]);
  m.setString(2, 'pitch', 0.5); assert.ok(near(s.r, 1 / 2));   // pitch — r без прилипания: 0.5 → октава
  m.setString(2, 'pitch', 2); assert.equal(s.r, 0.25);         // не выше двух октав
  m.setString(2, 'bright', 0.9); assert.equal(s.bright, 0.9);
  assert.deepEqual(ev.map((e) => e.t), ['tune', 'tune', 'tune']);
  m.meter([0.1, 0.2, 0.3, 0.4], [0, 0, 0.05, 0], [2, 2, 3, 2]);   // что слышно — из worklet
  assert.deepEqual(m.state.str.map((q) => [q.en, q.eh, q.hn]), [[0.1, 0, 2], [0.2, 0, 2], [0.3, 0.05, 3], [0.4, 0, 2]]);
});

test('Monochordum: автострам — down-up по шагам, акцент на такте, сила и промежуток, swing, chance', () => {
  const m = createModel({ rng: seeded(5) }), A = m.state.auto;
  Object.assign(A, { bpm: 120, div: 1, pattern: 1, strength: 0.6, swing: 0 });   // 1/8 на 120 — шаг 0.25 с
  const s0 = m.autoStep(0), s1 = m.autoStep(1), s2 = m.autoStep(2);
  assert.deepEqual(s0.map((h) => h.i), [0, 1, 2, 3]);  // чётный — вниз
  assert.deepEqual(s1.map((h) => h.i), [3, 2, 1, 0]);  // нечётный — вверх
  const gap = 0.006 + 0.018 * 0.4;
  s0.forEach((h, k) => { assert.ok(near(h.dt, k * gap)); assert.ok(h.pos >= 0.12 && h.pos < 0.22); });
  assert.ok(s0.every((h) => h.vel > 0.69 * 0.85 - 1e-9 && h.vel <= 0.69 + 1e-9), 'шаг 0 — акцент: 0.6 · 1.15');
  assert.ok(s2.every((h) => h.vel <= 0.6 + 1e-9), 'шаг 2 — без акцента');
  assert.ok(m.autoStep(8).every((h) => h.vel > 0.69 * 0.85 - 1e-9), 'шаг 8 — снова начало такта (div 2 · 4)');
  assert.ok(near(m.stepDur(0), 0.25) && near(m.stepDur(1), 0.25));
  A.swing = 0.4; assert.ok(near(m.stepDur(0), 0.3) && near(m.stepDur(1), 0.2));   // swing: чётные длиннее
  A.pattern = 0; assert.deepEqual(m.autoStep(1).map((h) => h.i), [0, 1, 2, 3]);   // down — всегда вниз
  A.pattern = 2; assert.deepEqual([0, 1, 2, 3, 4].map((k) => m.autoStep(k).map((h) => h.i)), [[0], [1], [2], [3], [0]]);   // arpeggio — по одной
  A.pattern = 3; const r = Array.from({ length: 40 }, (_, k) => m.autoStep(k).map((h) => h.i));   // random — каждая с вероятностью 0.55, по порядку
  assert.ok(r.every((o) => o.every((i, k) => k === 0 || i > o[k - 1])));
  assert.ok(r.some((o) => o.length < 4) && r.some((o) => o.length > 1));
  A.pattern = 1; m.state.fx.chance = 0; assert.equal(m.autoStep(0), null);   // chance 0 — шаг молчит
  m.state.fx.chance = 0.5; const n = Array.from({ length: 200 }, (_, k) => m.autoStep(k)).filter(Boolean).length;
  assert.ok(n > 60 && n < 140, `${n}`);
  const ev = events(m); m.setAuto(true); assert.ok(A.on && m.sounding()); m.setAuto(false);
  assert.deepEqual(ev, [{ t: 'auto', on: true }, { t: 'auto', on: false }]);
  m.setBpm(77); m.setAutoPar('div', 3); assert.equal(A.bpm, 77); assert.ok(near(m.stepDur(1), (60 / 77 / 4) * 0.8));
});

test('Monochordum: ветер — 0…1, тап вспоминает последний, корзина глушит всё', () => {
  const m = createModel(), ev = events(m), S = m.state;
  m.setWind(0.7); assert.equal(S.wind, 0.7); assert.ok(m.sounding());
  m.toggleWind(); assert.equal(S.wind, 0);
  m.toggleWind(); assert.equal(S.wind, 0.7);          // тот же ветер вернулся
  m.setWind(1.5); assert.equal(S.wind, 1);
  assert.deepEqual(ev.splice(0).map((e) => e.amt), [0.7, 0, 0.7, 1]);
  m.toggleSus(1); m.bow(3, 0.5); m.setAuto(true);
  m.clear();
  assert.ok(!m.sounding() && S.wind === 0 && !S.auto.on && S.str.every((s) => !s.sus && !s.bow));
  assert.equal(S.lastWind, 1);                        // после корзины тап по розе — прежний ветер
});

test('Monochordum: снимок → restore — тот же JSON, события для звука', () => {
  const m = createModel({ rng: seeded(11) });
  m.setBridge(0, 3 / 4); m.setString(1, 'decay', 0.2); m.toggleSus(2); m.setFx('hall', 0.6); m.setWind(0.3);
  Object.assign(m.state.auto, { bpm: 133, pattern: 2, swing: 0.25 }); m.setAuto(true);
  const js = m.snapshot(), o = JSON.parse(js);
  assert.deepEqual(Object.keys(o), ['str', 'fx', 'wind', 'auto']);
  assert.deepEqual(Object.keys(o.str[0]), ['r', 'sus', 'bright', 'decay', 'level']);
  assert.deepEqual(Object.keys(o.fx), Object.keys(FX_DEF));
  assert.deepEqual(Object.keys(o.auto), ['on', 'bpm', 'div', 'pattern', 'strength', 'swing']);
  const q = createModel(), ev = events(q);
  q.restore(js);
  assert.equal(q.snapshot(), js);
  assert.deepEqual(ev.map((e) => e.t), ['sus', 'sus', 'sus', 'sus', 'fx', 'wind', 'auto']);
  assert.ok(ev[2].on && q.state.auto.on && q.state.wind === 0.3);
  q.restore(JSON.stringify({ str: o.str, fx: o.fx }));   // старый снимок без ветра и автострама
  assert.equal(q.state.wind, 0); assert.ok(q.state.auto.on, 'без auto в снимке автострам не трогаем');
});

test('Monochordum: кубик с зерном повторяем, подставки — на пифагоровых ладах', () => {
  const a = createModel({ rng: seeded(42) }), b = createModel({ rng: seeded(42) });
  a.dice(); b.dice();
  assert.equal(a.snapshot(), b.snapshot());
  const pick = [1, 3 / 4, 2 / 3, 1 / 2, 4 / 9, 3 / 8, 1 / 3, 8 / 9];
  assert.ok(a.state.str.every((s) => pick.includes(s.r)));
  const many = Array.from({ length: 30 }, (_, k) => { const m = createModel({ rng: seeded(k) }); m.dice(); return m.state; });
  assert.ok(many.some((s) => s.wind > 0) && many.some((s) => s.wind === 0));
  assert.ok(many.some((s) => s.str.some((q) => q.sus)));
  assert.ok(many.every((s) => s.wind === 0 || (s.wind >= 0.15 && s.wind <= 0.5)));
});
