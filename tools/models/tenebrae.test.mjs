import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel, SET_KEYS, PIN_MAX, TAIL, UNPIN_TAIL, LFO_DEF, BEAT_MIN, BEAT_MAX, SHIFT_DEF } from '../../worlds/tenebrae/model.js';
import { LFO_KEYS, LINK_TYPES } from '../../worlds/tenebrae/engine.js';
import { seeded } from './util.mjs';
import { lerpLog } from '../../host/util.js';

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
const snapshot = (m) => JSON.stringify(m.state.voices.map((v) => v.mods.map((x) => ({ src: x.src, type: x.type, depth: x.depth, until: x.until }))));

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
  const made = V[i].lfo.cut;
  assert.deepEqual(calls.find((c) => c[0] === 'lfo'), ['lfo', i, 'cut', made]);
  assert.ok(!('ph' in made));
  const n = calls.length;
  m.lfo(i, 'cut', { rate: 3 });
  assert.equal(V[i].lfo.cut, made);
  assert.equal(made.rate, 3);
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
    m.fx({ chaos: 0.5 });
    for (let k = 0; k < 50; k++) m.tick(0.1);
    return m;
  };
  const m = run();
  const list = autos(m);
  assert.ok(list.length > 0);
  for (const { dst, x } of list) {
    assert.equal(x.auto, true);
    assert.ok(m.state.voices[x.src].active && x.src !== dst);
    assert.ok(x.k >= 0.15 && x.k < 0.55);
    assert.equal(x.depth, 0.5 * x.k);
  }
  assert.equal(snapshot(m), snapshot(run()));
});

test('chaos off', () => {
  const { m } = rig(7);
  two(m);
  m.fx({ chaos: 0.5 });
  for (let k = 0; k < 50; k++) m.tick(0.1);
  assert.ok(autos(m).length > 0);
  m.fx({ chaos: 0 });
  m.tick(0.5);
  assert.equal(autos(m).length, 0);
  const r = rig(7);
  r.m.spawn(0.2, 0.5, 0);
  r.m.fx({ chaos: 1 });
  for (let k = 0; k < 50; k++) r.m.tick(0.1);
  assert.equal(autos(r.m).length, 0);
});

test('chaos expiry', () => {
  const { m } = rig(7);
  two(m);
  m.fx({ chaos: 0.5 });
  let first = null;
  for (let k = 0; k < 200 && !first; k++) { m.tick(0.1); first = autos(m)[0] || null; }
  assert.ok(first);
  const { dst, x } = first;
  while (m.state.time <= x.until) m.tick(0.1);
  m.tick(0.5);
  assert.ok(!m.state.voices[dst].mods.includes(x));
  let now = null;
  for (let k = 0; k < 100 && !now; k++) { m.tick(0.1); now = m.state.voices[dst].mods.find((y) => y.auto) || null; }
  assert.ok(now && now !== x && now.until > x.until);   // зерно 7: после истечения выпадает новая авто-связь
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
  m.fx({ chaos: 0.5 });
  m.tick(0.1);
  const env = V.map((v) => v.env);
  m.tick(0);
  assert.deepEqual(V.map((v) => v.env), env);
  assert.ok(V.every((v) => !Number.isNaN(v.env) && !Number.isNaN(v.holeT)));
  m.tick(30);
  assert.ok(V.every((v) => v.mods.filter((x) => x.auto).length <= 1));
  const untils = autos(m).map(({ x }) => x.until);
  assert.ok(untils.length > 0);
  m.tick(0.1);   // хаос уже отработал один раз за tick(30): следующий tick связи не трогает
  assert.deepEqual(autos(m).map(({ x }) => x.until), untils);
});

// ---- кубик, снимок, очистка, сборка, FX ----
function loaded(seed = 5) {
  const r = rig(seed);
  const a = r.m.spawn(0.2, 0.5, 0), b = r.m.spawn(0.6, 0.5, 0);
  r.m.pin(a); r.m.pin(b);
  r.m.link(a, b); r.m.link(b, a);
  r.m.lfo(a, 'cut', { ...LFO_DEF }); r.m.lfo(b, 'wave', { ...LFO_DEF });
  return { ...r, a, b };
}

test('fx merges and tells the engine', () => {
  const { m, calls } = rig();
  m.fx({ rev: 0.7 });
  assert.equal(m.state.fx.rev, 0.7);
  assert.equal(m.state.fx.dirt, 0.2);
  assert.deepEqual(calls.at(-1), ['fx', m.state.fx]);
});

test('dice ranges', () => {
  const { m, V, a, b } = loaded();
  m.fx({ chaos: 0.5 });
  const c = m.spawn(0.9, 0.5, 0);
  m.tick(0.5);
  m.events();
  const autoBefore = autos(m).map(({ x }) => ({ ...x }));
  assert.equal(m.dice(), true);
  for (const i of [a, b, c]) {
    const v = V[i];
    assert.ok(v.wave >= 0 && v.wave < 1);
    assert.ok(v.cut >= 0.3 && v.cut < 0.92);
    assert.ok(v.res >= 0 && v.res < 0.75);
    assert.ok(v.beat >= BEAT_MIN && v.beat <= lerpLog(BEAT_MIN, BEAT_MAX, 0.85));
    assert.ok(v.fm === 0 || v.fm < 0.7);
    assert.ok(v.shift === SHIFT_DEF || v.shift < 1);
    for (const l of v.mods.filter((x) => !x.auto)) assert.ok(l.depth >= 0.15 && l.depth < 0.9 && LINK_TYPES.includes(l.type));
  }
  assert.deepEqual(autos(m).map(({ x }) => ({ ...x })), autoBefore);
  assert.deepEqual(m.events().map((e) => e.i).sort(), [a, b, c].sort());
});

test('dice empty', () => {
  const calls = [];
  const m = createModel({ rng: () => { throw new Error('rng'); }, engine: () => null });
  assert.equal(m.dice(), false);
  const i = m.spawn(0.1, 0.5, 0);
  m.release(i, TAIL);
  assert.equal(m.dice(), false);   // гаснущие не в счёт
  assert.deepEqual(calls, []);
});

test('dice seeded', () => {
  const run = () => { const r = loaded(9); r.m.dice(); return JSON.stringify(r.m.snapshot()) + JSON.stringify(r.V.map((v) => [v.wave, v.cut, v.res, v.beat, v.fm, v.shift, v.lfo])); };
  assert.equal(run(), run());
});

test('snapshot roundtrip', () => {
  const r = loaded(), t = r.m.spawn(0.9, 0.5, 0);
  r.m.fx({ chaos: 0.5 }); r.m.tick(0.5);
  const s = r.m.snapshot();
  const o = JSON.parse(s);
  assert.deepEqual(o.v.map((d) => d.i), [r.a, r.b]);
  assert.ok(!o.v.some((d) => d.i === t));
  assert.ok(o.v.every((d) => d.mods.every((x) => [r.a, r.b].includes(x.src))));
  assert.deepEqual(Object.keys(o.fx), ['rev', 'decay', 'dly', 'chaos', 'dirt']);
  const n = rig();
  n.m.restore(s);
  assert.equal(n.m.snapshot(), s);
});

test('snapshot format', () => {
  const { m, V } = rig();
  const i = m.spawn(0.123456, 0.5, 0.1);
  m.pin(i);
  Object.assign(V[i], { wave: 0.3333333, amp: 0.5 });
  m.lfo(i, 'cut', { morph: 0.5, rate: 2, depth: 0.25 });
  assert.equal(m.snapshot(),
    '{"v":[{"i":0,"x":0.1235,"y":0.5,"amp":0.5,"wave":0.3333,"cut":0.68,"res":0.21,"beat":0.35,"fm":0,"shift":0.5,"hole":0.1,"lfo":{"cut":{"morph":0.5,"rate":2,"depth":0.25}},"mods":[]}],"fx":{"rev":0.3,"decay":3.5,"dly":0.3,"chaos":0,"dirt":0.2}}');
});

test('restore removes extra pinned', () => {
  const { m, calls } = rig();
  const [a, b] = pinned(m, 2);
  const s = m.snapshot();
  const c = m.spawn(0.9, 0.5, 0); m.pin(c);
  m.restore(s);
  assert.equal(offs(calls, c).at(-1)[2], 0.25);
  assert.equal(m.state.voices[c].pinned, false);
  assert.ok(m.state.voices[a].pinned && m.state.voices[b].pinned);
});

test('restore order', () => {
  const r = loaded();
  const s = r.m.snapshot();
  const n = rig();
  n.m.restore(s);
  assert.ok(n.names().includes('fx'));
  n.calls.length = 0;
  n.m.tick(0.016);
  const mine = n.calls.filter((c) => c[1] === r.a).map((c) => c[0]);
  assert.ok(mine.lastIndexOf('lfo') < mine.indexOf('voice'));
  assert.ok(mine.indexOf('links') < mine.indexOf('voice'));
  assert.equal(n.m.state.voices[r.a].mods.length, 1);
  assert.equal(n.m.state.voices[r.a].lfo.cut.rate, LFO_DEF.rate);
});

test('restore keeps held temp', () => {
  const r = loaded();
  const s = r.m.snapshot();
  const t = r.m.spawn(0.9, 0.5, 0);
  r.m.grab(t);
  r.m.restore(s);
  assert.ok(r.V[t].active);
  assert.equal(r.V[t].held, 1);
});

test('clear', () => {
  const r = loaded();
  const t = r.m.spawn(0.9, 0.5, 0);
  r.m.keep([t]);
  r.calls.length = 0;
  r.m.clear();
  for (const i of [r.a, r.b, t]) assert.equal(offs(r.calls, i).at(-1)[2], 0.25);
  assert.ok(r.names().includes('clear'));
  assert.deepEqual(r.m.state.kept, []);
});

test('build order', () => {
  const r = rig();
  const [a, b] = two(r.m);
  r.m.link(a, b);
  r.calls.length = 0;
  r.m.build();
  const rank = { fx: 0, live: 1, links: 2, lfo: 2, voice: 3, on: 4 };
  const seq = r.names().map((n) => rank[n]);
  assert.deepEqual(seq, [...seq].sort((x, y) => x - y));
  assert.equal(r.names().filter((n) => n === 'live').length, 2);
  assert.equal(r.names().filter((n) => n === 'on').length, 2);
  assert.equal(r.names().filter((n) => n === 'voice').length, 6);
  assert.equal(r.V[a].dirty, false);
  assert.equal(r.V[a].snap, false);
});

test('events: an empty drain allocates nothing and stays empty', () => {
  const { m } = rig();
  const a = m.events(), b = m.events();
  assert.equal(a, b);
  assert.deepEqual(a, []);
  const i = m.spawn(0.4, 0.3, 0); m.pin(i);
  assert.deepEqual(m.events(), [{ t: 'burst', i }]);
  assert.deepEqual(m.events(), []);
});

test('set ignores keys outside the list', () => {
  const { m, V } = rig(); const i = m.spawn(0.4, 0.3, 0); m.tick(0.01);
  m.set(i, 'active', false); m.set(i, 'x', 0.9); m.set(i, 'cut', 0.1);
  assert.ok(V[i].active); assert.equal(V[i].x, 0.4); assert.equal(V[i].cut, 0.1);
  assert.equal(SET_KEYS.length, 7);
});
test('inactive voice ignores grab, pin, remove, move, set, lfo', () => {
  const { m, V, calls } = rig(); const v = V[3], before = JSON.stringify(v);
  m.grab(3); m.move(3, 0.9, 0.9, 0.5); m.set(3, 'cut', 0.1); m.lfo(3, 'cut', { depth: 0.5 }); m.remove(3);
  assert.equal(m.pin(3), null);
  assert.equal(JSON.stringify(v), before); assert.equal(calls.length, 0); assert.equal(m.events().length, 0);
});
test('new lfo merges LFO_DEF and writes no ph', () => {
  const { m, V } = rig(); const i = m.spawn(0.4, 0.3, 0), spec = { depth: 0.8 };
  m.lfo(i, 'cut', spec); m.lfo(i, 'nope', { depth: 1 });
  assert.deepEqual(V[i].lfo, { cut: { morph: 0, rate: 1.2, depth: 0.8 } });
  assert.deepEqual(spec, { depth: 0.8 });
});
test('links hold voice numbers; mod(dst, src) finds them', () => {
  const { m, V } = rig(); const [a, b] = two(m);
  const x = m.link(a, b);
  assert.equal(V[a].mods[0].src, b); assert.equal(m.mod(a, b), x); assert.equal(m.mod(b, a), undefined);
});
test('fresh voices are clean: first tick sends no voice', () => {
  const { m, names } = rig(); m.tick(0.01); assert.ok(!names().includes('voice'));
});
