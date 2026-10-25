// Тесты модели Inferno в Node: высота кругов, иней, грешники, буря, строки плашки, снимок, кубик с зерном.
// Каждый тест — дважды: против эталонной JS-модели (tools/ref/inferno-model.js) и против модели ядра (t2d.wasm) через фасад
// веба worlds/inferno/model.js (порт — inferno-core.mjs). Плюс сверка «JS-модель ↔ ядро»: те же действия — то же состояние.
//   core/build.sh && node --test tools/models/inferno.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel as jsModel, SPAN, PIN_MAX, FX_DEF } from '../ref/inferno-model.js';
import { createModel as coreModel, SLOT, SET_KEYS, FX_KEYS } from './inferno-core.mjs';
import { seeded, near } from './util.mjs';

const DT = 1 / 60;
const run = (m, secs) => { for (let k = 0; k < Math.round(secs / DT); k++) m.tick(DT); };
const events = (m) => { const ev = []; m.listen((e) => ev.push(e)); return ev; };
const MAJOR = [0, 2, 4, 5, 7, 9, 11];                   // лад для тестов: мажор от A (как scale.snap хоста — к ближайшей ступени, вниз при равенстве)
const snapMajor = (s) => { for (let d = 0; d < 12; d++) for (const x of [s - d, s + d]) if (MAJOR.includes(((x % 12) + 12) % 12)) return x; return s; };
const FACTORIES = {
  js: ({ seed = 1, scale } = {}) => jsModel({ rng: seeded(seed), ...(scale ? { scale: { on: true, snap: snapMajor, pcs: MAJOR } } : {}) }),
  core: ({ seed = 1, scale } = {}) => coreModel({ seed, ...(scale ? { scale: { on: true, idx: 0, root: 0 } } : {}) }),   // мажор от A у ядра: idx 0, root 0
};

for (const [name, make] of Object.entries(FACTORIES)) {
  test(`Inferno [${name}]: высота: зона круга ~⅔ октавы, нижний круг — от 55 Гц; с ладом — по ступеням`, () => {
    const m = make();
    assert.equal(m.semiOf(8, 0), 0);
    assert.ok(near(m.semiOf(0, 1), 60));
    assert.ok(near(m.semiOf(4, 0.5), 4 * SPAN + 0.5 * SPAN));
    m.state.circ[8].pos = 0; assert.ok(near(m.hzOf(8), 55));
    m.state.circ[0].pos = 1; assert.ok(near(m.hzOf(0), 55 * 32, 1e-6));
    const on = make({ scale: true });
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

  test(`Inferno [${name}]: ice растёт медленно (τ 6 с) и оттаивает быстрее (τ 3 с); резонаторы перенастраиваются при сдвиге > 0.02`, () => {
    const m = make(), ev = events(m);
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

  test(`Inferno [${name}]: не больше четырёх грешников; двойной тап по грешнику — отпустить`, () => {
    const m = make(), ev = events(m);
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

  test(`Inferno [${name}]: удар: уровень круга вспыхивает и гаснет (τ 0.4 с, со льдом — дольше)`, () => {
    const m = make(), ev = events(m);
    m.strike(4, 0.8);
    assert.deepEqual(ev.at(-1), { t: 'strike', k: 4, vel: 0.8 });
    assert.equal(m.state.circ[4].lvl, 1);
    run(m, 0.4);
    assert.ok(Math.abs(m.state.circ[4].lvl - Math.exp(-1)) < 0.01, `${m.state.circ[4].lvl}`);
    m.pin(4, 0.5); run(m, 1);
    assert.ok(Math.abs(m.state.circ[4].lvl - m.state.circ[4].level) < 0.01, 'горящий круг держит свой уровень');
  });

  test(`Inferno [${name}]: строки плашки круга (их качают LFO хоста inf-c<k>): pitch, width, drive, level → перенастройка; noise — только при смене`, () => {
    const m = make(), ev = events(m);
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

  test(`Inferno [${name}]: буря второго круга: качает его высоту, пока он горит; storm = 0 — затихает; резонатор — не чаще раза в 50 мс`, () => {
    const m = make(), ev = events(m);
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

  test(`Inferno [${name}]: снимок → restore: тот же JSON; события — цвет, fx, тление всех кругов`, () => {
    const a = make({ seed: 11 });
    a.dice(); a.setCirc(3, 'width', 0.2); a.setFx('smoke', 0.8);
    const js = a.snapshot();
    const b = make(), ev = events(b);
    b.restore(js);
    assert.equal(b.snapshot(), js);
    assert.deepEqual(Object.keys(JSON.parse(js)), ['circ', 'fx']);
    assert.deepEqual(Object.keys(JSON.parse(js).circ[0]), ['pos', 'sinner', 'color', 'width', 'drive', 'level']);
    assert.equal(ev.filter((e) => e.t === 'burn').length, 9);
    assert.equal(ev.filter((e) => e.t === 'fx').length, 1);
    const changed = JSON.parse(js).circ.filter((q, k) => q.color !== make().state.circ[k].color).length;
    assert.equal(ev.filter((e) => e.t === 'color').length, changed);
  });

  test(`Inferno [${name}]: кубик с зерном: повторяется; 2–3 грешника, structure из трёх`, () => {
    const a = make({ seed: 42 }), b = make({ seed: 42 });
    a.dice(); b.dice();
    assert.equal(a.snapshot(), b.snapshot());
    for (let s = 1; s < 30; s++) {
      const m = make({ seed: s });
      m.pin(0, 0.1); m.dice();
      const n = m.state.circ.filter((c) => c.sinner).length;
      assert.ok(n >= 2 && n <= 3, `зерно ${s}: ${n}`);
      assert.ok([0.15, 0.5, 0.85].includes(m.state.fx.structure));
    }
    const c = make({ seed: 43 }); c.dice();
    assert.notEqual(c.snapshot(), a.snapshot());
  });
}

// ---------- ядро ↔ эталон: те же действия — то же состояние ----------
test('Inferno [core ↔ js]: действия фасада и ядра дают одни поля кругов и fx (зеркало ядра)', () => {
  const m = coreModel({ seed: 3 });
  m.pin(2, 0.31); m.pin(4, 0.8); m.hold(6, 1); m.hold(6, 1); m.hold(6, -1);
  m.setCirc(2, 'width', 0.2); m.setCirc(2, 'drive', 0.9); m.setCirc(4, 'level', 0.4); m.setCirc(4, 'color', 3); m.setCirc(6, 'pos', 0.77);
  m.setFx('structure', 0.6); m.setFx('fire', 0.5); m.setFx('smoke', 0.1); m.setFx('ice', 0.3); m.setFx('storm', 0.2);
  for (let k = 0; k < 6; k++) m.pin(k, 0.1);             // лишние грешники — мимо (PIN_MAX), и в ядре тоже
  m.dice(); m.setCirc(1, 'color', 4);
  const mir = m.mirror(), H = 4 + FX_KEYS.length;
  FX_KEYS.forEach((k, i) => assert.ok(near(mir[4 + i], m.state.fx[k], 1e-12), `fx ${k}`));
  m.state.circ.forEach((c, k) => {
    const o = H + k * 8;
    assert.ok(near(mir[o], c.pos, 1e-12), `pos ${k}`); assert.equal(mir[o + 1], c.sinner ? 1 : 0, `sinner ${k}`); assert.equal(mir[o + 2], c.held, `held ${k}`);
    assert.equal(mir[o + 3], c.color, `color ${k}`); assert.ok(near(mir[o + 4], c.width, 1e-12)); assert.ok(near(mir[o + 5], c.drive, 1e-12)); assert.ok(near(mir[o + 6], c.level, 1e-12));
  });
  assert.equal(JSON.stringify(JSON.parse(m.core.snapshot(SLOT))), JSON.stringify(JSON.parse(m.snapshot())), 'снимок ядра = снимок фасада');
});

test('Inferno [core ↔ js]: иней, уровни кругов и буря — по тем же формулам, что у эталона', () => {
  const a = jsModel({ rng: seeded(5) }), b = coreModel({ seed: 5 });
  for (const m of [a, b]) { m.setFx('ice', 0.8); m.pin(1, 0.5); m.pin(4, 0.3); m.strike(7, 1); }
  for (let k = 0; k < 600; k++) { a.tick(DT); b.tick(DT); }
  assert.ok(near(a.state.iceE, b.state.iceE, 1e-6), `ice ${a.state.iceE} ${b.state.iceE}`);
  for (let k = 0; k < 9; k++) assert.ok(near(a.state.circ[k].lvl, b.state.circ[k].lvl, 1e-4), `lvl ${k}: ${a.state.circ[k].lvl} ${b.state.circ[k].lvl}`);
  assert.ok(near(a.state.stormPh, b.state.stormPh, 5e-3), `storm phase ${a.state.stormPh} ${b.state.stormPh}`);   // шаг кадра против шага блока: фаза интегрируется
  assert.ok(Math.abs(a.state.stormSemi - b.state.stormSemi) < 0.15, `storm ${a.state.stormSemi} ${b.state.stormSemi}`);
});

test('Inferno [core]: удар слышен в «услышанном», тление — шум, узел пересобирают (rebind) — сцена и пальцы возвращаются', () => {
  const m = coreModel({ seed: 9 });
  m.strike(8, 1); m.tick(DT);
  assert.deepEqual(m.heard().slice(0, 2), [1, 8]);
  m.hold(3, 1); m.pin(5, 0.4); m.setFx('smoke', 0.9);
  m.tick(0.3);
  const rms = (arr) => Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / arr.length);
  const pcm = []; for (let b = 0; b < 40; b++) { m.core.process(128); pcm.push(...m.core.dry(SLOT, 0, 128)); }
  assert.ok(rms(pcm) > 1e-3, `тление и грешник звучат: ${rms(pcm)}`);
  m.rebind();                                            // новый контекст: ядро пустое, фасад возвращает сцену и палец на круге
  const mir = m.mirror();
  assert.equal(mir[4 + FX_KEYS.indexOf('smoke')], 0.9);
  assert.equal(mir[4 + FX_KEYS.length + 3 * 8 + 2], 1, 'палец на третьем круге вернулся');
  assert.equal(mir[4 + FX_KEYS.length + 5 * 8 + 1], 1, 'грешник вернулся');
  const pcm2 = []; for (let b = 0; b < 60; b++) { m.core.process(128); pcm2.push(...m.core.dry(SLOT, 0, 128)); }
  assert.ok(rms(pcm2.slice(-4096)) > 1e-3, 'и звучит снова');
});
