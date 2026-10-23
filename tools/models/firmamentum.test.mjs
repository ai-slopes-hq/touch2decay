// Тесты модели Firmamentum в Node: слоты звёзд, fp/ff и limen, лад, комета, drift, снимок, кубик.
// Каждый тест — дважды: против эталонной JS-модели (tools/ref/firmamentum-model.js) и против модели ядра (t2d.wasm) через фасад
// веба worlds/firmamentum/model.js (порт — firmamentum-core.mjs). Плюс сверка «JS-модель ↔ ядро»: одно зерно, одни действия,
// шаг 128 сэмплов — состояние до 1e-9. Ниже — фасад на асинхронном порту: звезда под пальцем, закрытая ядром; id без гонок.
//   core/build.sh && node --test tools/models/firmamentum.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel as jsModel, SMAX, LIMEN } from '../ref/firmamentum-model.js';
import { createModel as coreModel, sky, S, K, SR, SLOT, ACT } from './firmamentum-core.mjs';
import { scl, snapSemi, inScale } from '../../host/scale.js';
import { seeded, near } from './util.mjs';

// лад хоста {on, idx, root} для JS-модели: snapSemi из host/scale.js (у него общее состояние scl — ставим на время вызова)
const hostSnap = ({ on, idx, root }) => ({
  on, snap(s) { const keep = { ...scl }; Object.assign(scl, { on, idx, root }); const r = snapSemi(s); Object.assign(scl, keep); return r; },
});
const inHostScale = ({ idx, root }, n) => { const keep = { ...scl }; Object.assign(scl, { on: true, idx, root }); const r = inScale(n); Object.assign(scl, keep); return r; };
const FACTORIES = {
  js: ({ seed = 1, scale, place = sky } = {}) => jsModel({ rng: seeded(seed), place, ...(scale ? { scale: hostSnap(scale) } : {}) }),
  core: ({ seed = 1, scale, place = sky, async } = {}) => coreModel({ seed, scale, place, async }),
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
    eq(J.fp(j), c.fp, `star ${i} fp (core)`); eq(J.ff(j), c.ff, `star ${i} ff (core)`);   // частоты, которые посчитало ядро (зеркало)
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
  both((m) => (m === J ? m.dice() : m.coreDice()), 'dice');   // кубик ядра (его rng): фасад веба кидает кубик сам — см. ниже
  const js = J.snapshot(), cs = C.snapshot();
  sameJson(JSON.parse(js), JSON.parse(cs));
  both((m) => m.restore(m === J ? js : cs), 'restore');
  for (let k = 0; k < Math.round(2 / dt); k++) both((m) => m.tick(dt), `after restore ${k}`);   // фазы drift после restore — те же
});

// ---------- фасад веба на асинхронном порту (как t2d-worklet.js: сообщения доходят позже, зеркало ~60 раз в секунду) ----------
const facadeAsync = (seed = 3) => FACTORIES.core({ seed, async: true });

test('Firmamentum фасад: звезду под пальцем закрыло ядро — её нет в stars, moveStar / setStar / closeStar — мимо, без ошибки', () => {
  for (const how of ['dice', 'clear', 'restore', 'core']) {
    const m = facadeAsync(), off = [];
    m.listen((e) => { if (e.t === 'star' && !e.on) off.push(e.s); });
    const s = m.addStar(0.4, 0.2); m.addStar(0.7, -0.3);
    m.tick(0.01);
    const held = m.state.stars[0];
    assert.equal(held, s, 'the same live object after the mirror');
    if (how === 'dice') m.dice();
    else if (how === 'clear') m.clear();
    else if (how === 'restore') m.restore(JSON.stringify({ s: [{ h: 0.6, u: 0 }], fx: {} }));
    else { m.core.action(SLOT, ACT.dice); m.deliver(); }   // ядро само (мимо фасада): зеркало без звезды
    assert.ok(!m.state.stars.includes(held), `${how}: the held star is not live`);
    assert.ok(off.includes(held), `${how}: star off event`);
    m.flush(); m.deliver();
    assert.ok(!m.state.stars.includes(held), `${how}: still not live after the mirror`);
    const ids = m.coreIds().join(), scene = m.core.snapshot(SLOT);
    m.moveStar(held, 0.9, 0.9); m.setStar(held, { cyc: 7 }); m.closeStar(held);
    m.flush();
    assert.equal(m.core.snapshot(SLOT), scene, `${how}: the core scene is untouched`);
    m.tick(0.01);
    assert.equal(m.coreIds().join(), ids, `${how}: nothing reached the core`);
    assert.ok(!m.state.stars.includes(held));
    assert.ok(m.state.stars.every((q) => m.coreStar(q.id)), `${how}: facade stars == core stars`);
    assert.equal(m.state.stars.length, m.coreIds().length);
  }
});

test('Firmamentum фасад: кубик / restore, сразу addStar без зеркала — id тот же в ядре, move и close попадают в неё', () => {
  for (const how of ['dice', 'restore', 'rebind']) {
    const m = facadeAsync(5);
    m.addStar(0.3, 0); m.addStar(0.5, 0.5); m.tick(0.01);
    if (how === 'dice') m.dice();
    else if (how === 'restore') m.restore(JSON.stringify({ s: [{ h: 0.2, u: -0.5 }, { h: 0.8, u: 0.1, cyc: 5 }], fx: { hall: 0.7 } }));
    else { const js = m.snapshot(); m.rebind(); m.restore(js); }   // новый узел ядра, как restartAudio: снимок → build (bind) → restore
    const a = m.addStar(0.66, 0.33);                    // ядро ещё не видело ни кубика, ни звезды
    const local = m.state.stars.map((s) => `${s.slot}:${s.id}`).join();
    m.flush();
    const c = m.coreStar(a.id);
    assert.ok(c, `${how}: the new star is in the core by its id ${a.id}`);
    assert.deepEqual([c.h, c.u, c.slot], [0.66, 0.33, a.slot], `${how}: the same star`);
    m.deliver();
    assert.equal(m.state.stars.map((s) => `${s.slot}:${s.id}`).join(), local, `${how}: the mirror agrees with the facade`);
    assert.ok(m.state.stars.includes(a), `${how}: the same object`);
    m.moveStar(a, 0.71, -0.2); m.flush();
    assert.deepEqual([m.coreStar(a.id).h, m.coreStar(a.id).u], [0.71, -0.2], `${how}: move hits it`);
    const others = m.coreIds().filter((id) => id !== a.id);
    m.closeStar(a); m.flush();
    assert.equal(m.coreStar(a.id), null, `${how}: close hits it`);
    assert.deepEqual(m.coreIds(), others, `${how}: the others stay`);
  }
});

test('Firmamentum фасад: зеркало не перетирает свои правки в пути, не возвращает закрытую, не теряет добавленную', () => {
  const m = facadeAsync(), s = m.addStar(0.3, 0.1);
  m.tick(0.01);
  m.moveStar(s, 0.5, 0.2);                              // ядро ещё на 0.3
  m.deliver();
  assert.deepEqual([s.h, s.u], [0.5, 0.2], 'a stale mirror does not pull the star back');
  const t = m.addStar(0.8, 0); m.deliver();
  assert.ok(m.state.stars.includes(t), 'a star added here survives a mirror that has not seen it');
  m.closeStar(s); m.deliver();
  assert.ok(!m.state.stars.includes(s) && m.state.stars.length === 1, 'a star closed here does not come back');
  m.tick(0.01);
  assert.deepEqual(m.state.stars.map((q) => q.id), m.coreIds(), 'after the core caught up — the same stars');
  assert.ok(near(m.coreStar(t.id).h, 0.8));
});

test('Firmamentum фасад: снимок → restore → зеркало — снимок тот же (числа через ядро без потерь, лишних шагов отмены нет)', () => {
  const m = FACTORIES.core({ seed: 4 });
  m.dice(); m.setFx('hall', 0.1 + 0.2); m.setStar(m.state.stars[1], { win: 1 / 3, lvl: 0.7000000000000001 });
  const js = m.snapshot();
  m.tick(0.05);
  assert.equal(m.snapshot(), js);
  const q = facadeAsync(8);
  q.restore(js);
  assert.equal(q.snapshot(), js, 'restore — at once, before the core');
  q.tick(0.05);
  assert.equal(q.snapshot(), js, 'and after the mirror');
  assert.deepEqual(JSON.parse(q.core.snapshot(SLOT)), JSON.parse(js), 'the core has the same scene (numbers — bit for bit)');
});
