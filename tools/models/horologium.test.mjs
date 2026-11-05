// Тесты модели Horologium в Node: удары за оборот (обертон, унтертон, aequalis), отношение и имя, снимок, кубик с зерном, фильтр flt. Каждый тест — дважды: против эталонной JS-модели (tools/ref/horologium-model.js)
// и против ядра (t2d.wasm) через фасад веба worlds/horologium/model.js (порт — horologium-core.mjs): ход у ядра успокаивается в его блоках.
//   core/build.sh && node --test tools/models/horologium.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel as jsModel, LENS } from '../ref/horologium-model.js';
import * as facade from '../../worlds/horologium/model.js';
import { createModel as coreModel } from './horologium-core.mjs';
import { seeded, near } from './util.mjs';

const FACTORIES = { js: (o = {}) => jsModel(o), core: (o = {}) => coreModel({ ...o, ...(o.rng ? { rng: o.rng } : {}) }) };

test('Horologium: константы фасада — те же, что у эталона; маятника и шкалы в фасаде нет', () => {
  for (const k of ['NR', 'LENS', 'NAMES', 'ROMAN']) assert.deepEqual(facade[k], { NR: 8, LENS, NAMES: facade.NAMES, ROMAN: facade.ROMAN }[k], k);
  for (const k of ['Z', 'ET', 'OM0', 'uOfE', 'eOfU']) assert.equal(facade[k], undefined, k);
  const m = facade.createModel(), st = m.state;
  assert.equal(st.pend, undefined); assert.deepEqual(Object.keys(st.clock), ['run', 'bpm']);
  for (const k of ['grab', 'swing', 'tapPendulum', 'release', 'holdStrip', 'dragStrip', 'freeStrip', 'resetSpeed', 'handSteps']) assert.equal(m[k], undefined, k);
});

const events = (m) => { const ev = []; m.listen((e) => ev.push(e)); return ev; };

test('Horologium [js]: скорость в worklet — по событию, только когда заметно сменилась', () => {
  const m = jsModel({ scale: { on: true, root: 3 } }), ev = events(m), { clock } = m.state;   // прежний протокол worklet — только у эталона
  assert.ok(near(m.baseB(), 55 * 2 ** (3 / 12)));
  m.tick(0.01); assert.deepEqual(ev.splice(0), [{ t: 'speed', F: 0, B: m.baseB() }]);
  m.tick(0.01); assert.equal(ev.length, 0);
  m.setRun(true); ev.length = 0; m.tick(0.01);
  assert.deepEqual(ev.splice(0), [{ t: 'speed', F: 100 / 240, B: m.baseB() }]);   // оборот — такт: bpm / 240
  m.setBpm(100.3); m.tick(0.01); assert.equal(ev.length, 0, '0.3 % — не шлём');
  m.setBpm(101); m.tick(0.01); assert.equal(ev.length, 1);
  assert.ok(clock.run);
});

for (const [name, createModel] of Object.entries(FACTORIES)) {
test(`Horologium [${name}]: удары за оборот — обертон n, унтертон 12/n, aequalis тянет к полутону; отношение и имя`, () => {
  const m = createModel(), { rings, fx } = m.state;
  rings.forEach((r) => { r.on = [4, 5, 6].includes(r.n); });   // умолчание — II, III, IV
  const r5 = rings[3], r7 = rings[5];
  assert.equal(m.mOf(r5), 5); r5.under = 1; assert.equal(m.mOf(r5), 12 / 5);
  fx.aequalis = 1; assert.ok(near(m.mOf(r5), 2 ** (Math.round(12 * Math.log2(2.4)) / 12)));
  assert.ok(near(m.mOf(r7), 2 ** (34 / 12)), 'седьмая гармоника → 34 полутона');
  fx.aequalis = 0.5; assert.ok(near(m.mOf(r7), Math.sqrt(7 * 2 ** (34 / 12))));
  fx.aequalis = 0; r5.under = 0;
  assert.deepEqual(m.ratio(0.5), { a: 'IV : V : VI', b: 'rhythmus · 4 · 5 · 6 ictus in circuitu · trias harmonica' });
  assert.deepEqual(m.ratio(55 / 4), { a: 'IV : V : VI', b: 'tonus — trias harmonica · A1 C#2 E2' });
  rings.forEach((r) => { r.on = [4, 5, 6].includes(r.n); r.under = 1; });
  assert.ok(m.ratio(0.5).b.endsWith('trias mollis') && m.ratio(0.5).a === '1/IV : 1/V : 1/VI');
  rings.forEach((r) => { r.on = false; }); assert.deepEqual(m.ratio(1), { a: 'quies', b: 'tap a ring' });
});

test(`Horologium [${name}]: кольца — тап, двойной тап, фаза, плашка — события; снимок → restore — тот же JSON`, () => {
  const m = createModel(), ev = events(m), { rings } = m.state;
  m.toggleRing(5); m.toggleRing(5); m.toggleUnder(1); m.setPhase(2, 0.3); m.setRing(3, 'on', 0.2); m.setRing(3, 'lvl', 0.5);
  assert.deepEqual(ev.splice(0).map((e) => e.t), ['all', 'wake', 'all', 'all', 'wake', 'rings', 'all', 'all']);
  assert.ok(!rings[5].on && rings[1].on && rings[1].under && rings[2].phi === 0.3 && !rings[3].on && rings[3].lvl === 0.5);
  m.setFx('hall', 0.6); m.loadFx({ materia: 0.9 }); assert.deepEqual(ev.splice(0).map((e) => e.t), ['fx', 'fx']);
  m.setBpm(133); m.setRun(true); m.setRing(4, 'flt', 0.2);
  const js = m.snapshot(), o = JSON.parse(js);
  assert.deepEqual(Object.keys(o), ['r', 'fx', 'bpm', 'run']);
  assert.deepEqual(Object.keys(o.r[0]).filter((k) => k !== 'inst'), ['on', 'under', 'phi', 'lvl', 'len', 'flt']);   // inst — только у фасада
  const q = createModel(), qe = events(q);
  q.restore(js); assert.equal(q.snapshot(), js);
  assert.deepEqual(qe.map((e) => e.t), ['fx', 'all']);
  q.restore(JSON.stringify({ gears: [] })); assert.equal(q.snapshot(), js, 'снимок старого Horologium — не наш');
  q.clear(); assert.ok(!q.sounding() && q.state.rings.every((r) => !r.on) && !q.state.clock.run);
});

test(`Horologium [${name}]: кубик с зерном повторяем — три соседних кольца, len из набора, сдвиг целый, часы идут на темпе`, () => {
  const a = createModel({ rng: seeded(42) }), b = createModel({ rng: seeded(42) });
  a.dice(); b.dice();
  assert.equal(a.snapshot(), b.snapshot());
  const firsts = new Set(); let nF = 0;
  for (let k = 0; k < 40; k++) {
    const m = createModel({ rng: seeded(k) }); m.dice();
    const rs = m.state.rings, on = rs.filter((r) => r.on).map((r) => r.n);
    assert.equal(on.length, 3, `${on}`);
    assert.ok(on[0] >= 2 && on[0] <= 7 && on[1] === on[0] + 1 && on[2] === on[0] + 2, `${on}`);
    firsts.add(on[0]);
    assert.ok(rs.every((r) => r.under === rs[0].under && r.lvl === 0.8));
    for (const r of rs) {
      if (r.on) { assert.ok(LENS.includes(r.len), `len ${r.len}`); const sh = r.phi * r.len; assert.ok(Math.abs(sh - Math.round(sh)) < 1e-9 && sh >= 0 && sh <= r.len - 1, `phi ${r.phi} len ${r.len}`); }
      else assert.ok(r.len === 16 && r.phi === 0);
    }
    assert.ok(m.state.clock.run && m.sounding());
    const fl = rs.filter((r) => r.flt !== 0.5);
    assert.ok(fl.length <= 1 && fl.every((r) => r.on && r.flt >= 0.30 && r.flt <= 0.65), `flt ${rs.map((r) => r.flt)}`);
    nF += fl.length;
  }
  assert.ok(firsts.size >= 4, [...firsts].join());
  assert.ok(nF > 3 && nF < 40, `фильтр на ${nF} из 40`);
});

test(`Horologium [${name}]: умолчание — звучат II, III, IV, len 16; len в снимке, старая сцена без len — 16, корзина — 16`, () => {
  const m = createModel(), rs = m.state.rings;
  assert.deepEqual(rs.map((r) => r.on), [true, true, true, false, false, false, false, false]);
  assert.ok(rs.every((r) => r.len === 16 && r.phi === 0));
  rs[3].len = 12; m.setRing(3, 'len', 12);
  const js = m.snapshot(), o = JSON.parse(js);
  assert.equal(o.r[3].len, 12); assert.ok(o.r.every((q, i) => q.len === (i === 3 ? 12 : 16)));
  const q = createModel(); q.restore(js); assert.equal(q.state.rings[3].len, 12);
  q.restore(JSON.stringify({ ...o, r: o.r.map(({ len, ...x }) => x) }));
  assert.ok(q.state.rings.every((r) => r.len === 16), 'старая сцена без len');
  q.restore(js); q.clear(); assert.ok(q.state.rings.every((r) => r.len === 16));
});

}

test('Horologium facade: inst — default kit, mirror 67, snapshot, old scene, clear', () => {
  const m = facade.createModel();
  assert.deepEqual(m.state.rings.map((r) => r.inst), [0, 1, 2, 3, 4, 5, 6, 7]);
  const js = JSON.parse(m.snapshot()); assert.equal(js.r[3].inst, 3);
  m.state.rings[3].inst = 6;
  m.restore(JSON.stringify({ ...js, r: js.r.map(({ inst, ...q }) => q) }));
  assert.equal(m.state.rings[3].inst, 3, 'старая сцена без inst — умолчание');
  const mir = new Array(67).fill(0); mir[11 + 7 * 2 + 4] = 7;   // кольцо IV — open hat
  mir[11 + 7 * 2 + 5] = 12; mir[11 + 7 * 2 + 6] = 0.25;
  mir[5] = 1; mir[6] = 133; mir[7] = 0.5; mir[8] = 0.75; mir[9] = 4; mir[10] = 1;
  m.sync(mir, 1e9); assert.equal(m.state.rings[2].inst, 7); assert.equal(m.state.rings[2].len, 12); assert.equal(m.state.rings[2].flt, 0.25);
  const { clock, wheel } = m.state;
  assert.ok(clock.run && clock.bpm === 133 && wheel.P === 0.5 && wheel.F === 0.75 && wheel.strikes === 4 && wheel.locked);
  m.clear(); assert.equal(m.state.rings[2].inst, 2); assert.equal(m.state.rings[2].len, 16);
  assert.equal(facade.RING_KEYS.length, 7); assert.equal(facade.RING_KEYS[5], 'len'); assert.equal(facade.RING_KEYS[6], 'flt');
  assert.equal(facade.HEAD, 11);
});

test('Horologium facade: flt — клэмп, мусор → 0.5, старый снимок с u/uT без flt открывается, flt в снимке и у ядра', () => {
  const m = facade.createModel(), rs = m.state.rings;
  assert.ok(rs.every((r) => r.flt === 0.5));
  m.setRing(1, 'flt', 0.2); assert.equal(rs[1].flt, 0.2);
  m.setRing(1, 'flt', 7); assert.equal(rs[1].flt, 1);
  m.setRing(1, 'flt', -3); assert.equal(rs[1].flt, 0);
  for (const bad of [NaN, 'x', null, undefined, {}]) { m.setRing(1, 'flt', bad); assert.equal(rs[1].flt, 0.5, String(bad)); }
  const old = { r: rs.map(({ on, under, phi, lvl, inst, len }) => ({ on, under, phi, lvl, inst, len })), fx: { ...m.state.fx }, bpm: 120, run: true, u: 2, uT: 1 };
  old.r[0].flt = 'junk'; old.r[2].flt = 0.1; old.r[3].flt = 9;
  m.restore(JSON.stringify(old));
  assert.deepEqual(rs.map((r) => r.flt), [0.5, 0.5, 0.1, 1, 0.5, 0.5, 0.5, 0.5]);
  assert.ok(m.state.clock.run && m.state.clock.bpm === 120);
  const o = JSON.parse(m.snapshot()); assert.deepEqual(Object.keys(o), ['r', 'fx', 'bpm', 'run']); assert.equal(o.r[2].flt, 0.1);
  const c = coreModel(); c.restore(JSON.stringify(old));
  assert.deepEqual(c.state.rings.map((r) => r.flt), [0.5, 0.5, 0.1, 1, 0.5, 0.5, 0.5, 0.5], 'ядро отдаёт flt в зеркало');
});

test('Horologium facade: Euclid helpers', () => {
  for (let L = 1; L <= 16; L++) for (let k = 1; k <= 9; k++) {
    let c = 0; for (let j = 0; j < L; j++) if (facade.euclid(j, k, L)) c++;
    assert.equal(c, Math.min(k, L), `k${k} L${L}`);
  }
  assert.equal(facade.euclid(0, 3, 8), true);
  for (const [phi, L, want] of [[0, 16, 0], [3 / 16, 16, 3], [0.5, 12, 6], [-0.25, 16, 12], [1, 16, 0], [0.99, 16, 0], [NaN, 16, 0], [1e300, 16, 0], [undefined, 8, 0]]) assert.equal(facade.rotOf(phi, L), want, `rot ${phi} ${L}`);
  assert.equal(facade.stepsOf({ under: 0 }), 16); assert.equal(facade.stepsOf({ under: 1 }), 8); assert.equal(facade.stepsOf({ under: 2 }), 32);
  assert.equal(facade.slotOf({ n: 2, under: 0, phi: 0, len: 16 }, 0.5), 8);
  assert.equal(facade.slotOf({ n: 2, under: 0, phi: 0, len: 12 }, 1), 4);
  assert.equal(facade.slotOf({ n: 2, under: 1, phi: 0, len: 16 }, 0.5), 4);
  assert.equal(facade.slotOf({ n: 2, under: 2, phi: 0, len: 16 }, 0.75), 8);   // ×2: 32 шага на оборот, 24 mod 16
  assert.equal(facade.slotOf({ n: 2, under: 0, phi: 3 / 16, len: 16 }, 0), 3);
  assert.equal(facade.slotOf({ n: 2, under: 0, phi: 0, len: 16 }, -0.01), 15);
  assert.equal(facade.slotOf({ n: 2, under: 0, phi: 0, len: 16 }, NaN), 0);
});
