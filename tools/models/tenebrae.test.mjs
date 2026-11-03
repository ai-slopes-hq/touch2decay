import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel, PIN_MAX, TAIL, UNPIN_TAIL } from '../../worlds/tenebrae/model.js';
import { seeded } from './util.mjs';

const GLUE = ['voice', 'on', 'off', 'live', 'links', 'lfo', 'fx', 'strike', 'clear', 'busEnv'];
function rig(seed = 1) {
  const calls = [];
  const glue = Object.fromEntries(GLUE.map((n) => [n, (...a) => calls.push([n, ...a])]));
  const m = createModel({ rng: seeded(seed), engine: () => glue });
  return { m, V: m.state.voices, calls, names: () => calls.map((c) => c[0]) };
}
const pinned = (m, n) => { const out = []; for (let k = 0; k < n; k++) { const i = m.spawn(0.1 * k, 0.5, 0); m.pin(i); out.push(i); } return out; };
const offs = (calls, i) => calls.filter((c) => c[0] === 'off' && c[1] === i);

test('spawn takes a free voice', () => {
  const { m, V, calls } = rig();
  assert.equal(m.spawn(0.4, 0.3, 0.2), 0);
  const v = V[0];
  assert.ok(v.active && v.envT === 1 && v.x === 0.4 && v.y === 0.3 && v.holeT === 0.2);
  assert.deepEqual(calls.find((c) => c[0] === 'live'), ['live', 0, true]);
  assert.deepEqual(calls.find((c) => c[0] === 'on'), ['on', 0]);
});

test('spawn temps limit and eviction', () => {
  const { m, V } = rig();
  for (let k = 0; k < 3; k++) m.spawn(0.1 * k, 0.5, 0);
  assert.equal(m.spawn(0.9, 0.5, 0), -1);
  m.release(1, TAIL); V[1].env = 0.1;
  m.release(2, TAIL); V[2].env = 0.05;
  assert.equal(m.spawn(0.9, 0.5, 0), 2);
});

test('spawn never evicts pinned, held or kept', () => {
  const { m, V } = rig();
  const a = m.spawn(0.1, 0.5, 0), b = m.spawn(0.2, 0.5, 0), c = m.spawn(0.3, 0.5, 0);
  for (const i of [a, b, c]) m.release(i, TAIL);
  m.grab(a); m.keep([b]);
  assert.equal(m.spawn(0.9, 0.5, 0), c);
  m.release(c, TAIL);
  m.grab(c);
  assert.equal(m.spawn(0.9, 0.5, 0), -1);
  const r = rig();
  pinned(r.m, 3);
  for (let k = 0; k < 3; k++) assert.ok(r.m.spawn(0.5, 0.5, 0) >= 0);
  assert.equal(r.m.spawn(0.5, 0.5, 0), -1);
  void V;
});

test('pin cycle', () => {
  const { m, V, calls } = rig();
  const i = m.spawn(0.4, 0.3, 0);
  assert.equal(m.pin(i), 'pinned');
  assert.equal(m.pin(i), 'unpinned');
  assert.equal(V[i].envT, 0);
  assert.equal(offs(calls, i).at(-1)[2], UNPIN_TAIL);
  assert.deepEqual(m.events(), [{ t: 'burst', i }, { t: 'burst', i }]);
  assert.deepEqual(m.events(), []);
});

test('pin full', () => {
  const { m, V, calls } = rig();
  pinned(m, PIN_MAX);
  const i = m.spawn(0.9, 0.5, 0);
  assert.equal(m.pin(i), 'full');
  assert.equal(V[i].pinned, false);
  assert.equal(offs(calls, i).at(-1)[2], TAIL);
});

test('letGo fades free voice only', () => {
  const { m, calls } = rig();
  const a = m.spawn(0.1, 0.5, 0);
  m.grab(a); m.letGo(a);
  assert.equal(offs(calls, a).at(-1)[2], TAIL);
  const b = m.spawn(0.2, 0.5, 0); m.pin(b); m.grab(b); m.letGo(b);
  assert.equal(offs(calls, b).length, 0);
  const c = m.spawn(0.3, 0.5, 0); m.keep([c]); m.grab(c); m.letGo(c);
  assert.equal(offs(calls, c).length, 0);
  m.unkeep();
  const d = m.spawn(0.4, 0.5, 0); m.grab(d); m.grab(d); m.letGo(d);
  assert.equal(offs(calls, d).length, 0);
});

test('letGo at zero', () => {
  const { m, V, calls } = rig();
  const i = m.spawn(0.1, 0.5, 0);
  m.pin(i);
  const n = calls.length;
  m.letGo(i);
  assert.equal(V[i].held, 0);
  assert.equal(calls.length, n);
});

test('double tap on fading voice', () => {
  const { m, V } = rig();
  const i = m.spawn(0.4, 0.3, 0);
  m.grab(i); m.letGo(i);
  assert.equal(V[i].envT, 0);
  m.attack(i); m.grab(i); m.letGo(i, false);
  assert.equal(m.pin(i), 'pinned');
  assert.equal(V[i].envT, 1);
  assert.equal(V[i].held, 0);
});

test('unkeep fades only free', () => {
  const { m, calls } = rig();
  const a = m.spawn(0.1, 0.5, 0), b = m.spawn(0.2, 0.5, 0);
  m.keep([a, b]); m.pin(b);
  m.unkeep();
  assert.equal(offs(calls, a).length, 1);
  assert.equal(offs(calls, b).length, 0);
  assert.deepEqual(m.state.kept, []);
});

test('remove', () => {
  const { m, V, calls } = rig();
  const i = m.spawn(0.1, 0.5, 0);
  m.pin(i); m.events(); m.keep([i]); m.grab(i);
  m.remove(i);
  assert.equal(V[i].pinned, false);
  assert.equal(V[i].held, 0);
  assert.equal(V[i].envT, 0);
  assert.equal(offs(calls, i).at(-1)[2], 0.25);
  assert.deepEqual(m.events(), [{ t: 'burst', i }]);
  assert.ok(!m.state.kept.includes(i));
});

test('load', () => {
  const { m, V } = rig();
  const a = m.spawn(0.1, 0.5, 0); m.spawn(0.2, 0.5, 0);
  V[a].lfo = { cut: {}, wave: {} };
  assert.equal(m.load(), (2 + 0.15 * 2) / 6);
});
