// engine Goetia без браузера: подделки AudioContext, AudioWorkletNode и fetch — проверка гонки start() с перезапуском звука.
//   node --test tools/test-goetia-engine.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.setInterval = () => 0;                       // сторож тишины engine — не держать процесс
const created = [];
globalThis.AudioWorkletNode = class { constructor(ctx) { created.push(ctx); this.port = { postMessage() {}, onmessage: null }; } connect() {} };
let release;
globalThis.fetch = () => new Promise((res) => { release = () => res({ ok: true, arrayBuffer: () => new ArrayBuffer(8) }); });

const node = () => ({ gain: { value: 1, setTargetAtTime() {} }, delayTime: { value: 0 }, frequency: { value: 0 }, connect: (x) => x, disconnect() {} });
const fakeCtx = (id) => ({ id, currentTime: 0, sampleRate: 48000, createGain: node, createDelay: node, createBiquadFilter: node, audioWorklet: { addModule: () => Promise.resolve() } });
const T = { hall: () => ({ input: node(), out: node(), lines: [{ g: node(), len: 0.1 }] }) };

const { createModel } = await import('../worlds/goetia/model.js');
const { createEngine } = await import('../worlds/goetia/engine.js');

test('a start that resolves after restart audio builds one node, on the new context', async () => {
  const engine = createEngine(T, createModel(), '1');
  const a = fakeCtx('a'), b = fakeCtx('b');
  engine.build(a, node()); engine.start();              // ядро ещё качается…
  engine.build(b, node()); engine.start();              // …а звук уже перезапущен
  release();
  for (let k = 0; k < 5; k++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(created.map((c) => c.id), ['b']);
});
