// Tenebrae (мир I): модель в ядре, сырой доступ для сверки с эталоном tools/ref/tenebrae-model.js — без фасада.
// Раскладки и коды — как в core/worlds/tenebrae/world.hpp; фасад (worlds/tenebrae/facade.js) держит те же числа.
import { loadT2d } from '../t2d-core.mjs';
import { createModel as facade } from '../../worlds/tenebrae/facade.js';
import { sdkFacade } from './sdk-facade.mjs';

export const SLOT = 1, SR = 48000;
export const MODEL_SEED = 0x4d4f44;
export const LINK_TYPES = ['fm', 'tzfm', 'am', 'rm'];
export const LFO_KEYS = ['pitch', 'wave', 'cut', 'res', 'beat', 'shift', 'amp', 'fm'];
export const SET_KEYS = ['wave', 'cut', 'res', 'beat', 'fm', 'shift', 'amp'];
export const ACT = {
  spawn: 16, grab: 17, letGo: 18, keep: 19, unkeep: 20, move: 21, sun: 22, set: 23, pin: 24, remove: 25, attack: 26, release: 27,
  link: 28, linkDepth: 29, linkType: 30, unlink: 31, lfo: 32, fx: 33, dice: 34, clear: 35, retune: 36,
};
export const MIRROR = { HEAD: 15, VOICE: 62, MODEL_N: 387, SCOPE_V: 129, N: 1161 };
const FIELDS = ['active', 'live', 'pinned', 'held', 'x', 'y', 'beat', 'wave', 'fm', 'cut', 'res', 'shift', 'amp', 'holeT', 'sunT', 'env', 'envT'];
const BOOLS = new Set(['active', 'live', 'pinned']);

export function parseMirror(m) {
  const out = { time: m[1], strikes: m[2], fx: { rev: m[3], decay: m[4], dly: m[5], chaos: m[6], dirt: m[7] }, kept: [], voices: [], scope: [] };
  for (let k = 0; k < m[8]; k++) out.kept.push(m[9 + k]);
  for (let i = 0; i < m[0]; i++) {
    const b = MIRROR.HEAD + i * MIRROR.VOICE, v = { i, mods: [], lfo: {} };
    FIELDS.forEach((f, k) => { v[f] = BOOLS.has(f) ? m[b + k] !== 0 : m[b + k]; });
    for (let k = 0; k < m[b + 17]; k++) {
      const q = b + 18 + 4 * k;
      v.mods.push({ src: m[q], type: LINK_TYPES[m[q + 1]], depth: m[q + 2], auto: m[q + 3] !== 0 });
    }
    LFO_KEYS.forEach((key, k) => { const q = b + 38 + 3 * k; if (m[q + 2] >= 0) v.lfo[key] = { morph: m[q], rate: m[q + 1], depth: m[q + 2] }; });
    out.voices.push(v);
    const s = MIRROR.MODEL_N + i * MIRROR.SCOPE_V;
    out.scope.push(m.length >= MIRROR.N && m[s] ? Float64Array.from(m.slice(s + 1, s + 129)) : null);
  }
  return out;
}

export function parseHeard(h) {
  const out = [];
  for (let k = 0; k < h.length;) {
    if (h[k] === 1) { out.push({ t: 'burst', i: h[k + 1] }); k += 2; }
    else if (h[k] === 2) { out.push({ t: 'strike', i: h[k + 1], p: h[k + 2] }); k += 3; }
    else throw new Error(`heard: код ${h[k]}`);
  }
  return out;
}

export function coreRig(seed) {
  const core = loadT2d();
  core.init(SR, seed);
  return {
    core,
    act(name, i = 0, a = []) {
      if (!(name in ACT)) throw new Error(`act: ${name}`);
      core.action(SLOT, ACT[name], i, a);
    },
    restore: (js) => core.restore(SLOT, js),
    snapshot: () => core.snapshot(SLOT),
    tick(dt) {
      let n = Math.round(dt * SR);
      while (n > 0) { const k = Math.min(128, n); core.process(k); n -= k; }
    },
    state: () => parseMirror(core.mirror(SLOT)),
    events: () => parseHeard(core.heard(SLOT)),
  };
}

// Фасад веба (worlds/tenebrae/facade.js) над ядром в Node: порт и зеркало — sdk-facade.mjs (async: сообщения копятся до flush(), зеркало — по deliver()).
// coreVoice(i) — голос из зеркала ядра сейчас, мимо фасада (для проверки гонок).
const ACTIONS = ['spawn', 'grab', 'letGo', 'keep', 'unkeep', 'move', 'sun', 'set', 'pin', 'remove', 'attack', 'release', 'link', 'linkDepth', 'linkType', 'unlink',
  'lfo', 'fx', 'dice', 'clear', 'retune', 'restore'];
export function createModel({ seed = 1, async = false, ...opts } = {}) {
  const m = sdkFacade(facade, SLOT, ACTIONS, { seed, async, heard: true, ...opts });
  m.coreVoice = (i) => parseMirror(m.mirror()).voices[i];
  return m;
}
