// Тесты модели Arcadia (worlds/arcadia/model.js) в Node без браузера: страна из зерна, странники, след, снимок, кубик.
//   node --test tools/models/arcadia.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel, genLand, GX, GY, VMAX, SEED0, depthOf } from '../../worlds/arcadia/model.js';

// повторяемая случайность для моделей (mulberry32)
const seeded = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

test('Arcadia: одно зерно — одна страна, другое зерно — другая', () => {
  const a = genLand(12345), b = genLand(12345), c = genLand(777);
  assert.equal(a.z.length, GX * GY);
  assert.deepEqual([...a.z], [...b.z]); assert.deepEqual([...a.lake], [...b.lake]);
  assert.deepEqual(a.peaks, b.peaks); assert.deepEqual(a.lakes, b.lakes); assert.deepEqual(a.rivers, b.rivers);
  assert.notDeepEqual([...a.z], [...c.z]);
  assert.ok(Math.max(...a.z.map(Math.abs)) <= 1 + 1e-6, 'рельеф нормирован в −1…1');
  assert.ok(a.lakes.length >= 2 && a.peaks.length >= 1 && a.peaks[0].name, 'озёра и вершины с именами');
  assert.ok([...a.lake].some((m) => m > 0.5), 'есть вода');
});

test('Arcadia: странники — слоты, нота вглубь выше, лад — ступени, ушедший освобождает слот', () => {
  const m = createModel({ rng: seeded(1) }), ev = [];
  m.listen((e) => ev.push(e));
  assert.equal(m.state.land.seed, SEED0);
  const ts = Array.from({ length: VMAX }, (_, i) => m.addT(i / VMAX - 0.5, -0.5 + i * 0.4));
  assert.deepEqual(ts.map((t) => t.slot), [0, 1, 2, 3]);
  assert.equal(m.addT(0, 0), null);
  assert.ok(m.hzOf(ts[3]) > m.hzOf(ts[0]), 'север — выше');
  assert.ok(Math.abs(m.hzOf({ v: -1, oct: 0 }) - 110) < 1e-9 && Math.abs(m.hzOf({ v: 1, oct: 0 }) - 440) < 1e-9, 'две октавы от A2');
  assert.ok(Math.abs(depthOf(-1)) < 1e-12 && Math.abs(depthOf(1) - 1) < 1e-12);
  const q = createModel({ scale: { on: true, snap: (s) => 2 * Math.round(s / 2), root: 0 } });   // лад: только чётные полутоны
  for (const v of [-0.7, -0.1, 0.33, 0.8]) { const st = 12 * Math.log2(q.hzOf({ v, oct: 0 }) / 110); assert.ok(Math.abs(st - Math.round(st)) < 1e-9 && Math.round(st) % 2 === 0, `${v}: ${st}`); }
  m.dropT(ts[1]);
  assert.equal(m.addT(0.1, 0.1).slot, 1);
  assert.deepEqual(ev.filter((e) => e.t === 'trav').slice(-2).map((e) => `${e.tr.slot}${e.on ? '+' : '-'}${e.added ? 'a' : ''}${e.route ? 'r' : ''}`), ['1-', '1+ar']);
  m.clear();
  assert.ok(!m.sounding());
});

test('Arcadia: путь river — вниз к воде, summit — вверх; новая страна пересчитывает пути', () => {
  const m = createModel(), ev = [];
  const t = m.addT(0.1, 0.5, { mode: 4 });
  const R = t.route, n = R.length / 2;
  assert.ok(n > 2, 'путь к вершине');
  assert.ok(m.zAt(R[2 * n - 2], R[2 * n - 1]) > m.zAt(R[0], R[1]), 'summit — вверх');
  m.setT(t, { mode: 3 }, true);
  const D = t.route, k = D.length / 2;
  assert.ok(m.zAt(D[2 * k - 2], D[2 * k - 1]) < m.zAt(D[0], D[1]), 'river — вниз');
  m.setT(t, { mode: 1 }, true); assert.equal(t.route, null);
  m.listen((e) => ev.push(e.t));
  m.newLand(4242);
  assert.equal(m.state.land.seed, 4242);
  assert.deepEqual(ev, ['land', 'trav']);
});

test('Arcadia: петля бродит — след блуждания идёт за центром раз в 0.12 с, у других путей следа нет', () => {
  const m = createModel(), w = m.addT(0, 0, { mode: 2 }), s = m.addT(0.5, 0.5, { mode: 0 });
  const c = Array.from({ length: VMAX }, () => [0, 0, 0.2]);
  for (let i = 0; i < 120; i++) {                       // 2 с по 1/60: центр петли (как из worklet) едет по кругу
    c[w.slot] = [0.2 * Math.cos(i / 20), 0.05 * Math.sin(i / 20), 0.16]; c[s.slot] = [0.5, 0.5, 0.16];
    m.track(c.map((q) => [...q])); m.tick(1 / 60);
  }
  assert.ok(w.trail.length >= 14 && w.trail.length <= 18, `${w.trail.length} marks in 2 s`);
  assert.ok(new Set(w.trail.map((p) => p[0].toFixed(3))).size > 10, 'след движется');
  assert.equal(s.trail.length, 0);
  for (let i = 0; i < 600; i++) m.tick(1 / 60);
  assert.equal(w.trail.length, 40, 'след — последние ~5 с');
  m.moveT(w, 0.3, 0.3); assert.equal(w.trail.length, 0, 'новый дом — след сначала');
});

test('Arcadia: снимок → restore — та же сцена; кубик с тем же зерном — та же страна и те же странники', () => {
  const a = createModel({ rng: seeded(11) }), b = createModel({ rng: seeded(11) });
  a.dice(); b.dice();
  assert.equal(a.snapshot(), b.snapshot());
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
});
