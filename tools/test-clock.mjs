// Метроном хоста (host/clock.js) без браузера: подделки AudioContext и AudioWorkletNode.
//   node --test tools/test-clock.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

const nodes = [];
globalThis.AudioWorkletNode = class {
  constructor(ctx, name) { this.ctx = ctx; this.name = name; this.port = { onmessage: null }; this.disconnects = 0; nodes.push(this); }
  connect(x) { return x; }
  disconnect() { this.disconnects++; }
};
const fakeCtx = ({ fail = false } = {}) => ({
  destination: {},
  createGain: () => ({ gain: { value: 1 }, connect: (x) => x }),
  audioWorklet: { addModule: () => (fail ? Promise.reject(new Error('no worklet')) : Promise.resolve()) },
});
const settle = () => new Promise((r) => setTimeout(r, 0));
const counter = () => { const f = () => { f.n++; }; f.n = 0; return f; };

const { onTick, startClock, clockLive } = await import('../host/clock.js');
const lastNode = (ctx) => nodes.filter((n) => n.ctx === ctx).at(-1);

test('a worklet message calls every subscriber', async () => {
  const a = counter(), b = counter(), ctx = fakeCtx();
  onTick(a); onTick(b);
  startClock(ctx); await settle();
  assert.equal(lastNode(ctx).name, 'clock');
  assert.equal(clockLive(), true);
  const a0 = a.n, b0 = b.n;
  lastNode(ctx).port.onmessage({ data: 1 });
  assert.equal(a.n - a0, 1); assert.equal(b.n - b0, 1);
});

test('a new context disconnects the old clock', async () => {
  const c1 = fakeCtx(), c2 = fakeCtx(), a = counter();
  onTick(a);
  startClock(c1); await settle();
  const old = lastNode(c1);
  startClock(c2); await settle();
  assert.equal(old.disconnects, 1);
  assert.equal(old.port.onmessage, null);
  assert.ok(lastNode(c2), 'a clock on the new context');
});

test('a failing addModule leaves the timer', async () => {
  const a = counter();
  onTick(a);
  assert.doesNotThrow(() => startClock(fakeCtx({ fail: true })));
  await settle();
  assert.equal(clockLive(), false);
  const n0 = a.n;
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(a.n - n0 >= 2, `timer ticks: ${a.n - n0}`);
});

test('a throwing subscriber does not stop the others', async () => {
  const b = counter(), ctx = fakeCtx();
  onTick(() => { throw new Error('boom'); }); onTick(b);
  startClock(ctx); await settle();
  const b0 = b.n;
  lastNode(ctx).port.onmessage({ data: 1 });
  assert.equal(b.n - b0, 1);
});

test('a context without AudioWorklet does not throw', () => {
  const ctx = fakeCtx(); delete ctx.audioWorklet;      // http по IP в сети, старый Safari
  assert.doesNotThrow(() => startClock(ctx));
  assert.equal(clockLive(), false);
});
