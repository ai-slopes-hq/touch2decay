// Тесты модели Paradisus (worlds/paradisus/model.js) в Node: высота ангела, форманты, планеты и chime, Gloria, лимит закреплённых,
// снимок, кубик с зерном.
//   node --test tools/models/paradisus.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel, formants, FORM, VOW, PIN_MAX, FX_DEF, harm } from '../../worlds/paradisus/model.js';
import { seeded, near } from './util.mjs';

const DT = 1 / 60;
// как склейка с engine: голос собран сразу (контекст есть) — ангел звучит (a.sung)
const make = (opt) => { const m = createModel(opt); m.listen((e) => { if (e.t === 'voice') m.voiced(e.a, e.on); }); return m; };
const collect = (m) => { const ev = []; m.listen((e) => ev.push(e)); return ev; };

test('hzOf: гармоника сферы × регистр от тоники A2; лад — от его тоники', () => {
  const scale = { on: false, root: 0 }, m = make({ scale, rng: seeded(1) });
  const a = m.addAngel(8, 0);                         // Luna — основной тон
  assert.equal(m.hzOf(a), 110);
  a.k = 0; assert.equal(m.hzOf(a), 990);              // Primum Mobile — девятая гармоника
  a.k = 4; a.reg = 0; assert.equal(m.hzOf(a), 110 * 5 * 0.5);
  a.reg = 2; assert.equal(m.hzOf(a), 110 * 5 * 2);
  scale.root = 3; assert.equal(m.hzOf(a), 110 * 5 * 2);   // лад выключен — тоника A
  scale.on = true; assert.ok(near(m.hzOf(a), 110 * 2 ** (3 / 12) * 10, 1e-9), `C: ${m.hzOf(a)}`);
  for (let k = 0; k < 9; k++) assert.equal(harm(k), 9 - k);
});

test('форманты: на гласной — таблица, между гласными — плавно (частота по логарифму)', () => {
  VOW.forEach((w, i) => assert.deepEqual(formants(i), FORM[w]));
  assert.deepEqual(formants(4.999999999).map((p) => Math.round(p[0])), FORM.a.map((p) => p[0]));   // u → a по кругу
  for (let i = 0; i < 5; i++) {
    let prev = formants(i);
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const f = formants(i + Math.min(t, 0.999999)), A = FORM[VOW[i]], B = FORM[VOW[(i + 1) % 5]];
      f.forEach((p, q) => {
        const lo = Math.min(A[q][0], B[q][0]), hi = Math.max(A[q][0], B[q][0]);
        assert.ok(p[0] >= lo - 1e-6 && p[0] <= hi + 1e-6, `F${q + 1} между гласными`);
        assert.ok(Math.abs(Math.log(p[0] / prev[q][0])) <= Math.abs(Math.log(B[q][0] / A[q][0])) * 0.05 + 1e-6, 'без скачков');
      });
      prev = f;
    }
    const mid = formants(i + 0.5);
    mid.forEach((p, q) => assert.ok(near(p[0], Math.sqrt(FORM[VOW[i]][q][0] * FORM[VOW[(i + 1) % 5]][q][0]), 1e-6), 'середина — среднее геометрическое'));
  }
});

test('chime: планета своей сферы проходит над закреплённым ангелом — ровно один раз за проход', () => {
  const m = make({ rng: seeded(2) }), ev = collect(m);
  m.setFx('gloria', 0);
  const a = m.addAngel(5, 2.3, true);                 // сфера Sol, гармоника 4
  m.setFx('orbits', 1);
  const lap = 70 / (0.3 + 1.7) / harm(a.k);           // секунд на оборот планеты этой сферы
  const chimes = () => ev.filter((e) => e.t === 'chime');
  for (let t = 0; t < lap * 3; t += DT) m.tick(DT);
  assert.equal(chimes().length, 3, `три оборота — три вспышки: ${chimes().length}`);
  assert.ok(chimes().every((e) => e.a === a && e.hz === m.hzOf(a)));
  const b = m.addAngel(5, 0.3); for (let t = 0; t < lap; t += DT) m.tick(DT);   // незакреплённый не звенит
  assert.ok(chimes().every((e) => e.a === a));
  m.release(b);
});

test('chime: момент — когда планета проходит над ангелом', () => {
  const m = make({ rng: seeded(3) }), ev = collect(m);
  m.setFx('gloria', 0); m.setFx('orbits', 1);
  const a = m.addAngel(3, 1.0, true);
  m.setOrbit((a.v / 5 - 0.004 - a.k * 0.13 + 2) / harm(a.k));   // планета чуть до ангела (как в shot.py)
  let at = -1;
  for (let i = 0; i < 120 && at < 0; i++) { m.tick(DT); if (ev.some((e) => e.t === 'chime')) at = i; }
  assert.ok(at >= 0 && at < 30, `вспышка в первые полсекунды: кадр ${at}`);
  const p = m.planetAt(a.k), u = a.v / 5;
  assert.ok(Math.abs(((p - u + 1.5) % 1) - 0.5) < 0.01, 'планета — над ангелом');
});

test('orbits = 0 — планеты стоят, chime нет', () => {
  const m = make({ rng: seeded(4) }), ev = collect(m);
  m.setFx('orbits', 0);
  m.addAngel(5, 2.3, true); m.addAngel(7, 0.1, true);
  const o0 = m.state.orbitT;
  for (let t = 0; t < 60; t += DT) m.tick(DT);
  assert.equal(m.state.orbitT, o0);
  assert.equal(ev.filter((e) => e.t === 'chime').length, 0);
});

test('gloria: зёрен ∝ времени и fx.gloria, на гармониках поющих; без хора и при 0 — нет', () => {
  const count = (g, secs, n = 2) => {
    const m = make({ rng: seeded(5) }), ev = collect(m);
    m.setFx('orbits', 0); m.setFx('gloria', g);
    const A = Array.from({ length: n }, (_, i) => m.addAngel(2 + i, i));
    for (let t = 0; t < secs - 1e-9; t += DT) m.tick(DT);
    const gr = ev.filter((e) => e.t === 'grain');
    assert.ok(gr.every((e) => A.some((a) => m.hzOf(a) === e.hz)), 'зерно — на гармонике поющего');
    return gr.length;
  };
  const n1 = count(0.5, 10), n2 = count(0.5, 20), n3 = count(1, 10);
  assert.ok(Math.abs(n1 - 120) <= 1, `0.5 × 24 × 10 с: ${n1}`);
  assert.ok(Math.abs(n2 - 2 * n1) <= 1, `вдвое дольше — вдвое больше: ${n1} ${n2}`);
  assert.ok(Math.abs(n3 - 2 * n1) <= 1, `вдвое сильнее — вдвое больше: ${n1} ${n3}`);
  assert.equal(count(0, 10), 0);
  assert.equal(count(1, 10, 0), 0);
});

test('закреплённых — не больше PIN_MAX; незакреплённые не в счёт; release освобождает место', () => {
  const m = make({ rng: seeded(6) }), ev = collect(m);
  const P = Array.from({ length: PIN_MAX }, (_, i) => m.addAngel(i, i, true));
  assert.ok(P.every(Boolean));
  assert.equal(m.addAngel(8, 1, true), null, 'пятый не встаёт');
  assert.ok(m.addAngel(8, 1), 'поющий, пока держишь, — можно');
  assert.equal(m.pinned().length, PIN_MAX);
  m.release(P[0], 0.6);
  assert.deepEqual(ev.at(-1), { t: 'voice', a: P[0], on: false, tau: 0.6 });
  assert.ok(m.addAngel(8, 2, true));
});

test('снимок → restore: тот же JSON, только закреплённые, голоса заново', () => {
  const m = make({ rng: seeded(7) });
  m.dice(); m.setFx('shimmer', 0.8); m.addAngel(2, 0.5);   // временный — в снимок не идёт
  const a = m.pinned()[1]; m.setAngel(a, 'singers', 0.3); m.setAngel(a, 'reg', 0.9); m.setAngel(a, 'breath', 0.7);
  const js = m.snapshot(), st = JSON.parse(js);
  assert.equal(st.angels.length, 3);
  assert.deepEqual(Object.keys(st.angels[0]), ['k', 'v', 'singers', 'detune', 'vib', 'breath', 'reg']);
  assert.deepEqual(Object.keys(st.fx), Object.keys(FX_DEF));
  assert.equal(st.angels[1].singers, 2); assert.equal(st.angels[1].reg, 2); assert.equal(st.angels[1].breath, 0.7);
  const m2 = make({ rng: seeded(99) });
  m2.addAngel(0, 0, true); const ev = collect(m2);
  m2.restore(js);
  assert.equal(m2.snapshot(), js);
  assert.equal(m2.state.angels.length, 3);
  assert.ok(m2.state.angels.every((x) => x.pinned));
  assert.equal(ev.filter((e) => e.t === 'voice' && !e.on).length, 1);
  assert.equal(ev.filter((e) => e.t === 'voice' && e.on).length, 3);
  assert.equal(ev.at(-1).t, 'fx');
});

test('кубик с зерном повторяем: три закреплённых на аккорде из натурального ряда', () => {
  const a = make({ rng: seeded(11) }), b = make({ rng: seeded(11) });
  a.dice(); b.dice();
  assert.equal(a.snapshot(), b.snapshot());
  const chords = ['4,5,6', '3,4,5', '4,6,8', '5,6,8', '2,3,5'];
  for (let s = 0; s < 20; s++) {
    const m = make({ rng: seeded(s) }); m.dice();
    assert.equal(m.pinned().length, 3);
    assert.ok(chords.includes(m.state.angels.map((x) => harm(x.k)).join(',')));
    assert.ok(m.state.angels.every((x) => x.v >= 0 && x.v < 5));
  }
});

test('дрейф гласной: закреплённый плывёт на времени модели (±0.45·vibrato), перестройка раз в 0.12 с', () => {
  const m = make({ rng: seeded(12) }), ev = collect(m);
  m.setFx('orbits', 0); m.setFx('gloria', 0); m.setFx('vibrato', 1);
  const a = m.addAngel(4, 2, true), b = m.addAngel(5, 2);
  const vs = [];
  for (let t = 0; t < 10; t += DT) { m.tick(DT); vs.push(m.vEff(a)); assert.equal(m.vEff(b), 2); }
  assert.ok(Math.max(...vs) - Math.min(...vs) > 0.1, 'плывёт');
  assert.ok(vs.every((v) => Math.abs(v - 2) <= 0.45 + 1e-9), 'не дальше 0.45');
  const re = ev.filter((e) => e.t === 'angel' && e.a === a).length;
  assert.ok(Math.abs(re - 10 / (0.12 + DT / 2)) < 12, `≈ 8 раз в секунду: ${re}`);
  assert.equal(ev.filter((e) => e.t === 'angel' && e.a === b).length, 0);
});

test('без голоса (звук ещё не собран) — ни зёрен, ни chime, ангел не светится; голос собран — поёт', () => {
  const m = createModel({ rng: seeded(13) }), ev = collect(m);
  m.setFx('orbits', 1); m.setFx('gloria', 1);
  const a = m.addAngel(5, 2.3, true);
  for (let t = 0; t < 20; t += DT) m.tick(DT);
  assert.equal(ev.filter((e) => e.t === 'grain' || e.t === 'chime').length, 0);
  assert.equal(a.lvl, 0);
  m.voiced(a, true);
  for (let t = 0; t < 20; t += DT) m.tick(DT);
  assert.ok(ev.filter((e) => e.t === 'grain').length > 400 && ev.some((e) => e.t === 'chime'));
  assert.ok(a.lvl > 0.99);
});
