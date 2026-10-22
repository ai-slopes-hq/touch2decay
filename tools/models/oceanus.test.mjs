// Тесты модели Oceanus (worlds/oceanus/model.js) в Node без браузера.
//   node --test tools/models/oceanus.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel, VMAX, FX_DEF, LUNA_DEF } from '../../worlds/oceanus/model.js';
import { seeded, near } from './util.mjs';

const TAU = Math.PI * 2;
const withLog = (opts) => { const m = createModel(opts), ev = []; m.listen((e) => ev.push(e)); return { m, ev }; };

test('Oceanus: города занимают слоты, седьмой не встаёт, ушедший освобождает слот', () => {
  const { m, ev } = withLog({ rng: seeded(1) });
  const vs = Array.from({ length: VMAX }, (_, i) => m.addVoice(i, 0.5, false));
  assert.deepEqual(vs.map((v) => v.slot), [0, 1, 2, 3, 4, 5]);
  assert.equal(m.addVoice(0, 0.5, false), null);
  assert.equal(ev.length, VMAX);
  assert.ok(ev.every((e) => e.t === 'voice' && e.on && e.added));
  assert.deepEqual(vs[0], { slot: 0, ang: 0, rn: 0.5, pinned: false, lvl: 0.8, oct: 0, path: 0 });
  m.dropVoice(vs[2]);
  assert.deepEqual(ev.at(-1), { t: 'voice', v: vs[2], on: false });
  assert.equal(m.state.voices.length, VMAX - 1);
  assert.equal(m.addVoice(1, 0.5, true).slot, 2);
  m.clear();
  assert.equal(m.sounding(), false);
  assert.equal(ev.filter((e) => e.t === 'voice' && !e.on).length, 1 + VMAX);
});

test('Oceanus: нота — угол по часовой полутонами, климат — октава, oct — ещё октава', () => {
  const m = createModel();
  assert.ok(near(m.hz({ ang: 0, rn: 0.9 }), 55));                     // у берега, наверху — A1
  assert.ok(near(m.hz({ ang: TAU / 12, rn: 0.9 }), 55 * 2 ** (1 / 12)));   // шаг по часовой — полутон
  assert.ok(near(m.hz({ ang: 0, rn: 0.5 }), 110));                    // средний климат — октава выше
  assert.ok(near(m.hz({ ang: 0, rn: 0.1 }), 220));                    // у Иерусалима — две
  assert.ok(near(m.hz({ ang: 0, rn: 0.1, oct: -1 }), 110));
  const v = m.addVoice(0, 0.85, false), ev = [];
  m.listen((e) => ev.push(e));
  m.moveVoice(v, TAU / 4, 0.2);                                       // ведёшь город к центру: +3 полутона, +2 октавы
  assert.ok(near(m.hz(v), 55 * 2 ** (27 / 12)));
  assert.deepEqual(ev, [{ t: 'voice', v, on: true }]);
});

test('Oceanus: с ладом — тоника сдвигает, snap ставит на ступень', () => {
  const sc = { on: false, root: 3, snap: (s) => s - (s % 2) };        // «лад» — только чётные полутоны
  const m = createModel({ scale: sc }), v = { ang: (5.4 / 12) * TAU, rn: 0.9 };
  assert.equal(m.root(), 0);
  assert.ok(near(m.semiOf(v), 5.4));                                  // без лада — плавно
  sc.on = true;
  assert.equal(m.root(), 3);
  assert.equal(m.semiOf(v), 8);                                       // 5.4 + 3 → 8 (округлили, на ступени)
  v.ang = (6.4 / 12) * TAU;
  assert.equal(m.semiOf(v), 8);                                       // 9 → 8
});

test('Oceanus: FX и луна — одно событие fx, вода и всплеск — события без состояния', () => {
  const { m, ev } = withLog({});
  m.setFx('tension', 0.9); m.setLuna({ sway: 0.5, to: 2 }); m.loadFx({ hall: 0.1 });
  assert.deepEqual(ev, [{ t: 'fx' }, { t: 'fx' }, { t: 'fx' }]);
  assert.equal(m.state.fx.tension, 0.9); assert.equal(m.state.fx.hall, 0.1);
  assert.deepEqual(m.state.luna, { ...LUNA_DEF, sway: 0.5, to: 2 });
  ev.length = 0;
  m.push(7, 0.25, -1.5); m.release(7); m.splash(0.5, 0.35);
  assert.deepEqual(ev, [{ t: 'push', id: 7, a: 0.25, d: -1.5 }, { t: 'release', id: 7 }, { t: 'splash', a: 0.5, amt: 0.35 }]);
  m.tick(0.5); m.tick(0.25);                                          // своё время — только счётчик, звука не просит
  assert.equal(m.state.time, 0.75);
  assert.equal(ev.length, 3);
});

test('Oceanus: снимок — только оставленные города, fx и луна; restore возвращает то же', () => {
  const m = createModel();
  const a = m.addVoice(1, 0.84, true); m.addVoice(2, 0.5, false); const c = m.addVoice(3, 0.18, true);
  m.setVoice(a, { lvl: 0.5, oct: 1, path: 2 }); m.setVoice(c, { path: 1 });
  m.setFx('wind', 0.3); m.setLuna({ orbit: 0.7, storm: 1 });
  const js = m.snapshot();
  assert.equal(js, '{"v":[{"ang":1,"rn":0.84,"lvl":0.5,"oct":1,"path":2},{"ang":3,"rn":0.18,"lvl":0.8,"oct":0,"path":1}],'
    + '"fx":{"tension":0.45,"damping":0.4,"wind":0.3,"tide":0.55,"hall":0.4},"luna":{"orbit":0.7,"storm":1,"sway":0,"to":0}}');
  const m2 = createModel(), ev = [];
  m2.addVoice(0, 0.5, false);
  m2.listen((e) => ev.push(e));
  m2.restore(js);
  assert.equal(m2.snapshot(), js);
  assert.equal(m2.state.voices.length, 2);
  assert.ok(m2.state.voices.every((v) => v.pinned));
  assert.deepEqual(ev.map((e) => e.t), ['voice', 'voice', 'voice', 'voice', 'voice', 'fx']);   // старый ушёл, каждый город — встал и настроен, потом FX
  m2.restore('{"v":[{"ang":1,"rn":0.5,"lvl":0.6,"oct":0}],"fx":{}}');  // старый снимок: без path и луны
  assert.equal(m2.state.voices[0].path, 0);
  assert.equal(m2.state.luna.orbit, 0.7);
});

test('Oceanus: кубик с зерном повторяется — 2–3 оставленных города на полутонах, всплеск, FX вразброс', () => {
  const run = (seed) => { const { m, ev } = withLog({ rng: seeded(seed) }); m.addVoice(0, 0.5, false); m.dice(); return { js: m.snapshot(), ev, m }; };
  const A = run(42), B = run(42), C = run(7);
  assert.equal(A.js, B.js);
  assert.notEqual(A.js, C.js);
  for (const { m, ev } of [A, C]) {
    const vs = m.state.voices;
    assert.ok(vs.length >= 2 && vs.length <= 3, vs.length);
    for (const v of vs) {
      assert.ok(v.pinned && [0.84, 0.5, 0.18].includes(v.rn) && [0, 1, 2].includes(v.path));
      assert.ok(near(((v.ang - 0.01) / TAU) * 12 % 1, 0, 1e-9));     // ровно на полутоне (+0.01 рад)
    }
    const { tension, damping } = m.state.fx;
    assert.ok(tension >= 0.2 && tension <= 0.8 && damping >= 0.15 && damping <= 0.75);
    const sp = ev.filter((e) => e.t === 'splash');
    assert.equal(sp.length, 1); assert.equal(sp[0].amt, 0.4);
    assert.equal(ev.find((e) => e.t === 'voice' && !e.on).v.pinned, false);   // сначала ушёл прежний город
  }
  assert.deepEqual({ ...FX_DEF, tension: 0, damping: 0 }, { ...A.m.state.fx, tension: 0, damping: 0 });   // остальные FX не трогает
});
