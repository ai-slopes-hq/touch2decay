import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel, PIN_MAX, TAIL, UNPIN_TAIL, LFO_DEF } from '../../worlds/tenebrae/model.js';
import { LFO_KEYS } from '../../worlds/tenebrae/engine.js';
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
  const { m } = rig();
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

const two = (m) => [m.spawn(0.2, 0.5, 0), m.spawn(0.6, 0.5, 0)];
const autos = (m) => m.state.voices.flatMap((v) => v.mods.filter((x) => x.auto).map((x) => ({ dst: v.i, x })));
const snapshot = (m) => JSON.stringify(m.state.voices.map((v) => v.mods.map((x) => ({ src: x.src.i, type: x.type, depth: x.depth, until: x.until }))));

test('remove drops links everywhere', () => {
  const { m, V } = rig();
  const [a, b] = two(m), c = m.spawn(0.9, 0.5, 0);
  m.link(b, a); m.link(c, a);
  V[b].dirty = false; V[c].dirty = false;
  m.remove(a);
  assert.deepEqual(V[b].mods, []);
  assert.deepEqual(V[c].mods, []);
  assert.ok(V[b].dirty && V[c].dirty);
});

test('link keeps depth', () => {
  const { m, V } = rig();
  const [a, b] = two(m);
  assert.equal(m.link(a, b).depth, 0.5);
  m.unlink(a, b);
  m.link(a, b); m.linkDepth(a, b, 0.8);
  const l = m.link(a, b);
  assert.equal(V[a].mods.length, 1);
  assert.equal(l.depth, 0.8);
  assert.equal(l.auto, false);
  m.linkType(a, b, 'am');
  assert.equal(V[a].mods[0].type, 'am');
  m.unlink(a, b);
  assert.deepEqual(V[a].mods, []);
  assert.equal(m.linkDepth(a, b, 1), undefined);   // нет связи — ничего
});

test('lfo edit in place', () => {
  const { m, V, calls } = rig();
  const i = m.spawn(0.2, 0.5, 0);
  const spec = { ...LFO_DEF };
  m.lfo(i, 'cut', spec);
  assert.equal(calls.filter((c) => c[0] === 'lfo').length, 1);
  assert.deepEqual(calls.find((c) => c[0] === 'lfo'), ['lfo', i, 'cut', spec]);
  assert.equal(V[i].lfo.cut.ph, 0);
  const n = calls.length;
  m.lfo(i, 'cut', { rate: 3 });
  assert.equal(V[i].lfo.cut, spec);
  assert.equal(spec.rate, 3);
  assert.equal(calls.length, n);
  assert.ok(V[i].dirty);
  m.lfo(i, 'cut', null);
  assert.deepEqual(calls.at(-1), ['lfo', i, 'cut', null]);
  assert.ok(!('cut' in V[i].lfo));
});

test('chaos seeded', () => {
  const run = () => {
    const { m } = rig(7);
    two(m);
    m.state.fx.chaos = 0.5;
    for (let k = 0; k < 50; k++) m.tick(0.1);
    return m;
  };
  const m = run();
  const list = autos(m);
  assert.ok(list.length > 0);
  for (const { dst, x } of list) {
    assert.equal(x.auto, true);
    assert.ok(x.src.active && x.src.i !== dst);
    assert.ok(x.k >= 0.15 && x.k < 0.55);
    assert.equal(x.depth, 0.5 * x.k);
  }
  assert.equal(snapshot(m), snapshot(run()));
});

test('chaos off', () => {
  const { m } = rig(7);
  two(m);
  m.state.fx.chaos = 0.5;
  for (let k = 0; k < 50; k++) m.tick(0.1);
  assert.ok(autos(m).length > 0);
  m.state.fx.chaos = 0;
  m.tick(0.5);
  assert.equal(autos(m).length, 0);
  const r = rig(7);
  r.m.spawn(0.2, 0.5, 0);
  r.m.state.fx.chaos = 1;
  for (let k = 0; k < 50; k++) r.m.tick(0.1);
  assert.equal(autos(r.m).length, 0);
});

test('chaos expiry', () => {
  const { m } = rig(7);
  two(m);
  m.state.fx.chaos = 0.5;
  let first = null;
  for (let k = 0; k < 200 && !first; k++) { m.tick(0.1); first = autos(m)[0] || null; }
  assert.ok(first);
  const { dst, x } = first;
  while (m.state.time <= x.until) m.tick(0.1);
  m.tick(0.5);
  assert.ok(!m.state.voices[dst].mods.includes(x));
  const now = m.state.voices[dst].mods.find((y) => y.auto);
  if (now) assert.ok(now.until > x.until);
});

test('tick sync order', () => {
  const { m, V, calls } = rig();
  const [a, b] = two(m);
  m.link(a, b);
  calls.length = 0;
  m.tick(0.016);
  const mine = calls.filter((c) => c[1] === a);
  const names = mine.map((c) => c[0]);
  assert.equal(names.filter((n) => n === 'lfo').length, LFO_KEYS.length);
  assert.ok(names.indexOf('links') < names.indexOf('lfo'));
  assert.ok(names.lastIndexOf('lfo') < names.indexOf('voice'));
  assert.equal(V[a].snap, false);
  assert.equal(V[a].dirty, false);
});

test('hole death', () => {
  const { m, V, calls } = rig();
  const i = m.spawn(0.2, 0.5, 0);
  m.pin(i);
  m.grab(i); m.move(i, 0.2, 0.5, 0.95); m.letGo(i);
  assert.equal(V[i].held, 0);
  m.tick(0.016);
  assert.equal(V[i].pinned, false);
  assert.equal(offs(calls, i).at(-1)[2], 0.4);
});

test('fade out', () => {
  const { m, V, calls } = rig();
  const [a, b] = two(m);
  m.link(a, b); m.lfo(a, 'cut', { ...LFO_DEF });
  for (let k = 0; k < 5; k++) m.tick(0.1);
  m.release(a, 0.05);
  for (let k = 0; k < 20 && V[a].active; k++) m.tick(0.1);
  assert.equal(V[a].active, false);
  assert.equal(V[a].live, false);
  assert.ok(calls.some((c) => c[0] === 'live' && c[1] === a && c[2] === false));
  assert.deepEqual(V[a].mods, []);
  assert.deepEqual(V[a].lfo, {});
});

test('sun strikes', () => {
  const { m, calls } = rig(3);
  const i = m.spawn(0.2, 0.5, 0);
  m.grab(i); m.sun(i, 1);
  const times = [];
  for (let k = 0; k < 100; k++) {
    const n = calls.filter((c) => c[0] === 'strike').length;
    m.tick(0.01);
    if (calls.filter((c) => c[0] === 'strike').length > n) times.push(m.state.time);
  }
  assert.ok(times.length >= 3);
  for (let k = 1; k < times.length; k++) {
    const d = times[k] - times[k - 1];
    assert.ok(d >= 0.12 * 0.6 - 1e-9 && d <= 0.12 * 1.4 + 0.01 + 1e-9, String(d));
  }
  const strikes = calls.filter((c) => c[0] === 'strike');
  assert.equal(m.state.strikes, strikes.length);
  assert.ok(strikes.every((c) => c[1] === 1));
  const ev = m.events().filter((e) => e.t === 'strike');
  assert.equal(ev.length, strikes.length);
  assert.ok(ev.every((e) => e.i === i && e.p === 1));
  const n = strikes.length;
  m.sun(i, 0);
  for (let k = 0; k < 50; k++) m.tick(0.01);
  m.sun(i, 1); m.letGo(i);
  for (let k = 0; k < 50; k++) m.tick(0.01);
  assert.equal(m.state.strikes, n);
});

test('tick dt 0 and long', () => {
  const { m, V } = rig(7);
  two(m);
  m.state.fx.chaos = 0.5;
  m.tick(0.1);
  const env = V.map((v) => v.env);
  m.tick(0);
  assert.deepEqual(V.map((v) => v.env), env);
  assert.ok(V.every((v) => !Number.isNaN(v.env) && !Number.isNaN(v.holeT)));
  m.tick(30);
  assert.ok(V.every((v) => v.mods.filter((x) => x.auto).length <= 1));
});
