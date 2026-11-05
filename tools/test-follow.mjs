// Cymatica: LOCK из JS не уходит (сетку читает ядро): без браузера, подделка AudioContext. Шаги Natura и Portus по сетке — в ядре (sdk_test).
//   node --test tools/test-follow.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

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
// Natura и Portus ставят шаги в ядре — core/tests/sdk_test.cpp (naturaWorld, portusWorld); Monochordum — tools/test-mono-core.mjs

// ---------- Cymatica: сетку читает ядро само (clk_->grid), из JS LOCK не уходит ----------
test('cymatica: play sends no LOCK — the core reads the master grid itself', async () => {
  const sent = [];
  const cym = { model: await import('../worlds/cymatica/model.js'), engine: await import('../worlds/cymatica/engine.js') };
  const core = { dry: { 2: node() }, ready: true, listen() {}, send: (m) => { sent.push(m); return sent.length; } };
  const T = { onTick: () => {}, send: () => node(), core, midiGrid: () => ({ t0: 1, p: 0.5 }), ctx: { currentTime: 1 } };
  const model = cym.model.createModel(), engine = cym.engine.createEngine(T, model, 'test');
  model.listen(engine.on);
  engine.build(fakeCtx([], []), node()); engine.start();
  sent.length = 0; model.play(true);
  const LOCK = 4, SEQ = 8;                              // коды action — worlds/cymatica/bridge.js
  assert.ok(sent.some((m) => m.t === 'action' && m.kind === SEQ), 'seq goes to the core');
  assert.ok(!sent.some((m) => m.t === 'action' && m.kind === LOCK), 'no lock from JS');
});
