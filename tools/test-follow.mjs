// Миры-секвенсеры идут по сетке MIDI-часов (T.midiGrid) и отдают такт наружу (engine.pulse): без браузера, подделка AudioContext, время двигаем руками.
//   node --test tools/test-follow.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepTime, due } from '../host/midi.js';

globalThis.setInterval = () => 0;                         // сторож тишины engine — не держит процесс
const node = () => new Proxy(function () {}, {             // любой узел: любые поля, методы, connect → дальше по цепочке
  get: (o, k) => (k === 'connect' ? () => node() : k in o ? o[k] : (o[k] = node())),
  set: (o, k, v) => ((o[k] = v), true),
  apply: () => node(),
});
const fakeCtx = (starts) => {
  const c = { currentTime: 0, sampleRate: 48000, createBuffer: () => ({ getChannelData: () => new Float32Array(8) }) };
  c.createOscillator = () => { const o = node(); o.start = (t) => { if (typeof t === 'number') starts.push(t); }; return o; };   // когда зазвучали ноты
  c.getOutputTimestamp = () => ({ contextTime: c.currentTime, performanceTime: 1000 + c.currentTime * 1000 + 30 });   // слышно через 30 мс
  return new Proxy(c, { get: (o, k) => (k in o ? o[k] : () => node()) });
};
const models = { portus: await import('../worlds/portus/model.js'), natura: await import('../worlds/natura/model.js') };
const engines = { portus: await import('../worlds/portus/engine.js'), natura: await import('../worlds/natura/engine.js') };

// риг мира: world — 'portus' | 'natura'; T — подмена полей хоста (midiGrid и т. п.); grid — сетка теста (null — нет)
function rig(world, T = {}) {
  const ticks = [], starts = [];
  const r = { grid: null, starts };
  const host = { onTick: (fn) => ticks.push(fn), hall: () => ({ input: node(), out: node(), lines: [] }), midiGrid: () => r.grid, stepTime, due, ...T };
  const model = models[world].createModel({ scale: { on: false, root: 0, snap: (s) => s } });
  const engine = engines[world].createEngine(host, model);
  model.listen(engine.on);
  const ctx = fakeCtx(starts);
  engine.build(ctx, node());
  const at = (t) => { ctx.currentTime = t; for (const f of ticks) f(); };
  const run = (from, to) => { for (let t = from; t <= to + 1e-9; t += 0.025) at(t); };
  if (world === 'portus') for (let i = 0; i < 16; i++) model.place(i, 0);      // кораблик на каждом месте
  else for (let i = 0; i < 12; i++) model.state.pads.at[i] = { note: i % 8, wave: 0 };   // кувшинка на каждом месте
  const out = []; if (engine.pulse) engine.pulse((m) => out.push(m));
  return Object.assign(r, { model, engine, ctx, at, run, out, seq: model.state.seq });
}
const times = (starts) => [...new Set(starts.map((t) => Math.round(t * 1e6) / 1e6))].sort((a, b) => a - b);   // у аккорда голосов много — удар один

for (const world of ['portus', 'natura']) {
  test(`${world}: with a grid, step k lands on stepTime ±1 ms`, () => {
    const r = rig(world); r.grid = { t0: 1, p: 0.5 };
    r.at(0.9); r.model.play(true); r.run(0.9, 3);
    const ts = times(r.starts);
    assert.ok(ts.length >= 14, `notes ${ts.length}`);
    ts.forEach((t, k) => assert.ok(Math.abs(t - (1 + k * 0.125)) < 1e-3, `step ${k}: ${t}`));
  });

  test(`${world}: the first step 20 ms late plays now`, () => {
    const r = rig(world); r.grid = { t0: 4.98, p: 0.5 };
    r.at(5); r.model.play(true);
    const ts = times(r.starts);
    assert.ok(ts.length >= 1, 'step 0 played');
    assert.ok(Math.abs(ts[0] - 5.005) < 1e-6, `${ts[0]}`);
  });

  test(`${world}: a backward grid jump does not repeat a step`, () => {
    const r = rig(world); r.grid = { t0: 1, p: 0.5 };
    const calls = [], key = world === 'portus' ? 'step' : 'stepNote', orig = r.model[key];
    r.model[key] = (j) => { calls.push(j); return orig(j); };
    r.at(0.9); r.model.play(true); r.run(0.9, 2);
    r.grid = { t0: 0.92, p: 0.5 }; r.run(2, 4);
    assert.ok(calls.length > 20, `calls ${calls.length}`);
    const mod = world === 'portus' ? 16 : 1e9;                 // Portus: номер шага по кругу; Natura: абсолютный
    for (let i = 1; i < calls.length; i++) { const d = (calls[i] - calls[i - 1] + mod) % mod; assert.ok(d >= 1 && d <= 3, `${calls[i - 1]} -> ${calls[i]}`); }
  });

  test(`${world}: grid off: the world keeps its tempo`, () => {
    const r = rig(world); r.model.setBpm(60); r.grid = { t0: 1, p: 0.5 };   // свой шаг 0.25 с, сетка — 0.125 с
    r.at(0.9); r.model.play(true); r.run(0.9, 2);
    r.grid = null; r.run(2, 5);
    const ts = times(r.starts), tail = ts.filter((t) => t >= 2.2);
    assert.ok(tail.length >= 8, `tail ${tail.length}`);
    for (let i = 1; i < tail.length; i++) assert.ok(Math.abs(tail[i] - tail[i - 1] - 0.25) < 1e-3, `${tail[i] - tail[i - 1]}`);
    for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] < 0.25 + 1e-3, `gap ${ts[i] - ts[i - 1]}`);   // пауза не больше шага
  });
}

// ---------- ведущий: Portus говорит оболочке, когда звучат шаги (время — epoch, мс, когда слышно) ----------
const heardAt = (t) => performance.timeOrigin + 1000 + t * 1000 + 30;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('play sends start with step 0 when it will be heard', () => {
  const { model, at, out } = rig('portus');
  at(1); model.play(true);
  const m = out.find((x) => x.t === 'start');
  assert.ok(m, 'start sent');
  assert.equal(m.step, 0); assert.equal(m.bpm, 120);
  near(m.at, heardAt(1.05));
});

test('every bar sends its step and time, once', () => {
  const { model, at, out } = rig('portus');
  at(1); model.play(true);
  for (let t = 1; t < 5.2; t += 0.025) at(t);              // 120 BPM: такт — 2 с
  const bars = out.filter((x) => x.t === 'at');
  assert.deepEqual(bars.map((x) => x.step), [16, 32]);
  near(bars[0].at, heardAt(1.05 + 2)); near(bars[1].at, heardAt(1.05 + 4));
});

test('a tempo change sends the next step at the new tempo', () => {
  const { model, at, out } = rig('portus');
  at(1); model.play(true);
  at(1.3); model.setBpm(90); at(1.4);                     // следующий шаг (1.55) входит в окно планировщика
  const m = out.find((x) => x.t === 'at');
  assert.ok(m, 'at sent'); assert.equal(m.bpm, 90);
  assert.ok(m.step > 0 && m.step < 16, `step ${m.step}`);
});

test('stop sends stop, a stopped world sends nothing', () => {
  const { model, at, out } = rig('portus');
  at(1); model.play(true); at(1.5);
  model.play(false);
  assert.equal(out.at(-1).t, 'stop');
  near(out.at(-1).at, heardAt(1.5));
  const n = out.length; at(3); at(5);
  assert.equal(out.length, n);
});
