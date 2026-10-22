// Тесты модели Horologium (worlds/horologium/model.js) в Node: маятник (энергия ↔ скорость, бросок, перекидка), ход к темпу,
// удары за оборот (обертон, унтертон, aequalis), отношение и имя, снимок, кубик с зерном.
//   node --test tools/models/horologium.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel, uOfE, eOfU, ET, OM0, MAGIC, Z } from '../../worlds/horologium/model.js';
import { seeded, near } from './util.mjs';

const events = (m) => { const ev = []; m.listen((e) => ev.push(e)); return ev; };

test('Horologium: энергия маятника ↔ скорость хода — туда и обратно; на темпе u = 0, края −3…8', () => {
  assert.ok(near(uOfE(ET), 0) && near(eOfU(0), ET));
  for (const u of [-2.5, -1, 0.3, 2, 5, 7.9]) assert.ok(near(uOfE(eOfU(u)), u, 1e-9), `${u}`);
  assert.equal(uOfE(ET / 1000), -3); assert.equal(uOfE(ET * 1e6), 8);
  assert.ok(near(eOfU(0.9), 2 * ET));                   // 0.9 октавы — вдвое больше энергии
});

test('Horologium: отпустил маятник — поймал у низа — стоп; бросил — ход из энергии; перекинул (e ≥ 1.95) — крутится', () => {
  const m = createModel(), { clock, pend } = m.state, ev = events(m);
  m.setRun(true); m.grab(0.2); assert.ok(pend.held && !pend.spin && pend.th === 0.2);
  assert.deepEqual(ev.splice(0).map((e) => e.t), ['wake', 'speed', 'wake']);
  m.release(0.2, 0.1); assert.ok(!pend.held && !clock.run, 'у низа и тихо — стоп');
  m.grab(0); m.release(0.04, 0.02); assert.ok(!clock.run, 'e < ET/6 — стоп');
  m.grab(0.8); ev.length = 0;
  const om = 3, e = (om / OM0) ** 2 / 2 + (1 - Math.cos(0.8));
  m.release(0.8, om);
  assert.ok(clock.run && near(clock.u, uOfE(e)) && !pend.spin && clock.u > 0.5);
  assert.ok(near(Math.sin(pend.ph) * Math.acos(1 - e), 0.8, 1e-9), 'фаза качания — с того места, где отпустил');
  assert.deepEqual(ev.map((x) => x.t), ['wake']);
  m.grab(-0.8); m.release(-0.8, -3); assert.ok(near(Math.acos(1 - e) * Math.sin(pend.ph), -0.8, 1e-9) && pend.ph > Math.PI / 2, 'бросил влево — фаза на обратном ходу');
  m.grab(2.5); m.release(2.5, 9); assert.ok(clock.run && pend.spin, 'через верх — крутится');
  assert.ok((9 / OM0) ** 2 / 2 + (1 - Math.cos(2.5)) >= 1.95);
});

test('Horologium: ход успокаивается к uT — сверху с τ 6 с, снизу с τ 1.5 с; шкала держит; стоп — маятник повисает', () => {
  const m = createModel(), { clock, pend } = m.state;
  m.setRun(true, 3); const dt = 0.01;
  for (let k = 0; k < 600; k++) m.tick(dt);             // 6 с
  assert.ok(near(clock.u, 3 * (1 - dt / 6) ** 600, 1e-12) && near(clock.u, 3 / Math.E, 0.01), `${clock.u}`);
  m.setRun(true, -2); for (let k = 0; k < 150; k++) m.tick(dt);   // 1.5 с
  assert.ok(near(clock.u, -2 / Math.E, 0.01), `${clock.u}`);
  clock.uT = 1; m.holdStrip(4); assert.ok(clock.strip && clock.u === 4 && clock.uT === 4);
  for (let k = 0; k < 100; k++) m.tick(dt); assert.equal(clock.u, 4, 'палец на шкале — скорость стоит');
  m.freeStrip(); m.dragStrip(20); assert.equal(clock.u, 8.5); m.resetSpeed(); assert.ok(clock.u === 0 && clock.uT === 0);
  m.setRun(true, 0); for (let k = 0; k < 37; k++) m.tick(dt);   // на темпе: качается с размахом 0.3 рад, Z/2 качаний за оборот
  const A = Math.acos(1 - ET); assert.ok(Math.abs(pend.th) <= A + 1e-12 && near(A, 0.3, 1e-3));
  m.stop(); pend.th = 0.3; m.tick(1); assert.ok(near(pend.th, 0.3 * Math.exp(-3)));
  m.setRun(true, 7.5); m.tick(0.01); assert.ok(pend.spin, 'u = 7.5 — энергия за 1.95, крутится');
  assert.equal(Z, 4);
});

test('Horologium: скорость в worklet — по событию, только когда заметно сменилась; спуск руками — шаг 1/Z', () => {
  const m = createModel({ scale: { on: true, root: 3 } }), ev = events(m), { clock } = m.state;
  assert.ok(near(m.baseB(), 55 * 2 ** (3 / 12)));
  m.tick(0.01); assert.deepEqual(ev.splice(0), [{ t: 'speed', F: 0, B: m.baseB() }]);
  m.tick(0.01); assert.equal(ev.length, 0);
  m.setRun(true, 0); ev.length = 0; m.tick(0.01);
  assert.deepEqual(ev.splice(0), [{ t: 'speed', F: 100 / 240, B: m.baseB() }]);   // оборот — такт: bpm / 240
  m.setBpm(100.3); m.tick(0.01); assert.equal(ev.length, 0, '0.3 % — не шлём');
  m.setBpm(101); m.tick(0.01); assert.equal(ev.length, 1);
  m.grab(0.3); ev.length = 0;
  m.swing(0.3, 0.1); m.swing(0.1, -0.2); m.swing(-0.2, 0.25); m.swing(0.25, 2.5); m.swing(2.5, -2.5);
  assert.deepEqual(ev, [{ t: 'step', d: 0.25 }, { t: 'step', d: 0.25 }]);   // через верх — не спуск
  assert.equal(m.handSteps, 2); assert.equal(m.state.pend.th, -2.5);
  assert.ok(clock.run && m.Fnow() === 0, 'держишь маятник — колесо стоит');
});

test('Horologium: удары за оборот — обертон n, унтертон 12/n, aequalis тянет к полутону; отношение и имя', () => {
  const m = createModel(), { rings, fx } = m.state;
  const r5 = rings[3], r7 = rings[5];
  assert.equal(m.mOf(r5), 5); r5.under = true; assert.equal(m.mOf(r5), 12 / 5);
  fx.aequalis = 1; assert.ok(near(m.mOf(r5), 2 ** (Math.round(12 * Math.log2(2.4)) / 12)));
  assert.ok(near(m.mOf(r7), 2 ** (34 / 12)), 'седьмая гармоника → 34 полутона');
  fx.aequalis = 0.5; assert.ok(near(m.mOf(r7), Math.sqrt(7 * 2 ** (34 / 12))));
  fx.aequalis = 0; r5.under = false;
  assert.deepEqual(m.ratio(0.5), { a: 'IV : V : VI', b: 'rhythmus · 4 · 5 · 6 ictus in circuitu · trias harmonica' });
  assert.deepEqual(m.ratio(55 / 4), { a: 'IV : V : VI', b: 'tonus — trias harmonica · A1 C#2 E2' });
  rings.forEach((r) => { r.on = [4, 5, 6].includes(r.n); r.under = true; });
  assert.ok(m.ratio(0.5).b.endsWith('trias mollis') && m.ratio(0.5).a === '1/IV : 1/V : 1/VI');
  rings.forEach((r) => { r.on = false; }); assert.deepEqual(m.ratio(1), { a: 'quies', b: 'tap a ring' });
});

test('Horologium: кольца — тап, двойной тап, фаза, плашка — события; снимок → restore — тот же JSON', () => {
  const m = createModel(), ev = events(m), { rings } = m.state;
  m.toggleRing(0); m.toggleRing(0); m.toggleUnder(1); m.setPhase(2, 0.3); m.setRing(3, 'on', 0.2); m.setRing(3, 'lvl', 0.5);
  assert.deepEqual(ev.splice(0).map((e) => e.t), ['all', 'wake', 'all', 'all', 'wake', 'rings', 'all', 'all']);
  assert.ok(!rings[0].on && rings[1].on && rings[1].under && rings[2].phi === 0.3 && !rings[3].on && rings[3].lvl === 0.5);
  m.setFx('hall', 0.6); m.loadFx({ materia: 0.9 }); assert.deepEqual(ev.splice(0).map((e) => e.t), ['fx', 'fx']);
  m.setBpm(133); m.setRun(true, 1.5); m.state.clock.uT = 0.5;
  const js = m.snapshot(), o = JSON.parse(js);
  assert.deepEqual(Object.keys(o), ['r', 'fx', 'bpm', 'run', 'u', 'uT']);
  assert.deepEqual(Object.keys(o.r[0]), ['on', 'under', 'phi', 'lvl']);
  const q = createModel(), qe = events(q);
  q.restore(js); assert.equal(q.snapshot(), js);
  assert.deepEqual(qe.map((e) => e.t), ['fx', 'all']);
  q.restore(JSON.stringify({ gears: [] })); assert.equal(q.snapshot(), js, 'снимок старого Horologium — не наш');
  q.clear(); assert.ok(!q.sounding() && q.state.rings.every((r) => !r.on) && !q.state.clock.run);
});

test('Horologium: кубик с зерном повторяем — волшебное отношение, часы идут на темпе', () => {
  const a = createModel({ rng: seeded(42) }), b = createModel({ rng: seeded(42) });
  a.dice(); b.dice();
  assert.equal(a.snapshot(), b.snapshot());
  for (let k = 0; k < 40; k++) {
    const m = createModel({ rng: seeded(k) }); m.dice();
    const on = m.state.rings.filter((r) => r.on).map((r) => r.n);
    assert.ok(MAGIC.some((s) => s.length === on.length && s.every((n, j) => n === on[j])), `${on}`);
    assert.ok(m.state.clock.run && m.state.clock.u === 0 && m.state.clock.uT === 0 && m.sounding());
    assert.ok(m.state.rings.filter((r) => r.phi > 0).length <= 1);
  }
});
