// Тесты модели Portus: кораблики на фарватере, высота, секвенсер (step, swing, nextGap, chance), сцена, снимок, кубик с зерном.
// Каждый тест — дважды: против эталонной JS-модели (tools/ref/portus-model.js) и против фасада веба (worlds/portus/model.js) над моделью ядра
// (t2d.wasm, порт — portus-core.mjs): после каждого действия сцена в зеркале ядра обязана совпасть со state фасада.
// Шаги и звук ядра — tools/test-portus-core.mjs и portusWorld в core/tests/sdk_test.cpp.
//   core/build.sh && node --test tools/models/portus.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ref from '../ref/portus-model.js';
import * as web from '../../worlds/portus/model.js';
import { createModel as coreModel } from './portus-core.mjs';
import { seeded, near } from './util.mjs';

const { edge, NSTEP, DT } = ref;
const FACTORIES = {
  js: (o = {}) => ref.createModel(o),
  core: ({ scale, rng, seed = 1 } = {}) => coreModel({ seed, ...(rng ? { rng } : {}), ...(scale ? { scale } : {}) }),
};
const events = (m) => { const ev = []; m.listen((e) => ev.push(e)); return ev; };

test('Portus: константы фасада — те же, что у эталона', () => {
  assert.deepEqual(web.CHORDS, ref.CHORDS); assert.deepEqual(web.DT, ref.DT); assert.deepEqual(web.DT_NAME, ref.DT_NAME); assert.deepEqual(web.NOTES, ref.NOTES);
  assert.equal(web.NSTEP, ref.NSTEP); assert.equal(web.PSPAN, ref.PSPAN);
  for (const d of [0, 0.1, 0.3, 0.5, 0.9, 1]) for (const s of [-1, 1]) assert.equal(web.edge(null, s, d), ref.edge(null, s, d));
});

for (const [name, mk] of Object.entries(FACTORIES)) {
  test(`Portus [${name}]: одно место — один кораблик; на занятое место — переплывает на новую ноту; тянешь — только на свободное`, () => {
    const m = mk({ rng: seeded(3) }), I = m.state.isles;
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

  test(`Portus [${name}]: высота — A2 от тоники фарватера, лад, октава маяка и кораблика −2…+2; имя аккорда`, () => {
    const m = mk(), is = m.place(0, 0);
    assert.ok(near(m.hzOf(is), 110));
    m.setNote(is, 7); assert.ok(near(m.hzOf(is), 110 * 2 ** (7 / 12)));
    m.setNote(is, 12); assert.ok(near(m.hzOf(is), 220));
    m.setNote(is, 0);
    for (const o of [-2, -1, 0, 1, 2]) { m.setPharos('oct', o); assert.ok(near(m.hzOf(is), 110 * 2 ** o)); }
    m.setPharos('oct', -1); m.setIsle(is, 'oct', 2); assert.ok(near(m.hzOf(is), 220), 'сдвиг кораблика — от маяка');
    m.setIsle(is, 'oct', 0); m.setPharos('oct', 0);
    assert.equal(m.nameOf(is), 'Am7');                    // аккорд — у маяка (по умолчанию m7)
    m.setPharos('chord', 4); m.setNote(is, 3); assert.equal(m.nameOf(is), 'Cm11');
    if (name === 'js') {
      const q = mk({ scale: { on: true, root: 3, snap: (s) => 2 * Math.round(s / 2) } }), j = q.place(0, 2);   // лад: чётные полутоны, тоника +3
      assert.equal(q.root(), 3);
      assert.equal(q.semiOf(j), 2 * Math.round((2 + 3 + 24) / 2) - 24);
      assert.ok(near(q.hzOf(j), 110 * 2 ** (q.semiOf(j) / 12)));
      assert.equal(mk({ scale: { on: false, root: 5, snap: (s) => s } }).root(), 0, 'без лада тоника — A');
    } else {                                              // лад хоста (минор от C): ступени лада, то же, что у эталона с тем же ладом
      const q = mk({ scale: { on: true, idx: 1, root: 3 } }), j = q.place(0, 1), r = ref.createModel({ scale: { on: true, root: 3, snap: (s) => s } });
      assert.equal(q.root(), 3);
      const st = q.semiOf(j) - 12 * q.state.pharos.oct;
      assert.equal(st, Math.round(st)); assert.ok(near(q.hzOf(j), 110 * 2 ** (q.semiOf(j) / 12)));
      assert.ok(r.semiOf(r.place(0, 1)) <= q.semiOf(j) + 1, 'тоника та же, ступень — рядом');
    }
  });

  test(`Portus [${name}]: nextGap — до следующего кораблика, по кругу; один кораблик — весь круг; пусто — 16 шагов`, () => {
    const m = mk(), s = m.stepSec();
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

  test(`Portus [${name}]: swing — нечётные шестнадцатые позже на swing · полшага; шаги — ровно по stepSec`, () => {
    const m = mk();
    m.setBpm(100); m.setPharos('swing', 0.6);
    const s = 60 / 100 / 4;
    assert.ok(near(m.stepSec(), s));
    for (let j = 0; j < NSTEP; j++) assert.ok(near(m.swing(j), j % 2 ? 0.6 * s * 0.5 : 0), `шаг ${j}`);
    const at = Array.from({ length: 4 }, (_, j) => j * m.stepSec() + m.swing(j));   // как в часах engine: next += stepSec, удар — next + swing
    assert.ok(near(at[1] - at[0], s * 1.3) && near(at[2] - at[1], s * 0.7) && near(at[3] - at[2], s * 1.3));
    m.setPharos('swing', 0); assert.ok(near(m.swing(1), 0));
  });

  test(`Portus [${name}]: step — кораблик, сила (на «и» сильнее), до следующего; chance — через rng`, () => {
    const m = mk({ rng: seeded(7) });
    const a = m.place(2, 0), b = m.place(5, 4);
    assert.equal(m.step(0), null, 'пустое место');
    const h2 = m.step(2), h5 = m.step(5);
    assert.equal(h2.is, a); assert.equal(h2.vel, 1); assert.ok(near(h2.gap, 3 * m.stepSec()));
    assert.equal(h5.is, b); assert.equal(h5.vel, 0.85); assert.ok(near(h5.gap, 13 * m.stepSec()));
    m.setFx('chance', 0); assert.equal(m.step(2), null, 'chance 0 — молчит');
    m.setFx('chance', 0.5);
    const n = Array.from({ length: 400 }, () => m.step(2)).filter(Boolean).length;
    assert.ok(n > 150 && n < 250, `${n}`);
    const run = (seed) => { const q = mk({ rng: seeded(seed) }); q.place(2, 0); q.state.fx.chance = 0.5; return Array.from({ length: 32 }, () => !!q.step(2)).join(); };
    assert.equal(run(9), run(9), 'то же зерно — тот же узор пропусков');
  });

  test(`Portus [${name}]: события — fx на шину, play, kill, audition; буй — время эха и повторы, плашка эха`, () => {
    const m = mk(), ev = events(m), S = m.state;
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

  test(`Portus [${name}]: снимок → restore — тот же JSON, шина узнаёт`, () => {
    const m = mk({ rng: seeded(11) });
    m.place(2, 0); const b = m.place(9, 7); m.setIsle(b, 'oct', 1); m.setIsle(b, 'lvl', 0.6);
    m.setPharos('chord', 4); m.setPharos('swing', 0.3); m.setFx('mare', 0.4); m.setBuoy(0.1, 0.7); m.setFog('size', 0.2); m.setBpm(133);
    const js = m.snapshot(), o = JSON.parse(js);
    assert.deepEqual(Object.keys(o), ['isles', 'luna', 'echo', 'buoy', 'fog', 'pharos', 'fx', 'bpm']);
    assert.deepEqual(Object.keys(o.isles[0]), ['step', 'p', 'oct', 'lvl', 'sd']);
    assert.deepEqual(Object.keys(o.fx), ['wow', 'mare', 'drive', 'spread', 'chance']);
    const q = mk(), ev = events(q);
    q.restore(js);
    assert.equal(q.snapshot(), js);
    assert.deepEqual(ev.map((e) => e.t), ['fx']);
    assert.ok(!q.state.seq.playing, 'снимок часы не заводит');
    q.restore(JSON.stringify({ ...o, isles: [...o.isles, { p: 3 }] }));   // кораблик без места — пропускаем, как раньше
    assert.equal(q.state.isles.length, 2);
  });

  test(`Portus [${name}]: кубик с зерном повторяем; 3–8 корабликов, буй между берегами, часы пошли`, () => {
    const a = mk({ rng: seeded(42) }), b = mk({ rng: seeded(42) });
    a.dice(); b.dice();
    assert.equal(a.snapshot(), b.snapshot());
    for (let k = 0; k < 40; k++) {
      const m = mk({ rng: seeded(k) }), ev = events(m); m.dice(); const S = m.state;
      assert.ok(S.isles.length >= 3 && S.isles.length <= 8, `${S.isles.length}`);
      assert.equal(new Set(S.isles.map((i) => i.step)).size, S.isles.length, 'по одному на место');
      assert.ok(S.isles.every((i) => i.step >= 0 && i.step < NSTEP && i.p >= 0 && i.p <= 12));
      assert.ok(S.isles.filter((i) => i.step < 8).every((i) => i.p === 0), 'первая половина такта — на тонике');
      const l = edge(null, -1, S.buoy.d), r = edge(null, 1, S.buoy.d); assert.ok(S.buoy.u > l && S.buoy.u < r);
      assert.ok([-1, 0].includes(S.pharos.oct) && S.seq.playing);
      assert.deepEqual(ev.map((e) => e.t), ['fx', 'play']);
    }
  });
}

// паритет: одна и та же последовательность правок (кораблики, плашки, буй, кубик, снимок) — эталон и фасад над ядром приходят к одной сцене
const normal = (m) => {
  const o = JSON.parse(m.snapshot());
  o.isles.sort((a, b) => a.step - b.step);
  return o;
};
const close = (a, b, path = '') => {
  if (typeof a === 'number') return assert.ok(Math.abs(a - b) < 1e-9, `${path}: ${a} vs ${b}`);
  if (Array.isArray(a)) { assert.equal(a.length, b.length, path); return a.forEach((x, i) => close(x, b[i], `${path}[${i}]`)); }
  if (a && typeof a === 'object') { assert.deepEqual(Object.keys(a), Object.keys(b), path); return Object.keys(a).forEach((k) => close(a[k], b[k], `${path}.${k}`)); }
  assert.equal(a, b, path);
};
test('Portus: 120 случайных правок × 6 зёрен — эталон и фасад над ядром сходятся (сцена, события)', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const R = seeded(100 + seed), a = ref.createModel({ rng: seeded(seed) }), b = coreModel({ seed, rng: seeded(seed) });
    const ea = events(a), eb = events(b);
    const pick = (n) => Math.floor(R() * n);
    for (let n = 0; n < 120; n++) {
      const op = pick(15), j = pick(NSTEP), p = pick(13), v = R(), isA = a.isleOn(j), isB = b.isleOn(j);
      switch (op) {
        case 0: case 1: a.place(j, p); b.place(j, p); break;
        case 2: if (isA) { a.sink(isA); b.sink(isB); } break;
        case 3: { const k = pick(NSTEP); if (isA) { a.moveIsle(isA, k); b.moveIsle(isB, k); } break; }
        case 4: if (isA) { a.setNote(isA, p); b.setNote(isB, p); } break;
        case 5: if (isA) { const k = pick(2) ? 'oct' : 'lvl', x = k === 'oct' ? pick(5) - 2 : v; a.setIsle(isA, k, x); b.setIsle(isB, k, x); } break;
        case 6: { const k = ['cut', 'res', 'env'][pick(3)]; a.setLuna(k, v); b.setLuna(k, v); break; }
        case 7: { const u = R() * 2 - 1, d = R(); a.setBuoy(u, d); b.setBuoy(u, d); break; }
        case 8: { const k = ['time', 'tone', 'mix', 'fb'][pick(4)], x = k === 'time' ? pick(5) : v; a.setEcho(k, x); b.setEcho(k, x); break; }
        case 9: { const k = ['amt', 'size'][pick(2)]; a.setFog(k, v); b.setFog(k, v); break; }
        case 10: { const k = ['chord', 'oct', 'len', 'lvl', 'swing'][pick(5)], x = k === 'chord' ? pick(5) : k === 'oct' ? pick(5) - 2 : v; a.setPharos(k, x); b.setPharos(k, x); break; }
        case 11: { const k = ['wow', 'mare', 'drive', 'spread', 'chance'][pick(5)]; a.setFx(k, v); b.setFx(k, v); break; }
        case 12: { const x = 60 + Math.round(v * 120); a.setBpm(x); b.setBpm(x); break; }
        case 13: if (pick(4) === 0) { a.dice(); b.dice(); } else if (pick(3) === 0) { a.clear(); b.clear(); } else { const js = a.snapshot(); a.clear(); a.restore(js); b.restore(js); } break;
        default: { a.play(); b.play(); break; }
      }
      close(normal(a), normal(b), `seed ${seed} op ${n}/${op}`);
    }
    assert.deepEqual(eb.map((e) => e.t), ea.map((e) => e.t), `события, зерно ${seed}`);
    assert.equal(a.sounding(), b.sounding());
  }
});

test('Portus [core]: фасад пережил новый узел ядра (bind) — сцена и пуск ушли туда заново', () => {
  const m = coreModel({ seed: 3, rng: seeded(3) });
  m.dice(); m.setBuoy(0.2, 0.7); m.setPharos('oct', 1);
  const js = m.snapshot(), playing = m.state.seq.playing;
  m.rebind();                                           // restartAudio: новый AudioContext, новый узел
  m.agree('rebind');
  assert.equal(m.snapshot(), js); assert.equal(m.coreScene().playing, playing);
});

test('Portus [core]: сообщения ещё в пути — зеркало их не перетирает (асинхронный порт)', () => {
  const m = coreModel({ seed: 5, rng: seeded(5), async: true, check: false });
  m.place(3, 4); m.place(9, 1); m.setLuna('cut', 0.9); m.setFx('wow', 0.7);
  m.deliver();                                          // ядро ещё ничего не применило
  assert.deepEqual(m.state.isles.map((i) => i.step), [3, 9]); assert.equal(m.state.luna.cut, 0.9); assert.equal(m.state.fx.wow, 0.7);
  m.flush(); m.deliver();
  assert.deepEqual(m.state.isles.map((i) => i.step), [3, 9]); assert.equal(m.state.luna.cut, 0.9);
  const is = m.isleOn(3); m.moveIsle(is, 5); m.sink(m.isleOn(9));
  m.deliver(); assert.deepEqual(m.state.isles.map((i) => i.step), [5]); assert.equal(m.isleOn(5), is, 'тот же кораблик');
  m.flush(); m.deliver();
  assert.deepEqual(m.state.isles.map((i) => i.step), [5]); assert.equal(m.isleOn(5), is);
});
