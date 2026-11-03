// Сценарии сверки звука Tenebrae действиями: эталон (tools/ref/tenebrae-model.js → клей кодов 0–8 → ядро) против модели ядра (действия от 16).
// Шаги — формат tools/models/tenebrae-parity.test.mjs; spawn несёт номер голоса последним числом (эталон его проверяет, ядро им пользуется).
// Дополнительно: ['snap'] — запомнить снимок, ['restore'] без аргумента — восстановить запомненный.
import { createModel } from './ref/tenebrae-model.js';
import { loadT2d } from './t2d-core.mjs';
import { seeded } from './models/util.mjs';
import { MODEL_SEED, SET_KEYS, LFO_KEYS, LINK_TYPES, ACT, parseHeard, parseMirror } from './models/tenebrae-core.mjs';

export const SR = 48000, BLOCK = 128, SEED = 12345, SLOT = 1;
const LOW = { VOICE: 0, ON: 1, OFF: 2, LIVE: 3, LINKS: 4, LFO: 5, FX: 6, STRIKE: 7, CLEAR: 8 };
const blocks = (secs) => Math.round(secs * SR / BLOCK);

export const ACTS = {
  pluck: [['spawn', 0.4, 0.4, 0, 0], ['run', 0.3], ['letGo', 0, true], ['run', 3]],
  pinned: [['spawn', 0.2, 0.3, 0, 0], ['spawn', 0.5, 0.5, 0, 1], ['spawn', 0.75, 0.35, 0, 2], ['pin', 0], ['pin', 1], ['pin', 2], ['run', 0.5],
    ['link', 1, 0], ['linkType', 1, 0, 'fm'], ['linkDepth', 1, 0, 0.4], ['link', 2, 1], ['linkType', 2, 1, 'am'], ['linkDepth', 2, 1, 0.6],
    ['link', 0, 2], ['linkType', 0, 2, 'tzfm'], ['linkDepth', 0, 2, 0.3],
    ['lfo', 0, 'cut', { morph: 0.3, rate: 0.7, depth: 0.5 }], ['lfo', 1, 'pitch', { morph: 0.5, rate: 0.4, depth: 0.3 }], ['run', 1.5],
    ['set', 0, 'wave', 0.6], ['set', 1, 'cut', 0.4], ['set', 2, 'beat', 1.5], ['run', 1], ['unlink', 1, 0], ['lfo', 0, 'cut', null], ['run', 1]],
  chaos: [['fx', { chaos: 0.8 }], ['spawn', 0.2, 0.3, 0, 0], ['spawn', 0.5, 0.5, 0, 1], ['spawn', 0.7, 0.4, 0, 2], ['pin', 0], ['pin', 1], ['run', 10]],
  sun: [['spawn', 0.4, 0.4, 0, 0], ['grab', 0], ['sun', 0, 0.8], ['run', 3], ['sun', 0, 0.2], ['run', 1.5], ['letGo', 0, true], ['run', 1]],
  dice: [['spawn', 0.2, 0.3, 0, 0], ['spawn', 0.6, 0.5, 0, 1], ['pin', 0], ['pin', 1], ['dice'], ['run', 1.5], ['dice'], ['run', 1.5], ['retune'], ['run', 1]],
  restore: [['spawn', 0.2, 0.3, 0, 0], ['spawn', 0.6, 0.5, 0, 1], ['pin', 0], ['pin', 1], ['link', 1, 0], ['linkType', 1, 0, 'rm'], ['linkDepth', 1, 0, 0.7],
    ['lfo', 0, 'wave', { morph: 0.2, rate: 1, depth: 0.5 }], ['set', 0, 'cut', 0.45], ['run', 0.5], ['snap'], ['clear'], ['run', 1], ['restore'], ['run', 2]],
  clear: [['spawn', 0.3, 0.3, 0, 0], ['spawn', 0.6, 0.4, 0, 1], ['pin', 0], ['link', 1, 0], ['lfo', 1, 'cut', { morph: 0, rate: 2, depth: 0.4 }], ['run', 1], ['clear'], ['run', 2]],
  hole: [['spawn', 0.3, 0.3, 0.6, 0], ['run', 1.5], ['move', 0, 0.3, 0.3, 0.95], ['run', 3]],
  dirt: [['fx', { dirt: 0.9, rev: 0.8 }], ['spawn', 0.3, 0.4, 0, 0], ['spawn', 0.6, 0.5, 0, 1], ['pin', 0], ['run', 3], ['letGo', 1, true], ['run', 2]],
};

// эталон: шаги → модель-эталон → клей (коды 0–8) → t2d слота 1
export function refPath(steps, { seed = SEED } = {}) {
  const core = loadT2d();
  core.init(SR, seed);
  const send = (kind, i, a) => core.action(SLOT, kind, i, a);
  const glue = {
    voice: (i, v) => send(LOW.VOICE, i, [v.x, v.y, v.cut, v.res, v.wave, v.beat, v.fm, v.shift, v.amp, v.holeT, v.snap ? 1 : 0]),
    on: (i) => send(LOW.ON, i, []), off: (i, tau) => send(LOW.OFF, i, [tau]), live: (i, on) => send(LOW.LIVE, i, [on ? 1 : 0]),
    links: (i, mods) => send(LOW.LINKS, i, mods.flatMap((q) => [q.src, LINK_TYPES.indexOf(q.type), q.depth])),
    lfo: (i, key, sp) => { const c = LFO_KEYS.indexOf(key); if (c >= 0) send(LOW.LFO, i, sp ? [c, sp.morph, sp.rate, sp.depth] : [c, 0, 0, 0]); },
    fx: ({ rev, dly, dirt }) => send(LOW.FX, 0, [rev, dly, dirt]), strike: (p) => send(LOW.STRIKE, 0, [p]), clear: () => send(LOW.CLEAR, 0, []), busEnv() {},
  };
  const model = createModel({ rng: seeded(seed ^ MODEL_SEED), engine: () => glue });
  glue.fx(model.state.fx);                              // как prepare ядра
  const L = [], R = [], heard = [];
  let snap = null, autos = 0;
  steps.forEach((s, n) => {
    const [name, ...a] = s;
    switch (name) {
      case 'run':
        for (let b = 0, m = blocks(a[0]); b < m; b++) {
          model.tick(BLOCK / SR); core.process(BLOCK);
          L.push(Float32Array.from(core.dry(SLOT, 0))); R.push(Float32Array.from(core.dry(SLOT, 1)));
          if (model.state.voices.some((v) => v.mods.some((q) => q.auto))) autos++;
          const e = model.events(); if (e.length) heard.push({ at: L.length, events: e });
        }
        break;
      case 'spawn': if (model.spawn(a[0], a[1], a[2]) !== a[3]) throw new Error(`#${n} spawn: голос ${a[3]} не тот`); break;
      case 'fx': model.fx({ ...model.state.fx, ...a[0] }); break;
      case 'snap': snap = model.snapshot(); break;
      case 'restore': model.restore(a[0] ?? snap); break;
      case 'lfo': model.lfo(a[0], a[1], a[2]); break;
      default: model[name](...a);
    }
  });
  return { L: cat(L), R: cat(R), heard, autos };
}

// ядро: те же шаги → действия от 16
export function corePath(steps, { seed = SEED } = {}) {
  const core = loadT2d();
  core.init(SR, seed);
  const act = (name, i, a) => core.action(SLOT, ACT[name], i, a);
  const L = [], R = [], heard = [];
  let snap = null;
  for (const s of steps) {
    const [name, ...a] = s;
    switch (name) {
      case 'run':
        for (let b = 0, m = blocks(a[0]); b < m; b++) {
          core.process(BLOCK);
          L.push(Float32Array.from(core.dry(SLOT, 0))); R.push(Float32Array.from(core.dry(SLOT, 1)));
          const e = parseHeard(core.heard(SLOT)); if (e.length) heard.push({ at: L.length, events: e });
        }
        break;
      case 'spawn': act('spawn', a[3], [a[0], a[1], a[2]]); break;
      case 'letGo': act('letGo', a[0], [a[1] ? 1 : 0]); break;
      case 'keep': act('keep', 0, a[0]); break;
      case 'set': act('set', a[0], [SET_KEYS.indexOf(a[1]), a[2]]); break;
      case 'lfo': act('lfo', a[0], a[2] ? [LFO_KEYS.indexOf(a[1]), a[2].morph, a[2].rate, a[2].depth] : [LFO_KEYS.indexOf(a[1]), 0, 0, -1]); break;
      case 'linkDepth': act('linkDepth', a[0], [a[1], a[2]]); break;
      case 'linkType': act('linkType', a[0], [a[1], LINK_TYPES.indexOf(a[2])]); break;
      case 'link': case 'unlink': act(name, a[0], [a[1]]); break;
      case 'fx': { const o = { ...parseMirror(core.mirror(SLOT)).fx, ...a[0] }; act('fx', 0, [o.rev, o.decay, o.dly, o.chaos, o.dirt]); break; }
      case 'snap': snap = core.snapshot(SLOT); break;
      case 'restore': core.restore(SLOT, a[0] ?? snap); break;
      case 'dice': case 'clear': case 'unkeep': case 'retune': act(name, 0, []); break;
      case 'sun': act('sun', a[0], [a[1]]); break;
      case 'move': act('move', a[0], a.slice(1)); break;
      case 'release': act('release', a[0], [a[1]]); break;
      default: act(name, a[0], []);                     // grab, pin, remove, attack
    }
  }
  return { L: cat(L), R: cat(R), heard };
}
function cat(list) { const o = new Float32Array(list.length * BLOCK); list.forEach((b, k) => o.set(b, k * BLOCK)); return o; }
