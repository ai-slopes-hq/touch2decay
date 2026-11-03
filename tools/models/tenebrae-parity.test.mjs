// Tenebrae: модель ядра C++ против эталона tools/ref/tenebrae-model.js (копия model.js шага Б) — одни шаги, одно зерно.
// После каждого шага: все поля голосов, связи, LFO, fx, kept, time, strikes — до 1e-9; события вида (burst, strike) — те же; в конце
// сценария снимок — одна и та же строка. Звук не проверяется (engine эталона — заглушка, чтобы live и snap шли как в вебе).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel } from '../ref/tenebrae-model.js';
import { seeded, near } from './util.mjs';
import { MODEL_SEED, SR, LINK_TYPES, LFO_KEYS, SET_KEYS, MIRROR, coreRig } from './tenebrae-core.mjs';

const stub = { live() {}, on() {}, off() {}, lfo() {}, links() {}, voice() {}, fx() {}, strike() {}, busEnv() {}, clear() {} };
const BLOCK = 128, DT = BLOCK / SR;
const VF = ['x', 'y', 'beat', 'wave', 'fm', 'cut', 'res', 'shift', 'amp', 'holeT', 'sunT', 'env', 'envT'];
const code = (list, key) => { const k = list.indexOf(key); return k < 0 ? 99 : k; };   // чужой ключ — код, который ядро не знает

function rig(seed) {
  const ref = createModel({ rng: seeded(seed ^ MODEL_SEED), engine: () => stub });
  const core = coreRig(seed);
  const seen = { auto: false, burst: 0, strike: 0, pinned: 0, lfo: 0 };
  const eq = (a, b, what) => assert.ok(near(a, b), `${what}: эталон ${a}, ядро ${b}`);

  function same(at) {
    const r = ref.state, c = core.state();
    eq(r.time, c.time, `${at} time`); assert.equal(r.strikes, c.strikes, `${at} strikes`);
    for (const k of Object.keys(r.fx)) eq(r.fx[k], c.fx[k], `${at} fx.${k}`);
    assert.deepEqual(c.kept, r.kept, `${at} kept`);
    r.voices.forEach((v, i) => {
      const w = c.voices[i], t = `${at} voice ${i}`;
      for (const f of ['active', 'live', 'pinned']) assert.equal(w[f], v[f], `${t} ${f}`);
      assert.equal(w.held, v.held, `${t} held`);
      for (const f of VF) eq(v[f], w[f], `${t} ${f}`);
      assert.equal(w.mods.length, v.mods.length, `${t} mods`);
      v.mods.forEach((m, k) => {
        assert.equal(w.mods[k].src, m.src, `${t} mod ${k} src`); assert.equal(w.mods[k].type, m.type, `${t} mod ${k} type`);
        assert.equal(w.mods[k].auto, !!m.auto, `${t} mod ${k} auto`); eq(m.depth, w.mods[k].depth, `${t} mod ${k} depth`);
        if (m.auto) seen.auto = true;
      });
      assert.deepEqual(Object.keys(w.lfo).sort(), Object.keys(v.lfo).sort(), `${t} lfo keys`);
      for (const [key, sp] of Object.entries(v.lfo)) for (const f of ['morph', 'rate', 'depth']) eq(sp[f], w.lfo[key][f], `${t} lfo ${key}.${f}`);
    });
    seen.pinned = Math.max(seen.pinned, r.voices.filter((v) => v.pinned).length); seen.lfo = Math.max(seen.lfo, ...r.voices.map((v) => Object.keys(v.lfo).length));
    const re = ref.events(), ce = core.events();
    for (const e of re) seen[e.t]++;
    assert.equal(ce.length, re.length, `${at} events`);
    re.forEach((e, k) => { assert.equal(ce[k].t, e.t); assert.equal(ce[k].i, e.i); if (e.t === 'strike') eq(e.p, ce[k].p, `${at} strike p`); });
  }

  function step(s, n) {
    const [name, ...a] = s, at = `#${n} ${JSON.stringify(s)}`;
    switch (name) {
      case 'spawn': { const i = ref.spawn(...a); if (i >= 0) core.act('spawn', i, a); break; }
      case 'run': for (let k = 0, m = Math.round(a[0] * SR / BLOCK); k < m; k++) { ref.tick(DT); core.tick(DT); same(`${at} +${k}`); } return;
      case 'letGo': ref.letGo(a[0], a[1]); core.act('letGo', a[0], [a[1] ? 1 : 0]); break;
      case 'keep': ref.keep(a[0]); core.act('keep', 0, a[0]); break;
      case 'set': ref.set(a[0], a[1], a[2]); core.act('set', a[0], [code(SET_KEYS, a[1]), a[2]]); break;
      case 'pin': ref.pin(a[0]); core.act('pin', a[0]); break;
      case 'lfo': ref.lfo(a[0], a[1], a[2]); core.act('lfo', a[0], a[2] ? [code(LFO_KEYS, a[1]), a[2].morph, a[2].rate, a[2].depth] : [code(LFO_KEYS, a[1]), 0, 0, -1]); break;
      case 'linkDepth': ref.linkDepth(a[0], a[1], a[2]); core.act('linkDepth', a[0], [a[1], a[2]]); break;
      case 'linkType': ref.linkType(a[0], a[1], a[2]); core.act('linkType', a[0], [a[1], LINK_TYPES.indexOf(a[2])]); break;
      case 'link': case 'unlink': ref[name](a[0], a[1]); core.act(name, a[0], [a[1]]); break;
      case 'fx': { const o = { ...ref.state.fx, ...a[0] }; ref.fx(o); core.act('fx', 0, [o.rev, o.decay, o.dly, o.chaos, o.dirt]); break; }
      case 'restore': { const js = a[0] ?? ref.snapshot(); ref.restore(js); core.restore(js); break; }
      case 'dice': case 'clear': case 'unkeep': case 'retune': ref[name](); core.act(name); break;
      case 'grab': case 'remove': case 'attack': ref[name](a[0]); core.act(name, a[0]); break;
      case 'move': ref.move(...a); core.act('move', a[0], a.slice(1)); break;
      case 'sun': ref.sun(...a); core.act('sun', a[0], [a[1]]); break;
      case 'release': ref.release(...a); core.act('release', a[0], [a[1]]); break;
      default: throw new Error(name);
    }
    same(at);
  }
  return {
    ref, core, seen,
    play(steps) { steps.forEach(step); assert.equal(core.snapshot(), ref.snapshot(), 'snapshot'); },
  };
}

test('pin cycle, full, keep and unkeep', () => {
  const r = rig(1);
  r.play([['spawn', 0.2, 0.3, 0], ['spawn', 0.4, 0.5, 0], ['spawn', 0.6, 0.2, 0], ['run', 0.3],
    ['pin', 0], ['pin', 1], ['pin', 2], ['spawn', 0.5, 0.5, 0], ['pin', 3], ['pin', 0], ['pin', 0],
    ['keep', [3]], ['letGo', 3, true], ['unkeep'], ['run', 3]]);
  assert.equal(r.ref.state.voices.filter((v) => v.pinned).length, 3);
  assert.equal(r.ref.state.voices[3].pinned, false);
});

test('chaos and death', () => {
  const r = rig(2);
  r.play([['fx', { chaos: 0.8 }], ['spawn', 0.2, 0.3, 0], ['spawn', 0.5, 0.5, 0], ['spawn', 0.7, 0.4, 0], ['run', 12]]);
  assert.ok(r.seen.auto, 'авто-связи были');
});

test('sun strikes', () => {
  const r = rig(3);
  r.play([['spawn', 0.4, 0.4, 0], ['grab', 0], ['sun', 0, 0.8], ['run', 3]]);
  assert.ok(r.ref.state.strikes > 3);
});

test('dice, snapshot, restore, clear', () => {
  const r = rig(4);
  r.play([['spawn', 0.2, 0.3, 0], ['spawn', 0.6, 0.5, 0], ['pin', 0], ['pin', 1], ['link', 0, 1], ['linkType', 0, 1, 'rm'], ['linkDepth', 0, 1, 0.7],
    ['lfo', 1, 'cut', { morph: 0.3, rate: 2, depth: 0.5 }], ['run', 0.5], ['dice'], ['run', 0.3]]);
  const js = r.ref.snapshot();
  r.play([['clear'], ['run', 0.5], ['restore', js], ['run', 0.3], ['clear'], ['run', 1]]);
});

test('hole death', () => {
  const r = rig(5);
  r.play([['spawn', 0.3, 0.3, 0], ['move', 0, 0.3, 0.3, 0.95], ['run', 4]]);
  assert.equal(r.ref.state.voices[0].active, false);
});

test('snapshot string equals the reference', () => {
  const r = rig(6);
  r.play([['spawn', 0.2, 0.3, 0], ['spawn', 0.6, 0.5, 0], ['pin', 0], ['lfo', 0, 'cut', { morph: 0.1, rate: 3, depth: 0.4 }], ['lfo', 0, 'pitch', { morph: 0.5, rate: 0.07, depth: 0.2 }],
    ['set', 0, 'cut', 0.123456], ['link', 0, 1], ['link', 1, 0], ['run', 0.2]]);
  const js = r.core.snapshot();
  assert.ok(js.includes('"cut":0.1235'), js);
  assert.ok(js.indexOf('"cut":{') < js.indexOf('"pitch":{'), 'порядок LFO — порядок добавления');
  assert.ok(js.includes('"mods":[]'), js);
});

test('fuzz 600 seeded steps', () => {
  const r = rig(7), R = seeded(7);
  const vi = () => Math.floor(R() * 6), f = () => R();
  const keys = [...SET_KEYS, 'foo'], lkeys = [...LFO_KEYS, 'bar'];
  const steps = [];
  for (let n = 0; n < 600; n++) {
    const d = Math.floor(R() * 100);
    if (d < 10) steps.push(['spawn', f(), f(), R() < 0.15 ? 0.95 : 0]);
    else if (d < 16) steps.push(['grab', vi()]);
    else if (d < 21) steps.push(['letGo', vi(), R() < 0.7]);
    else if (d < 24) steps.push(['keep', [0, 1, 2, 3, 4, 5].filter(() => R() < 0.4)]);
    else if (d < 27) steps.push(['unkeep']);
    else if (d < 33) steps.push(['move', vi(), f(), f(), R() < 0.1 ? 0.95 : f() * 0.8]);
    else if (d < 36) steps.push(['sun', vi(), R() < 0.3 ? 0 : f()]);
    else if (d < 42) steps.push(['set', vi(), keys[Math.floor(R() * keys.length)], f()]);
    else if (d < 47) steps.push(['pin', vi()]);
    else if (d < 49) steps.push(['remove', vi()]);
    else if (d < 51) steps.push(['attack', vi()]);
    else if (d < 54) steps.push(['release', vi(), 0.1 + f()]);
    else if (d < 60) { const a = vi(); steps.push(['link', a, (a + 1 + Math.floor(R() * 5)) % 6]); }
    else if (d < 63) { const a = vi(); steps.push(['linkDepth', a, (a + 1 + Math.floor(R() * 5)) % 6, f()]); }
    else if (d < 65) { const a = vi(); steps.push(['linkType', a, (a + 1 + Math.floor(R() * 5)) % 6, LINK_TYPES[Math.floor(R() * 4)]]); }
    else if (d < 67) { const a = vi(); steps.push(['unlink', a, (a + 1 + Math.floor(R() * 5)) % 6]); }
    else if (d < 73) steps.push(['lfo', vi(), lkeys[Math.floor(R() * lkeys.length)], R() < 0.25 ? null : { morph: f(), rate: 0.1 + 10 * f(), depth: f() }]);
    else if (d < 77) steps.push(['fx', R() < 0.5 ? { chaos: R() < 0.3 ? 0 : f() } : { rev: f(), decay: 1 + 5 * f(), dly: f(), dirt: f() }]);
    else if (d < 79) steps.push(['dice']);
    else if (d < 80) steps.push(['clear']);
    else if (d < 81) steps.push(['retune']);
    else if (d < 83) steps.push(['restore']);               // снимок берётся на лету
    else steps.push(['run', 0.02 + 0.5 * f()]);
  }
  r.play(steps);
  assert.ok(r.seen.auto && r.seen.burst > 5 && r.seen.strike > 0 && r.seen.pinned >= 2 && r.seen.lfo >= 1, JSON.stringify(r.seen));
});

test('fuzz with restore', () => {
  const r = rig(8), R = seeded(8);
  r.play([['fx', { chaos: 0.5 }]]);
  for (let n = 0; n < 12; n++) {
    r.play([['spawn', R(), R(), 0], ['spawn', R(), R(), 0], ['pin', Math.floor(R() * 6)], ['lfo', 0, 'wave', { morph: R(), rate: 1, depth: 0.5 }], ['run', 0.4], ['restore', r.ref.snapshot()], ['run', 0.2]]);
  }
});

test('mirror length', () => {
  const r = rig(9);
  assert.equal(r.core.core.mirror(1).length, MIRROR.MODEL_N);
  r.play([['spawn', 0.4, 0.4, 0], ['run', 0.1]]);
  assert.equal(r.core.core.mirror(1).length, MIRROR.N);
  assert.ok(r.core.state().scope[0].some((x) => x !== 0), 'контур есть');
});
