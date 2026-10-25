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
const fakeCtx = (starts, rec) => {
  const c = { currentTime: 0, sampleRate: 48000, createBuffer: () => ({ getChannelData: () => new Float32Array(8) }) };
  c.createOscillator = () => { const o = node(); o.start = (t) => { if (typeof t === 'number') { starts.push(t); rec.push({ t, now: c.currentTime }); } }; return o; };   // когда зазвучали ноты
  c.audioWorklet = { addModule: () => Promise.resolve() };   // Monochordum: модуль струн «загружен»
  c.getOutputTimestamp = () => ({ contextTime: c.currentTime, performanceTime: 1000 + c.currentTime * 1000 + 30 });   // слышно через 30 мс
  return new Proxy(c, { get: (o, k) => (k in o ? o[k] : () => node()) });
};
const models = { natura: await import('../worlds/natura/model.js') };   // Portus ставит шаги в ядре — core/tests/sdk_test.cpp (portusWorld)   // Monochordum ставит шаги в ядре — tools/test-mono-core.mjs
const engines = { natura: await import('../worlds/natura/engine.js') };

// риг мира: world — 'natura'; T — подмена полей хоста (midiGrid и т. п.); grid — сетка теста (null — нет)
function rig(world, T = {}) {
  const ticks = [], starts = [], rec = [];
  const r = { grid: null, starts, rec, plucks: [] };
  globalThis.AudioWorkletNode = class { constructor() { this.port = { postMessage: (m) => { if (m.t === 'pluck' && m.at !== undefined) r.plucks.push(m.at); } }; } connect() {} };   // щипки автострама: их время — время нот
  const host = { onTick: (fn) => ticks.push(fn), send: () => node(), midiGrid: () => r.grid, stepTime, due, ...T };
  const model = models[world].createModel({ scale: { on: false, root: 0, snap: (s) => s } });
  const engine = engines[world].createEngine(host, model);
  model.listen(engine.on);
  const ctx = fakeCtx(starts, rec);
  engine.build(ctx, node());
  const at = (t) => { r.ctx.currentTime = t; for (const f of ticks) f(); };
  const run = (from, to) => { for (let t = from; t <= to + 1e-9; t += 0.025) at(t); };
  for (let i = 0; i < 12; i++) model.state.pads.at[i] = { note: i % 8, wave: 0 };   // кувшинка на каждом месте
  const out = []; if (engine.pulse) engine.pulse((m) => out.push(m));
  const rebuild = (t) => { const c = fakeCtx(starts, rec); c.currentTime = t; r.ctx = c; engine.build(c, node()); };   // restartAudio: новый контекст, время с нуля
  return Object.assign(r, { model, engine, ctx, at, run, rebuild, out, seq: model.state.seq });
}
const times = (starts) => [...new Set(starts.map((t) => Math.round(t * 1e6) / 1e6))].sort((a, b) => a - b);   // у аккорда голосов много — удар один

for (const world of ['natura']) {
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

  test(`${world}: a backward grid jump never places a note out of order or in the past`, () => {
    const r = rig(world); r.grid = { t0: 1, p: 0.5 };
    r.at(0.9); r.model.play(true); r.run(0.9, 2);
    r.grid = { t0: 0.8, p: 0.5 }; r.run(2, 4);              // сетка ушла назад больше чем на шаг: шаг k встаёт раньше уже поставленного k−1
    const order = []; for (const x of r.rec) if (!order.length || order.at(-1).t !== x.t) order.push(x);   // у аккорда голосов много — удар один
    assert.ok(order.length > 20, `notes ${order.length}`);
    assert.ok(Math.abs(order[0].t - 1) < 1e-3 && Math.abs(order[1].t - 1.125) < 1e-3, 'followed the grid before the jump');
    for (let i = 1; i < order.length; i++) assert.ok(order[i].t > order[i - 1].t, `out of order: ${order[i - 1].t} then ${order[i].t}`);
    for (const x of order) assert.ok(x.t > x.now, `note ${x.t} placed at now ${x.now}`);
  });

  test(`${world}: grid off: follows the grid first, then keeps its own tempo`, () => {
    const r = rig(world); r.model.setBpm(60); r.grid = { t0: 1, p: 0.4 };   // свой шаг 0.25 с, сетка — 0.1 с
    r.at(0.9); r.model.play(true); r.run(0.9, 2);
    const before = times(r.starts);
    assert.ok(before.length >= 10, `grid notes ${before.length}`);
    before.forEach((t, k) => assert.ok(Math.abs(t - (1 + k * 0.1)) < 1e-3, `grid step ${k}: ${t}`));
    r.grid = null; r.run(2, 5);
    const post = times(r.starts).slice(before.length);
    assert.ok(post.length >= 8, `free notes ${post.length}`);
    assert.ok(post[0] - before.at(-1) <= 0.25 + 1e-3, `first gap ${post[0] - before.at(-1)}`);   // без паузы
    for (let i = 1; i < post.length; i++) assert.ok(Math.abs(post[i] - post[i - 1] - 0.25) < 1e-3, `gap ${post[i] - post[i - 1]}`);   // без пачки
  });

  test(`${world}: a new AudioContext re-anchors the clock`, () => {
    const r = rig(world); r.model.setBpm(120);
    r.at(300); r.model.play(true); r.run(300, 301);
    r.rebuild(0.5); r.starts.length = 0; r.rec.length = 0;
    r.run(0.5, 1);
    const ts = times(r.starts);
    assert.ok(ts.length >= 2 && ts[0] < 0.5 + 0.125 + 0.06, `resumes within a step: ${ts[0]}`);
    r.starts.length = 0; r.grid = { t0: 2, p: 0.5 }; r.run(1, 6);          // сетка на часах нового контекста
    const g = times(r.starts).filter((t) => t >= 2.3);                       // номер шага идёт дальше, но время — по новой сетке
    assert.ok(g.length >= 4, `grid notes ${g.length}`);
    g.forEach((t) => assert.ok(Math.abs((t - 2) / 0.125 - Math.round((t - 2) / 0.125)) < 0.008, `off grid: ${t}`));
  });
}

// ---------- защита от плохой сетки: период ≤ 0 не сетка ----------
for (const world of ['natura']) {
  for (const p of [0, -0.5]) {
    test(`${world}: a grid with p = ${p} is ignored, the scheduler ends and keeps its own tempo`, async () => {
      const r = rig(world); await r.ready;
      r.grid = { t0: 1, p };
      r.at(1);
      r.model.play(true);
      r.run(1, 3);
      const ts = times(r.starts);
      assert.ok(ts.length >= 6, `notes ${ts.length}`);
      for (let i = 1; i < ts.length; i++) assert.ok(ts[i] > ts[i - 1], 'in order');
    });
  }
}

// ---------- мир запущен через час после MIDI Start: без прохода по всем шагам ----------
for (const world of ['natura']) {
  test(`${world}: started an hour after MIDI Start it does bounded work and lands on the grid`, async () => {
    let dues = 0;
    const r = rig(world, { due: (...a) => { dues++; return due(...a); } }); await r.ready;
    r.grid = { t0: 0.013, p: 0.5 };
    r.at(3600);
    r.model.play(true);
    r.run(3600, 3601);
    assert.ok(dues < 100, `loop iterations ${dues}`);
    const ts = times(r.starts);
    assert.ok(ts.length >= 3, `notes ${ts.length}`);
    for (const t of ts) { const k = ((t - 0.013) / 0.5) * 4; assert.ok(Math.abs(k - Math.round(k)) < 0.01, `off grid: ${t}`); assert.ok(t >= 3600, 'not in the past'); }
  });
}

// ---------- Cymatica: сетка уходит в ядро раньше узора (пуск встаёт на узел) ----------
test('cymatica: play sends the lock before the seq message', async () => {
  const sent = [];
  const cym = { model: await import('../worlds/cymatica/model.js'), engine: await import('../worlds/cymatica/engine.js') };
  let grid = null;                                      // сетки при сборке нет — появляется к пуску
  const ticks = [];
  const core = { dry: { 2: node() }, ready: true, listen() {}, send: (m) => { sent.push(m); return sent.length; } };
  const T = { onTick: (fn) => ticks.push(fn), send: () => node(), core, midiGrid: () => grid, ctx: { currentTime: 1 } };
  const model = cym.model.createModel(), engine = cym.engine.createEngine(T, model, 'test');
  model.listen(engine.on);
  engine.build(fakeCtx([], []), node()); engine.start();
  sent.length = 0; grid = { t0: 1, p: 0.5 }; model.play(true);
  const LOCK = 4, SEQ = 3;                              // коды action — worlds/cymatica/bridge.js
  const i = sent.findIndex((m) => m.t === 'action' && m.kind === LOCK), j = sent.findIndex((m) => m.t === 'action' && m.kind === SEQ);
  assert.ok(i >= 0 && j >= 0 && i < j, `lock at ${i}, seq at ${j}`);
  assert.deepEqual(sent[i].abs, [1]);                   // t0 — во времени контекста: worklet переведёт во время ядра
});
