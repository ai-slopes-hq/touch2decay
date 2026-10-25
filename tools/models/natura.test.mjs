// Тесты эталонной модели Natura (tools/ref/natura-model.js; фасад веба worlds/natura/model.js — в конце, над ядром) в Node: ноты и лад, шаги петли (пауза, шанс, свои значения), глайд,
// кувшинки и запруда, утки и огибающая, дерево, снимок, кубик с зерном.
//   node --test tools/models/natura.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel, attOf, relOf, GONE_S } from '../ref/natura-model.js';
import { seeded, near } from './util.mjs';

const events = (m) => { const ev = []; m.listen((e) => ev.push(e)); return ev; };
const empty = (m) => { m.clear(); m.setLen(16); };

test('Natura: нота — ступень лада от тоники; без лада — ля минор от A2, две октавы с лишним', () => {
  const m = createModel();
  assert.equal(m.noteHz(0), 110);
  assert.ok(near(m.noteHz(2), 110 * 2 ** (3 / 12)));   // ля минор: 0 2 3 5 7 8 10
  assert.ok(near(m.noteHz(7), 220) && near(m.noteHz(14), 440));
  const sc = { on: true, root: 3, pcs: [3, 5, 7, 8, 10, 0, 2] };   // до мажор: тоника C — 3 полутона от A
  const q = createModel({ scale: sc });
  assert.ok(near(q.noteHz(0), 110 * 2 ** (3 / 12)));
  assert.ok(near(q.noteHz(2), 110 * 2 ** (7 / 12)));  // ми
  assert.ok(near(q.noteHz(7), 2 * q.noteHz(0)));
  sc.pcs = [3, 7, 10];                                // трезвучие: три ступени на октаву
  assert.ok(near(q.noteHz(3), 2 * q.noteHz(0)) && near(q.noteHz(1), 110 * 2 ** (7 / 12)));
});

test('Natura: голос кораблика — поперёк реки высота; с ладом по ступеням, без — плавно между ними', () => {
  const sc = { on: false, root: 0, pcs: null }, m = createModel({ scale: sc });
  assert.ok(near(m.skiffHz(-0.39), m.noteHz(0)) && near(m.skiffHz(0.39), m.noteHz(14)));
  assert.ok(near(m.skiffHz(-1), m.noteHz(0)) && near(m.skiffHz(1), m.noteHz(14)), 'за берегом — край');
  const q = (d) => (d / 14 - 0.5) * 0.78;            // ступень d → поперёк
  const mid = m.skiffHz(q(3.5));
  assert.ok(near(Math.log2(mid), (Math.log2(m.noteHz(3)) + Math.log2(m.noteHz(4))) / 2), 'без лада — между ступенями');
  sc.on = true;
  assert.ok(near(m.skiffHz(q(3.4)), m.noteHz(3)) && near(m.skiffHz(q(3.6)), m.noteHz(4)), 'с ладом — ближайшая ступень');
});

test('Natura: шаг петли — пустое место пауза, шанс через rng (свой × общий), свои значения кувшинки сильнее пейзажа', () => {
  let calls = 0;
  const base = seeded(3), rng = () => { calls++; return base(); };
  const m = createModel({ rng }), { pads, fx } = m.state;
  empty(m); m.setLen(4);
  pads.at[0] = { note: 0, wave: 1 }; pads.at[2] = { note: 7, wave: 2, lock: { cutoff: 0.9, att: 0.5 } };
  assert.equal(m.stepNote(1), null); assert.equal(calls, 0, 'пустое место — без rng');
  const a = m.stepNote(4);                           // 4 % 4 = 0
  assert.equal(a.i, 0); assert.equal(a.wave, 1); assert.equal(a.hz, 110);
  assert.equal(a.cutoff, fx.cutoff); assert.equal(a.res, fx.res);
  assert.ok(near(a.att, attOf(fx.att)) && near(a.rel, relOf(fx.rel)));
  const b = m.stepNote(2);
  assert.equal(b.cutoff, 0.9); assert.equal(b.res, fx.res);   // своё cutoff, общее res
  assert.ok(near(b.att, attOf(0.5)) && near(b.rel, relOf(fx.rel)));
  pads.at[2].chance = 0;
  assert.equal(m.stepNote(2), null, 'chance 0 — молчит');
  pads.at[2].chance = 0.5;
  const n = Array.from({ length: 400 }, () => m.stepNote(2)).filter(Boolean).length;
  assert.ok(n > 150 && n < 250, `шанс 50 %: ${n}`);
  fx.chance = 0.5; pads.at[0].chance = 0.5;
  const k = Array.from({ length: 400 }, () => m.stepNote(0)).filter(Boolean).length;
  assert.ok(k > 60 && k < 140, `шанс 25 % (свой × общий): ${k}`);
  const r = createModel({ rng: () => 0.999 });
  assert.ok(r.stepNote(0), 'rng < 1 × 1 — звучит');
});

test('Natura: длина шага и задержки — доли темпа', () => {
  const m = createModel(), { seq, fx } = m.state;
  m.setBpm(120); assert.ok(near(m.stepSec(), 0.125));
  fx.time = 0; assert.deepEqual(m.div(), ['1/16', 1 / 4]); assert.ok(near(m.delaySec(), 0.125));
  fx.time = 1; assert.deepEqual(m.div(), ['1/2', 2]); assert.ok(near(m.delaySec(), 1));
  fx.time = 0.5; assert.equal(m.div()[0], '1/4');
  assert.equal(seq.bpm, 120);
});

test('Natura: глайд — из прошлой сыгранной ноты за 0.8 шага; без глайда и первая нота — сразу', () => {
  const m = createModel(), { pads } = m.state;
  empty(m); m.setLen(3);
  pads.at[0] = { note: 0, wave: 0, glide: true }; pads.at[1] = { note: 4, wave: 0 }; pads.at[2] = { note: 7, wave: 0, glide: true };
  assert.equal(m.stepNote(0).from, 0, 'первая нота — глайда не из чего');
  assert.equal(m.stepNote(1).from, 0, 'без глайда');
  const c = m.stepNote(2);
  assert.ok(near(c.from, m.noteHz(4)) && near(c.glide, m.stepSec() * 0.8));
  assert.ok(near(m.stepNote(3).from, m.noteHz(7)), 'по кругу: из последней');
  m.voice(pads.at[1]);                                // послушать тоже двигает «прошлую ноту»
  assert.ok(near(m.stepNote(0).from, m.noteHz(4)));
  m.glide([1, 2]);                                    // провёл через 1 (без) и 2 (с) — оба скользят
  assert.ok(pads.at[1].glide && pads.at[2].glide);
  m.glide([1, 2]);                                    // все уже скользили — снять
  assert.ok(!pads.at[1].glide && !pads.at[2].glide);
});

test('Natura: кувшинки — посадить, сдвинуть, нота, убрать, запруда; послушать — событие', () => {
  const m = createModel(), ev = events(m), { pads } = m.state;
  empty(m);
  m.state.lastWave = 3;
  m.plant(5, 9);
  assert.deepEqual(pads.at[5], { note: 9, wave: 3 });
  assert.deepEqual(ev.splice(0), [{ t: 'hear', pd: pads.at[5] }]);
  m.plant(5, 2); assert.equal(pads.at[5].note, 9, 'место занято'); assert.equal(ev.length, 0);
  m.plant(6, 1);
  assert.equal(m.movePad(5, 6), false, 'на занятое — нет');
  assert.equal(m.movePad(5, 5), false);
  const pd = pads.at[5];
  assert.equal(m.movePad(5, 8), true); assert.equal(pads.at[8], pd); assert.equal(pads.at[5], null);
  ev.splice(0);
  m.setNote(8, 9); assert.equal(ev.length, 0, 'та же нота — тихо');
  m.setNote(8, 11); assert.equal(pd.note, 11); assert.deepEqual(ev.splice(0), [{ t: 'hear', pd }]);
  m.remove(8); assert.equal(pads.at[8], null);
  m.setLen(5); assert.equal(pads.len, 5);
  assert.equal(m.sounding(), false);
  m.play(true); assert.equal(m.sounding(), false, 'кувшинка 6 за запрудой — не звучит');
  m.plant(2, 3); assert.equal(m.sounding(), true);
  m.play(); assert.equal(m.state.seq.playing, false, 'play() — переключить');
  assert.deepEqual(ev.filter((e) => e.t === 'play'), [{ t: 'play', on: true }, { t: 'play', on: false }]);
});

test('Natura: плашка кувшинки — цветок, шанс, свои значения, сброс; меню волн', () => {
  const m = createModel(), ev = events(m), pd = m.state.pads.at[0];
  assert.equal(m.setWave(pd, pd.wave), false);
  assert.equal(m.setWave(pd, 4), true); assert.equal(pd.wave, 4); assert.equal(m.state.lastWave, 4);
  m.setChance(pd, 0.65); m.setLock(pd, 'cutoff', 0.2); m.setLock(pd, 'rel', 0.9);
  assert.deepEqual(pd.lock, { cutoff: 0.2, rel: 0.9 });
  assert.equal(m.val(pd, 'cutoff'), 0.2); assert.equal(m.val(pd, 'res'), m.state.fx.res);
  m.resetPad(pd, 'cutoff'); assert.deepEqual(pd.lock, { rel: 0.9 });
  m.resetPad(pd, 'rel'); assert.equal(pd.lock, undefined, 'последнее своё — общий обвод');
  m.resetPad(pd, 'chance'); assert.equal(pd.chance, 1);
  m.pickWave(2); assert.equal(m.state.lastWave, 2);
  m.pickWave(1, pd); assert.equal(pd.wave, 1); assert.equal(m.state.lastWave, 1);
  assert.deepEqual(ev, [{ t: 'wave', w: 2 }, { t: 'hear', pd }]);
});

test('Natura: утки улетели — огибающая открыта 4 с времени модели; дерево затихает', () => {
  const m = createModel(), pd = { note: 0, wave: 0, lock: { att: 0.7, rel: 0.1 } };
  m.tick(10);
  assert.equal(m.envOpen(), false);
  m.scare();
  assert.ok(m.envOpen());
  assert.ok(near(m.attSec(pd), attOf(0)) && near(m.relSec(pd), relOf(1)), 'attack в ноль, release до конца — и у своих значений');
  m.tick(GONE_S - 0.01); assert.ok(m.envOpen());
  m.tick(0.02); assert.equal(m.envOpen(), false);
  assert.ok(near(m.attSec(pd), attOf(0.7)));
  const ev = events(m);
  m.shakeBy(0.7); m.shakeBy(0.7); assert.equal(m.state.shake, 1);
  m.tick(0.05); assert.ok(near(m.state.shake, Math.exp(-0.05 / 1.4)));
  m.tick(5); assert.ok(near(m.state.shake, Math.exp(-0.15 / 1.4)), 'шаг затухания — не длиннее 0.1 с');
  assert.deepEqual(ev.map((e) => e.t), ['shake', 'shake']);
  m.croak(null); m.croak(pd); m.scatter(); m.skiff({ t: 0.5, q: 0 }); m.skiff(null);
  assert.deepEqual(ev.slice(2).map((e) => e.t), ['croak', 'laser', 'skiff', 'skiff']);
});

test('Natura: снимок → restore — тот же JSON; старый снимок без chance и с env', () => {
  const m = createModel({ rng: seeded(7) });
  m.dice(); m.setFx('reverb', 0.7); m.setBpm(111); m.glide([m.state.pads.at.findIndex(Boolean)]);
  const js = m.snapshot(), o = JSON.parse(js);
  assert.deepEqual(Object.keys(o), ['fx', 'len', 'at', 'bpm']);
  assert.deepEqual(Object.keys(o.fx), ['reverb', 'delay', 'time', 'chorus', 'cutoff', 'res', 'att', 'rel', 'chance']);
  const q = createModel(), ev = events(q);
  q.restore(js);
  assert.equal(q.snapshot(), js);
  assert.deepEqual(ev, [{ t: 'fx' }]);
  const old = { fx: { reverb: 0.1, delay: 0.2, time: 0.3, chorus: 0.4, cutoff: 0.5, res: 0.6, att: 0.1, rel: 0.2, env: 0.9 }, len: 8, at: Array(16).fill(null), bpm: 80 };
  q.state.fx.chance = 0.3; q.restore(JSON.stringify(old));
  assert.equal(q.state.fx.chance, 1); assert.equal('env' in q.state.fx, false); assert.equal(q.state.seq.bpm, 80);
});

test('Natura: restore копирует кувшинки — правка после restore не трогает снимок', () => {
  const m = createModel(), js = JSON.stringify({ fx: {}, len: 4, at: [{ note: 1, wave: 0, lock: { cutoff: 0.3 } }, null], bpm: 90 });
  m.restore(js); const a = m.state.pads.at[0];
  m.restore(js); assert.notEqual(m.state.pads.at[0], a);
  m.state.pads.at[0].lock.cutoff = 0.9;
  assert.equal(a.lock.cutoff, 0.3);
});

test('Natura: кубик с зерном повторяем — Евклид на 8–16 местах, ноты блуждают, река поплыла', () => {
  const a = createModel({ rng: seeded(42) }), b = createModel({ rng: seeded(42) }), ev = events(a);
  a.dice(); b.dice();
  assert.equal(a.snapshot(), b.snapshot());
  assert.ok(a.state.seq.playing);
  assert.deepEqual(ev.map((e) => e.t), ['fx', 'play']);
  for (let s = 0; s < 40; s++) {
    const m = createModel({ rng: seeded(s) }); m.dice();
    const { len, at } = m.state.pads, live = at.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
    assert.ok(len >= 8 && len <= 16, `${len}`);
    assert.ok(live.every((i) => i < len) && live.length >= 3);
    assert.ok(live.every((i, k) => k === 0 || Math.abs(at[i].note - at[live[k - 1]].note) <= 2), 'ноты — шагами ±1–2 ступени');
    assert.ok(at.every((p) => !p || (p.note >= 0 && p.note <= 14 && p.wave >= 0 && p.wave <= 4)));
    assert.equal(m.state.fx.chance, 1);
  }
  const p = createModel({ rng: seeded(1) }); p.play(true); const e2 = events(p); p.dice();
  assert.deepEqual(e2.map((e) => e.t), ['fx'], 'уже плывёт — не перезапускать');
});

// ===== фасад веба (worlds/natura/model.js) над ядром (t2d.wasm): после каждого действия сцена в зеркале ядра совпадает со state =====
import * as ref from '../ref/natura-model.js';
import * as web from '../../worlds/natura/model.js';
import { createModel as coreModel, sceneState, sceneOf, agreeScenes, norm } from './natura-core.mjs';
import { SR } from './sdk-facade.mjs';

test('Natura [core]: константы фасада — те же, что у эталона', () => {
  assert.deepEqual(web.WAVES, ['sine', 'square', 'triangle', 'saw', 'sharp']); assert.deepEqual(web.LOCKS, ['cutoff', 'res', 'att', 'rel']);
  assert.deepEqual(web.DIVS, [['1/16', 1 / 4], ['1/8', 1 / 2], ['1/8d', 3 / 4], ['1/4', 1], ['1/4d', 1.5], ['1/2', 2]]);
  for (const v of [0, 0.3, 1]) { assert.equal(web.attOf(v), attOf(v)); assert.equal(web.relOf(v), relOf(v)); }
  assert.equal(web.GONE_S, GONE_S);
  const a = createModel({ scale: { on: true, root: 3, pcs: [3, 5, 7, 8, 10, 0, 2] } }), b = web.createModel({ scale: { on: true, root: 3, pcs: [3, 5, 7, 8, 10, 0, 2] } });
  for (let n = 0; n <= 14; n++) assert.equal(a.noteHz(n), b.noteHz(n));
  for (const q of [-1, -0.2, 0, 0.17, 0.39]) assert.equal(a.skiffHz(q), b.skiffHz(q));
});

test('Natura [core]: демо-сцена фасада и ядра — одна', () => {
  const m = coreModel(); m.agree('демо');
  assert.equal(m.state.pads.at.filter(Boolean).length, 9);
});

test('Natura [core]: кувшинки — посадить, сдвинуть, нота, убрать, запруда, бегунок; ядро слышит каждое', () => {
  const m = coreModel(), { pads } = m.state;
  m.clear(); m.setLen(16); m.agree('пусто');
  assert.equal(m.coreScene().at.filter(Boolean).length, 0);
  m.pickWave(3); m.plant(5, 9);
  assert.deepEqual(pads.at[5], { note: 9, wave: 3 });
  m.plant(5, 2); assert.equal(pads.at[5].note, 9, 'место занято');
  m.plant(6, 1); assert.equal(m.movePad(5, 6), false); assert.equal(m.movePad(5, 8), true);
  m.setNote(8, 11); m.glide([6, 8]); assert.ok(pads.at[6].glide && pads.at[8].glide);
  m.glide([6, 8]); assert.ok(!pads.at[6].glide);
  m.remove(6); m.setLen(5);
  assert.equal(m.coreScene().len, 5);
  assert.equal(m.sounding(), false);
  m.play(true); assert.equal(m.coreScene().playing, true);
  m.plant(2, 3); assert.equal(m.sounding(), true);
  m.tick(0.5); assert.ok(m.coreScene().step >= 0, 'бегунок идёт');
  assert.equal(m.state.seq.playing, true);
  m.play(); assert.equal(m.coreScene().playing, false);
});

test('Natura [core]: плашка кувшинки — цветок, шанс, свои значения, сброс; ядро согласно', () => {
  const m = coreModel(), pd = m.state.pads.at[0];
  m.setWave(pd, 4); m.setChance(pd, 0.65); m.setLock(pd, 'cutoff', 0.2); m.setLock(pd, 'rel', 0.9);
  assert.deepEqual(norm(m.state.pads.at[0]).lock, { cutoff: 0.2, rel: 0.9 });
  m.resetPad(pd, 'cutoff'); m.resetPad(pd, 'rel'); assert.equal(pd.lock, undefined);
  m.resetPad(pd, 'chance'); assert.equal(pd.chance, 1);
  m.pickWave(1, pd); m.setLock(pd, 'res', 0.4); m.setLock(pd, 'att', 0.1);
  m.agree('плашка');
  m.clear(); assert.deepEqual(m.coreScene().at.filter(Boolean), []);
});

test('Natura [core]: ядро и эталон под случайными правками — одна сцена и один снимок', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const r = seeded(seed * 101), a = ref.createModel({ rng: seeded(seed) }), b = coreModel({ seed, rng: seeded(seed) });
    const ix = () => Math.floor(r() * 16), pad = (m, i) => m.state.pads.at[i];
    for (let s = 0; s < 120; s++) {
      const i = ix(), j = ix(), k3 = ix(), v = r(), w = r(), op = Math.floor(r() * 16);
      for (const m of [a, b]) {
        const pd = pad(m, i);
        switch (op) {
          case 0: case 1: m.plant(i, Math.floor(v * 15)); break;
          case 2: m.remove(i); break;
          case 3: m.movePad(i, j); break;
          case 4: if (pd) m.setNote(i, Math.floor(v * 15)); break;
          case 5: m.setLen(1 + Math.floor(v * 16)); break;
          case 6: m.glide([i, j, k3]); break;
          case 7: if (pd) m.setWave(pd, Math.floor(v * 5)); break;
          case 8: if (pd) m.setChance(pd, Math.round(v * 20) / 20); break;
          case 9: if (pd) m.setLock(pd, ['cutoff', 'res', 'att', 'rel'][Math.floor(v * 4)], v); break;
          case 10: if (pd) m.resetPad(pd, ['cutoff', 'res', 'att', 'rel', 'chance'][Math.floor(v * 5)]); break;
          case 11: m.pickWave(Math.floor(v * 5), v > 0.5 ? pd : undefined); break;
          case 12: m.setFx(['reverb', 'delay', 'time', 'chorus', 'cutoff', 'res', 'att', 'rel', 'chance'][Math.floor(v * 9)], w); break;
          case 13: m.setBpm(60 + Math.floor(v * 100)); break;
          case 14: if (s % 17 === 0) m.dice(); break;
          case 15: if (s % 40 === 0) m.clear(); break;
        }
      }
      agreeScenes(sceneState(a.state), sceneState(b.state), `seed ${seed} шаг ${s} op ${op}`);
      agreeScenes(sceneOf(b.mirror()), sceneState(a.state), `ядро seed ${seed} шаг ${s} op ${op}`);
    }
    const snapScene = (js) => { const o = JSON.parse(js); return { bpm: o.bpm, len: o.len, fx: o.fx, at: o.at.map(norm) }; };   // glide:false / chance:1 / пустой lock — то же самое
    agreeScenes(snapScene(b.snapshot()), snapScene(a.snapshot()), `снимок seed ${seed}`);
    agreeScenes(snapScene(b.core.snapshot(web.SLOT)), snapScene(a.snapshot()), `снимок ядра seed ${seed}`);
    assert.deepEqual(Object.keys(JSON.parse(b.core.snapshot(web.SLOT))), ['fx', 'len', 'at', 'bpm']);
  }
});

test('Natura [core]: снимок → restore — те же сцена и JSON; в новый фасад и в новое ядро', () => {
  const m = coreModel({ seed: 9, rng: seeded(9) });
  m.dice(); m.setFx('reverb', 0.7); m.setBpm(111); m.glide([m.state.pads.at.findIndex(Boolean)]);
  const js = m.snapshot(), q = coreModel({ seed: 2 });
  q.restore(js);
  assert.equal(q.snapshot(), js); agreeScenes(sceneOf(q.mirror()), sceneState(m.state), 'restore');
  assert.deepEqual(JSON.parse(q.core.snapshot(web.SLOT)), JSON.parse(js));
  const old = { fx: { reverb: 0.1, delay: 0.2, time: 0.3, chorus: 0.4, cutoff: 0.5, res: 0.6, att: 0.1, rel: 0.2, env: 0.9 }, len: 8, at: Array(16).fill(null), bpm: 80 };
  q.restore(JSON.stringify(old));
  assert.equal(q.state.fx.chance, 1); assert.equal(sceneOf(q.mirror()).fx.chance, 1); assert.equal(sceneOf(q.mirror()).bpm, 80);
});

test('Natura [core]: кубик с зерном повторяем; ядро получает одно restore, играет, повторный — не перезапускает', () => {
  const a = coreModel({ seed: 5, rng: seeded(42) }), b = coreModel({ seed: 5, rng: seeded(42) }), ev = [];
  a.listen((e) => ev.push(e.t));
  a.dice(); b.dice();
  assert.equal(a.snapshot(), b.snapshot()); assert.ok(a.state.seq.playing && a.coreScene().playing);
  assert.deepEqual(ev, ['fx', 'play']);
  const ref2 = ref.createModel({ rng: seeded(42) }); ref2.dice();
  assert.deepEqual(JSON.parse(a.snapshot()), JSON.parse(ref2.snapshot()), 'тот же кубик, что у эталона');
  ev.length = 0; a.dice(); assert.deepEqual(ev, ['fx'], 'уже плывёт — не перезапускать');
});

test('Natura [core]: дерево — затихает в ядре (τ 1.4 с), зеркало ведёт state.shake; SHAKEBY копится до 1', () => {
  const m = coreModel();
  m.shakeBy(0.7); m.shakeBy(0.7); assert.equal(m.state.shake, 1);
  m.tick(0.001); assert.ok(m.coreScene().shake > 0.99);
  m.tick(1.4); assert.ok(Math.abs(m.coreScene().shake - Math.exp(-1)) < 5e-3, `${m.coreScene().shake}`);
  assert.ok(Math.abs(m.state.shake - m.coreScene().shake) < 1e-9, 'state.shake — зеркало');
  m.tick(30); assert.equal(m.coreScene().shake, 0); assert.equal(m.state.shake, 0);
});

test('Natura [core]: асинхронный порт — зеркало, отставшее от правок, не перетирает свежее; после доставки сцены согласны', () => {
  const m = coreModel({ seed: 4, async: true, check: false }), { pads } = m.state;
  m.deliver();                                          // первое зеркало: ядро ещё без сцены (bind не слал) — фасад держит своё
  m.rebind(); m.flush(); m.deliver(); m.agree('после bind');
  m.setNote(0, 14); m.setLock(pads.at[0], 'cutoff', 0.11); m.plant(1, 3); m.setFx('delay', 0.9); m.setBpm(133); m.setLen(7);
  m.deliver();                                          // ядро ещё не применило — старое зеркало
  assert.equal(pads.at[0].note, 14); assert.equal(pads.at[0].lock.cutoff, 0.11); assert.equal(pads.at[1].note, 3);
  assert.equal(m.state.fx.delay, 0.9); assert.equal(m.state.seq.bpm, 133); assert.equal(pads.len, 7);
  m.flush(); m.deliver(); m.agree('после доставки');
  m.remove(0); m.movePad(2, 4); m.glide([1, 4]); m.deliver(); m.flush(); m.deliver(); m.agree('второй круг');
  m.play(true); m.deliver(); assert.equal(m.state.seq.playing, true, 'пуск не откатило зеркало'); m.flush(); m.deliver(); assert.equal(m.coreScene().playing, true);
  m.shakeBy(0.5); m.deliver(); assert.equal(m.state.shake, 0.5); m.flush(); m.deliver(); assert.ok(m.state.shake > 0.49);
});

test('Natura [core]: новый узел ядра (restartAudio) — сцена и пуск возвращаются целиком', () => {
  const m = coreModel({ seed: 6, rng: seeded(6) });
  m.dice(); m.setBpm(101); m.shakeBy(0.4);
  const before = sceneState(m.state);
  m.rebind(11);
  agreeScenes(sceneOf(m.mirror()), before, 'после rebind');
  assert.equal(m.coreScene().playing, true); assert.ok(m.coreScene().shake > 0.3);
  m.tick(0.2); assert.ok(m.coreScene().step >= 0);
  assert.ok(SR > 0);
});
