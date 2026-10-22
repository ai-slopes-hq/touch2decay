// Тесты модели Cymatica (worlds/cymatica/core.js, model.js) в Node: помощники секвенсера и раскладки ханга (бывший tools/test-seq.mjs),
// полиритм (узор модели → часы plate-worklet.js), сообщение seq, луна, снимок, кубик с зерном.
//   node --test tools/models/cymatica.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as C from '../../worlds/cymatica/core.js';
import { createModel } from '../../worlds/cymatica/model.js';
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
// часы секвенсера — в plate-worklet.js: грузим его в vm (как tools/test-plate.mjs) и гоним узор модели по шагам
function plateProc() {
  const SRC = readFileSync(new URL('../../plate-worklet.js', import.meta.url), 'utf8'), posted = [], reg = {};
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

test('Cymatica: полиритм — ритм 6 и мелодия 4: пары (r, m) и ноты повторяются через НОК = 12, а не через 6 или 4', () => {
  const m = createModel(), ev = events(m), n = m.degPerOct();
  const h = { vel: 1 }, cells = [[0, 0], [0, 1], [1, 2], [2, 3]].map(([r, s]) => C.cellCenter(r, s, n));
  m.load({ rhythm: { len: 6, steps: [h, h, h, h, h, h] }, melody: { len: 4, steps: cells } });
  m.play(true);
  const msg = ev.filter((e) => e.t === 'seq').pop().msg;
  assert.equal(msg.rhythm.len, 6); assert.equal(msg.melody.len, 4);   // длины — каждая своя, не сведены
  const W = plateProc();
  W.send(msg);
  for (let k = 0; k < 36; k++) W.proc.tick();
  const pairs = W.posted.filter((d) => d.t === 'step').map((d) => `${d.r},${d.m}`);
  const L = (6 * 4) / gcd(6, 4);
  assert.equal(L, 12);
  assert.equal(new Set(pairs.slice(0, L)).size, L, 'за НОК — все пары разные');
  assert.deepEqual(pairs.slice(L, 2 * L), pairs.slice(0, L), 'и дальше — по кругу');
  assert.notDeepEqual(pairs.slice(6, 12), pairs.slice(0, 6), 'за длину ритма узор ещё не повторился');
  assert.equal(W.hits.length, 36);
  const notes = m.notesOf(m.state.seq.melody.steps);
  W.hits.forEach((hz, k) => assert.ok(near(hz, 55 * 2 ** (notes[k % 4] / 12), 1e-6), `шаг ${k} бьёт ноту места ${k % 4}`));
});

test('Cymatica: сообщение seq для известного узора — ритм {vel, chance}, мелодия {s, x, y}, место в молчащей клетке — пусто', () => {
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
});

test('Cymatica: луна — sine по времени модели, random с зерном повторяем; высота едет по ступеням', () => {
  const m = createModel(), ev = events(m), D = m.state.drift;
  m.state.seq.bpm = 120;
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
  const run = (seed) => { const q = createModel({ rng: seeded(seed) }); q.state.seq.bpm = 120; q.setDrift('shape', 1); const out = []; for (let i = 0; i < 80; i++) { q.tick(0.05); out.push(q.state.drift.k); } return out; };
  const r1 = run(7);
  assert.deepEqual(run(7), r1, 'одно зерно — одни ступени');
  assert.ok(r1.every((k) => Math.abs(k) <= 2), 'в пределах глубины (0.3 → ±2)');
  assert.ok(new Set(r1).size > 1, 'прыгает');
  for (let i = 0; i < 80; i += 20) assert.equal(new Set(r1.slice(i + 1, i + 19)).size, 1, 'random — новая ступень дважды за период (1 bar на 120 — каждую секунду)');
  m.toggleDrift();                                          // выкл — пластина возвращается
  m.tick(0.01);
  assert.equal(D.k, 0); assert.equal(m.effF0(), m.state.plate.f0);
});

test('Cymatica: снимок → restore — тот же JSON и та же форма, события для звука', () => {
  const m = createModel({ rng: seeded(5) });
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
  const old = JSON.stringify({ ...o, fx: { ...o.fx, chance: undefined } });   // старый снимок без chance — 1
  q.restore(old); assert.equal(q.state.plate.fx.chance, 1);
});

test('Cymatica: кубик с зерном — повторяем; мелодия длины, не делящей ритм; ноты — по ладу во всех трёх кольцах', () => {
  const a = createModel({ rng: seeded(42) }), b = createModel({ rng: seeded(42) });
  a.dice(); b.dice();
  assert.equal(a.snapshot(), b.snapshot());
  for (let k = 0; k < 40; k++) {
    const m = createModel({ rng: seeded(k) }), ev = events(m);
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

test('Cymatica: запись игрой — удар в ближайший шаг по сетке, место — в шаг мелодии того же мига; по шагам; пошаговый ввод', () => {
  const m = createModel(), S = m.state, n = m.degPerOct(), p = C.cellCenter(0, 1, n);
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
