// Тесты модели Tria corpora (worlds/tria/model.js) в Node: физика трёх тел, энергия, снимок, кубик с зерном.
//   node --test tools/models/tria.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel, BODY_KEYS, FX_DEF } from '../../worlds/tria/model.js';

// повторяемая случайность для моделей (mulberry32)
const seeded = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const DT = 1 / 60;
const run = (m, secs) => { for (let k = 0; k < Math.round(secs / DT); k++) m.tick(DT); };

// Fiat lux: восьмёрка Шенсине — Монтгомери (x1 = (−0.97000436, 0.24308753), v3 = (−0.93240737, −0.86473146) при G = m = 1, период 6.32591398),
// в модели — масштаб 0.55, G = Gc(), без земли и почти без смягчения (lux: eps² = 1e-6), decay 0 — ничего отключать не надо
test('Fiat lux: восьмёрка держится — тела на той же кривой и энергия на месте 18 периодов', () => {
  const m = createModel(), B = m.state.bodies;
  m.fiatLux();
  assert.ok(m.state.lux && !m.state.still);
  const P = 6.32591398 * Math.sqrt(0.55 ** 3 / m.Gc()) / (0.5 + m.state.fx.gravitas);   // период в секундах кадра (физика идёт в (0.5 + gravitas) раза быстрее)
  const E0 = m.energy(), curve = [];
  for (let t = 0; t < P; t += DT) { m.tick(DT); curve.push([B[0].x, B[0].y]); }   // кривая — след первого тела за период
  let off = 0, rmax = 0, de = 0;
  for (let k = 0; k < 60 / DT; k++) {
    m.tick(DT);
    if (k % 5) continue;
    for (const b of B) { let d = 9; for (const c of curve) d = Math.min(d, Math.hypot(b.x - c[0], b.y - c[1])); off = Math.max(off, d); rmax = Math.max(rmax, Math.hypot(b.x, b.y)); }
    de = Math.max(de, Math.abs(m.energy() - E0));
  }
  assert.ok(off < 0.03, `все три тела — на одной кривой: отход ${off}`);
  assert.ok(rmax < 0.65, `не уходят к краю: ${rmax}`);
  assert.ok(de < 1e-4 * Math.abs(E0), `энергия: ${E0} ± ${de}`);
  const cm = B.reduce((a, b) => [a[0] + b.x / 3, a[1] + b.y / 3], [0, 0]);
  assert.ok(Math.hypot(cm[0], cm[1]) < 1e-6, `центр масс в центре блюда: ${cm}`);
});

test('бросок: энергия сохраняется 20 с (кубик с зерном и бросок тела)', () => {
  const m = createModel({ rng: seeded(7) });
  m.dice();
  run(m, 1);                                        // первый кадр поднимает энергию нового броска до EMIN
  const E0 = m.energy();
  run(m, 20);
  assert.ok(Math.abs(m.energy() - E0) < 0.05 * Math.abs(E0) + 0.05, `${E0} -> ${m.energy()}`);
  m.grab(1); m.drag(1, 0.3, -0.2); m.release(1, { vx: 1.2, vy: -0.8 });
  assert.equal(m.state.bodies[1].vx, 1.2);
  run(m, 1); const E1 = m.energy(); run(m, 20);
  assert.ok(Math.abs(m.energy() - E1) < 0.05 * Math.abs(E1) + 0.05, `после броска: ${E1} -> ${m.energy()}`);
  assert.ok(E1 >= 0.6 * m.state.bodies.reduce((a, b) => a + b.m, 0) - 1e-6, `у броска энергия не ниже EMIN: ${E1}`);
});

test('decay садит тела в клубок; корзина замораживает', () => {
  const m = createModel({ rng: seeded(3) });
  m.dice(); m.setFx('decay', 1);
  run(m, 40);
  const B = m.state.bodies, v = Math.max(...B.map((b) => Math.hypot(b.vx, b.vy)));
  assert.ok(v < 1.5, `скорости упали: ${v}`);
  m.clear();
  assert.ok(m.state.still && !m.sounding());
  const p = B.map((b) => [b.x, b.y]); run(m, 1);
  assert.deepEqual(B.map((b) => [b.x, b.y]), p);
});

test('аспекты и соединения — события для звука, вспышки в state', () => {
  const m = createModel({ rng: seeded(11) }), ev = {};
  m.listen((e) => { ev[e.t] = (ev[e.t] || 0) + 1; });
  m.dice(); run(m, 10);
  assert.equal(ev.start, 1);
  assert.equal(ev.drone, 600);
  assert.ok(ev.bell > 3, `колокола: ${ev.bell}`);
  assert.ok(m.state.flashes.length > 0 && m.state.flashes.length <= 30);
  assert.ok(m.state.flashes.every((f) => f.t > 0 && f.t <= m.state.time));
});

test('снимок → restore: тот же JSON, форма как была', () => {
  const a = createModel({ rng: seeded(5) });
  a.dice(); run(a, 3); a.anchor(2);
  const js = a.snapshot(), st = JSON.parse(js);
  assert.deepEqual(Object.keys(st), ['b', 'fx', 'still', 'lux', 'cadit']);
  assert.deepEqual(Object.keys(st.b[0]), BODY_KEYS);
  assert.deepEqual(Object.keys(st.fx), Object.keys(FX_DEF));
  const b = createModel(), ev = [];
  b.listen((e) => ev.push(e.t));
  b.restore(js);
  assert.equal(b.snapshot(), js);
  assert.deepEqual(ev, ['fx', 'start']);
  assert.ok(b.state.bodies.every((q) => q.trail.length === 0));
});

test('кубик с зерном повторяется', () => {
  const a = createModel({ rng: seeded(42) }), b = createModel({ rng: seeded(42) });
  a.dice(); b.dice();
  assert.equal(a.snapshot(), b.snapshot());
  run(a, 5); run(b, 5);
  assert.equal(a.snapshot(), b.snapshot());
  const c = createModel({ rng: seeded(43) }); c.dice();
  assert.notEqual(a.snapshot(), c.snapshot());
});

test('лад: с ладом — тоника и ступени из scale, без лада — пентатоника', () => {
  const m = createModel(), b = m.state.bodies[0];
  assert.equal(m.baseHz(b), 55);                    // semi 0 − 12 → A1
  b.semi = 1; assert.equal(m.baseHz(b), 55);        // 1 → ближайшая ступень пентатоники 0
  const on = createModel({ scale: { on: true, root: 3, snap: (s) => s } }), q = on.state.bodies[0];
  assert.equal(on.tonic(), 3);
  assert.ok(Math.abs(on.baseHz(q) - 55 * 2 ** (3 / 12)) < 1e-9);
});
