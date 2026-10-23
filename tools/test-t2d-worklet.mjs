// Тесты t2d-worklet.js: обёртка в vm против t2d-core.mjs напрямую (тот же wasm, те же вызовы — совпадение точное).
//   core/build.sh && node --test tools/test-t2d-worklet.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadT2d } from './t2d-core.mjs';
import { loadWorklet, block, SR, BLOCK } from './t2d-scenarios.mjs';

const act = (slot, kind, i, a) => ({ t: 'action', slot, kind, i, a });
const ADD = 0, CLEAR = 5;
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const lastMirror = (posted) => [...posted].reverse().find((m) => m.t === 'm').w[10].mirror;

test('messages before ready are queued and applied in order', async () => {
  const w = loadWorklet();
  w.proc.port.onmessage({ data: act(10, ADD, 0, [0.5, 0]) });
  w.proc.port.onmessage({ data: act(10, ADD, 0, [0.3, 0.2]) });
  w.proc.port.onmessage({ data: act(10, CLEAR, 0, []) });
  w.proc.port.onmessage({ data: act(10, ADD, 0, [0.7, -0.1]) });
  assert.deepEqual(block(w)[0][0], new Float32Array(BLOCK), 'silence before ready');
  await w.ready;
  for (let k = 0; k < 2000; k++) block(w);
  const m = lastMirror(w.posted);
  assert.equal(m[16], 1, 'one star after clear + add');
  assert.ok(Math.abs(m[19] - 0.7) < 1e-9, `h ${m[19]}`);
});

test('wrapper == t2d-core.mjs: dry output and mirrors', async () => {
  const w = loadWorklet(); await w.ready;
  const c = loadT2d(); c.init(SR, 1);
  const send = (slot, kind, i, a) => { w.proc.port.onmessage({ data: act(slot, kind, i, a) }); c.action(slot, kind, i, a); };
  send(10, ADD, 0, [0.5, 0]); send(10, ADD, 0, [0.2, 0.4]);
  let worst = 0, hall = 0;
  for (let k = 0; k < 400; k++) {
    const o = block(w); c.process(BLOCK);
    for (let ch = 0; ch < 2; ch++) {
      const d = c.dry(10, ch), r = c.ret(ch);
      for (let i = 0; i < BLOCK; i++) worst = Math.max(worst, Math.abs(o[1][ch][i] - d[i]), Math.abs(o[0][ch][i] - r[i]));
      hall = Math.max(hall, peak(o[1][ch]));
    }
  }
  assert.ok(hall > 1e-3, 'sounds');
  assert.equal(worst, 0);
  const posts = w.posted.filter((m) => m.t === 'm');
  assert.ok(posts.length > 40 && posts.length < 400 * 128 / (SR / 60) + 2, `posts ${posts.length}`);
  // зеркало в конце == зеркало ядра в момент последней отправки: сравниваем время и число звёзд
  const m = lastMirror(w.posted), cm = c.mirror(10);
  assert.equal(m.length, cm.length); assert.equal(m[16], cm[16]);
});

test('heard accumulates between posts, nothing lost', async () => {
  const w = loadWorklet(); await w.ready;
  const c = loadT2d(); c.init(SR, 1);
  w.proc.port.onmessage({ data: act(10, ADD, 0, [0.5, 0]) });
  c.action(10, ADD, 0, [0.5, 0]);
  let want = 0, got = 0;
  for (let k = 0; k < 1500; k++) {
    block(w); c.process(BLOCK);
    const h = c.heard(10); if (h[0] > 0) want += h[0];
  }
  for (const m of w.posted) if (m.t === 'm') for (const h of m.w[10].heard) got += h[0];
  // последние блоки после последней отправки ещё в копилке — они не считаются
  assert.ok(want > 3, `pulses ${want}`);
  assert.ok(got <= want && want - got <= 2, `got ${got} of ${want}`);
});

test('external send into hall (input 2) reaches the return', async () => {
  const w = loadWorklet(); await w.ready;
  const imp = [new Float32Array(BLOCK), new Float32Array(BLOCK)]; imp[0][0] = imp[1][0] = 1;
  let ret = peak(block(w, { 2: imp })[0][0]);
  for (let k = 0; k < 300; k++) ret = Math.max(ret, peak(block(w)[0][0]));
  assert.ok(ret > 1e-4, `return ${ret}`);
  const w2 = loadWorklet(); await w2.ready;
  let none = 0; for (let k = 0; k < 300; k++) none = Math.max(none, peak(block(w2)[0][0]));
  assert.equal(none, 0, 'no input — silent return');
});

test('fader 0: world send does not reach the return', async () => {
  const run = async (g) => {
    const w = loadWorklet(); await w.ready;
    if (g != null) w.proc.port.onmessage({ data: { t: 'fader', slot: 10, g } });
    w.proc.port.onmessage({ data: act(10, ADD, 0, [0.5, 0]) });
    let ret = 0, dry = 0;
    for (let k = 0; k < 400; k++) { const o = block(w); ret = Math.max(ret, peak(o[0][0])); dry = Math.max(dry, peak(o[1][0])); }
    return { ret, dry };
  };
  const on = await run(null), off = await run(0);
  assert.ok(on.ret > 1e-5 && on.dry > 1e-3, JSON.stringify(on));
  assert.equal(off.ret, 0);
  assert.ok(off.dry > 1e-3, 'dry is not affected by the send fader');
});

test('scale changes fp in the mirror', async () => {
  const fpOf = async (scale) => {
    const w = loadWorklet(); await w.ready;
    if (scale) w.proc.port.onmessage({ data: { t: 'scale', on: true, ...scale } });
    w.proc.port.onmessage({ data: act(10, ADD, 0, [0.85, 0]) });
    for (let k = 0; k < 400; k++) block(w);
    return lastMirror(w.posted)[27];
  };
  const free = await fpOf(null), snapped = await fpOf({ idx: 3, root: 2 });
  assert.ok(free > 0 && snapped > 0 && Math.abs(free - snapped) > 1e-6, `${free} vs ${snapped}`);
});

test('snap -> restore round trip', async () => {
  const w = loadWorklet(); await w.ready;
  w.proc.port.onmessage({ data: act(10, ADD, 0, [0.5, 0]) });
  w.proc.port.onmessage({ data: act(10, ADD, 0, [0.2, 0.4]) });
  w.proc.port.onmessage({ data: { t: 'snap', slot: 10, id: 7 } });
  const s = w.posted.find((m) => m.t === 'snap');
  assert.equal(s.id, 7); assert.match(s.js, /^\{"s":\[/);
  w.proc.port.onmessage({ data: act(10, CLEAR, 0, []) });
  block(w);
  w.proc.port.onmessage({ data: { t: 'restore', slot: 10, js: s.js } });
  w.proc.port.onmessage({ data: { t: 'snap', slot: 10, id: 8 } });
  assert.equal(w.posted.find((m) => m.t === 'snap' && m.id === 8).js, s.js);
});

test('bad wasm: err, silence, no throw', async () => {
  const { sandbox } = await import('./goetia-scenarios.mjs');
  const { reg, posted } = sandbox('../t2d-worklet.js', { TextDecoder, TextEncoder });
  const proc = new reg.t2d({ processorOptions: { wasm: new ArrayBuffer(8), worlds: [10] } });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(posted.some((m) => m.t === 'err'));
  const out = [[new Float32Array(128), new Float32Array(128)], [new Float32Array(128), new Float32Array(128)]];
  proc.process([[], [], [], []], out, {});
  assert.equal(peak(out[1][0]), 0);
});
