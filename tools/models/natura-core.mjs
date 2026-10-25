// Фасад модели Natura (worlds/natura/model.js) над t2d.wasm в Node — см. sdk-facade.mjs. После каждого действия сверяет сцену ядра (зеркало)
// со state фасада: bpm, len, fx, кувшинки по местам (note, wave, glide, chance, свои значения).
import assert from 'node:assert/strict';
import { createModel as facade, SLOT, ACT, FX_KEYS, LOCKS, NPAD, MIRROR_HEAD, MIRROR_PAD, MIRROR_N } from '../../worlds/natura/model.js';
import { sdkFacade } from './sdk-facade.mjs';

export { SLOT, ACT };
export const ACTIONS = ['play', 'setBpm', 'setFx', 'loadFx', 'setScene', 'hear', 'plant', 'remove', 'movePad', 'setNote', 'setLen', 'glide', 'setWave', 'setChance', 'setLock',
  'resetPad', 'pickWave', 'skiff', 'shakeBy', 'scatter', 'croak', 'scare', 'dice', 'clear', 'restore'];

// кувшинка в сравнимом виде: пустой glide / chance 1 / нет своих значений — одно и то же
export const norm = (pd) => (pd ? { note: pd.note, wave: pd.wave, glide: !!pd.glide, chance: pd.chance ?? 1, lock: Object.fromEntries(LOCKS.filter((k) => pd.lock && pd.lock[k] != null).map((k) => [k, pd.lock[k]])) } : null);
export const sceneState = (S) => ({ bpm: S.seq.bpm, len: S.pads.len, fx: Object.fromEntries(FX_KEYS.map((k) => [k, S.fx[k]])), at: S.pads.at.map(norm) });

export function sceneOf(x) {                           // зеркало ядра → сцена, как sceneState
  const fx = Object.fromEntries(FX_KEYS.map((k, i) => [k, x[7 + i]])), at = [];
  for (let i = 0; i < NPAD; i++) {
    const o = MIRROR_HEAD + i * MIRROR_PAD;
    at.push(x[o] === 0 ? null : { note: x[o + 1], wave: x[o + 2], glide: x[o + 3] !== 0, chance: x[o + 4] < 0 ? 1 : x[o + 4], lock: Object.fromEntries(LOCKS.map((k, l) => [k, x[o + 5 + l]]).filter(([, v]) => v >= 0)) });
  }
  return { bpm: x[4], len: x[5], fx, at, step: x[0], playing: x[1] !== 0, voices: x[2], shake: x[6] };
}

export function agreeScenes(a, b, what = '') {         // a, b — { bpm, len, fx, at }
  assert.equal(a.bpm, b.bpm, `${what}: bpm`); assert.equal(a.len, b.len, `${what}: len`);
  for (const k of FX_KEYS) assert.ok(Math.abs(a.fx[k] - b.fx[k]) < 1e-12, `${what}: fx.${k} ${a.fx[k]} vs ${b.fx[k]}`);
  for (let i = 0; i < NPAD; i++) {
    const p = a.at[i], q = b.at[i];
    assert.equal(!!p, !!q, `${what}: место ${i}: ${JSON.stringify(p)} vs ${JSON.stringify(q)}`);
    if (!p) continue;
    for (const k of ['note', 'wave', 'glide']) assert.equal(p[k], q[k], `${what}: место ${i}.${k}`);
    assert.ok(Math.abs(p.chance - q.chance) < 1e-12, `${what}: место ${i}.chance ${p.chance} vs ${q.chance}`);
    assert.deepEqual(Object.keys(p.lock).sort(), Object.keys(q.lock).sort(), `${what}: место ${i}.lock`);
    for (const k of Object.keys(p.lock)) assert.ok(Math.abs(p.lock[k] - q.lock[k]) < 1e-12, `${what}: место ${i}.lock.${k}`);
  }
}

export function createModel(opts = {}) {
  const { check = true, ...rest } = opts;
  const m = sdkFacade(facade, SLOT, ACTIONS, rest);
  m.coreScene = () => sceneOf(m.mirror());
  m.agree = (what = '') => {                           // state фасада = сцена ядра
    const x = m.mirror();
    assert.equal(x.length, MIRROR_N, 'зеркало ядра');
    agreeScenes(sceneOf(x), sceneState(m.state), what);
  };
  if (check) for (const k of ACTIONS) { const f = m[k]; m[k] = (...a) => { const r = f(...a); m.agree(k); return r; }; }
  return m;
}
