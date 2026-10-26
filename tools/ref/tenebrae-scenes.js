// Сцены сверки звука Tenebrae (мир I): один источник для эталона в Chromium (tools/ref/tenebrae-bus.html + worlds/tenebrae/engine.js),
// нативного core/build/tenebrae-cli (tools/tenebrae-bus.py) и t2d.wasm (tools/test-tenebrae-core.mjs).
// Сцена — { secs, acts: [[t, kind, i, a]] }: действие мира в момент t (с), виды и a — как t2d_action слота 1 (ACT в engine.js).
// Время — на границе блока 128 сэмплов при 48 кГц (q): и страница, и CLI применяют действие в начале блока.
// Коды — те же, что ACT / LINK_TYPES / LFO_KEYS в worlds/tenebrae/engine.js (страница сверяет): импорт движка в Node тянет весь хост.
export const ACT = { VOICE: 0, ON: 1, OFF: 2, LIVE: 3, LINKS: 4, LFO: 5, FX: 6, STRIKE: 7, CLEAR: 8 };
export const LINK_TYPES = ['fm', 'tzfm', 'am', 'rm'];
export const LFO_KEYS = ['pitch', 'wave', 'cut', 'res', 'beat', 'shift', 'amp', 'fm'];

export const SR = 48000;
// поля голоса — порядок a у VOICE (как в app.js); по умолчанию — значения новой планеты модели
export const FIELDS = ['x', 'y', 'cut', 'res', 'wave', 'beat', 'fm', 'shift', 'amp', 'holeT', 'snap'];
const DEF = { x: 0.45, y: 0.35, cut: 0.68, res: 0.21, wave: 0.125, beat: 0.35, fm: 0, shift: 0.5, amp: 1, holeT: 0, snap: 1 };
const FX_APP = [0.3, 0.3, 0.2];                       // fx модели при старте: rev, dly, dirt

const q = (t) => Math.round(t * SR / 128) * 128 / SR;
// shiftHz модели (tone.js), обращённый: положение луча для сдвига hz > 0
const shiftT = (hz) => (1 + 0.04 + 0.96 * Math.log2(hz * 2047 / 1500 + 1) / 11) / 2;

const voice = (i, o = {}) => [0, ACT.VOICE, i, FIELDS.map((k) => (k in o ? o[k] : DEF[k]))];
// новая планета: подключить, поля сразу (snap), огибающая вверх — как app.js
const planet = (i, o) => [[0, ACT.LIVE, i, [1]], voice(i, o), [0, ACT.ON, i, []]];
const fx = (rev, dly, dirt) => [0, ACT.FX, 0, [rev, dly, dirt]];
const at = (t, a) => [q(t), ...a.slice(1)];
const link = (t, dst, src, type, depth) => [q(t), ACT.LINKS, dst, [src, LINK_TYPES.indexOf(type), depth]];
const lfo = (t, i, key, morph, rate, depth) => [q(t), ACT.LFO, i, [LFO_KEYS.indexOf(key), morph, rate, depth]];

const one = (o, secs = 4) => ({ secs, acts: [fx(...FX_APP), ...planet(0, o)] });
const pair = (type) => ({ secs: 4, acts: [fx(...FX_APP), ...planet(0, { x: 0.3, y: 0.3 }), ...planet(1, { x: 0.55, y: 0.3 }), link(0.5, 1, 0, type, 0.5)] });

export const SCENES = {
  one: one({}),
  wave5: one({ wave: 0.5 }),
  wave9: one({ wave: 0.9 }),
  tzfm: pair('tzfm'),
  fm: pair('fm'),
  am: pair('am'),
  rm: pair('rm'),
  shift: one({ shift: shiftT(300) }),
  hole: one({ holeT: 0.7 }),
  lfocut: { secs: 4, acts: [fx(...FX_APP), ...planet(0, {}), lfo(0.5, 0, 'cut', 0.3, 0.7, 0.5)] },
  // 6 голосов по полю, перегруз, дилей и зал выкручены; одна fm-связь и LFO волны
  full: { secs: 6, acts: [fx(0.5, 0.5, 0.6),
    ...[0, 1, 2, 3, 4, 5].flatMap((i) => planet(i, { x: 0.1 + 0.15 * i, y: 0.15 + 0.12 * i, wave: [0.125, 0.3, 0.5, 0.7, 0.9, 0.2][i], beat: 0.2 + 0.5 * i })),
    link(1, 2, 0, 'fm', 0.3), lfo(1.5, 4, 'wave', 0.5, 0.4, 0.3)] },
  tail: { secs: 6, acts: [...one({}).acts, at(1, [0, ACT.OFF, 0, [1.6]])] },
  strike: { secs: 4, acts: [...one({}).acts, at(1, [0, ACT.STRIKE, 0, [0.3]]), at(2, [0, ACT.STRIKE, 0, [1]])] },
};

// stdin для tenebrae-cli: у каждой строки act — все поля, и i тоже (иначе CLI и JS разберут FX по-разному)
export const cliInput = ({ secs, acts }) =>
  `secs ${secs}\n${acts.map(([t, kind, i, a]) => `act ${t} ${kind} ${i}${a.map((v) => ` ${v}`).join('')}\n`).join('')}`;
