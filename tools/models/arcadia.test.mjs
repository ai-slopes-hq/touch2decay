// Тесты модели Arcadia в Node без браузера: страна из зерна, странники, пути, след, снимок, кубик. Каждый тест (кроме чистой страны) —
// дважды: против эталонной JS-модели (tools/ref/arcadia-model.js) и против ядра (t2d.wasm) через фасад веба worlds/arcadia/model.js
// (порт — arcadia-core.mjs): у ядра странники, ноты и пути — его, центры петель — из его звука.
//   core/build.sh && node --test tools/models/arcadia.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel as jsModel, genLand as refLand } from '../ref/arcadia-model.js';
import { genLand, GX, GY, VMAX, SEED0, depthOf } from '../../worlds/arcadia/model.js';
import { createModel as coreModel } from './arcadia-core.mjs';
import { seeded } from './util.mjs';

const FACTORIES = { js: (o = {}) => jsModel(o), core: (o = {}) => coreModel(o) };

test('Arcadia: одно зерно — одна страна, другое зерно — другая; у фасада — та же genLand, что у эталона', () => {
  const a = genLand(12345), b = genLand(12345), c = genLand(777);
  assert.equal(a.z.length, GX * GY);
  assert.deepEqual([...a.z], [...b.z]); assert.deepEqual([...a.lake], [...b.lake]);
  assert.deepEqual(a.peaks, b.peaks); assert.deepEqual(a.lakes, b.lakes); assert.deepEqual(a.rivers, b.rivers);
  assert.notDeepEqual([...a.z], [...c.z]);
  assert.ok(Math.max(...a.z.map(Math.abs)) <= 1 + 1e-6, 'рельеф нормирован в −1…1');
  assert.ok(a.lakes.length >= 2 && a.peaks.length >= 1 && a.peaks[0].name, 'озёра и вершины с именами');
  assert.ok([...a.lake].some((m) => m > 0.5), 'есть вода');
  const r = refLand(12345);
  assert.deepEqual([...a.z], [...r.z]); assert.deepEqual(a.rivers, r.rivers);
});

for (const [name, createModel] of Object.entries(FACTORIES)) {
test(`Arcadia [${name}]: странники — слоты, нота вглубь выше, лад — ступени, ушедший освобождает слот`, () => {
  const m = createModel({ rng: seeded(1) }), ev = [];
  m.listen((e) => ev.push(e));
  assert.equal(m.state.land.seed, SEED0);
  const ts = Array.from({ length: VMAX }, (_, i) => m.addT(i / VMAX - 0.5, -0.5 + i * 0.4));
  assert.deepEqual(ts.map((t) => t.slot), [0, 1, 2, 3]);
  assert.equal(m.addT(0, 0), null);
  assert.ok(m.hzOf(ts[3]) > m.hzOf(ts[0]), 'север — выше');
  assert.ok(Math.abs(m.hzOf({ v: -1, oct: 0 }) - 110) < 1e-9 && Math.abs(m.hzOf({ v: 1, oct: 0 }) - 440) < 1e-9, 'две октавы от A2');
  assert.ok(Math.abs(depthOf(-1)) < 1e-12 && Math.abs(depthOf(1) - 1) < 1e-12);
  if (m.coreT) m.coreT().forEach((c, i) => assert.ok(Math.abs(c.f - m.hzOf(ts[i])) < 1e-9, `нота ядра — та же: ${c.f}`));   // pow libm и V8 — до последнего бита
  const q = createModel({ scale: { on: true, idx: 0, root: 0, snap: (s) => 2 * Math.round(s / 2) } });   // эталон: только чётные полутоны
  if (!q.coreT) for (const v of [-0.7, -0.1, 0.33, 0.8]) { const st = 12 * Math.log2(q.hzOf({ v, oct: 0 }) / 110); assert.ok(Math.abs(st - Math.round(st)) < 1e-9 && Math.round(st) % 2 === 0, `${v}: ${st}`); }
  else {                                                 // ядро: лад хоста (мажор от A) — ноты ядра и фасада в ладу и совпадают
    for (const v of [-0.7, -0.1, 0.33, 0.8]) q.addT(0, v);
    q.coreT().forEach((c, i) => { const st = Math.round(12 * Math.log2(c.f / 110)); assert.ok([0, 2, 4, 5, 7, 9, 11].includes(((st % 12) + 12) % 12), `${c.v}: ${st}`); assert.ok(Math.abs(c.f - q.hzOf(q.state.travellers[i])) < 1e-9); });
  }
  m.dropT(ts[1]);
  assert.equal(m.addT(0.1, 0.1).slot, 1);
  assert.deepEqual(ev.filter((e) => e.t === 'trav').slice(-2).map((e) => `${e.tr.slot}${e.on ? '+' : '-'}${e.added ? 'a' : ''}${e.route ? 'r' : ''}`), ['1-', '1+ar']);
  if (m.coreT) assert.deepEqual(m.coreT().map((c) => c.slot), [0, 1, 2, 3]);
  m.clear();
  assert.ok(!m.sounding());
  if (m.coreT) assert.equal(m.coreT().length, 0);
});

test(`Arcadia [${name}]: путь river — вниз к воде, summit — вверх; новая страна пересчитывает пути`, () => {
  const m = createModel(), ev = [];
  const t = m.addT(0.1, 0.5, { mode: 4 });
  const R = t.route, n = R.length / 2;
  assert.ok(n > 2, 'путь к вершине');
  assert.ok(m.zAt(R[2 * n - 2], R[2 * n - 1]) > m.zAt(R[0], R[1]), 'summit — вверх');
  m.setT(t, { mode: 3 }, true);
  const D = t.route, k = D.length / 2;
  assert.ok(m.zAt(D[2 * k - 2], D[2 * k - 1]) < m.zAt(D[0], D[1]), 'river — вниз');
  if (m.coreT) assert.equal(m.coreT()[0].mode, 3);
  m.setT(t, { mode: 1 }, true); assert.equal(t.route, null);
  m.listen((e) => ev.push(e.t));
  m.newLand(4242);
  assert.equal(m.state.land.seed, 4242);
  assert.deepEqual(ev, ['land', 'trav']);
  if (m.coreT) {                                         // ядро растит страну по кускам: звучит через ~0.16 с
    assert.ok(m.landPending());
    m.tick(0.2);
    assert.ok(!m.landPending());
    assert.equal(m.mirror()[7], 4242);
  }
});

test(`Arcadia [${name}]: петля бродит — след блуждания идёт за центром раз в 0.12 с, у других путей следа нет`, () => {
  const m = createModel(), w = m.addT(0, 0, { mode: 2 }), s = m.addT(0.5, 0.5, { mode: 0 });
  const c = Array.from({ length: VMAX }, () => [0, 0, 0.2]);
  for (let i = 0; i < 120; i++) {                       // 2 с по 1/60: центр петли (эталон — как из worklet, по кругу; ядро — свой)
    c[w.slot] = [0.2 * Math.cos(i / 20), 0.05 * Math.sin(i / 20), 0.16]; c[s.slot] = [0.5, 0.5, 0.16];
    if (!m.coreT) m.track(c.map((q) => [...q]));
    m.tick(1 / 60);
  }
  assert.ok(w.trail.length >= 14 && w.trail.length <= 18, `${w.trail.length} marks in 2 s`);
  assert.ok(new Set(w.trail.map((p) => p[0].toFixed(4))).size > 10, 'след движется');
  assert.equal(s.trail.length, 0);
  if (m.coreT) assert.ok(Math.hypot(m.state.loops.centers[s.slot][0] - 0.5, m.state.loops.centers[s.slot][1] - 0.5) < 1e-6, 'still — петля стоит дома');
  for (let i = 0; i < 600; i++) m.tick(1 / 60);
  assert.equal(w.trail.length, 40, 'след — последние ~5 с');
  m.moveT(w, 0.3, 0.3); assert.equal(w.trail.length, 0, 'новый дом — след сначала');
});

test(`Arcadia [${name}]: снимок → restore — та же сцена; кубик с тем же зерном — та же страна и те же странники`, () => {
  const a = createModel({ rng: seeded(11) }), b = jsModel({ rng: seeded(11) });
  a.dice(); b.dice();
  assert.equal(a.snapshot(), b.snapshot(), 'кубик — как у эталона');
  if (a.core) assert.equal(a.core.snapshot(12), a.snapshot(), 'снимок ядра — тот же');
  assert.notEqual(a.state.land.seed, SEED0);
  const n = a.state.travellers.length;
  assert.ok(n >= 2 && n <= 3, `dice: ${n} wanderers`);
  assert.ok(a.state.travellers.every((t) => t.mode >= 1 && t.mode <= 4));
  a.setFx('wind', 0.6);
  const js = a.snapshot(), st = JSON.parse(js);
  assert.deepEqual(Object.keys(st), ['seed', 't', 'fx']);
  assert.deepEqual(Object.keys(st.t[0]), ['u', 'v', 'oct', 'r', 'fig', 'mode', 'sp', 'lvl']);
  const c = createModel({ rng: seeded(5) });
  c.addT(0.9, 0.9);
  c.restore(js);
  assert.equal(c.snapshot(), js);
  assert.deepEqual([...c.state.land.z], [...a.state.land.z]);
  if (c.core) { assert.equal(c.core.snapshot(12), js); c.rebind(); assert.equal(c.core.snapshot(12), js, 'новый узел ядра — та же сцена'); assert.equal(c.coreT().length, n); }
});
}

test('Arcadia [core]: зеркало догоняет действия по номеру сообщения — не перетирает свежее', () => {
  const m = coreModel({ async: true }), t = m.addT(0, 0);
  m.flush(); m.deliver();
  m.setFx('wind', 0.7); m.setT(t, { r: 0.4 });
  m.deliver();                                          // ядро ещё не видело
  assert.equal(m.state.fx.wind, 0.7); assert.equal(t.r, 0.4);
  m.flush(); m.deliver();
  assert.equal(m.state.fx.wind, 0.7); assert.equal(t.r, 0.4);
  assert.equal(m.coreT()[0].r, 0.4);
});
