// ПРОБА 0б (ветка native): MIDI-часы → Portus (engine.sync) и Portus → часы наружу (engine.pulse) без браузера: подделка AudioContext, время двигаем руками.
//   node --test tools/test-portus-sync.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.setInterval = () => 0;                         // сторож тишины engine — не держит процесс
const node = () => new Proxy(function () {}, {             // любой узел: любые поля, методы, connect → дальше по цепочке
  get: (o, k) => (k === 'connect' ? () => node() : k in o ? o[k] : (o[k] = node())),
  set: (o, k, v) => ((o[k] = v), true),
  apply: () => node(),
});
const fakeCtx = () => {
  const c = { currentTime: 0, sampleRate: 48000, createBuffer: () => ({ getChannelData: () => new Float32Array(8) }) };
  c.getOutputTimestamp = () => ({ contextTime: c.currentTime, performanceTime: 1000 + c.currentTime * 1000 + 30 });   // слышно через 30 мс
  return new Proxy(c, { get: (o, k) => (k in o ? o[k] : () => node()) });
};
const { createModel } = await import('../worlds/portus/model.js');
const { createEngine } = await import('../worlds/portus/engine.js');

function rig() {
  const ticks = [];
  const T = { onTick: (fn) => ticks.push(fn), hall: () => ({ input: node(), out: node(), lines: [] }) };
  const model = createModel({ scale: { on: false, root: 0, snap: (s) => s } });
  const engine = createEngine(T, model);
  model.listen(engine.on);
  const ctx = fakeCtx();
  engine.build(ctx, node());
  const at = (t) => { ctx.currentTime = t; for (const f of ticks) f(); };
  const out = []; engine.pulse((m) => out.push(m));
  return { model, engine, ctx, at, out, seq: model.state.seq };
}

test('beats while stopped do not start playback', () => {
  const { engine, at, seq } = rig();
  at(1);
  for (let n = 0; n < 4; n++) { at(1 + n * 0.5); engine.sync({ t: 'beat', n, bpm: 120, ago: 0 }); }
  assert.equal(seq.playing, false);
});

test('tempo follows while stopped', () => {
  const { engine, seq } = rig();
  engine.sync({ t: 'tempo', bpm: 97 });
  assert.equal(seq.bpm, 97);
  assert.equal(seq.playing, false);
});

test('bpm jitter does not retune', () => {
  const { engine, at, seq } = rig();
  engine.sync({ t: 'tempo', bpm: 120 });
  at(1); engine.sync({ t: 'start', ago: 0 });
  for (const [n, b] of [[0, 120.1], [1, 119.9], [2, 120.2], [3, 119.8]]) { at(1 + n * 0.5); engine.sync({ t: 'beat', n, bpm: b, ago: 0 }); }
  assert.equal(seq.bpm, 120);
});

test('start waits for the first beat and puts step 0 on it', () => {
  const { engine, at, seq } = rig();
  engine.sync({ t: 'tempo', bpm: 120 });
  at(1); engine.sync({ t: 'start', ago: 0 });
  assert.equal(seq.playing, true);
  at(1.3);                                                // доли ещё нет — шагов не планируем
  assert.equal(engine.step, -1);
  engine.sync({ t: 'beat', n: 0, bpm: 120, ago: 0.01 });  // доля пришла 10 мс назад — шаг 0 сразу, без пропуска
  at(1.31);
  assert.equal(engine.step, 0);
  at(1.29 + 0.5 + 0.001);                                 // доля 1 — шаг 4
  assert.equal(engine.step, 4);
});

test('start while already playing restarts on the beat', () => {
  const { engine, model, at } = rig();
  at(1); model.play(true);
  at(2.37);
  engine.sync({ t: 'start', ago: 0 });
  engine.sync({ t: 'beat', n: 0, bpm: 120, ago: 0 });
  at(2.38);
  assert.equal(engine.step, 0);
});

test('stop stops, and later beats do not restart', () => {
  const { engine, at, seq } = rig();
  at(1); engine.sync({ t: 'start', ago: 0 }); engine.sync({ t: 'beat', n: 0, bpm: 120, ago: 0 });
  at(1.5); engine.sync({ t: 'stop', ago: 0 });
  assert.equal(seq.playing, false);
  at(2); engine.sync({ t: 'beat', n: 2, bpm: 120, ago: 0 });
  assert.equal(seq.playing, false);
});

// ---------- ведущий: Portus говорит оболочке, когда звучат шаги (время — epoch, мс, когда слышно) ----------
const heardAt = (t) => performance.timeOrigin + 1000 + t * 1000 + 30;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('play sends start with step 0 when it will be heard', () => {
  const { model, at, out } = rig();
  at(1); model.play(true);
  const m = out.find((x) => x.t === 'start');
  assert.ok(m, 'start sent');
  assert.equal(m.step, 0); assert.equal(m.bpm, 120);
  near(m.at, heardAt(1.05));
});

test('every bar sends its step and time, once', () => {
  const { model, at, out } = rig();
  at(1); model.play(true);
  for (let t = 1; t < 5.2; t += 0.025) at(t);              // 120 BPM: такт — 2 с
  const bars = out.filter((x) => x.t === 'at');
  assert.deepEqual(bars.map((x) => x.step), [16, 32]);
  near(bars[0].at, heardAt(1.05 + 2)); near(bars[1].at, heardAt(1.05 + 4));
});

test('a tempo change sends the next step at the new tempo', () => {
  const { model, at, out } = rig();
  at(1); model.play(true);
  at(1.3); model.setBpm(90); at(1.4);                     // следующий шаг (1.55) входит в окно планировщика
  const m = out.find((x) => x.t === 'at');
  assert.ok(m, 'at sent'); assert.equal(m.bpm, 90);
  assert.ok(m.step > 0 && m.step < 16, `step ${m.step}`);
});

test('stop sends stop, a stopped world sends nothing', () => {
  const { model, at, out } = rig();
  at(1); model.play(true); at(1.5);
  model.play(false);
  assert.equal(out.at(-1).t, 'stop');
  near(out.at(-1).at, heardAt(1.5));
  const n = out.length; at(3); at(5);
  assert.equal(out.length, n);
});
