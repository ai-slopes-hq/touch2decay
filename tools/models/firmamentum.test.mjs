// Тесты модели Firmamentum в Node: слоты звёзд, fp/ff и limen, лад, комета, drift, снимок, кубик.
// Каждый тест — дважды: против JS-модели (worlds/firmamentum/model.js) и против модели ядра (t2d.wasm через фасад firmamentum-core.mjs).
// Плюс сверка «JS-модель ↔ ядро»: одно зерно, одни действия, шаг 128 сэмплов — состояние до 1e-9.
//   core/build.sh && node --test tools/models/firmamentum.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel as jsModel, SMAX, LIMEN } from '../../worlds/firmamentum/model.js';
import { createModel as coreModel, sky, S, K, SR } from './firmamentum-core.mjs';
import { scl, snapSemi, inScale } from '../../host/scale.js';
import { seeded, near } from './util.mjs';

// лад хоста {on, idx, root} для JS-модели: snapSemi из host/scale.js (у него общее состояние scl — ставим на время вызова)
const hostSnap = ({ on, idx, root }) => ({
  on, snap(s) { const keep = { ...scl }; Object.assign(scl, { on, idx, root }); const r = snapSemi(s); Object.assign(scl, keep); return r; },
});
const inHostScale = ({ idx, root }, n) => { const keep = { ...scl }; Object.assign(scl, { on: true, idx, root }); const r = inScale(n); Object.assign(scl, keep); return r; };
const FACTORIES = {
  js: ({ seed = 1, scale, place = sky } = {}) => jsModel({ rng: seeded(seed), place, ...(scale ? { scale: hostSnap(scale) } : {}) }),
  core: ({ seed = 1, scale, place = sky } = {}) => coreModel({ seed, scale, place }),
};
const toSky = (p) => ({ h: -p.y / (S * K), u: p.x / S });   // точка свода (px) → (h, u), обратное к sky

for (const [name, make] of Object.entries(FACTORIES)) {
  test(`Firmamentum [${name}]: звёзды занимают слоты, лишняя не встаёт, закрытая освобождает слот`, () => {
    const m = make({ seed: 1 }), ev = [];
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

  test(`Firmamentum [${name}]: высота — частота пульсаций (limen — 20 Гц), место по своду — формант, лад — ступени`, () => {
    const m = make(), at = (h, u = 0) => m.fp(m.addStar(h, u)), ffAt = (u) => m.ff(m.addStar(0.5, u));
    assert.ok(near(at(0), 0.7)); assert.ok(near(at(1), 520)); assert.ok(near(at(LIMEN), 20));
    assert.ok(near(ffAt(-1), 140)); assert.ok(near(ffAt(1), 4800));
    const minor = { on: true, idx: 1, root: 3 };          // лад хоста: минор от C (3 полутона от A)
    const q = make({ scale: minor }), f = q.fp(q.addStar(0.85, 0)), st = 12 * Math.log2(f / 55);
    assert.ok(near(st, Math.round(st), 1e-6) && inHostScale(minor, Math.round(st)), `${f} Hz — ${st} st`);
    m.clear();
    assert.ok(near(q.fp(q.addStar(0.1, 0)), at(0.1)));    // ниже 27.5 Гц — ритм, лад не трогает
  });

  test(`Firmamentum [${name}]: комета пролетает по своду, звезда на её пути пульсирует до двух октав быстрее, потом отпускает`, () => {
    const m = make({ seed: 7 }), fps = [];
    m.listen((e) => { if (e.t === 'fp') fps.push(m.fp(e.s)); });
    const s = m.addStar(0.3, 0);
    m.setFx('cometa', 1); m.launch(); m.tick(0.01);
    const c = m.state.comet;
    assert.ok(c && m.state.comets === 1, 'comet launched');
    assert.ok(c.dur >= 3.5 && c.dur <= 6.5);
    m.tick(c.dur / 2 - 0.01);                           // середина пути — поставить звезду прямо туда
    const q = toSky(m.cometAt());
    m.moveStar(s, q.h, q.u);
    const base = m.fp(s) / (s.cm ?? 1);                 // частота без кометы — на новом месте
    m.tick(0.04);                                       // частота уходит в звук не чаще ~30 раз в секунду
    assert.ok(s.cm > 3.7 && s.cm <= 4, `cm ${s.cm}`);
    assert.ok(Math.max(...fps) > 3.5 * base, 'fp sent faster');
    m.tick(c.dur);                                      // пролетела — пульсация прежняя
    assert.equal(m.state.comet, null); assert.equal(s.cm, 1);
    assert.ok(near(m.fp(s), base)); assert.ok(base > 0);
  });

  test(`Firmamentum [${name}]: drift — форманты плывут, раз в 0.1 с`, () => {
    const m = make({ seed: 3 }), ff = [];
    m.listen((e) => { if (e.t === 'ff') ff.push(m.ff(e.s)); });
    m.addStar(0.5, 0); m.setFx('drift', 1);
    for (let i = 0; i < 60; i++) m.tick(1 / 60);
    assert.ok(ff.length >= 8 && ff.length <= 11, `${ff.length} updates per second`);
    assert.ok(new Set(ff.map((x) => x.toFixed(3))).size > 3, 'formant moves');
  });

  test(`Firmamentum [${name}]: снимок → restore — та же сцена; кубик с тем же зерном — та же сцена`, () => {
    const a = make({ seed: 11 }), b = make({ seed: 11 });
    a.dice(); b.dice();
    assert.equal(a.snapshot(), b.snapshot());
    const n = a.state.stars.length;
    assert.ok(n >= 3 && n <= 4, `dice: ${n} stars`);
    assert.equal(a.state.stars.filter((s) => s.h < LIMEN).length, 1, 'one rhythm below limen');
    a.setFx('hall', 0.9);
    const js = a.snapshot(), c = make({ seed: 5 });
    c.addStar(0.9, 0.9);
    c.restore(js);
    assert.equal(c.snapshot(), js);
  });
}

// ---------- JS-модель ↔ ядро: одно зерно, одни действия, шаг 128 сэмплов ----------
const KEYS = ['slot', 'id', 'h', 'u', 'cyc', 'win', 'mask', 'lvl', 'dr', 'cm'];
function same(J, C, where) {                            // состояние двух моделей — до 1e-9
  const eq = (a, b, what) => assert.ok(near(a, b), `${where}: ${what} ${a} ≠ ${b}`);
  eq(J.state.time, C.state.time, 'time');
  assert.equal(J.state.comets, C.state.comets, `${where}: comets`);
  assert.equal(!J.state.comet, !C.state.comet, `${where}: comet`);
  if (J.state.comet) for (const k of ['t0', 'dur']) eq(J.state.comet[k], C.state.comet[k], `comet.${k}`);
  if (J.state.comet) for (const e of ['a', 'b']) for (const k of ['h', 'u']) eq(J.state.comet[e][k], C.state.comet[e][k], `comet.${e}.${k}`);
  assert.equal(J.state.stars.length, C.state.stars.length, `${where}: stars`);
  J.state.stars.forEach((j, i) => {
    const c = C.state.stars[i];
    for (const k of KEYS) eq(k === 'cm' ? (j.cm ?? 1) : j[k], c[k], `star ${i} ${k}`);
    eq(J.fp(j), C.fp(c), `star ${i} fp`); eq(J.ff(j), C.ff(c), `star ${i} ff`);
  });
}
const sameJson = (a, b, path = '') => {                 // разобранные снимки: те же ключи и порядок, числа до 1e-12
  if (typeof a === 'number') return assert.ok(typeof b === 'number' && Math.abs(a - b) < 1e-12, `${path}: ${a} ≠ ${b}`);
  if (a === null || typeof a !== 'object') return assert.equal(a, b, path);
  assert.deepEqual(Object.keys(a), Object.keys(b), path);
  for (const k of Object.keys(a)) sameJson(a[k], b[k], `${path}.${k}`);
};

test('Firmamentum: JS-модель ↔ ядро — то же состояние до 1e-9 (зерно 7, лад минор от C)', () => {
  const opts = { seed: 7, scale: { on: true, idx: 1, root: 3 } };
  const J = FACTORIES.js(opts), C = FACTORIES.core(opts), dt = 128 / SR;
  const both = (fn, where) => { fn(J); fn(C); same(J, C, where); };
  both((m) => m.addStar(0.2, -0.5), 'add 1');
  both((m) => m.addStar(0.5, 0.1), 'add 2');
  both((m) => m.addStar(0.72, 0.6), 'add 3');
  both((m) => m.addStar(0.9, -0.2), 'add 4');
  both((m) => m.moveStar(m.state.stars[1], 0.62, 0.3), 'move');
  both((m) => m.setStar(m.state.stars[2], { cyc: 5, win: 0.35, mask: 0.3, lvl: 0.6 }), 'set');
  both((m) => m.setFx('drift', 0.8), 'fx drift');
  both((m) => m.setFx('cometa', 1), 'fx cometa');
  both((m) => m.launch(), 'launch');
  const steps = Math.round(20 / dt);
  let comets = 0;
  for (let k = 0; k < steps; k++) { both((m) => m.tick(dt), `step ${k}`); comets = J.state.comets; }
  assert.ok(comets >= 2, `${comets} comets in 20 s`);
  both((m) => m.dice(), 'dice');
  const js = J.snapshot(), cs = C.snapshot();
  sameJson(JSON.parse(js), JSON.parse(cs));
  both((m) => m.restore(m === J ? js : cs), 'restore');
  for (let k = 0; k < Math.round(2 / dt); k++) both((m) => m.tick(dt), `after restore ${k}`);   // фазы drift после restore — те же
});
