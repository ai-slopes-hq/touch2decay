// Тесты модели Monochordum в Node: струны, автострам, ветер, снимок, кубик с зерном.
// Каждый тест модели — дважды: против эталонной JS-модели (tools/ref/monochord-model.js) и против модели ядра (t2d.wasm) через фасад
// веба worlds/monochord/model.js (порт — monochord-core.mjs): у ядра ещё и его зеркало должно сойтись со state фасада.
// Шаги автострама в ядре (часы, сетка MIDI) — tools/test-mono-core.mjs.
//   core/build.sh && node --test tools/models/monochord.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel as jsModel, F_OPEN, MARKS, FX_DEF } from '../ref/monochord-model.js';
import * as facade from '../../worlds/monochord/model.js';
import { createModel as coreModel } from './monochord-core.mjs';
import { seeded, near } from './util.mjs';

const FACTORIES = {
  js: ({ rng } = {}) => jsModel(rng ? { rng } : {}),
  core: ({ rng, seed = 1 } = {}) => coreModel({ seed, ...(rng ? { rng } : {}) }),
};
const events = (m) => { const ev = []; m.listen((e) => ev.push(e)); return ev; };
const OWN = ['r', 'sus', 'bright', 'decay', 'level', 'bow'];
function coreAgrees(m, what) {                          // у ядра: зеркало струн = state фасада
  if (!m.coreStr) return;
  m.coreStr().forEach((q, i) => OWN.forEach((k) => assert.ok(near(+q[k], +m.state.str[i][k], 1e-12), `${what}: str ${i}.${k} core ${q[k]} vs ${m.state.str[i][k]}`)));
}

test('Monochordum: константы фасада — те же, что у эталона', () => {
  assert.deepEqual(facade.F_OPEN, F_OPEN); assert.deepEqual(facade.MARKS, MARKS); assert.deepEqual(facade.FX_DEF, FX_DEF);
});

test('Monochordum [js]: лад — ступени от тоники (игрушечный лад)', () => {
  const q = jsModel({ scale: { on: true, root: 3, snap: (st) => 2 * Math.round(st / 2) } });   // лад: чётные полутоны, тоника +3
  q.setBridge(1, 0.6); const st = -12 * Math.log2(q.state.str[1].r);
  assert.ok(near(st, Math.round(st), 1e-9) && Math.round(st) % 2 === 0, `${st}`);
  assert.ok(near(q.hzOf(1), (F_OPEN[1] * 2 ** (3 / 12)) / q.state.str[1].r));
});

test('Monochordum [core]: лад хоста — подставка на ступенях лада, тоника — у фасада и ядра одна', () => {
  const m = coreModel(), j = jsModel({ scale: { on: true, root: 3, snap: (s) => s } });
  m.setScale(true, 1, 3);                               // минор от C (A + 3)
  m.setBridge(1, 0.6); m.setBridge(2, 0.71);
  coreAgrees(m, 'scale');
  const st = -12 * Math.log2(m.state.str[1].r);
  assert.ok(near(st, Math.round(st), 1e-9), `${st}`);
  j.state.str[1].r = m.state.str[1].r;
  assert.ok(near(m.hzOf(1), j.hzOf(1)), `${m.hzOf(1)} vs ${j.hzOf(1)}`);
});

for (const [name, createModel] of Object.entries(FACTORIES)) {
  test(`Monochordum [${name}]: подставка прилипает к пифагоровым ладам, высота — открытая струна / r`, () => {
    const m = createModel(), ev = events(m), s = m.state.str[0];
    m.setBridge(0, 0.505); assert.equal(s.r, 1 / 2);  // рядом с Sol — ровно 1/2
    assert.ok(near(m.hzOf(0), F_OPEN[0] * 2));
    m.setBridge(0, 0.56); assert.equal(s.r, 0.56);    // между ладами — как есть
    m.setBridge(0, 2 / 3 + 0.004); assert.equal(s.r, 2 / 3);
    assert.deepEqual(ev.map((e) => [e.t, e.i]), [['tune', 0], ['tune', 0], ['tune', 0]]);
    assert.ok(MARKS.some(([r]) => r === s.r));
    coreAgrees(m, 'bridge');
  });

  test(`Monochordum [${name}]: щипок, флажолет, смычок, Эолова струна, плашка — события и состояние`, () => {
    const m = createModel(), ev = events(m), s = m.state.str[2];
    m.pluck(2, 0.3); m.pluck(1, 0.5, 0.4); m.harm(2, 3);
    assert.deepEqual(ev.splice(0), [{ t: 'pluck', i: 2, pos: 0.3, vel: 0.9 }, { t: 'pluck', i: 1, pos: 0.5, vel: 0.4 }, { t: 'harm', i: 2, n: 3, vel: 0.9 }]);
    assert.equal(m.sounding(), false);                // щипок затухает сам — мир не «звучит»
    m.bow(2, 0.6); assert.equal(s.bow, 0.6); assert.ok(m.sounding());
    m.bow(2, 0); assert.ok(!m.sounding());
    m.toggleSus(2); assert.ok(s.sus && m.sounding());
    m.toggleSus(2); assert.ok(!s.sus);
    assert.deepEqual(ev.splice(0), [{ t: 'bow', i: 2, amp: 0.6 }, { t: 'bow', i: 2, amp: 0 }, { t: 'sus', i: 2, on: true }, { t: 'sus', i: 2, on: false }]);
    m.setString(2, 'pitch', 0.5); assert.ok(near(s.r, 1 / 2));   // pitch — r без прилипания: 0.5 → октава
    m.setString(2, 'pitch', 2); assert.equal(s.r, 0.25);         // не выше двух октав
    m.setString(2, 'bright', 0.9); assert.equal(s.bright, 0.9);
    assert.deepEqual(ev.map((e) => e.t), ['tune', 'tune', 'tune']);
    coreAgrees(m, 'sheet');
    if (name === 'js') {                              // эталон: энергию клала склейка (meter)
      m.meter([0.1, 0.2, 0.3, 0.4], [0, 0, 0.05, 0], [2, 2, 3, 2]);
      assert.deepEqual(m.state.str.map((q) => [q.en, q.eh, q.hn]), [[0.1, 0, 2], [0.2, 0, 2], [0.3, 0.05, 3], [0.4, 0, 2]]);
    } else {                                          // ядро: энергия — из звука, в зеркале
      m.pluck(1, 0.3, 1); m.tick(0.05);
      assert.ok(m.state.str[1].en > 0.001 && m.state.str[0].en < m.state.str[1].en, `${m.state.str.map((q) => q.en)}`);
      m.harm(3, 4, 0.9); m.tick(0.05);
      assert.ok(m.state.str[3].eh > 0.0001 && m.state.str[3].hn === 4, `${m.state.str[3].eh} ${m.state.str[3].hn}`);
    }
  });

  test(`Monochordum [${name}]: автострам — down-up по шагам, акцент на такте, сила и промежуток, swing, chance`, () => {
    const m = createModel({ rng: seeded(5) }), A = m.state.auto;
    for (const [k, v] of Object.entries({ bpm: 120, div: 1, pattern: 1, strength: 0.6, swing: 0 })) m.setAutoPar(k, v);   // 1/8 на 120 — шаг 0.25 с (действием: у ядра state правит зеркало)
    const s0 = m.autoStep(0), s1 = m.autoStep(1), s2 = m.autoStep(2);
    assert.deepEqual(s0.map((h) => h.i), [0, 1, 2, 3]);  // чётный — вниз
    assert.deepEqual(s1.map((h) => h.i), [3, 2, 1, 0]);  // нечётный — вверх
    const gap = 0.006 + 0.018 * 0.4;
    s0.forEach((h, k) => { assert.ok(near(h.dt, k * gap)); assert.ok(h.pos >= 0.12 && h.pos < 0.22); });
    assert.ok(s0.every((h) => h.vel > 0.69 * 0.85 - 1e-9 && h.vel <= 0.69 + 1e-9), 'шаг 0 — акцент: 0.6 · 1.15');
    assert.ok(s2.every((h) => h.vel <= 0.6 + 1e-9), 'шаг 2 — без акцента');
    assert.ok(m.autoStep(8).every((h) => h.vel > 0.69 * 0.85 - 1e-9), 'шаг 8 — снова начало такта (div 2 · 4)');
    assert.ok(near(m.stepDur(0), 0.25) && near(m.stepDur(1), 0.25));
    m.setAutoPar('swing', 0.4); assert.ok(near(m.stepDur(0), 0.3) && near(m.stepDur(1), 0.2));   // swing: чётные длиннее
    m.setAutoPar('pattern', 0); assert.deepEqual(m.autoStep(1).map((h) => h.i), [0, 1, 2, 3]);   // down — всегда вниз
    m.setAutoPar('pattern', 2); assert.deepEqual([0, 1, 2, 3, 4].map((k) => m.autoStep(k).map((h) => h.i)), [[0], [1], [2], [3], [0]]);   // arpeggio — по одной
    m.setAutoPar('pattern', 3); const r = Array.from({ length: 40 }, (_, k) => m.autoStep(k).map((h) => h.i));   // random — каждая с вероятностью 0.55, по порядку
    assert.ok(r.every((o) => o.every((i, k) => k === 0 || i > o[k - 1])));
    assert.ok(r.some((o) => o.length < 4) && r.some((o) => o.length > 1));
    m.setAutoPar('pattern', 1); m.setFx('chance', 0); assert.equal(m.autoStep(0), null);   // chance 0 — шаг молчит
    m.setFx('chance', 0.5); const n = Array.from({ length: 200 }, (_, k) => m.autoStep(k)).filter(Boolean).length;
    assert.ok(n > 60 && n < 140, `${n}`);
    const ev = events(m); m.setAuto(true); assert.ok(A.on && m.sounding()); m.setAuto(false);
    assert.deepEqual(ev, [{ t: 'auto', on: true }, { t: 'auto', on: false }]);
    m.setBpm(77); m.setAutoPar('div', 3); assert.equal(A.bpm, 77); assert.ok(near(m.stepDur(1), (60 / 77 / 4) * 0.8));
  });

  test(`Monochordum [${name}]: ветер — 0…1, тап вспоминает последний, корзина глушит всё`, () => {
    const m = createModel(), ev = events(m), S = m.state;
    m.setWind(0.7); assert.equal(S.wind, 0.7); assert.ok(m.sounding());
    m.toggleWind(); assert.equal(S.wind, 0);
    m.toggleWind(); assert.equal(S.wind, 0.7);        // тот же ветер вернулся
    m.setWind(1.5); assert.equal(S.wind, 1);
    assert.deepEqual(ev.splice(0).map((e) => e.amt), [0.7, 0, 0.7, 1]);
    m.toggleSus(1); m.bow(3, 0.5); m.setAuto(true);
    m.clear();
    assert.ok(!m.sounding() && S.wind === 0 && !S.auto.on && S.str.every((s) => !s.sus && !s.bow));
    assert.equal(S.lastWind, 1);                      // после корзины тап по розе — прежний ветер
    coreAgrees(m, 'clear');
  });

  test(`Monochordum [${name}]: снимок → restore — тот же JSON, события для звука`, () => {
    const m = createModel({ rng: seeded(11) });
    m.setBridge(0, 3 / 4); m.setString(1, 'decay', 0.2); m.toggleSus(2); m.setFx('hall', 0.6); m.setWind(0.3);
    m.setAutoPar('bpm', 133); m.setAutoPar('pattern', 2); m.setAutoPar('swing', 0.25); m.setAuto(true);
    const js = m.snapshot(), o = JSON.parse(js);
    assert.deepEqual(Object.keys(o), ['str', 'fx', 'wind', 'auto']);
    assert.deepEqual(Object.keys(o.str[0]), ['r', 'sus', 'bright', 'decay', 'level']);
    assert.deepEqual(Object.keys(o.fx), Object.keys(FX_DEF));
    assert.deepEqual(Object.keys(o.auto), ['on', 'bpm', 'div', 'pattern', 'strength', 'swing']);
    if (m.core) assert.equal(m.core.snapshot(facade.SLOT), js, 'core snapshot = facade snapshot');
    const q = createModel(), ev = events(q);
    q.restore(js);
    assert.equal(q.snapshot(), js);
    assert.deepEqual(ev.map((e) => e.t), ['sus', 'sus', 'sus', 'sus', 'fx', 'wind', 'auto']);
    assert.ok(ev[2].on && q.state.auto.on && q.state.wind === 0.3);
    coreAgrees(q, 'restore');
    if (q.core) assert.equal(q.core.snapshot(facade.SLOT), js, 'core after restore');
    q.restore(JSON.stringify({ str: o.str, fx: o.fx }));   // старый снимок без ветра и автострама
    assert.equal(q.state.wind, 0); assert.ok(q.state.auto.on, 'без auto в снимке автострам не трогаем');
  });

  test(`Monochordum [${name}]: кубик с зерном повторяем, подставки — на пифагоровых ладах`, () => {
    const a = createModel({ rng: seeded(42) }), b = createModel({ rng: seeded(42) });
    a.dice(); b.dice();
    assert.equal(a.snapshot(), b.snapshot());
    const pick = [1, 3 / 4, 2 / 3, 1 / 2, 4 / 9, 3 / 8, 1 / 3, 8 / 9];
    assert.ok(a.state.str.every((s) => pick.includes(s.r)));
    coreAgrees(a, 'dice');
    if (a.core) assert.equal(a.core.snapshot(facade.SLOT), a.snapshot(), 'core = facade after dice');
    const many = Array.from({ length: 30 }, (_, k) => { const m = createModel({ rng: seeded(k) }); m.dice(); return m.state; });
    assert.ok(many.some((s) => s.wind > 0) && many.some((s) => s.wind === 0));
    assert.ok(many.some((s) => s.str.some((q) => q.sus)));
    assert.ok(many.every((s) => s.wind === 0 || (s.wind >= 0.15 && s.wind <= 0.5)));
  });

  test(`Monochordum [${name}]: swingAt совпадает со stepDur (сдвиг нечётного шага, чётный на месте)`, () => {
    const m = createModel(); m.setAutoPar('div', 1); m.setAutoPar('swing', 0.4);
    const sec = 60 / m.state.auto.bpm / 2;
    assert.equal(m.swingAt(0), 0);
    assert.ok(near(m.swingAt(1), m.stepDur(0) - sec) && m.swingAt(1) > 0);
    assert.equal(m.swingAt(2), 0);
    assert.equal(m.perBeat(), 2); m.setAutoPar('div', 2); assert.equal(m.perBeat(), 3);
  });
}

test('Monochordum: кубик фасада и кубик эталона с одним зерном — одна сцена', () => {
  const j = jsModel({ rng: seeded(7) }), c = coreModel({ rng: seeded(7) });
  j.dice(); c.dice();
  assert.equal(c.snapshot(), j.snapshot());
});

test('Monochordum фасад: правка без зеркала не перетирается старым зеркалом; новый узел ядра — сцена целиком', () => {
  const m = coreModel({ async: true });
  m.setBridge(1, 3 / 4); m.setSus(3, true); m.setWind(0.4);
  m.deliver();                                          // зеркало ещё до правок — фасад их держит
  assert.equal(m.state.str[1].r, 3 / 4); assert.ok(m.state.str[3].sus); assert.equal(m.state.wind, 0.4);
  m.flush(); m.deliver();
  assert.equal(m.state.str[1].r, 3 / 4); assert.ok(m.state.str[3].sus);
  const js = m.snapshot();
  m.rebind(); m.flush(); m.deliver();                   // restartAudio: новое ядро получает сцену целиком
  assert.equal(m.core.snapshot(facade.SLOT), js);
});
