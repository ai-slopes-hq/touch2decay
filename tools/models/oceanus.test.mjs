// Тесты модели Oceanus в Node: слоты, высота, лад, FX и луна, снимок, кубик.
// Каждый тест — дважды: против эталонной JS-модели (tools/ref/oceanus-model.js) и против модели ядра (t2d.wasm) через фасад
// веба worlds/oceanus/model.js (порт — oceanus-core.mjs). Ниже — лад хоста в ядре и фасад на асинхронном порту (город под пальцем).
//   core/build.sh && node --test tools/models/oceanus.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel as jsModel, VMAX, FX_DEF, LUNA_DEF } from '../ref/oceanus-model.js';
import { createModel as coreModel, SLOT, ACT } from './oceanus-core.mjs';
import { hostScale } from './sdk-facade.mjs';
import { seeded, near } from './util.mjs';

const TAU = Math.PI * 2;
const FACTORIES = {
  js: ({ seed = 1, rng, scale } = {}) => jsModel({ rng: rng || seeded(seed), ...(scale ? { scale } : {}) }),
  core: ({ seed = 1, rng, async } = {}) => coreModel({ seed, rng, async }),
};
const pick = (v) => ({ slot: v.slot, ang: v.ang, rn: v.rn, pinned: v.pinned, lvl: v.lvl, oct: v.oct, path: v.path });

for (const [name, make] of Object.entries(FACTORIES)) {
  const withLog = (opts) => { const m = make(opts), ev = []; m.listen((e) => ev.push(e)); return { m, ev }; };

  test(`Oceanus [${name}]: города занимают слоты, седьмой не встаёт, ушедший освобождает слот`, () => {
    const { m, ev } = withLog({ seed: 1 });
    const vs = Array.from({ length: VMAX }, (_, i) => m.addVoice(i, 0.5, false));
    assert.deepEqual(vs.map((v) => v.slot), [0, 1, 2, 3, 4, 5]);
    assert.equal(m.addVoice(0, 0.5, false), null);
    assert.equal(ev.length, VMAX);
    assert.ok(ev.every((e) => e.t === 'voice' && e.on && e.added));
    assert.deepEqual(pick(vs[0]), { slot: 0, ang: 0, rn: 0.5, pinned: false, lvl: 0.8, oct: 0, path: 0 });
    m.dropVoice(vs[2]);
    assert.deepEqual(ev.at(-1), { t: 'voice', v: vs[2], on: false });
    assert.equal(m.state.voices.length, VMAX - 1);
    assert.equal(m.addVoice(1, 0.5, true).slot, 2);
    m.clear();
    assert.equal(m.sounding(), false);
    assert.equal(ev.filter((e) => e.t === 'voice' && !e.on).length, 1 + VMAX);
  });

  test(`Oceanus [${name}]: нота — угол по часовой полутонами, климат — октава, oct — ещё октава`, () => {
    const m = make();
    assert.ok(near(m.hz({ ang: 0, rn: 0.9 }), 55));                   // у берега, наверху — A1
    assert.ok(near(m.hz({ ang: TAU / 12, rn: 0.9 }), 55 * 2 ** (1 / 12)));   // шаг по часовой — полутон
    assert.ok(near(m.hz({ ang: 0, rn: 0.5 }), 110));                  // средний климат — октава выше
    assert.ok(near(m.hz({ ang: 0, rn: 0.1 }), 220));                  // у Иерусалима — две
    assert.ok(near(m.hz({ ang: 0, rn: 0.1, oct: -1 }), 110));
    const v = m.addVoice(0, 0.85, false), ev = [];
    m.listen((e) => ev.push(e));
    m.moveVoice(v, TAU / 4, 0.2);                                     // ведёшь город к центру: +3 полутона, +2 октавы
    assert.ok(near(m.hz(v), 55 * 2 ** (27 / 12)));
    assert.deepEqual(ev, [{ t: 'voice', v, on: true }]);
  });

  test(`Oceanus [${name}]: FX и луна — одно событие fx, вода и всплеск — события без состояния`, () => {
    const { m, ev } = withLog({});
    m.setFx('tension', 0.9); m.setLuna({ sway: 0.5, to: 2 }); m.loadFx({ hall: 0.1 });
    assert.deepEqual(ev, [{ t: 'fx' }, { t: 'fx' }, { t: 'fx' }]);
    assert.equal(m.state.fx.tension, 0.9); assert.equal(m.state.fx.hall, 0.1);
    assert.deepEqual(m.state.luna, { ...LUNA_DEF, sway: 0.5, to: 2 });
    ev.length = 0;
    m.push(7, 0.25, -1.5); m.release(7); m.splash(0.5, 0.35);
    assert.deepEqual(ev, [{ t: 'push', id: 7, a: 0.25, d: -1.5 }, { t: 'release', id: 7 }, { t: 'splash', a: 0.5, amt: 0.35 }]);
    m.tick(0.5); m.tick(0.25);                                        // своё время — только счётчик, звука не просит
    assert.equal(m.state.time, 0.75);
    assert.equal(ev.length, 3);
  });

  test(`Oceanus [${name}]: снимок — только оставленные города, fx и луна; restore возвращает то же`, () => {
    const m = make();
    const a = m.addVoice(1, 0.84, true); m.addVoice(2, 0.5, false); const c = m.addVoice(3, 0.18, true);
    m.setVoice(a, { lvl: 0.5, oct: 1, path: 2 }); m.setVoice(c, { path: 1 });
    m.setFx('wind', 0.3); m.setLuna({ orbit: 0.7, storm: 1 });
    const js = m.snapshot();
    assert.equal(js, '{"v":[{"ang":1,"rn":0.84,"lvl":0.5,"oct":1,"path":2},{"ang":3,"rn":0.18,"lvl":0.8,"oct":0,"path":1}],'
      + '"fx":{"tension":0.45,"damping":0.4,"wind":0.3,"tide":0.55,"hall":0.4},"luna":{"orbit":0.7,"storm":1,"sway":0,"to":0}}');
    const m2 = make(), ev = [];
    m2.addVoice(0, 0.5, false);
    m2.listen((e) => ev.push(e));
    m2.restore(js);
    assert.equal(m2.snapshot(), js);
    assert.equal(m2.state.voices.length, 2);
    assert.ok(m2.state.voices.every((v) => v.pinned));
    assert.deepEqual(ev.filter((e) => e.t === 'voice' && !e.on).map((e) => e.v.ang), [0], 'the old city left');
    assert.equal(ev.at(-1).t, 'fx', 'then FX');
    m2.restore('{"v":[{"ang":1,"rn":0.5,"lvl":0.6,"oct":0}],"fx":{}}');  // старый снимок: без path и луны
    assert.equal(m2.state.voices[0].path, 0);
    assert.equal(m2.state.luna.orbit, 0.7);
  });

  test(`Oceanus [${name}]: кубик с зерном повторяется — 2–3 оставленных города на полутонах, всплеск, FX вразброс`, () => {
    const run = (seed) => { const { m, ev } = withLog({ rng: seeded(seed) }); m.addVoice(0, 0.5, false); m.dice(); return { js: m.snapshot(), ev, m }; };
    const A = run(42), B = run(42), C = run(7);
    assert.equal(A.js, B.js);
    assert.notEqual(A.js, C.js);
    for (const { m, ev } of [A, C]) {
      const vs = m.state.voices;
      assert.ok(vs.length >= 2 && vs.length <= 3, vs.length);
      for (const v of vs) {
        assert.ok(v.pinned && [0.84, 0.5, 0.18].includes(v.rn) && [0, 1, 2].includes(v.path));
        assert.ok(near(((v.ang - 0.01) / TAU) * 12 % 1, 0, 1e-9));   // ровно на полутоне (+0.01 рад)
      }
      const { tension, damping } = m.state.fx;
      assert.ok(tension >= 0.2 && tension <= 0.8 && damping >= 0.15 && damping <= 0.75);
      const sp = ev.filter((e) => e.t === 'splash');
      assert.equal(sp.length, 1); assert.equal(sp[0].amt, 0.4);
      assert.equal(ev.find((e) => e.t === 'voice' && !e.on).v.pinned, false);   // сначала ушёл прежний город
    }
    assert.deepEqual({ ...FX_DEF, tension: 0, damping: 0 }, { ...A.m.state.fx, tension: 0, damping: 0 });   // остальные FX не трогает
  });
}

test('Oceanus: кубик фасада и кубик эталона с одним зерном — одна сцена', () => {
  for (const seed of [1, 42, 99]) {
    const a = FACTORIES.js({ seed }), b = FACTORIES.core({ seed });
    a.dice(); b.dice();
    assert.equal(b.snapshot(), a.snapshot());
    assert.equal(b.core.snapshot(SLOT), a.snapshot(), 'and the core holds it');
  }
});

test('Oceanus [core]: лад хоста — hz в зеркале ядра = hz фасада = hz эталона', () => {
  for (const [idx, root] of [[0, 0], [1, 3], [3, 7]]) {
    const sc = { on: true, idx, root };
    const m = coreModel({ scale: sc }), ref = jsModel({ scale: hostScale(sc) });
    for (let k = 0; k < 6; k++) m.addVoice(k * 1.37 + 0.2, [0.9, 0.5, 0.2][k % 3], true);
    for (const v of m.state.voices) {
      const c = m.coreVoice(v.id);
      assert.ok(near(c.hz, m.hz(v)), `core ${c.hz} vs facade ${m.hz(v)}`);
      assert.ok(near(m.hz(v), ref.hz(v)));
    }
  }
});

// ---------- фасад на асинхронном порту: как в вебе, зеркало приходит позже действий ----------
const facadeAsync = (seed = 1) => coreModel({ seed, async: true });

test('Oceanus фасад: город под пальцем — тот же объект после зеркала, свои правки в пути зеркало не перетирает', () => {
  const m = facadeAsync(), v = m.addVoice(1, 0.85, false);
  m.tick(0.01);
  assert.equal(m.state.voices[0], v, 'the same live object');
  assert.ok(v.hz > 0 && v.gain >= 0, 'core fields came with the mirror');
  m.moveVoice(v, 2, 0.5);                               // ядро ещё на (1, 0.85)
  m.deliver();
  assert.deepEqual([v.ang, v.rn], [2, 0.5], 'a stale mirror does not pull the city back');
  const w = m.addVoice(3, 0.2, true); m.deliver();
  assert.ok(m.state.voices.includes(w), 'a city added here survives a mirror that has not seen it');
  m.dropVoice(v); m.deliver();
  assert.ok(!m.state.voices.includes(v) && m.state.voices.length === 1, 'a city dropped here does not come back');
  m.tick(0.01);
  assert.deepEqual(m.state.voices.map((q) => q.id), m.coreIds(), 'after the core caught up — the same cities');
  assert.equal(m.coreVoice(w.id).rn, 0.2);
});

test('Oceanus фасад: кубик / restore / новый узел — сразу addVoice без зеркала: id тот же в ядре, move и drop попадают в него', () => {
  for (const how of ['dice', 'restore', 'rebind', 'clear']) {
    const m = facadeAsync(5);
    m.addVoice(1, 0.84, true); m.addVoice(2, 0.5, false); m.tick(0.01);
    if (how === 'dice') m.dice();
    else if (how === 'clear') m.clear();
    else if (how === 'restore') m.restore('{"v":[{"ang":0.5,"rn":0.84,"lvl":0.7,"oct":0,"path":1}],"fx":{"hall":0.7}}');
    else { m.rebind(); }                                // новый узел ядра, как restartAudio: сцена — туда целиком (и временный город тоже)
    const a = m.addVoice(4, 0.18, false);               // ядро ещё ничего не видело
    const local = m.state.voices.map((v) => `${v.slot}:${v.id}:${v.pinned}`).join();
    m.flush();
    const c = m.coreVoice(a.id);
    assert.ok(c, `${how}: the new city is in the core by its id ${a.id}`);
    assert.deepEqual([c.ang, c.rn, c.slot, c.pinned], [4, 0.18, a.slot, 0], `${how}: the same city`);
    m.deliver();
    assert.equal(m.state.voices.map((v) => `${v.slot}:${v.id}:${v.pinned}`).join(), local, `${how}: the mirror agrees with the facade`);
    assert.ok(m.state.voices.includes(a), `${how}: the same object`);
    m.moveVoice(a, 5, 0.5); m.flush();
    assert.deepEqual([m.coreVoice(a.id).ang, m.coreVoice(a.id).rn], [5, 0.5], `${how}: move hits it`);
    const others = m.coreIds().filter((id) => id !== a.id);
    m.dropVoice(a); m.flush();
    assert.equal(m.coreVoice(a.id), null, `${how}: drop hits it`);
    assert.deepEqual(m.coreIds(), others, `${how}: the others stay`);
  }
});

test('Oceanus фасад: город убрало ядро (мимо фасада) — с зеркалом уходит и у фасада, правки ушедшего — мимо', () => {
  const m = facadeAsync(3), v = m.addVoice(1, 0.85, true);
  m.tick(0.01);
  const off = [];
  m.listen((e) => { if (e.t === 'voice' && !e.on) off.push(e.v); });
  m.core.action(SLOT, ACT.clear); m.deliver();
  assert.ok(!m.state.voices.includes(v) && off.includes(v));
  m.moveVoice(v, 2, 0.3); m.setVoice(v, { lvl: 0.1 }); m.dropVoice(v); m.flush();
  assert.deepEqual(m.coreIds(), [], 'nothing reached the core');
});

test('Oceanus фасад: снимок → restore → зеркало — снимок тот же, у ядра та же сцена', () => {
  const m = FACTORIES.core({ seed: 4 });
  m.dice(); m.setFx('wind', 0.1 + 0.2); m.setVoice(m.state.voices[0], { lvl: 0.7000000000000001 }); m.setLuna({ orbit: 1 / 3 });
  const js = m.snapshot();
  m.tick(0.05);
  assert.equal(m.snapshot(), js);
  const q = facadeAsync(8);
  q.restore(js);
  assert.equal(q.snapshot(), js, 'restore — at once, before the core');
  q.tick(0.05);
  assert.equal(q.snapshot(), js, 'and after the mirror');
  assert.equal(q.core.snapshot(SLOT), js, 'the core has the same scene (numbers — bit for bit)');
});

test('Oceanus фасад: форма кольца и луна — из зеркала, вода от пальца живёт', () => {
  const m = facadeAsync(2);
  m.addVoice(1, 0.85, true);
  m.tick(0.2);
  const flat = Array.from(m.state.shape);
  m.push(1, 0.25, 2); m.tick(0.3);
  const pulled = Array.from(m.state.shape);
  assert.ok(pulled.some((x, i) => Math.abs(x - flat[i]) > 0.05), 'the finger pulls the water');
  assert.ok(m.state.moon > 0 && m.state.moon < 1);
  m.release(1); m.splash(0.6, 0.35); m.tick(0.1);
  assert.ok(m.state.voices[0].gain > 0.1, 'the city sings');
});
