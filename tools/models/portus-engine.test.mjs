// Склейка Portus с ядром (worlds/portus/model.js — фасад, worlds/portus/engine.js — узел) в Node, без wasm: что и когда уходит ядру,
// как «услышано» превращается в вспышку, как зеркало правит state. Раскладка действий и зеркала должна совпадать с core/worlds/portus/world.hpp.
//   node --test tools/models/portus-engine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel, DT, SLOT, ACT, MIRROR_HEAD, MIRROR_ISLE, MIRROR_N } from '../../worlds/portus/model.js';
import { createEngine } from '../../worlds/portus/engine.js';
import { seeded, near } from './util.mjs';

function rig() {
  const sent = [], subs = [];
  const link = { connect() {} };
  const core = { ready: true, dry: { [SLOT]: link }, listen: (fn) => subs.push(fn), send: (m) => { sent.push(m); return sent.length; } };
  const model = createModel({ rng: seeded(11) });
  const engine = createEngine({ core }, model);
  model.listen(engine.on);
  engine.build({}, link);
  const acts = () => sent.filter((m) => m.t === 'action' && m.slot === SLOT);
  const mirror = (f = {}) => {                          // зеркало ядра: шаг, играет, голосов, bpm, параметры, места
    const m = new Array(MIRROR_N).fill(0); m[0] = -1; Object.assign(m, f); return m;
  };
  return { model, engine, sent, subs, acts, core, mirror };
}

test('Portus engine: слот 13, раскладка зеркала — 24 числа сцены и 16 мест по 5', () => {
  assert.equal(SLOT, 13); assert.equal(MIRROR_HEAD, 24); assert.equal(MIRROR_ISLE, 5); assert.equal(MIRROR_N, 104);
  assert.deepEqual(Object.values(ACT), [...Array(16).keys()]);
});

test('Portus engine: build отдаёт ядру порт и сцену целиком (restore), затем пуск; действия фасада — по кодам ядра', () => {
  const { model, sent, acts } = rig();
  assert.equal(sent[0].t, 'restore'); assert.equal(sent[0].slot, SLOT); assert.equal(sent[0].js, model.snapshot());
  assert.equal(acts().length, 0, 'без пуска — только сцена');
  const is = model.place(3, 4);
  model.moveIsle(is, 5); model.setNote(is, 7); model.setIsle(is, 'oct', 1); model.setIsle(is, 'lvl', 0.5);
  model.setLuna('res', 0.8); model.setBuoy(0.2, 0.7); model.setEcho('tone', 0.3); model.setFog('size', 0.2); model.setPharos('chord', 4); model.setBpm(100); model.setFx('wow', 0.9);
  model.play(true); model.killEcho(); model.clear();
  assert.deepEqual(acts().map((m) => [m.kind, m.i, m.a]), [
    [ACT.PLACE, 3, [4, is.sd]], [ACT.MOVE, 3, [5]], [ACT.NOTE, 5, [7]], [ACT.ISLE, 5, [0, 1]], [ACT.ISLE, 5, [1, 0.5]],
    [ACT.LUNA, 1, [0.8]], [ACT.BUOY, 0, [0.2, 0.7]], [ACT.ECHO, 1, [0.3]], [ACT.FOG, 1, [0.2]], [ACT.PHAROS, 0, [4]], [ACT.BPM, 0, [100]], [ACT.FX, 0, [0.9]],
    [ACT.PLAY, 0, [1]], [ACT.KILL, 0, []], [ACT.CLEAR, 0, []],
  ]);
  model.place(2, 0); model.sink(model.isleOn(2)); model.place(2, 1); model.place(2, 6);
  assert.deepEqual(acts().slice(15).map((m) => [m.kind, m.i]), [[ACT.PLACE, 2], [ACT.SINK, 2], [ACT.PLACE, 2], [ACT.NOTE, 2]], 'второй раз на то же место — нота');
  const dead = model.place(9, 0); model.sink(dead); const n = acts().length;
  model.setNote(dead, 3); model.moveIsle(dead, 11); model.setIsle(dead, 'lvl', 0.2);
  assert.equal(acts().length, n, 'утонувший кораблик ядро не трогает');
});

test('Portus engine: новый контекст — сцена и пуск заново, счёт сообщений с начала', () => {
  const r = rig();
  r.model.place(1, 0); r.model.play(true);
  const before = r.sent.length;
  r.engine.build({}, { connect() {} });
  const tail = r.sent.slice(before);
  assert.deepEqual(tail.map((m) => m.t === 'restore' ? 'restore' : m.kind), ['restore', ACT.PLAY]);
  assert.equal(JSON.parse(tail[0].js).isles.length, 1);
});

test('Portus engine: кубик — сцена ядру одним restore (пуск отдельно); restore модели — то же', () => {
  const { model, sent, acts } = rig();
  const n = sent.length;
  model.dice();
  assert.deepEqual(sent.slice(n).map((m) => m.t === 'restore' ? 'restore' : m.kind), ['restore', ACT.PLAY]);
  assert.equal(sent[n].js, model.snapshot());
  const js = model.snapshot(), m2 = sent.length;
  model.restore(js);
  assert.equal(sent.length, m2 + 1); assert.equal(sent.at(-1).t, 'restore');
  assert.ok(acts().length > 0);
});

test('Portus engine: аудиция — только пока часы стоят и не чаще 140 мс; ядру — место', async () => {
  const { model, sent, engine } = rig();
  const is = model.place(5, 3);
  model.audition(is);
  const a = sent.filter((m) => m.kind === ACT.AUDITION);
  assert.equal(a.length, 1); assert.equal(a[0].i, 5);
  model.audition(is);
  assert.equal(sent.filter((m) => m.kind === ACT.AUDITION).length, 1, 'слишком скоро');
  await new Promise((res) => setTimeout(res, 160));
  model.audition(is);
  assert.equal(sent.filter((m) => m.kind === ACT.AUDITION).length, 2);
  model.play(true);
  model.audition(is);
  assert.equal(sent.filter((m) => m.kind === ACT.AUDITION).length, 2, 'часы идут — аудиции нет');
  assert.ok(engine.ready);
});

test('Portus engine: «услышано» из ядра — вспышка кораблика с временем эха; зеркало — шаг и голоса', () => {
  const { model, engine, subs, mirror } = rig();
  const is = model.place(8, 2);
  model.setEcho('time', 2);
  const got = [];
  engine.listen((e) => got.push(e));
  model.play(true);
  const msg = { t: 'm', n: 1, w: { [SLOT]: { mirror: mirror({ 0: 8, 1: 1, 2: 3 }), heard: [[1, 8], [1, 5]] } } };   // шаг 8 есть, шага 5 — нет кораблика
  for (const fn of subs) fn(msg);
  assert.equal(got.length, 1); assert.equal(got[0].hit, is);
  assert.ok(near(got[0].dt, DT[2] * model.stepSec() * 1000)); assert.ok(near(got[0].fb, model.fbOf()));
  assert.equal(engine.step, 8); assert.equal(engine.voices, 3);
  model.play(false);
  assert.equal(engine.step, -1, 'часы стоят — шага нет');
});

test('Portus engine: зеркало с подтверждением — сообщения в пути не перетираются; старый wasm без слота — ничего не ломает', () => {
  const { model, subs, mirror, sent } = rig();
  model.place(4, 5); model.setLuna('cut', 0.9);
  const empty = { t: 'm', n: 1, w: { [SLOT]: { mirror: [], heard: [] } } };
  for (const fn of subs) fn(empty);                     // пустое зеркало (старый t2d.wasm)
  assert.equal(model.state.isles.length, 1); assert.equal(model.state.luna.cut, 0.9);
  const m = mirror({ 3: 120 }); m[MIRROR_HEAD + 4 * MIRROR_ISLE] = 1; m[MIRROR_HEAD + 4 * MIRROR_ISLE + 1] = 2;
  for (const fn of subs) fn({ t: 'm', n: 0, w: { [SLOT]: { mirror: m, heard: [] } } });   // ядро ещё не применило ни одного сообщения
  assert.equal(model.state.isles[0].p, 5, 'правка в пути — зеркало её не трогает');
  assert.equal(model.state.luna.cut, 0.9);
  for (const fn of subs) fn({ t: 'm', n: sent.length, w: { [SLOT]: { mirror: m, heard: [] } } });   // применило всё — верим зеркалу
  assert.equal(model.state.isles[0].p, 2);
});
