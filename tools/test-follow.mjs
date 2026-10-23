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
const models = { portus: await import('../worlds/portus/model.js'), natura: await import('../worlds/natura/model.js'), monochord: await import('../worlds/monochord/model.js') };
const engines = { portus: await import('../worlds/portus/engine.js'), natura: await import('../worlds/natura/engine.js'), monochord: await import('../worlds/monochord/engine.js') };

// риг мира: world — 'portus' | 'natura'; T — подмена полей хоста (midiGrid и т. п.); grid — сетка теста (null — нет)
function rig(world, T = {}) {
  const ticks = [], starts = [], rec = [];
  const r = { grid: null, starts, rec, plucks: [] };
  globalThis.AudioWorkletNode = class { constructor() { this.port = { postMessage: (m) => { if (m.t === 'pluck' && m.at !== undefined) r.plucks.push(m.at); } }; } connect() {} };   // щипки автострама: их время — время нот
  const host = { onTick: (fn) => ticks.push(fn), hall: () => ({ input: node(), out: node(), lines: [] }), midiGrid: () => r.grid, stepTime, due, ...T };
  const model = models[world].createModel({ scale: { on: false, root: 0, snap: (s) => s } });
  const engine = world === 'monochord' ? engines[world].createEngine(host, model, 'test') : engines[world].createEngine(host, model);
  model.listen(engine.on);
  const ctx = fakeCtx(starts, rec);
  engine.build(ctx, node());
  const at = (t) => { r.ctx.currentTime = t; for (const f of ticks) f(); };
  const run = (from, to) => { for (let t = from; t <= to + 1e-9; t += 0.025) at(t); };
  if (world === 'portus') for (let i = 0; i < 16; i++) model.place(i, 0);      // кораблик на каждом месте
  else if (world === 'monochord') { model.setAutoPar('pattern', 2); model.state.fx.chance = 1; }   // arpeggio: один щипок на шаг
  else for (let i = 0; i < 12; i++) model.state.pads.at[i] = { note: i % 8, wave: 0 };   // кувшинка на каждом месте
  if (world === 'monochord') r.ready = engine.start() || new Promise((ok) => setTimeout(ok, 0));   // модуль струн: ждать ready
  const out = []; if (engine.pulse) engine.pulse((m) => out.push(m));
  const rebuild = (t) => { const c = fakeCtx(starts, rec); c.currentTime = t; r.ctx = c; engine.build(c, node()); if (world === 'monochord') { engine.start(); r.ready = new Promise((ok) => setTimeout(ok, 0)); } };   // restartAudio: новый контекст, время с нуля
  return Object.assign(r, { model, engine, ctx, at, run, rebuild, out, seq: model.state.seq });
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

// ---------- Monochordum: автострам по сетке (щипок с at — время ноты) ----------
test('monochord 1/8T with swing on the grid', async () => {
  const r = rig('monochord'); await r.ready;
  r.model.setAutoPar('div', 2); r.model.setAutoPar('swing', 0.3); r.grid = { t0: 1, p: 0.5 };
  r.at(0.9); r.model.setAuto(true); r.run(0.9, 3);
  const ts = [...new Set(r.plucks.map((t) => Math.round(t * 1e6) / 1e6))].sort((a, b) => a - b);
  assert.ok(ts.length >= 10, `notes ${ts.length}`);
  ts.forEach((t, k) => assert.ok(Math.abs(t - (1 + (k / 3) * 0.5 + r.model.swingAt(k))) < 1e-3, `step ${k}: ${t}`));
});

test('monochord: a backward grid jump never places a note out of order, a new AudioContext re-anchors', async () => {
  const r = rig('monochord'); await r.ready;
  r.grid = { t0: 1, p: 0.5 };
  r.at(0.9); r.model.setAuto(true); r.run(0.9, 2);
  r.grid = { t0: 0.8, p: 0.5 }; r.run(2, 4);
  const p = r.plucks;
  assert.ok(p.length > 10, `notes ${p.length}`);
  for (let i = 1; i < p.length; i++) assert.ok(p[i] > p[i - 1], `out of order: ${p[i - 1]} then ${p[i]}`);
  r.rebuild(0.5); await r.ready; r.plucks.length = 0; r.model.setAuto(true); r.run(0.5, 1);
  assert.ok(r.plucks.length >= 2 && r.plucks[0] < 0.5 + 0.35, `resumes: ${r.plucks[0]}`);
});
