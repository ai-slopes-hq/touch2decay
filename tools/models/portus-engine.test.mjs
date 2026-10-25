// Склейка Portus с ядром (worlds/portus/engine.js) в Node, без wasm: что и когда уходит ядру, как «услышано» превращается в вспышку.
// Раскладка чисел должна совпадать с core/worlds/portus/world.hpp (STATE) — её сверяет и C++-тест portusWorld (core/tests/sdk_test.cpp).
//   node --test tools/models/portus-engine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel, DT } from '../../worlds/portus/model.js';
import { createEngine, stateArgs, ACT, SLOT, STATE_HEAD, STATE_N } from '../../worlds/portus/engine.js';
import { seeded, near } from './util.mjs';

function rig() {
  const sent = [], subs = [];
  const link = { connect() {} };
  const core = { ready: true, dry: { [SLOT]: link }, listen: (fn) => subs.push(fn), send: (m) => { sent.push(m); return sent.length; } };
  const model = createModel({ rng: seeded(11) });
  const engine = createEngine({ core }, model);
  model.listen(engine.on);
  engine.build({}, link);
  const kinds = () => sent.filter((m) => m.t === 'action' && m.slot === SLOT).map((m) => m.kind);
  return { model, engine, sent, subs, kinds, core };
}

test('Portus engine: слот 13, раскладка STATE — 19 чисел шины и 16 мест по 4', () => {
  assert.equal(SLOT, 13); assert.equal(STATE_HEAD, 19); assert.equal(STATE_N, 83);
  const m = createModel({ rng: seeded(2) });
  m.place(2, 0); m.place(10, 7); m.setIsle(m.isleOn(10), 'lvl', 0.5);
  const a = stateArgs(m);
  assert.equal(a.length, STATE_N);
  const { luna, echo, fog, pharos, fx, seq } = m.state;
  assert.deepEqual(a.slice(0, STATE_HEAD), [seq.bpm, fx.chance, pharos.swing, pharos.chord, pharos.lvl, pharos.len, m.fcOf(), luna.res, luna.env, DT[echo.time], echo.tone,
    echo.mix, m.fbOf(), fog.amt, fog.size, fx.drive, fx.wow, fx.mare, fx.spread]);
  const slot = (j) => a.slice(STATE_HEAD + 4 * j, STATE_HEAD + 4 * j + 4);
  assert.deepEqual(slot(0), [0, 0, 0, 0]);
  assert.equal(slot(2)[0], 1); assert.ok(near(slot(2)[1], 110)); assert.equal(slot(2)[2], 0); assert.equal(slot(2)[3], 1);   // A2 = 110 Гц
  assert.equal(slot(10)[0], 1); assert.ok(near(slot(10)[1], 110 * 2 ** (7 / 12))); assert.equal(slot(10)[2], 7); assert.equal(slot(10)[3], 0.5);
});

test('Portus engine: build шлёт состояние; изменение — раз, без изменения — ничего; пуск и kill — отдельными действиями', () => {
  const { model, engine, kinds, sent } = rig();
  assert.deepEqual(kinds(), [ACT.STATE]);
  engine.poll(100); engine.poll(200);
  assert.equal(kinds().length, 1, 'ничего не менялось — ничего не шлём');
  model.place(3, 4);
  engine.poll(300);
  assert.deepEqual(kinds(), [ACT.STATE, ACT.STATE]);
  model.setLuna('cut', 0.8); engine.poll(400);                 // луна событий не шлёт — подхватывает опрос
  assert.equal(kinds().length, 3);
  model.play(true);
  assert.equal(sent.at(-1).kind, ACT.PLAY); assert.deepEqual(sent.at(-1).a, [1]);
  model.play(false);
  assert.deepEqual(sent.at(-1).a, [0]);
  model.killEcho();
  assert.equal(sent.at(-1).kind, ACT.KILL);
  model.setFx('wow', 0.9);                                      // событие fx — сразу, без ожидания опроса
  assert.equal(sent.at(-1).kind, ACT.STATE); assert.equal(sent.at(-1).a[16], 0.9);
});

test('Portus engine: новый контекст — состояние и пуск заново', () => {
  const r = rig();
  r.model.place(1, 0); r.model.play(true);
  const before = r.sent.length;
  r.engine.build({}, { connect() {} });
  const tail = r.sent.slice(before).map((m) => m.kind);
  assert.deepEqual(tail, [ACT.STATE, ACT.PLAY]);
});

test('Portus engine: аудиция — только пока часы стоят и не чаще 140 мс', async () => {
  const { model, kinds, sent, engine } = rig();
  const is = model.place(5, 3);
  model.audition(is);
  const a = sent.filter((m) => m.kind === ACT.AUDITION);
  assert.equal(a.length, 1);
  assert.deepEqual(a[0].a.slice(1), [3, 1, 5]);                 // p, lvl, шаг
  assert.ok(near(a[0].a[0], model.hzOf(is)));
  model.audition(is);
  assert.equal(sent.filter((m) => m.kind === ACT.AUDITION).length, 1, 'слишком скоро');
  await new Promise((res) => setTimeout(res, 160));
  model.audition(is);
  assert.equal(sent.filter((m) => m.kind === ACT.AUDITION).length, 2);
  model.play(true);
  model.audition(is);
  assert.equal(sent.filter((m) => m.kind === ACT.AUDITION).length, 2, 'часы идут — аудиции нет');
  assert.ok(kinds().length > 0 && engine.ready);
});

test('Portus engine: «услышано» из ядра — вспышка кораблика с временем эха; зеркало — шаг и голоса', () => {
  const { model, engine, subs } = rig();
  const is = model.place(8, 2);
  model.setEcho('time', 2);
  const got = [];
  engine.listen((e) => got.push(e));
  model.play(true);
  const msg = { t: 'm', n: 1, w: { [SLOT]: { mirror: [8, 1, 3], heard: [[1, 8], [1, 5]] } } };   // шаг 8 есть, шага 5 — нет кораблика
  for (const fn of subs) fn(msg);
  assert.equal(got.length, 1); assert.equal(got[0].hit, is);
  assert.ok(near(got[0].dt, DT[2] * model.stepSec() * 1000)); assert.ok(near(got[0].fb, model.fbOf()));
  assert.equal(engine.step, 8); assert.equal(engine.voices, 3);
  model.play(false);
  assert.equal(engine.step, -1, 'часы стоят — шага нет');
});
