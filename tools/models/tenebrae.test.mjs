// Тесты модели Tenebrae в Node. Каждый общий тест — дважды: против эталона (tools/ref/tenebrae-model.js) и против модели ядра (t2d.wasm)
// через фасад веба worlds/tenebrae/model.js (порт — tenebrae-core.mjs, sdk-facade.mjs). Проверки — по state, events() и ответам методов,
// state из теста не пишется. Команды клея движка (tick sync order, build, restore order, хвосты затухания) — только у эталона (`ref:`).
// Внизу — гонки фасада (асинхронный порт: flush / deliver), только на ядре (`core:`).
//   core/build.sh && node --test tools/models/tenebrae.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel as refModel, SET_KEYS, PIN_MAX, TAIL, UNPIN_TAIL, LFO_DEF, BEAT_MIN, BEAT_MAX, SHIFT_DEF } from '../ref/tenebrae-model.js';
import * as facade from '../../worlds/tenebrae/model.js';
import { createEngine } from '../../worlds/tenebrae/engine.js';
const { LFO_KEYS, LINK_TYPES } = facade;
import * as coreLib from './tenebrae-core.mjs';
import { createModel as coreModel, MODEL_SEED } from './tenebrae-core.mjs';
import { seeded, near } from './util.mjs';
import { lerpLog } from '../../host/util.js';

const GLUE = ['voice', 'on', 'off', 'live', 'links', 'lfo', 'fx', 'strike', 'clear', 'busEnv'];
function refRig(seed = 1) {                            // эталон с записью команд клея
  const calls = [];
  const glue = Object.fromEntries(GLUE.map((n) => [n, (...a) => calls.push([n, ...a])]));
  const m = refModel({ rng: seeded(seed ^ MODEL_SEED), engine: () => glue });
  return { m, V: m.state.voices, calls, names: () => calls.map((c) => c[0]) };
}
const quiet = Object.fromEntries(GLUE.map((n) => [n, () => {}]));
const FACTORIES = {
  ref: ({ seed = 1 } = {}) => refModel({ rng: seeded(seed ^ MODEL_SEED), engine: () => quiet }),
  core: ({ seed = 1, async } = {}) => coreModel({ seed, async }),
};

const pinned = (m, n) => { const out = []; for (let k = 0; k < n; k++) { const i = m.spawn(0.1 * k, 0.5, 0); m.pin(i); out.push(i); } return out; };
const offs = (calls, i) => calls.filter((c) => c[0] === 'off' && c[1] === i);
const two = (m) => [m.spawn(0.2, 0.5, 0), m.spawn(0.6, 0.5, 0)];
const autos = (m) => m.state.voices.flatMap((v) => v.mods.filter((x) => x.auto).map((x) => ({ dst: v.i, x })));
const mods = (m) => JSON.stringify(m.state.voices.map((v) => v.mods.map((x) => ({ src: x.src, type: x.type, depth: x.depth, auto: x.auto }))));
const drain = (m, dt, n) => { const out = []; for (let k = 0; k < n; k++) { m.tick(dt); out.push(...m.events().map((e) => ({ ...e, at: m.state.time }))); } return out; };

for (const [name, make] of Object.entries(FACTORIES)) {
  const rig = (seed) => { const m = make({ seed }); return { m, V: m.state.voices }; };
  const loaded = (seed = 5) => {
    const r = rig(seed), { m } = r;
    const a = m.spawn(0.2, 0.5, 0), b = m.spawn(0.6, 0.5, 0);
    m.pin(a); m.pin(b);
    m.link(a, b); m.link(b, a);
    m.lfo(a, 'cut', { ...LFO_DEF }); m.lfo(b, 'wave', { ...LFO_DEF });
    return { ...r, a, b };
  };

  test(`[${name}] spawn takes a free voice`, () => {
    const { m, V } = rig();
    assert.equal(m.spawn(0.4, 0.3, 0.2), 0);
    const v = V[0];
    assert.ok(v.active && v.live && v.envT === 1 && v.x === 0.4 && v.y === 0.3 && v.holeT === 0.2);
    assert.equal(m.sounding(), true);
  });

  test(`[${name}] spawn temps limit and eviction`, () => {
    const { m, V } = rig();
    for (let k = 0; k < 3; k++) m.spawn(0.1 * k, 0.5, 0);
    m.tick(0.3);
    assert.equal(m.spawn(0.9, 0.5, 0), -1);
    m.release(2, TAIL); m.tick(0.5);                    // 2 затухает дольше всех — самый тихий
    m.release(1, TAIL); m.tick(0.05);
    assert.ok(V[2].env < V[1].env);
    assert.equal(m.spawn(0.9, 0.5, 0), 2);
  });

  test(`[${name}] spawn never evicts pinned, held or kept`, () => {
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

  test(`[${name}] pin cycle`, () => {
    const { m, V } = rig();
    const i = m.spawn(0.4, 0.3, 0);
    assert.equal(m.pin(i), 'pinned');
    assert.ok(V[i].pinned);
    assert.equal(m.pin(i), 'unpinned');
    assert.ok(!V[i].pinned);
    assert.equal(V[i].envT, 0);
    assert.deepEqual(m.events(), [{ t: 'burst', i }, { t: 'burst', i }]);
    assert.deepEqual(m.events(), []);
  });

  test(`[${name}] pin full`, () => {
    const { m, V } = rig();
    pinned(m, PIN_MAX);
    const i = m.spawn(0.9, 0.5, 0);
    assert.equal(m.pin(i), 'full');
    assert.equal(V[i].pinned, false);
    assert.equal(V[i].envT, 0);
  });

  test(`[${name}] letGo fades free voice only`, () => {
    const { m, V } = rig();
    const a = m.spawn(0.1, 0.5, 0);
    m.grab(a); m.letGo(a);
    assert.equal(V[a].envT, 0);
    const b = m.spawn(0.2, 0.5, 0); m.pin(b); m.grab(b); m.letGo(b);
    assert.equal(V[b].envT, 1);
    const c = m.spawn(0.3, 0.5, 0); m.keep([c]); m.grab(c); m.letGo(c);
    assert.equal(V[c].envT, 1);
    m.unkeep();
    assert.equal(V[c].envT, 0);
    const d = m.spawn(0.4, 0.5, 0); m.grab(d); m.grab(d); m.letGo(d);
    assert.equal(V[d].envT, 1);
    assert.equal(V[d].held, 1);
  });

  test(`[${name}] letGo at zero`, () => {
    const { m, V } = rig();
    const i = m.spawn(0.1, 0.5, 0);
    m.letGo(i);
    assert.equal(V[i].held, 0);
    assert.equal(V[i].envT, 1);
  });

  test(`[${name}] double tap on fading voice`, () => {
    const { m, V } = rig();
    const i = m.spawn(0.4, 0.3, 0);
    m.grab(i); m.letGo(i);
    assert.equal(V[i].envT, 0);
    m.attack(i); m.grab(i); m.letGo(i, false);
    assert.equal(m.pin(i), 'pinned');
    assert.equal(V[i].envT, 1);
    assert.equal(V[i].held, 0);
  });

  test(`[${name}] unkeep fades only free`, () => {
    const { m, V } = rig();
    const a = m.spawn(0.1, 0.5, 0), b = m.spawn(0.2, 0.5, 0);
    m.keep([a, b]); m.pin(b);
    assert.deepEqual([...m.state.kept], [a, b]);
    m.unkeep();
    assert.equal(V[a].envT, 0);
    assert.equal(V[b].envT, 1);
    assert.deepEqual([...m.state.kept], []);
  });

  test(`[${name}] remove`, () => {
    const { m, V } = rig();
    const i = m.spawn(0.1, 0.5, 0);
    m.pin(i); m.events(); m.keep([i]); m.grab(i);
    m.remove(i);
    assert.equal(V[i].pinned, false);
    assert.equal(V[i].held, 0);
    assert.equal(V[i].envT, 0);
    assert.deepEqual(m.events(), [{ t: 'burst', i }]);
    assert.ok(!m.state.kept.includes(i));
  });

  test(`[${name}] load`, () => {
    const { m } = rig();
    const a = m.spawn(0.1, 0.5, 0); m.spawn(0.2, 0.5, 0);
    m.lfo(a, 'cut', {}); m.lfo(a, 'wave', {});
    assert.ok(near(m.load(), (2 + 0.15 * 2) / 6));
  });

  test(`[${name}] remove drops links everywhere`, () => {
    const { m, V } = rig();
    const [a, b] = two(m), c = m.spawn(0.9, 0.5, 0);
    m.link(b, a); m.link(c, a);
    m.remove(a);
    assert.deepEqual(V[b].mods, []);
    assert.deepEqual(V[c].mods, []);
  });

  test(`[${name}] link keeps depth`, () => {
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
    assert.equal(m.linkDepth(a, b, 1), undefined);      // нет связи — ничего
  });

  test(`[${name}] lfo edit in place`, () => {
    const { m, V } = rig();
    const i = m.spawn(0.2, 0.5, 0);
    m.lfo(i, 'cut', { ...LFO_DEF });
    const made = V[i].lfo.cut;
    assert.deepEqual({ ...made }, LFO_DEF);
    assert.ok(!('ph' in made));
    m.lfo(i, 'cut', { rate: 3 });
    assert.equal(V[i].lfo.cut, made);
    assert.equal(made.rate, 3);
    m.lfo(i, 'cut', null);
    assert.ok(!('cut' in V[i].lfo));
  });

  test(`[${name}] chaos seeded`, () => {
    const run = () => {
      const { m } = rig(7);
      two(m);
      m.fx({ chaos: 0.5 });
      for (let k = 0; k < 50; k++) m.tick(0.1);
      return m;
    };
    const m = run(), list = autos(m);
    assert.ok(list.length > 0);
    for (const { dst, x } of list) {
      assert.equal(x.auto, true);
      assert.ok(m.state.voices[x.src].active && x.src !== dst);
      assert.ok(x.depth >= 0.5 * 0.15 - 1e-9 && x.depth < 0.5 * 0.55);
    }
    assert.equal(mods(m), mods(run()));
  });

  test(`[${name}] chaos off`, () => {
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

  test(`[${name}] hole death`, () => {
    const { m, V } = rig();
    const i = m.spawn(0.2, 0.5, 0);
    m.pin(i);
    m.grab(i); m.move(i, 0.2, 0.5, 0.95); m.letGo(i);
    assert.equal(V[i].held, 0);
    m.tick(0.016);
    assert.equal(V[i].pinned, false);
    assert.equal(V[i].envT, 0);
  });

  test(`[${name}] fade out`, () => {
    const { m, V } = rig();
    const [a, b] = two(m);
    m.link(a, b); m.lfo(a, 'cut', { ...LFO_DEF });
    for (let k = 0; k < 5; k++) m.tick(0.1);
    m.release(a, 0.05);
    for (let k = 0; k < 20 && V[a].active; k++) m.tick(0.1);
    assert.equal(V[a].active, false);
    assert.equal(V[a].live, false);
    assert.deepEqual(V[a].mods, []);
    assert.deepEqual(V[a].lfo, {});
  });

  test(`[${name}] sun strikes`, () => {
    const { m } = rig(3);
    const i = m.spawn(0.2, 0.5, 0);
    m.grab(i); m.sun(i, 1);
    const hits = drain(m, 0.01, 100).filter((e) => e.t === 'strike');
    assert.ok(hits.length >= 3);
    for (let k = 1; k < hits.length; k++) {
      const d = hits[k].at - hits[k - 1].at;             // шаг 0.01 тика + блок ядра: допуск на дискретность
      assert.ok(d >= 0.12 * 0.6 - 0.011 && d <= 0.12 * 1.4 + 0.011 + 1e-9, String(d));
    }
    assert.equal(m.state.strikes, hits.length);
    assert.ok(hits.every((e) => e.i === i && e.p === 1));
    const n = hits.length;
    m.sun(i, 0);
    drain(m, 0.01, 50);
    m.sun(i, 1); m.letGo(i);
    drain(m, 0.01, 50);
    assert.equal(m.state.strikes, n);
  });

  test(`[${name}] tick dt 0 and long`, () => {
    const { m, V } = rig(7);
    two(m);
    m.fx({ chaos: 0.5 });
    m.tick(0.1);
    const env = V.map((v) => v.env);
    m.tick(0);
    assert.deepEqual(V.map((v) => v.env), env);
    m.tick(30);
    assert.ok(V.every((v) => !Number.isNaN(v.env) && !Number.isNaN(v.holeT)));
    assert.ok(V.every((v) => v.mods.filter((x) => x.auto).length <= 1));
  });

  test(`[${name}] fx merges`, () => {
    const { m } = rig();
    m.fx({ rev: 0.7 });
    assert.equal(m.state.fx.rev, 0.7);
    assert.equal(m.state.fx.dirt, 0.2);
  });

  test(`[${name}] dice ranges`, () => {
    const { m, V, a, b } = loaded();
    m.fx({ chaos: 0.5 });
    const c = m.spawn(0.9, 0.5, 0);
    m.tick(0.5);
    m.events();
    const autoBefore = autos(m).map(({ dst, x }) => ({ dst, src: x.src, type: x.type, depth: x.depth }));
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
    assert.deepEqual(autos(m).map(({ dst, x }) => ({ dst, src: x.src, type: x.type, depth: x.depth })), autoBefore);
    assert.deepEqual(m.events().map((e) => e.i).sort(), [a, b, c].sort());
  });

  test(`[${name}] dice empty`, () => {
    const { m } = rig();
    assert.equal(m.dice(), false);
    const i = m.spawn(0.1, 0.5, 0);
    m.release(i, TAIL);
    assert.equal(m.dice(), false);                      // гаснущие не в счёт
    assert.deepEqual(m.events(), []);
  });

  test(`[${name}] dice seeded`, () => {
    const run = () => { const r = loaded(9); r.m.dice(); return r.m.snapshot() + JSON.stringify(r.V.map((v) => [v.wave, v.cut, v.res, v.beat, v.fm, v.shift, v.lfo])); };
    assert.equal(run(), run());
  });

  test(`[${name}] snapshot roundtrip`, () => {
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

  test(`[${name}] snapshot format`, () => {
    const { m } = rig();
    const i = m.spawn(0.123456, 0.5, 0.1);
    m.pin(i);
    m.set(i, 'wave', 0.3333333); m.set(i, 'amp', 0.5);
    m.lfo(i, 'cut', { morph: 0.5, rate: 2, depth: 0.25 });
    assert.equal(m.snapshot(),
      '{"v":[{"i":0,"x":0.1235,"y":0.5,"amp":0.5,"wave":0.3333,"cut":0.68,"res":0.21,"beat":0.35,"fm":0,"shift":0.5,"hole":0.1,"lfo":{"cut":{"morph":0.5,"rate":2,"depth":0.25}},"mods":[]}],"fx":{"rev":0.3,"decay":3.5,"dly":0.3,"chaos":0,"dirt":0.2}}');
  });

  test(`[${name}] restore removes extra pinned`, () => {
    const { m, V } = rig();
    const [a, b] = pinned(m, 2);
    const s = m.snapshot();
    const c = m.spawn(0.9, 0.5, 0); m.pin(c);
    m.restore(s);
    assert.equal(V[c].pinned, false);
    assert.equal(V[c].envT, 0);
    assert.ok(V[a].pinned && V[b].pinned);
  });

  test(`[${name}] restore keeps held temp`, () => {
    const r = loaded();
    const s = r.m.snapshot();
    const t = r.m.spawn(0.9, 0.5, 0);
    r.m.grab(t);
    r.m.restore(s);
    assert.ok(r.V[t].active);
    assert.equal(r.V[t].held, 1);
  });

  test(`[${name}] clear`, () => {
    const r = loaded();
    const t = r.m.spawn(0.9, 0.5, 0);
    r.m.keep([t]);
    r.m.clear();
    for (const i of [r.a, r.b, t]) assert.equal(r.V[i].envT, 0);
    assert.deepEqual([...r.m.state.kept], []);
  });

  test(`[${name}] events: an empty drain allocates nothing and stays empty`, () => {
    const { m } = rig();
    const a = m.events(), b = m.events();
    assert.equal(a, b);
    assert.deepEqual(a, []);
    const i = m.spawn(0.4, 0.3, 0); m.pin(i);
    assert.deepEqual(m.events(), [{ t: 'burst', i }]);
    assert.deepEqual(m.events(), []);
  });

  test(`[${name}] set ignores keys outside the list`, () => {
    const { m, V } = rig(); const i = m.spawn(0.4, 0.3, 0); m.tick(0.01);
    m.set(i, 'active', false); m.set(i, 'x', 0.9); m.set(i, 'cut', 0.1);
    assert.ok(V[i].active); assert.equal(V[i].x, 0.4); assert.equal(V[i].cut, 0.1);
    assert.equal(SET_KEYS.length, 7);
  });

  test(`[${name}] inactive voice ignores grab, pin, remove, move, set, lfo`, () => {
    const { m, V } = rig(); const v = V[3], before = JSON.stringify(v);
    m.grab(3); m.move(3, 0.9, 0.9, 0.5); m.set(3, 'cut', 0.1); m.lfo(3, 'cut', { depth: 0.5 }); m.remove(3);
    assert.equal(m.pin(3), null);
    assert.equal(JSON.stringify(v), before); assert.equal(m.events().length, 0);
  });

  test(`[${name}] new lfo merges LFO_DEF and writes no ph`, () => {
    const { m, V } = rig(); const i = m.spawn(0.4, 0.3, 0), spec = { depth: 0.8 };
    m.lfo(i, 'cut', spec); m.lfo(i, 'nope', { depth: 1 });
    assert.deepEqual(V[i].lfo, { cut: { morph: 0, rate: 1.2, depth: 0.8 } });
    assert.deepEqual(spec, { depth: 0.8 });
  });

  test(`[${name}] links hold voice numbers; mod(dst, src) finds them`, () => {
    const { m, V } = rig(); const [a, b] = two(m);
    const x = m.link(a, b);
    assert.equal(V[a].mods[0].src, b); assert.equal(m.mod(a, b), x); assert.equal(m.mod(b, a), undefined);
  });
}

// ---- только эталон: команды клея движка ----
const lastTau = (calls, i) => offs(calls, i).at(-1)[2];

test('ref: tails of fading', () => {
  const { m, calls } = refRig();
  const a = m.spawn(0.1, 0.5, 0); m.grab(a); m.letGo(a);
  assert.equal(lastTau(calls, a), TAIL);
  const b = m.spawn(0.2, 0.5, 0); m.pin(b); m.pin(b);
  assert.equal(lastTau(calls, b), UNPIN_TAIL);
  const c = m.spawn(0.3, 0.5, 0); m.remove(c);
  assert.equal(lastTau(calls, c), 0.25);
  const { m: n, calls: nc } = refRig();
  pinned(n, PIN_MAX);
  const f = n.spawn(0.9, 0.5, 0); n.pin(f);
  assert.equal(lastTau(nc, f), TAIL);
});

test('ref: tick sync order', () => {
  const { m, V, calls } = refRig();
  const [a, b] = two(m);
  m.link(a, b);
  calls.length = 0;
  m.tick(0.016);
  const names = calls.filter((c) => c[1] === a).map((c) => c[0]);
  assert.equal(names.filter((n) => n === 'lfo').length, LFO_KEYS.length);
  assert.ok(names.indexOf('links') < names.indexOf('lfo'));
  assert.ok(names.lastIndexOf('lfo') < names.indexOf('voice'));
  assert.equal(V[a].snap, false);
  assert.equal(V[a].dirty, false);
});

test('ref: chaos expiry', () => {
  const { m } = refRig(7);
  two(m);
  m.fx({ chaos: 0.5 });
  let first = null;
  for (let k = 0; k < 200 && !first; k++) { m.tick(0.1); first = autos(m)[0] || null; }
  assert.ok(first);
  const { dst, x } = first;
  while (m.state.time <= x.until) m.tick(0.1);
  m.tick(0.5);
  assert.ok(!m.state.voices[dst].mods.includes(x));
});

test('ref: restore order and build order', () => {
  const r = refRig(5), { m } = r;
  const [a, b] = two(m);
  m.pin(a); m.pin(b); m.link(a, b); m.lfo(a, 'cut', { ...LFO_DEF });
  const s = m.snapshot();
  const n = refRig();
  n.m.restore(s);
  assert.ok(n.names().includes('fx'));
  n.calls.length = 0;
  n.m.tick(0.016);
  const mine = n.calls.filter((c) => c[1] === a).map((c) => c[0]);
  assert.ok(mine.lastIndexOf('lfo') < mine.indexOf('voice'));
  assert.ok(mine.indexOf('links') < mine.indexOf('voice'));
  r.calls.length = 0;
  m.build();
  const rank = { fx: 0, live: 1, links: 2, lfo: 2, voice: 3, on: 4 };
  const seq = r.names().map((x) => rank[x]);
  assert.deepEqual(seq, [...seq].sort((x, y) => x - y));
  assert.equal(r.names().filter((x) => x === 'voice').length, 6);
});

test('ref: fresh voices are clean: first tick sends no voice', () => {
  const { m, names } = refRig(); m.tick(0.01); assert.ok(!names().includes('voice'));
});

// ---- только ядро: гонки фасада и мост ----
const asyncCore = (seed = 1) => coreModel({ seed, async: true });

test('core: numbers match the core', () => {
  assert.deepEqual(facade.ACT, coreLib.ACT);
  assert.deepEqual(facade.MIRROR, coreLib.MIRROR);
  assert.equal(facade.SLOT, coreLib.SLOT);
  assert.deepEqual(facade.SET_KEYS, coreLib.SET_KEYS);
  assert.deepEqual(facade.LFO_KEYS, coreLib.LFO_KEYS);
  assert.deepEqual(facade.LINK_TYPES, coreLib.LINK_TYPES);
  assert.deepEqual(facade.LFO_DEF, LFO_DEF);
});

test('core: touched voice survives stale mirrors', () => {
  const m = asyncCore(), V = m.state.voices;
  const i = m.spawn(0.4, 0.3, 0);
  m.flush(); m.deliver();
  let x = 0;
  for (let k = 1; k <= 20; k++) {
    x = 0.1 + 0.01 * k;
    m.move(i, x, 0.5, 0);
    m.deliver();                                        // зеркало отстаёт: в нём старое место
    assert.equal(V[i].x, x);
  }
  m.flush(); m.deliver();
  assert.equal(V[i].x, x);
  assert.ok(near(m.coreVoice(i).x, x));
});

test('core: a link or a set in flight survives a stale mirror and then agrees', () => {
  const m = asyncCore(), V = m.state.voices;
  const [a, b] = [m.spawn(0.2, 0.5, 0), m.spawn(0.6, 0.5, 0)];
  m.flush(); m.deliver();
  m.link(a, b); m.set(a, 'cut', 0.11); m.lfo(a, 'wave', { depth: 0.6 });
  m.deliver();
  assert.equal(V[a].mods.length, 1); assert.equal(V[a].cut, 0.11); assert.equal(V[a].lfo.wave.depth, 0.6);
  const link = V[a].mods[0], lfo = V[a].lfo.wave;
  m.flush(); m.deliver();
  assert.equal(V[a].mods[0], link); assert.equal(V[a].lfo.wave, lfo);   // объекты те же
  assert.ok(near(m.coreVoice(a).cut, 0.11)); assert.equal(m.coreVoice(a).mods.length, 1);
});

test('core: partial lfo spec merges with own state and goes whole to the core', () => {
  const m = asyncCore(), V = m.state.voices;
  const i = m.spawn(0.2, 0.5, 0);
  m.lfo(i, 'cut', { depth: 0.6 });
  m.lfo(i, 'cut', { rate: 3 });                          // зеркала ещё не было — берём свой state
  m.flush(); m.deliver();
  assert.deepEqual({ ...V[i].lfo.cut }, { morph: 0, rate: 3, depth: 0.6 });
  assert.deepEqual(m.coreVoice(i).lfo.cut, { morph: 0, rate: 3, depth: 0.6 });
  m.lfo(i, 'cut', { depth: 0 });                         // глубина 0 — настоящий LFO, не «нет»
  m.flush(); m.deliver();
  assert.ok('cut' in V[i].lfo); assert.equal(V[i].lfo.cut.depth, 0);
  m.lfo(i, 'cut', null);
  m.flush(); m.deliver();
  assert.ok(!('cut' in V[i].lfo)); assert.ok(!('cut' in m.coreVoice(i).lfo));
});

test('core: link to self does nothing', () => {
  const m = asyncCore(), V = m.state.voices;
  const i = m.spawn(0.2, 0.5, 0);
  assert.equal(m.link(i, i), undefined);
  assert.deepEqual(V[i].mods, []);
  m.flush(); m.deliver();
  assert.deepEqual(V[i].mods, []); assert.deepEqual(m.coreVoice(i).mods, []);
});

test('core: spawn index is the caller\'s', () => {
  const script = (m) => {                               // три временных отпущены в разные моменты; затухает дольше всех первый
    const [a, b, c] = [0, 1, 2].map((k) => m.spawn(0.2 * k, 0.5, 0));
    m.link(b, a); m.lfo(b, 'cut', { depth: 0.5 });
    m.tick(0.3);
    m.release(b, TAIL); m.tick(0.4);
    m.release(c, TAIL); m.tick(0.4);
    m.release(a, TAIL); m.tick(0.1);
    return b;
  };
  const ref = FACTORIES.ref();
  const want = script(ref);
  const m = asyncCore(), V = m.state.voices;
  assert.equal(script(m), want);
  const i = m.spawn(0.77, 0.66, 0.1);                    // до deliver
  assert.equal(i, ref.spawn(0.77, 0.66, 0.1));
  assert.equal(i, want);
  m.flush(); m.deliver();
  const w = m.coreVoice(i);
  assert.ok(w.active && near(w.x, 0.77) && near(w.y, 0.66) && w.envT === 1);
  assert.deepEqual(w.mods, []); assert.deepEqual(Object.keys(w.lfo), []);
  assert.deepEqual(V[i].mods, []);
});

test('core: dice arrives by mirror', () => {
  const m = asyncCore(), V = m.state.voices;
  const [a, b] = pinned(m, 2);
  m.flush(); m.deliver();
  const waves = [V[a].wave, V[b].wave];
  assert.equal(m.dice(), true);
  assert.deepEqual([V[a].wave, V[b].wave], waves);       // состояние не тронуто
  assert.equal(m.busy(), true);
  m.deliver();
  assert.equal(m.busy(), true);                          // зеркало до кубика
  m.flush(); m.tick(0.01);
  assert.notEqual(V[a].wave, waves[0]); assert.notEqual(V[b].wave, waves[1]);
  assert.equal(m.busy(), false);
  const e = asyncCore();
  assert.equal(e.dice(), false);
  assert.equal(e.busy(), false);
});

test('core: clear is busy until the core wipes', () => {
  const m = asyncCore();
  pinned(m, 2);
  m.flush(); m.deliver();
  m.clear();
  assert.ok(m.busy());
  assert.ok(m.state.voices.every((v) => v.envT === 0));
  m.flush(); m.tick(0.01);
  assert.ok(!m.busy());
});

test('core: heard becomes events', () => {
  const m = asyncCore();
  const i = m.spawn(0.2, 0.5, 0);
  m.pin(i);
  m.flush(); m.tick(0.01);
  assert.deepEqual(m.events().filter((e) => e.t === 'burst'), [{ t: 'burst', i }]);
  const n = asyncCore(), j = n.spawn(0.2, 0.5, 0);
  n.sun(j, 1); n.grab(j);
  n.flush(); n.tick(0.5);
  const hits = n.events().filter((e) => e.t === 'strike');
  assert.ok(hits.length > 0);
  assert.deepEqual(hits[0], { t: 'strike', i: j, p: 1 });
});

test('core: kept survives a stale mirror', () => {
  const m = asyncCore();
  const i = m.spawn(0.2, 0.5, 0);
  m.flush(); m.deliver();
  m.keep([i]);
  m.deliver();
  assert.deepEqual([...m.state.kept], [i]);
  m.flush(); m.deliver();
  assert.deepEqual([...m.state.kept], [i]);
});

test('core: rebind sends the pinned scene', () => {
  const m = coreModel({ seed: 3 });
  const [a, b] = pinned(m, 2), t = m.spawn(0.9, 0.5, 0);
  m.link(a, b); m.lfo(b, 'cut', { morph: 0.5, rate: 2, depth: 0.25 });
  const s = m.snapshot();
  m.rebind();
  const wa = m.coreVoice(a), wb = m.coreVoice(b);
  assert.ok(wa.pinned && wb.pinned);
  assert.deepEqual(wa.mods.map((x) => [x.src, x.type, x.auto]), [[b, 'tzfm', false]]);
  assert.deepEqual(wb.lfo.cut, { morph: 0.5, rate: 2, depth: 0.25 });
  assert.ok(!m.coreVoice(t).active);
  assert.equal(m.snapshot(), s);
});

test('core: scope is null until the core has contours', () => {
  const m = coreModel();
  assert.equal(m.scope(0), null);
  const i = m.spawn(0.2, 0.5, 0);
  m.tick(0.2);
  const sc = m.scope(i);
  assert.ok(sc instanceof Float32Array && sc.length === 128);
  assert.ok(sc.some((x) => x !== 0));
  assert.equal(m.scope(5), null);
  assert.equal(m.scope(i), sc);                          // тот же массив каждый кадр
});

test('core: engine build wires the facade', () => {
  const sent = [], conns = [];
  let listener = null;
  const m = facade.createModel();
  const core = { dry: [null, { connect(o) { conns.push(o); return o; } }], send: (x) => { sent.push(x); return sent.length; }, listen(fn) { listener = fn; } };
  const out = {};
  createEngine({ model: m }).build(core, out);
  assert.deepEqual(conns, [out]);
  assert.ok(sent.some((x) => x.t === 'restore' && x.slot === 1));
  const mirror = new Array(facade.MIRROR.MODEL_N).fill(0);
  mirror[0] = 6; mirror[1] = 12.5;
  listener({ n: 1, w: { 1: { mirror, heard: [] } } });
  assert.equal(m.state.time, 12.5);
});

test('core: unchanged sun depth does not keep voices dirty', () => {
  const m = asyncCore(), V = m.state.voices;
  const [a, b] = pinned(m, 2);
  m.flush(); m.deliver();
  m.dice();
  m.flush(); m.core.process(128);                        // кубик применён, зеркало с новыми тембрами
  for (let i = 0; i < 6; i++) m.sun(i, 0);               // как кадровый sunStrikes: глубина та же
  m.deliver();                                           // ack: кубик есть, свежих sun нет
  assert.equal(m.busy(), false);
  assert.equal(V[a].wave, m.coreVoice(a).wave);
  assert.equal(V[b].wave, m.coreVoice(b).wave);
});

test('engine: a mirror from the previous core is ignored after rebuild', async () => {
  const { createEngine } = await import('../../worlds/tenebrae/engine.js');
  const synced = [];
  const model = { bind() {}, sync: (m, n) => synced.push(n) };
  const node = () => ({ connect() {}, disconnect() {} });
  const mk = () => { const c = { dry: { [facade.SLOT]: node() }, send() {}, cb: null, listen(f) { c.cb = f; } }; return c; };
  const e = createEngine({ model }), old = mk(), cur = mk();
  e.build(old, node()); e.build(cur, node());
  const d = (n) => ({ n, w: { [facade.SLOT]: { mirror: [], heard: [] } } });
  old.cb(d(7)); cur.cb(d(2));
  assert.deepEqual(synced, [2]);
});
