// Тесты модели Cymatica в Node: помощники секвенсера и раскладки ханга (worlds/cymatica/core.js; бывший tools/test-seq.mjs) и сама модель.
// Каждый тест модели — дважды: против эталонной JS-модели (tools/ref/cymatica-model.js — какой она была до этапа 2) и против модели ядра
// (t2d.wasm) через фасад веба worlds/cymatica/model.js (порт — cymatica-core.mjs): у ядра ещё и его зеркало и снимок должны сойтись со state
// фасада. Плюс «эталон ↔ ядро»: одни и те же правки узора — одно состояние (снимок), кубик с одним зерном, луна, запись игрой по часам ядра,
// отзыв резонатора, перезапуск звука. Звук пластины и часы — tools/test-cym-core.mjs.
//   core/build.sh (или core/build-wasi.sh) && node --test tools/models/cymatica.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as C from '../../worlds/cymatica/core.js';
import { createModel as jsModel } from '../ref/cymatica-model.js';
import { createModel as coreModel } from './cymatica-core.mjs';
import { hostScale, SR } from './sdk-facade.mjs';
import { seeded, near } from './util.mjs';

const plain = (a) => Array.from(a, (x) => !!x);
const events = (m) => { const ev = []; m.listen((e) => ev.push(e)); return ev; };

// ---------- помощники (как было в test-seq.mjs) ----------
test('euclid', () => {
  assert.deepEqual(plain(C.euclid(3, 8)), [true, false, false, true, false, false, true, false]);
  const e = plain(C.euclid(5, 8));
  assert.equal(e.filter(Boolean).length, 5);
  assert.equal(e[0], true);
  assert.ok(plain(C.euclid(0, 4)).every((x) => !x));
  assert.ok(plain(C.euclid(4, 4)).every((x) => x));
});

test('nearestStep', () => {
  assert.equal(C.nearestStep(1000 + 0.4 * 125, 1000, 3, 125, 16), 3);
  assert.equal(C.nearestStep(1000 + 0.6 * 125, 1000, 3, 125, 16), 4);
  assert.equal(C.nearestStep(1000 + 0.6 * 125, 1000, 15, 125, 16), 0);
});

test('walkMelody', () => {
  const list = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  const w = Array.from(C.walkMelody(7, 12, list));
  assert.equal(w.length, 7);
  w.forEach((s) => assert.ok(list.includes(s), `in the scale: ${s}`));
  for (let i = 1; i < w.length; i++) assert.ok(Math.abs(list.indexOf(w[i]) - list.indexOf(w[i - 1])) <= 2, 'small steps');
  assert.deepEqual(C.walkMelody(9, 12, list, seeded(3)), C.walkMelody(9, 12, list, seeded(3)), 'same seed — same walk');
});

const seq16 = () => Array.from({ length: 16 }, (_, i) => i);

test('rotateSteps', () => {
  assert.deepEqual(Array.from(C.rotateSteps(seq16(), 16, 2)), [14, 15, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual(Array.from(C.rotateSteps(seq16(), 4, 1)), [3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.deepEqual(Array.from(C.rotateSteps(seq16(), 4, -1)), [1, 2, 3, 0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
});

test('twistOrPinch', () => {
  assert.equal(C.twistOrPinch(0, 0.35, 100, 105), 'twist');
  assert.equal(C.twistOrPinch(0, 0.05, 100, 160), 'pinch');
  assert.equal(C.twistOrPinch(0, 0.05, 100, 105), null);
  assert.equal(C.twistOrPinch(3.1, -3.1, 100, 100), null);   // через ±180°: ≈4.6°, а не 355°
});

test('snapToGrid', () => {
  assert.equal(C.snapToGrid(3, 2, 16), 4);
  assert.equal(C.snapToGrid(5, 4, 16), 4);
  assert.equal(C.snapToGrid(15, 4, 16), 0);             // по кругу
  assert.equal(C.snapToGrid(6, 4, 7), 0);               // длина не кратна сетке: ближайшая доля по кругу
  assert.equal(C.snapToGrid(5, 1, 16), 5);
});

test('quantizeRhythm', () => {
  const h = (n) => ({ x: n, y: 0, vel: 1 });
  const s = Array(16).fill(null); s[1] = h(1); s[2] = h(2); s[7] = h(7); s[12] = h(12);
  const q = Array.from(C.quantizeRhythm(s, 8, 4));
  assert.deepEqual(q.map((x, i) => (x ? i : -1)).filter((i) => i >= 0), [0, 4, 12]);   // 1→0, 2→4, 7→8→0 занято; 12 — за длиной, не трогается
  assert.equal(q[0].x, 1);                                // в занятое гнездо встаёт первый
});

const list5 = Array.from({ length: 61 }, (_, s) => s).filter((s) => [0, 3, 5, 7, 10].includes(s % 12));

test('noteList and degPerOct without a scale: minor pentatonic up to 60', () => {
  assert.deepEqual(Array.from(C.noteList()), list5);
  assert.equal(C.degPerOct(), 5);
  const major = { on: true, pcs: [0, 2, 4, 5, 7, 9, 11], snap: (s) => s };   // лад: все полутоны «в ладу», 7 ступеней на октаву
  assert.equal(C.noteList(major).length, 61);
  assert.equal(C.degPerOct(major), 7);
});

test('cellIdx: sectors from the top clockwise, rings by area, centre is the top ring', () => {
  assert.equal(C.cellIdx(0, -0.95, 2, 5), 2);           // верх, край — кольцо 0, сектор 0
  assert.equal(C.cellIdx(0.95, 0, 2, 5), 3);            // справа — 90°, сектор 1
  assert.equal(C.cellIdx(0, 0, 2, 5), 12);              // центр — кольцо 2
  assert.equal(C.cellIdx(0, 0.7, 2, 5), 2 + 5 + 2);     // низ, середина — кольцо 1, сектор 2
  assert.equal(C.cellIdx(0, 1.2, 2, 5), null);          // за краем пластины
});

test('noteAt: note of the cell, null beyond the list', () => {
  assert.equal(C.noteAt(0, -0.95, 2, 5, list5), list5[2]);
  assert.equal(C.noteAt(0, 0, list5.length - 3, 5, list5), null);
  assert.equal(C.noteAt(0, 1.2, 2, 5, list5), null);
});

test('cellOf and cellCenter round trip', () => {
  for (const n of [5, 7, 12]) {
    for (let idx = 2; idx < 2 + 3 * n; idx++) {
      const c = C.cellOf(idx, 2, n), p = C.cellCenter(c.ring, c.sector, n);
      assert.equal(C.cellIdx(p.x, p.y, 2, n), idx, `n=${n} idx=${idx}`);
    }
  }
  assert.equal(C.cellOf(1, 2, 5), null);
  assert.equal(C.cellOf(17, 2, 5), null);
});

test('transposeHits: k steps up, hit moves to the new cell, clamped to the rings', () => {
  const t = Array.from(C.transposeHits([{ x: 0, y: -0.95, vel: 0.7 }, null], 2, 2, 5, list5));
  assert.equal(C.cellIdx(t[0].x, t[0].y, 2, 5), 4);
  assert.equal(t[0].vel, 0.7);
  assert.equal(t[1], null);
  const u = C.transposeHits([{ x: 0, y: -0.95, vel: 1 }], 99, 2, 5, list5)[0];
  assert.equal(C.cellIdx(u.x, u.y, 2, 5), 16);
  const v = C.transposeHits([{ x: 0, y: -0.95, vel: 1 }], -99, 2, 5, list5)[0];
  assert.equal(C.cellIdx(v.x, v.y, 2, 5), 2);
});

// ---------- модель ----------
const FACTORIES = {
  js: ({ seed = 1 } = {}) => jsModel({ rng: seeded(seed) }),
  core: ({ seed = 1 } = {}) => coreModel({ seed, rng: seeded(seed) }),
};
const SC = (on, idx = 0, root = 0) => ({ on, idx, root });
// ссылка на лад в эталоне: тот же host/scale.js, что у ядра (мажор от тоники и т. п.)
const jsWithScale = (sc, seed = 1) => jsModel({ rng: seeded(seed), scale: hostScale(sc) });
const coreWithScale = (sc, seed = 1) => coreModel({ seed, rng: seeded(seed), scale: sc });
const stepsOf = (m) => m.steps.map((s) => `${s.r},${s.m}`);

// часы секвенсера — в ядре (эталон — tools/ref/plate-worklet.js): грузим его в vm (как tools/test-plate.mjs) и гоним узор модели по шагам
function plateProc() {
  const SRC = readFileSync(new URL('../ref/plate-worklet.js', import.meta.url), 'utf8'), posted = [], reg = {};
  const ctx = {
    sampleRate: 48000, currentTime: 0, Math, Float32Array, Float64Array, Array, Object, Number, JSON,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (m) => posted.push(m), onmessage: null }; } },
    registerProcessor: (name, cls) => { reg[name] = cls; },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const proc = new reg.plate(), hits = [];
  proc.strike = (g, hz) => hits.push(hz);
  return { proc, posted, hits, send: (data) => proc.port.onmessage({ data }) };
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

for (const [name, createModel] of Object.entries(FACTORIES)) {
  test(`Cymatica [${name}]: полиритм — ритм 6 и мелодия 4: пары (r, m) и ноты повторяются через НОК = 12, а не через 6 или 4`, () => {
    const m = createModel(), ev = events(m), n = m.degPerOct();
    const h = { vel: 1 }, cells = [[0, 0], [0, 1], [1, 2], [2, 3]].map(([r, s]) => C.cellCenter(r, s, n));
    m.load({ rhythm: { len: 6, steps: [h, h, h, h, h, h] }, melody: { len: 4, steps: cells } });
    m.play(true);
    const msg = ev.filter((e) => e.t === 'seq').pop().msg;
    assert.equal(msg.rhythm.len, 6); assert.equal(msg.melody.len, 4);   // длины — каждая своя, не сведены
    const L = (6 * 4) / gcd(6, 4);
    assert.equal(L, 12);
    let pairs;
    if (name === 'js') {                                     // узор модели — в часы эталонного worklet
      const W = plateProc();
      W.send(msg);
      for (let k = 0; k < 36; k++) W.proc.tick();
      pairs = W.posted.filter((d) => d.t === 'step').map((d) => `${d.r},${d.m}`);
      assert.equal(W.hits.length, 36);
      const notes = m.notesOf(m.state.seq.melody.steps);
      W.hits.forEach((hz, k) => assert.ok(near(hz, 55 * 2 ** (notes[k % 4] / 12), 1e-6), `шаг ${k} бьёт ноту места ${k % 4}`));
    } else {                                                 // у ядра — его собственные часы: 36 шестнадцатых на 96 BPM
      for (let k = 0; k < 36 * 6; k++) m.tick(0.15625 / 6);
      pairs = stepsOf(m).slice(0, 36);
      assert.equal(pairs.length, 36);
      assert.ok(m.steps.slice(0, 36).every((s) => s.hit), 'у каждого шага — удар (шанс 1)');
    }
    assert.equal(new Set(pairs.slice(0, L)).size, L, 'за НОК — все пары разные');
    assert.deepEqual(pairs.slice(L, 2 * L), pairs.slice(0, L), 'и дальше — по кругу');
    assert.notDeepEqual(pairs.slice(6, 12), pairs.slice(0, 6), 'за длину ритма узор ещё не повторился');
  });

  test(`Cymatica [${name}]: сообщение seq для известного узора — ритм {vel, chance}, мелодия {s, x, y}, место в молчащей клетке — пусто`, () => {
    const m = createModel(), ev = events(m), n = m.degPerOct(), b = m.base(), list = m.noteList();
    assert.equal(b, list.indexOf(12), 'база — ступень пластины 110 Гц (12 полутонов от 55)');
    const a = C.cellCenter(0, 0, n), c = C.cellCenter(2, 4, n), far = { x: 0.95, y: 0.2 };
    m.load({ bpm: 120, rhythm: { len: 5, steps: [{ vel: 1 }, null, { vel: 0.5, chance: 0.4 }] }, melody: { len: 3, steps: [a, null, c, null, far] } });
    m.setFx('chance', 0.8);
    const e = ev.filter((q) => q.t === 'seq').pop();
    assert.deepEqual(Object.keys(e.msg), ['t', 'bpm', 'playing', 'chance', 'rhythm', 'melody']);
    assert.equal(e.msg.bpm, 120); assert.equal(e.msg.playing, false); assert.equal(e.msg.chance, 0.8);
    assert.deepEqual(e.msg.rhythm.steps.slice(0, 4), [{ vel: 1, chance: 1 }, null, { vel: 0.5, chance: 0.4 }, null]);
    assert.equal(e.msg.rhythm.steps.length, 16);
    assert.deepEqual(e.msg.melody.steps[0], { s: list[b], x: a.x, y: a.y });
    assert.deepEqual(e.msg.melody.steps[2], { s: list[b + 2 * n + 4], x: c.x, y: c.y });
    assert.equal(e.msg.melody.steps[1], null);
    assert.deepEqual(m.state.sentSeq, { rhythm: e.msg.rhythm, melody: e.msg.melody });
    // пластина маленькая (высоко): верхнее кольцо за 1760 Гц — место молчит и уходит пустым
    m.setF0(880);
    const top = ev.filter((q) => q.t === 'seq').pop().msg;
    assert.equal(top.melody.steps[2], null, 'клетка за пределом — пауза');
    assert.ok(top.melody.steps[0] && top.melody.steps[0].s === m.noteList()[m.base()]);
    // вспышка — только у нового: ничего не менял — born пуст
    m.setBpm(121);
    assert.deepEqual(ev.pop().born, { r: [], m: [] });
    m.toggleBeat(1);
    assert.deepEqual(ev.pop().born.r, [1]);
    if (name === 'core') {                                   // ядро получило то же: его модель = state фасада, его снимок = снимок фасада
      assert.equal(m.coreSnapshot(), m.snapshot());
      assert.equal(m.coreModel().bpm, 121);
    }
  });

  test(`Cymatica [${name}]: луна — sine по времени, random с зерном повторяем; высота едет по ступеням`, () => {
    const m = createModel(), ev = events(m), D = m.state.drift;
    m.setBpm(120);
    m.setDrift('depth', 3 / 7); m.setDrift('rate', 1);        // ±3 ступени, период 1/4 (такт — четверть: 0.5 с на 120)
    assert.ok(D.on, 'тронул плашку — луна включилась');
    assert.equal(m.driftDepth(), 3); assert.equal(m.driftRate()[0], '1/4');
    const ks = [];
    for (let i = 0; i < 20; i++) { m.tick(0.025); ks.push(D.k); }
    ks.forEach((k, i) => assert.equal(k + 0, 0 + Math.round(3 * Math.sin((((i + 1) * 0.025) / 0.5) * Math.PI * 2)), `шаг ${i}`));
    assert.ok(ev.some((e) => e.t === 'f0'), 'новая ступень — пластина едет');
    const list = m.scaleSemis(), b0 = list.indexOf(12);
    m.tick(0.125 - (20 * 0.025) % 0.5);                       // четверть периода — гребень: +3 ступени
    assert.equal(D.k, 3);
    assert.ok(near(m.effF0(), 55 * 2 ** (list[b0 + 3] / 12)), `${m.effF0()}`);
    const run = (seed) => { const q = createModel({ seed }); q.setBpm(120); q.setDrift('shape', 1); const out = []; for (let i = 0; i < 80; i++) { q.tick(0.05); out.push(q.state.drift.k); } return out; };
    const r1 = run(7);
    assert.deepEqual(run(7), r1, 'одно зерно — одни ступени');
    assert.ok(r1.every((k) => Math.abs(k) <= 2), 'в пределах глубины (0.3 → ±2)');
    assert.ok(new Set(r1).size > 1, 'прыгает');
    for (let i = 0; i < 80; i += 20) assert.equal(new Set(r1.slice(i + 1, i + 19)).size, 1, 'random — новая ступень дважды за период (1 bar на 120 — каждую секунду)');
    m.toggleDrift();                                          // выкл — пластина возвращается
    m.tick(0.01);
    assert.equal(D.k, 0); assert.equal(m.effF0(), m.state.plate.f0);
  });

  test(`Cymatica [${name}]: снимок → restore — тот же JSON и та же форма, события для звука`, () => {
    const m = createModel({ seed: 5 });
    m.dice(); m.setF0(146.83); m.setFx('hall', 0.6); m.setChance(0, 0.35); m.setDrift('depth', 0.5);
    const js = m.snapshot(), o = JSON.parse(js);
    assert.deepEqual(Object.keys(o), ['f0', 'fx', 'bows', 'seq', 'drift']);
    assert.deepEqual(Object.keys(o.fx), ['structure', 'damping', 'brightness', 'hall', 'echo', 'time', 'chance']);
    assert.deepEqual(Object.keys(o.seq), ['bpm', 'rhythm', 'melody']);
    assert.deepEqual(Object.keys(o.drift), ['on', 'depth', 'rate', 'shape']);
    assert.equal(o.seq.rhythm.steps.length, 16);
    const q = createModel(), ev = events(q);
    q.restore(js);
    assert.equal(q.snapshot(), js);
    assert.deepEqual(ev.map((e) => e.t), ['f0', 'params', 'fx', 'seq']);
    assert.equal(q.state.drift.k, 0);
    assert.equal(q.state.seq.playing, false, 'часы снимок не включает');
    if (name === 'core') assert.equal(q.coreSnapshot(), js, 'модель ядра после restore — тот же снимок');
    const old = JSON.stringify({ ...o, fx: { ...o.fx, chance: undefined } });   // старый снимок без chance — 1
    q.restore(old); assert.equal(q.state.plate.fx.chance, 1);
  });

  test(`Cymatica [${name}]: кубик с зерном — повторяем; мелодия длины, не делящей ритм; ноты — по ладу во всех трёх кольцах`, () => {
    const a = createModel({ seed: 42 }), b = createModel({ seed: 42 });
    a.dice(); b.dice();
    assert.equal(a.snapshot(), b.snapshot());
    for (let k = 0; k < 40; k++) {
      const m = createModel({ seed: k }), ev = events(m);
      m.dice();
      const { rhythm, melody, playing } = m.state.seq;
      assert.ok(playing && ev.some((e) => e.t === 'seq'));
      assert.ok(rhythm.len >= 8 && rhythm.len <= 16, `${rhythm.len}`);
      assert.ok(melody.len >= 3, `${melody.len}`);
      assert.notEqual(rhythm.len % melody.len, 0, `${rhythm.len} / ${melody.len}`);
      assert.ok(rhythm.steps[0] && rhythm.steps.slice(rhythm.len).every((s) => !s), 'Евклид: первый — удар, за длиной пусто');
      const notes = m.notesOf(melody.steps);
      for (let i = 0; i < melody.len; i++) assert.ok(notes[i] != null && m.noteList().includes(notes[i]), `место ${i} — нота лада`);
      assert.ok(melody.steps.slice(melody.len).every((s) => !s));
    }
  });
}

// запись игрой: у эталона время касания и последний тик приходят параметрами, у ядра привязку к шагу делают его часы
test('Cymatica [js]: запись игрой — удар в ближайший шаг по сетке, место — в шаг мелодии того же мига; по шагам; пошаговый ввод', () => {
  const m = jsModel(), S = m.state, n = m.degPerOct(), p = C.cellCenter(0, 1, n);
  m.state.seq.bpm = 120; m.play(true); m.rec(true);           // шаг — 125 мс
  m.state.grid = 2;
  m.strikeAt(p, 1000 + 2.6 * 125, { r: 4, m: 1, atMs: 1000 });   // ближайший шаг 7 → сетка 1/8 → 8, мелодия сдвигается так же: 1 + 3 + 1 = 5
  assert.ok(S.seq.rhythm.steps[8] && !S.seq.rhythm.steps[7]);
  assert.deepEqual(S.seq.melody.steps[5], { x: p.x, y: p.y });
  assert.equal(S.lastStrike.rec, true);
  m.play(false); m.stepRecToggle();
  m.strikeAt(p, 0, null); m.skipStep();
  assert.deepEqual(S.stepRec, { r: 2, m: 2 });
  assert.ok(S.seq.rhythm.steps[0] && !S.seq.rhythm.steps[1]);
  m.stepRecToggle(); m.clear(); m.setCursor(3);
  assert.equal(m.strikeAt({ x: 0, y: 0 }, 0, null) != null, true);
  assert.equal(S.cursor, 4);
  assert.ok(S.seq.melody.steps[3] && S.seq.rhythm.steps.slice(0, S.seq.rhythm.len).every(Boolean), 'пустой ритм заполнился');
});

test('Cymatica [core]: запись игрой — ядро привязывает удар к шагу по своим часам; по шагам; пошаговый ввод', () => {
  const m = coreModel(), S = m.state, n = m.degPerOct(), p = C.cellCenter(0, 1, n), ev = events(m);
  m.setBpm(120); m.play(true); m.rec(true); m.cycleGrid();   // шаг — 125 мс; сетка 1/8
  assert.equal(S.grid, 2);
  m.tick(0.825);                                              // тики на 0, 0.125, … 0.75 (шаг 6, мелодия 6); сейчас 0.6 шага после него: ближайший — шаг 7
  assert.equal(stepsOf(m).at(-1), '6,6');
  m.strikeAt(p, 0, null);                                     // now и last фасаду больше не нужны
  assert.ok(S.seq.rhythm.steps[8] && !S.seq.rhythm.steps[7], 'удар — в шаг 8 по сетке 1/8');
  assert.deepEqual(S.seq.melody.steps[1], { x: p.x, y: p.y }, 'место — в шаг мелодии: (6 + 1) % 7 + сдвиг сетки 1');
  assert.equal(S.lastStrike.rec, true);
  assert.deepEqual(ev.filter((e) => e.t === 'seq').pop().born.r, [8], 'запись из ядра — вспышка в гнезде');
  assert.equal(m.coreSnapshot(), m.snapshot());
  m.play(false); m.stepRecToggle();
  m.strikeAt(p, 0, null); m.skipStep();
  assert.deepEqual(S.stepRec, { r: 2, m: 2 });
  assert.ok(S.seq.rhythm.steps[0] && !S.seq.rhythm.steps[1]);
  assert.deepEqual(m.coreModel().stepRec, { r: 2, m: 2 });
  m.stepRecToggle(); m.clear(); m.setCursor(3);
  assert.equal(m.strikeAt({ x: 0, y: 0 }, 0, null) != null, true);
  assert.equal(S.cursor, 4);
  assert.ok(S.seq.melody.steps[3] && S.seq.rhythm.steps.slice(0, S.seq.rhythm.len).every(Boolean), 'пустой ритм заполнился');
  assert.equal(m.coreSnapshot(), m.snapshot());
  assert.equal(m.strikeAt({ x: 0, y: 1.2 }, 0, null), null, 'за краем пластины — молчит');
});

// ---------- эталон ↔ ядро ----------
// одни и те же правки узора, лада и ручек — одно состояние: модель ядра (его снимок и зеркало) = state фасада = эталонная JS-модель
function ops(R, m) {                                          // случайная правка по зерну: имя, аргументы
  const n = m.degPerOct(), list = m.noteList(), b = m.base();
  const pick = (k) => Math.floor(R() * k);
  const cell = () => { const c = C.cellOf(b + pick(3 * n), b, n); return C.cellCenter(c.ring, c.sector, n); };
  const kind = pick(18);
  if (kind === 0) return ['toggleBeat', [pick(16)]];
  if (kind === 1) return ['setLen', [R() < 0.5 ? 'rhythm' : 'melody', 3 + pick(14)]];
  if (kind === 2) return ['setChance', [pick(16), Math.round(R() * 100) / 100]];
  if (kind === 3) return ['nudgeNote', [pick(16), b + pick(3 * n), pick(7) - 3]];
  if (kind === 4) { const p = cell(); return ['moveMark', [pick(16), p.x + (R() - 0.5) * 0.04, p.y]]; }
  if (kind === 5) return ['dropMark', [pick(16)]];
  if (kind === 6) return ['comb', []];
  if (kind === 7) return ['turn', [['rhythm', 'melody', 'plate'][pick(3)], null, pick(9) - 4]];   // orig — снимок узора, подставит прогон
  if (kind === 8) return ['setF0', [55 + R() * 800]];
  if (kind === 9) return ['stepScale', [pick(40), pick(5) - 2]];
  if (kind === 10) return ['setBpm', [60 + pick(100)]];
  if (kind === 11) return ['setFx', [['structure', 'damping', 'brightness', 'hall', 'echo', 'time', 'chance'][pick(7)], Math.round(R() * 100) / 100]];
  if (kind === 12) return ['cycleGrid', []];
  if (kind === 13) return ['play', [R() < 0.5]];
  if (kind === 14) return ['toggleDrift', []];
  if (kind === 15) return ['setDrift', [['depth', 'rate', 'shape'][pick(3)], Math.round(R() * 100) / 100]];
  if (kind === 16) { const p = cell(); return ['strikeAt', [{ x: p.x, y: p.y }, 0, null]]; }
  return ['dice', []];
}
const snapNear = (a, b, what) => {                            // снимки равны; числа — до 1e-9 (тригонометрия кубика: libm ядра ≠ V8 на последнем бите)
  const A = JSON.parse(a), B = JSON.parse(b);
  const walk = (x, y, path) => {
    if (typeof x === 'number' && typeof y === 'number') return assert.ok(Math.abs(x - y) <= 1e-9, `${what}: ${path} ${x} vs ${y}`);
    if (x && y && typeof x === 'object') { assert.deepEqual(Object.keys(x), Object.keys(y), `${what}: keys at ${path}`); for (const k of Object.keys(x)) walk(x[k], y[k], `${path}.${k}`); return; }
    assert.deepEqual(x, y, `${what}: ${path}`);
  };
  walk(A, B, '$');
};
function parity(sc, seed, count) {
  const R = seeded(seed), j = sc ? jsWithScale(sc, seed) : jsModel({ rng: seeded(seed) }), c = sc ? coreWithScale(sc, seed) : coreModel({ seed, rng: seeded(seed) });
  for (let i = 0; i < count; i++) {
    const [name, args] = ops(R, c);
    // эталон выбирает кубик на своём потоке, фасад — по зерну: кубик сравниваем отдельно; в общем прогоне его заменяет load узора
    if (name === 'dice') { const pat = { rhythm: { len: 8 + (i % 8), steps: C.euclid(3 + (i % 4), 8 + (i % 8)).map((x) => (x ? { vel: 1 } : null)) }, melody: { len: 3 + (i % 5), steps: [C.cellCenter(0, 0, c.degPerOct()), null, C.cellCenter(2, 1, c.degPerOct())] } }; j.load(pat); c.load(JSON.parse(JSON.stringify(pat))); }
    else if (name === 'turn') {
      const orig = { r: j.state.seq.rhythm.steps.slice(), m: j.state.seq.melody.steps.slice() };
      j[name](args[0], orig, args[2]); c[name](args[0], { r: c.state.seq.rhythm.steps.slice(), m: c.state.seq.melody.steps.slice() }, args[2]);
    } else if (name === 'strikeAt') { j.strikeAt(...args); c.strikeAt(...args); }
    else if (name === 'toggleDrift' || name === 'setDrift') continue;       // луна считает время: у эталона — кадры, у ядра — сэмплы (отдельный тест)
    else { j[name](...args); c[name](...args); }
    snapNear(j.snapshot(), c.snapshot(), `#${i} ${name} (facade vs reference)`);
    snapNear(c.coreSnapshot(), c.snapshot(), `#${i} ${name} (core vs facade)`);
    assert.deepEqual(c.state.seq.rhythm.steps.map((s) => !!s), j.state.seq.rhythm.steps.map((s) => !!s), `#${i} ${name}: ритм`);
    assert.deepEqual(c.notesOf(c.state.seq.melody.steps), j.notesOf(j.state.seq.melody.steps), `#${i} ${name}: ноты`);
    assert.equal(c.state.grid, j.state.grid, `#${i} ${name}: сетка`);
  }
}
test('Cymatica: правки узора — модель ядра, фасад и эталон приходят к одному состоянию (без лада)', () => {
  for (const seed of [1, 2, 3, 4, 5]) parity(null, seed, 120);
});
test('Cymatica: правки узора — то же с ладом хоста (минор от C, мажор, лидийский от F)', () => {
  parity(SC(true, 1, 3), 11, 120); parity(SC(true, 0, 0), 12, 120); parity(SC(true, 4, 8), 13, 120);
});
test('Cymatica [core]: кубик — фасад и ядро по одному зерну дают один узор, эталон — те же свойства', () => {
  for (const sc of [null, SC(true, 1, 3), SC(true, 2, 5)]) {
    for (let k = 0; k < 30; k++) {
      const c = sc ? coreWithScale(sc, k) : coreModel({ seed: k, rng: seeded(k) });
      c.dice();
      snapNear(c.coreSnapshot(), c.snapshot(), `dice seed ${k}${sc ? ' scale' : ''}`);
      assert.equal(c.coreModel().playing, true);
    }
  }
});

test('Cymatica [core]: смена лада хоста — ядро переписывает ноты пластине, фасад — подписи и вспышки', () => {
  const m = coreModel(), ev = events(m), n = m.degPerOct();
  m.load({ rhythm: { len: 4, steps: [{ vel: 1 }, { vel: 1 }] }, melody: { len: 3, steps: [C.cellCenter(0, 2, n), C.cellCenter(1, 1, n), C.cellCenter(2, 0, n)] } });
  const before = m.notesOf(m.state.seq.melody.steps);
  m.setScale(true, 1, 3);                                     // лад включили: ступеней 7 на октаву
  m.tick(0.01);
  assert.equal(m.degPerOct(), 7);
  const after = m.notesOf(m.state.seq.melody.steps);
  assert.notDeepEqual(after, before, 'клетки те же места — ноты другие');
  assert.ok(ev.some((e) => e.t === 'seq' && e.born.m.length), 'вспышка: ноты сменили клетки');
  m.setScale(false, 0, 0); m.tick(0.01);
  assert.deepEqual(m.notesOf(m.state.seq.melody.steps), before);
});

test('Cymatica [core]: отзыв резонатора — нота удара того же класса высоты, что основной тон пластины (110 Гц = A), и только она', () => {
  const m = coreModel(), n = m.degPerOct();
  const own = C.cellCenter(0, 0, n), other = C.cellCenter(0, 1, n);   // база — 12 (A2): верх края — сама база, правее — 15
  m.strikeAt(other, 0, null); m.tick(0.01);
  assert.equal(m.answers.length, 0, `${m.notesOf([other])[0]} — не тот класс`);
  m.strikeAt(own, 0, null); m.tick(0.01);
  assert.deepEqual(m.answers.map((a) => a.semi), [12], 'нота 12 = основной тон — резонатор отзывается');
  m.strikeAt(C.cellCenter(1, 0, n), 0, null); m.tick(0.01);   // кольцо выше: 12 + 12 = 24 — та же нота октавой выше, тоже отзывается
  assert.deepEqual(m.answers.map((a) => a.semi), [12, 24]);
  m.load({ rhythm: { len: 4, steps: [{ vel: 1 }] }, melody: { len: 1, steps: [own] } });   // узор: удар шага по ноте 12 — отзыв от шага
  m.play(true); m.tick(0.7);
  assert.ok(m.answers.length >= 4, `шаги тоже отзываются: ${m.answers.length}`);
});

test('Cymatica [core]: в ядре в пути — не перетираем: действия, которых ядро ещё не применило, зеркало не отменяет', () => {
  const m = coreModel({ async: true });
  m.toggleBeat(2); m.toggleBeat(5); m.setBpm(140);            // в очереди порта, ядро их ещё не видело
  m.deliver();                                                // зеркало старое — состояние фасада остаётся
  assert.ok(m.state.seq.rhythm.steps[2] && m.state.seq.rhythm.steps[5]); assert.equal(m.state.seq.bpm, 140);
  m.flush(); m.deliver();                                     // ядро применило — зеркало такое же
  assert.ok(m.state.seq.rhythm.steps[2] && m.state.seq.rhythm.steps[5]); assert.equal(m.state.seq.bpm, 140);
  assert.equal(m.coreModel().bpm, 140);
  m.tick(0.1);
  assert.equal(m.coreSnapshot(), m.snapshot());
});

test('Cymatica [core]: перезапуск звука — новый узел ядра получает сцену целиком, ход часов и сетку записи', () => {
  const m = coreModel({ seed: 9 });
  m.dice(); m.setF0(220); m.setFx('hall', 0.7); m.cycleGrid(); m.cycleGrid(); m.setDrift('depth', 0.6);
  m.tick(0.3);
  const js = m.snapshot(), grid = m.state.grid;
  m.rebind();                                                 // restartAudio → build: новый контекст, ядро с нуля
  assert.equal(m.coreSnapshot(), js);
  assert.equal(m.state.grid, grid); assert.equal(m.coreModel().grid, grid);
  assert.equal(m.coreModel().playing, true);
  const n = m.steps.length;
  m.tick(0.5);
  assert.ok(m.steps.length > n, 'часы идут и в новом узле');
});

test('Cymatica [core]: без лада и с ладом хост и ядро видят одну раскладку (0…60 полутонов, ступеней на октаву)', () => {
  const m = coreModel(), list5 = Array.from({ length: 61 }, (_, s) => s).filter((s) => [0, 3, 5, 7, 10].includes(s % 12));
  assert.deepEqual(m.noteList(), list5);
  m.setScale(true, 2, 0);                                     // дорийский от A: семь ступеней
  assert.equal(m.degPerOct(), 7);
  assert.deepEqual(m.noteList().slice(0, 8), [0, 2, 3, 5, 7, 9, 10, 12]);
  m.setF0(120);                                               // щипок с ладом — на ступень лада
  assert.ok(m.noteList().includes(Math.round(12 * Math.log2(m.state.plate.f0 / 55))));
  assert.equal(m.coreSnapshot(), m.snapshot());
});
