// Тесты модели Portus (worlds/portus/model.js) в Node: кораблики на фарватере, высота, секвенсер (step, swing, nextGap, chance), сцена, снимок, кубик с зерном.
//   node --test tools/models/portus.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel, edge, NSTEP, DT } from '../../worlds/portus/model.js';
import { seeded, near } from './util.mjs';

const events = (m) => { const ev = []; m.listen((e) => ev.push(e)); return ev; };

test('Portus: одно место — один кораблик; на занятое место — переплывает на новую ноту; тянешь — только на свободное', () => {
  const m = createModel({ rng: seeded(3) }), I = m.state.isles;
  const a = m.place(2, 0), b = m.place(10, 7);
  assert.deepEqual(I.map((i) => [i.step, i.p, i.oct, i.lvl]), [[2, 0, 0, 1], [10, 7, 0, 1]]);
  assert.ok(a.sd >= 0 && a.sd < 1000 && a.sd !== b.sd);   // зерно качания — из rng
  assert.equal(m.place(2, 5), a); assert.equal(I.length, 2); assert.equal(a.p, 5);   // то же место — тот же кораблик, новая нота
  assert.equal(m.isleOn(10), b); assert.equal(m.isleOn(3), undefined);
  m.moveIsle(a, 10); assert.equal(a.step, 2, 'место занято — остаётся');
  m.moveIsle(a, 4); assert.equal(a.step, 4);
  m.setNote(a, 9); assert.equal(a.p, 9);
  m.setIsle(b, 'oct', -1); m.setIsle(b, 'lvl', 0.5); assert.deepEqual([b.oct, b.lvl], [-1, 0.5]);
  m.sink(b); assert.deepEqual(I.map((i) => i.step), [4]);
  m.setIsle(b, 'lvl', 0.9); assert.equal(b.lvl, 0.5, 'утонувший кораблик плашка не трогает');
  m.sink(b); assert.equal(I.length, 1);
});

test('Portus: высота — A2 от тоники фарватера, лад, октава маяка и кораблика −2…+2; имя аккорда', () => {
  const m = createModel(), is = m.place(0, 0);
  assert.ok(near(m.hzOf(is), 110));
  m.setNote(is, 7); assert.ok(near(m.hzOf(is), 110 * 2 ** (7 / 12)));
  m.setNote(is, 12); assert.ok(near(m.hzOf(is), 220));
  m.setNote(is, 0);
  for (const o of [-2, -1, 0, 1, 2]) { m.setPharos('oct', o); assert.ok(near(m.hzOf(is), 110 * 2 ** o)); }
  m.setPharos('oct', -1); m.setIsle(is, 'oct', 2); assert.ok(near(m.hzOf(is), 220), 'сдвиг кораблика — от маяка');
  m.setIsle(is, 'oct', 0); m.setPharos('oct', 0);
  assert.equal(m.nameOf(is), 'Am7');                    // аккорд — у маяка (по умолчанию m7)
  m.setPharos('chord', 4); m.setNote(is, 3); assert.equal(m.nameOf(is), 'Cm11');
  const q = createModel({ scale: { on: true, root: 3, snap: (s) => 2 * Math.round(s / 2) } }), j = q.place(0, 2);   // лад: чётные полутоны, тоника +3
  assert.equal(q.root(), 3);
  assert.equal(q.semiOf(j), 2 * Math.round((2 + 3 + 24) / 2) - 24);
  assert.ok(near(q.hzOf(j), 110 * 2 ** (q.semiOf(j) / 12)));
  assert.equal(createModel({ scale: { on: false, root: 5, snap: (s) => s } }).root(), 0, 'без лада тоника — A');
});

test('Portus: nextGap — до следующего кораблика, по кругу; один кораблик — весь круг; пусто — 16 шагов', () => {
  const m = createModel(), s = m.stepSec();
  assert.ok(near(s, 0.125));                            // 120 BPM — шестнадцатая 125 мс
  assert.ok(near(m.nextGap(0), NSTEP * s), 'пустой фарватер');
  m.place(2, 0); m.place(10, 0);
  assert.ok(near(m.nextGap(2), 8 * s));
  assert.ok(near(m.nextGap(10), 8 * s), 'через конец — к началу');
  assert.ok(near(m.nextGap(5), 5 * s));
  assert.ok(near(m.nextGap(12), 6 * s));
  assert.ok(near(m.nextGap(15), 3 * s));
  m.sink(m.isleOn(10)); assert.ok(near(m.nextGap(2), NSTEP * s), 'один кораблик — до себя же через круг');
  m.setBpm(60); assert.ok(near(m.nextGap(2), NSTEP * 0.25));
});

test('Portus: swing — нечётные шестнадцатые позже на swing · полшага; шаги — ровно по stepSec', () => {
  const m = createModel();
  m.setBpm(100); m.setPharos('swing', 0.6);
  const s = 60 / 100 / 4;
  assert.ok(near(m.stepSec(), s));
  for (let j = 0; j < NSTEP; j++) assert.ok(near(m.swing(j), j % 2 ? 0.6 * s * 0.5 : 0), `шаг ${j}`);
  const at = Array.from({ length: 4 }, (_, j) => j * m.stepSec() + m.swing(j));   // как в часах engine: next += stepSec, удар — next + swing
  assert.ok(near(at[1] - at[0], s * 1.3) && near(at[2] - at[1], s * 0.7) && near(at[3] - at[2], s * 1.3));
  m.setPharos('swing', 0); assert.ok(near(m.swing(1), 0));
});

test('Portus: step — кораблик, сила (на «и» сильнее), до следующего; chance — через rng', () => {
  const m = createModel({ rng: seeded(7) });
  const a = m.place(2, 0), b = m.place(5, 4);
  assert.equal(m.step(0), null, 'пустое место');
  const h2 = m.step(2), h5 = m.step(5);
  assert.equal(h2.is, a); assert.equal(h2.vel, 1); assert.ok(near(h2.gap, 3 * m.stepSec()));
  assert.equal(h5.is, b); assert.equal(h5.vel, 0.85); assert.ok(near(h5.gap, 13 * m.stepSec()));
  m.setFx('chance', 0); assert.equal(m.step(2), null, 'chance 0 — молчит');
  m.setFx('chance', 0.5);
  const n = Array.from({ length: 400 }, () => m.step(2)).filter(Boolean).length;
  assert.ok(n > 150 && n < 250, `${n}`);
  const run = (seed) => { const q = createModel({ rng: seeded(seed) }); q.place(2, 0); q.state.fx.chance = 0.5; return Array.from({ length: 32 }, () => !!q.step(2)).join(); };
  assert.equal(run(9), run(9), 'то же зерно — тот же узор пропусков');
});

test('Portus: события — fx на шину, play, kill, audition; буй — время эха и повторы, плашка эха', () => {
  const m = createModel(), ev = events(m), S = m.state;
  m.setFx('drive', 0.7); m.setFog('amt', 0.8); m.setBpm(90);
  m.setLuna('cut', 0.9); m.setPharos('len', 0.5);        // их читает каждый удар — без событий
  assert.deepEqual(ev.splice(0).map((e) => e.t), ['fx', 'fx', 'fx']);
  assert.equal(S.fx.drive, 0.7); assert.equal(S.seq.bpm, 90); assert.equal(S.luna.cut, 0.9);
  m.play(); assert.ok(S.seq.playing); m.play(); assert.ok(!S.seq.playing); m.play(true);
  const is = m.place(3, 2); m.audition(is); m.killEcho();
  assert.deepEqual(ev.splice(0), [{ t: 'play', on: true }, { t: 'play', on: false }, { t: 'play', on: true }, { t: 'audition', is }, { t: 'kill' }]);
  assert.ok(m.sounding()); m.clear(); assert.ok(!m.sounding());
  m.setBuoy(5, 2); assert.equal(S.buoy.d, 0.95); assert.ok(near(S.buoy.u, edge(null, 1, 0.95) - 0.03)); assert.equal(S.echo.time, 4);   // дальше в море нельзя, у правого берега — 1/2
  m.setBuoy(-5, 0.5); assert.equal(S.echo.time, 0);
  assert.ok(near(m.fbOf(), 0.15 + 0.5 * 0.84));
  m.setEcho('time', 2); assert.equal(S.echo.time, 2);
  const a = edge(null, -1, 0.5), b = edge(null, 1, 0.5); assert.ok(near(S.buoy.u, a + 0.03 + 0.5 * (b - a - 0.06)), 'плашка ставит буй по времени');
  m.setEcho('fb', 1); assert.ok(near(S.buoy.d, 0.95)); assert.ok(m.fbOf() <= 0.985);
  m.setEcho('tone', 0.3); assert.equal(S.echo.tone, 0.3);
  assert.deepEqual(ev.map((e) => e.t), ['fx', 'fx', 'fx', 'fx', 'fx']);
  assert.ok(near(DT[S.echo.time] * m.stepSec(), 4 * 60 / 90 / 4));
});

test('Portus: снимок → restore — тот же JSON, шина узнаёт', () => {
  const m = createModel({ rng: seeded(11) });
  m.place(2, 0); const b = m.place(9, 7); m.setIsle(b, 'oct', 1); m.setIsle(b, 'lvl', 0.6);
  m.setPharos('chord', 4); m.setPharos('swing', 0.3); m.setFx('mare', 0.4); m.setBuoy(0.1, 0.7); m.setFog('size', 0.2); m.setBpm(133);
  const js = m.snapshot(), o = JSON.parse(js);
  assert.deepEqual(Object.keys(o), ['isles', 'luna', 'echo', 'buoy', 'fog', 'pharos', 'fx', 'bpm']);
  assert.deepEqual(Object.keys(o.isles[0]), ['step', 'p', 'oct', 'lvl', 'sd']);
  assert.deepEqual(Object.keys(o.fx), ['wow', 'mare', 'drive', 'spread', 'chance']);
  const q = createModel(), ev = events(q);
  q.restore(js);
  assert.equal(q.snapshot(), js);
  assert.deepEqual(ev.map((e) => e.t), ['fx']);
  assert.ok(!q.state.seq.playing, 'снимок часы не заводит');
  q.restore(JSON.stringify({ ...o, isles: [...o.isles, { p: 3 }] }));   // кораблик без места — пропускаем, как раньше
  assert.equal(q.state.isles.length, 2);
});

test('Portus: кубик с зерном повторяем; 3–8 корабликов, буй между берегами, часы пошли', () => {
  const a = createModel({ rng: seeded(42) }), b = createModel({ rng: seeded(42) });
  a.dice(); b.dice();
  assert.equal(a.snapshot(), b.snapshot());
  for (let k = 0; k < 40; k++) {
    const m = createModel({ rng: seeded(k) }), ev = events(m); m.dice(); const S = m.state;
    assert.ok(S.isles.length >= 3 && S.isles.length <= 8, `${S.isles.length}`);
    assert.equal(new Set(S.isles.map((i) => i.step)).size, S.isles.length, 'по одному на место');
    assert.ok(S.isles.every((i) => i.step >= 0 && i.step < NSTEP && i.p >= 0 && i.p <= 12));
    assert.ok(S.isles.filter((i) => i.step < 8).every((i) => i.p === 0), 'первая половина такта — на тонике');
    const l = edge(null, -1, S.buoy.d), r = edge(null, 1, S.buoy.d); assert.ok(S.buoy.u > l && S.buoy.u < r);
    assert.ok([-1, 0].includes(S.pharos.oct) && S.seq.playing);
    assert.deepEqual(ev.map((e) => e.t), ['fx', 'play']);
  }
});
