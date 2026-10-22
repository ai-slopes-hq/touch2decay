// Тесты модели Inferno (worlds/inferno/model.js) в Node: высота кругов, иней, грешники, буря, строки плашки, снимок, кубик с зерном.
//   node --test tools/models/inferno.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel, SPAN, PIN_MAX, FX_DEF } from '../../worlds/inferno/model.js';
import { seeded, near } from './util.mjs';

const DT = 1 / 60;
const run = (m, secs) => { for (let k = 0; k < Math.round(secs / DT); k++) m.tick(DT); };
const events = (m) => { const ev = []; m.listen((e) => ev.push(e)); return ev; };
const MAJOR = [0, 2, 4, 5, 7, 9, 11];                   // лад для тестов: мажор от A (как scale.snap хоста — к ближайшей ступени, вниз при равенстве)
const snapMajor = (s) => { for (let d = 0; d < 12; d++) for (const x of [s - d, s + d]) if (MAJOR.includes(((x % 12) + 12) % 12)) return x; return s; };

test('высота: зона круга ~⅔ октавы, нижний круг — от 55 Гц; с ладом — по ступеням', () => {
  const m = createModel();
  assert.equal(m.semiOf(8, 0), 0);
  assert.ok(near(m.semiOf(0, 1), 60));
  assert.ok(near(m.semiOf(4, 0.5), 4 * SPAN + 0.5 * SPAN));
  m.state.circ[8].pos = 0; assert.ok(near(m.hzOf(8), 55));
  m.state.circ[0].pos = 1; assert.ok(near(m.hzOf(0), 55 * 32, 1e-6));
  const on = createModel({ scale: { on: true, snap: snapMajor, pcs: MAJOR } });
  for (let k = 0; k < 9; k++) for (const p of [0, 0.13, 0.5, 0.77, 1]) {
    const s = on.semiOf(k, p);
    assert.equal(s, snapMajor(Math.round(m.semiOf(k, p))));
    assert.ok(MAJOR.includes(((s % 12) + 12) % 12), `ступень лада: ${s}`);
  }
  on.setFx('structure', 0.5);                            // structure «scale»: нота, ступень через одну и ещё через одну вверх
  on.state.circ[8].pos = 0;                              // 0 полутонов = A: вверх по мажору — B(2) C#(4) D(5) E(7) → 4 и 7
  assert.deepEqual(on.ratios(8).map((r) => Math.round(12 * Math.log2(r))), [0, 4, 7]);
  m.setFx('structure', 0); assert.deepEqual(m.ratios(3), [1, 2, 3]);
  m.setFx('structure', 0.9); assert.deepEqual(m.ratios(3), [1, 2.76, 5.4]);
});

test('ice растёт медленно (τ 6 с) и оттаивает быстрее (τ 3 с); резонаторы перенастраиваются при сдвиге > 0.02', () => {
  const m = createModel(), ev = events(m);
  m.setFx('ice', 1);
  run(m, 6);
  assert.ok(Math.abs(m.state.iceE - (1 - Math.exp(-1))) < 0.01, `за τ — 63 %: ${m.state.iceE}`);
  const ices = ev.filter((e) => e.t === 'ice').length;
  assert.ok(ices > 10 && ices < 40, `перенастройка не каждый кадр: ${ices}`);
  const top = m.state.iceE;
  m.setFx('ice', 0);
  run(m, 3);
  assert.ok(Math.abs(m.state.iceE - top * Math.exp(-1)) < 0.01, `оттаял за 3 с до 37 %: ${m.state.iceE}`);
  const c = m.state.circ[0];
  assert.ok(near(m.Qof(c), (4 + (1 - c.width) * 60) * (1 + m.state.iceE * 8)));
});

test('не больше четырёх грешников; двойной тап по грешнику — отпустить', () => {
  const m = createModel(), ev = events(m);
  for (let k = 0; k < 6; k++) m.pin(k, 0.25);
  assert.equal(m.state.circ.filter((c) => c.sinner).length, PIN_MAX);
  assert.equal(m.state.circ[5].sinner, false);
  assert.equal(m.state.circ[5].pos, 0.5, 'лишний грешник не двигает высоту');
  assert.equal(m.state.circ[0].pos, 0.25);
  assert.equal(ev.filter((e) => e.t === 'burn').length, 6);
  assert.ok(m.sounding() && m.burning(2));
  assert.equal(m.pin(2, 0.9), false);
  assert.equal(m.state.circ[2].pos, 0.25);
  assert.equal(m.pin(5, 0.6), true);
  m.clear();
  assert.ok(!m.sounding());
  m.hold(3, 1); assert.ok(m.burning(3) && m.sounding()); m.hold(3, -1); assert.ok(!m.sounding());
});

test('удар: уровень круга вспыхивает и гаснет (τ 0.4 с, со льдом — дольше)', () => {
  const m = createModel(), ev = events(m);
  m.strike(4, 0.8);
  assert.deepEqual(ev.at(-1), { t: 'strike', k: 4, vel: 0.8 });
  assert.equal(m.state.circ[4].lvl, 1);
  run(m, 0.4);
  assert.ok(Math.abs(m.state.circ[4].lvl - Math.exp(-1)) < 0.01, `${m.state.circ[4].lvl}`);
  m.pin(4, 0.5); run(m, 1);
  assert.ok(Math.abs(m.state.circ[4].lvl - m.state.circ[4].level) < 0.01, 'горящий круг держит свой уровень');
});

test('строки плашки круга (их качают LFO хоста inf-c<k>): pitch, width, drive, level → перенастройка; noise — только при смене', () => {
  const m = createModel(), ev = events(m);
  const f0 = m.hzOf(6);
  m.setCirc(6, 'pos', 0.9);
  assert.deepEqual(ev.at(-1), { t: 'tune', k: 6 });
  assert.ok(m.hzOf(6) > f0);
  for (const key of ['width', 'drive', 'level']) { m.setCirc(6, key, 0.3); assert.equal(m.state.circ[6][key], 0.3); assert.deepEqual(ev.at(-1), { t: 'tune', k: 6 }); }
  const n = ev.length;
  m.setCirc(6, 'color', m.state.circ[6].color);
  assert.equal(ev.length, n, 'тот же шум — без событий');
  m.setCirc(6, 'color', 4);
  assert.deepEqual(ev.at(-1), { t: 'color', k: 6 });
});

test('буря второго круга: качает его высоту, пока он горит; storm = 0 — затихает; резонатор — не чаще раза в 50 мс', () => {
  const m = createModel(), ev = events(m);
  m.pin(1, 0.5);
  const base = m.hzOf(1);
  let mx = 0;
  for (let k = 0; k < 600; k++) { m.tick(DT); mx = Math.max(mx, Math.abs(m.state.stormSemi)); }
  assert.ok(mx > 1 && mx <= FX_DEF.storm * 7.8 + 1e-9, `размах бури: ${mx}`);
  const tunes = ev.filter((e) => e.t === 'tune' && e.k === 1).length;
  assert.ok(tunes >= 150 && tunes <= 201, `перенастроек за 10 с: ${tunes}`);
  assert.notEqual(m.hzOf(1), base);
  m.setFx('storm', 0);
  run(m, 1);
  assert.ok(Math.abs(m.state.stormSemi) < 0.01, `${m.state.stormSemi}`);
});

test('снимок → restore: тот же JSON; события — цвет, fx, тление всех кругов', () => {
  const a = createModel({ rng: seeded(11) });
  a.dice(); a.setCirc(3, 'width', 0.2); a.setFx('smoke', 0.8);
  const js = a.snapshot();
  const b = createModel(), ev = events(b);
  b.restore(js);
  assert.equal(b.snapshot(), js);
  assert.deepEqual(Object.keys(JSON.parse(js)), ['circ', 'fx']);
  assert.deepEqual(Object.keys(JSON.parse(js).circ[0]), ['pos', 'sinner', 'color', 'width', 'drive', 'level']);
  assert.equal(ev.filter((e) => e.t === 'burn').length, 9);
  assert.equal(ev.filter((e) => e.t === 'fx').length, 1);
  const changed = JSON.parse(js).circ.filter((q, k) => q.color !== createModel().state.circ[k].color).length;
  assert.equal(ev.filter((e) => e.t === 'color').length, changed);
});

test('кубик с зерном: повторяется; 2–3 грешника, structure из трёх', () => {
  const a = createModel({ rng: seeded(42) }), b = createModel({ rng: seeded(42) });
  a.dice(); b.dice();
  assert.equal(a.snapshot(), b.snapshot());
  for (let s = 1; s < 30; s++) {
    const m = createModel({ rng: seeded(s) });
    m.pin(0, 0.1); m.dice();
    const n = m.state.circ.filter((c) => c.sinner).length;
    assert.ok(n >= 2 && n <= 3, `зерно ${s}: ${n}`);
    assert.ok([0.15, 0.5, 0.85].includes(m.state.fx.structure));
  }
  const c = createModel({ rng: seeded(43) }); c.dice();
  assert.notEqual(c.snapshot(), a.snapshot());
});
