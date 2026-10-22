// Goetia — модель: восемь знаков круга, печать (путь от знака к знаку) → программа bytebeat, духи в треугольниках (до трёх), общие FX.
// Только данные и алгоритм — без DOM, холста и Web Audio. Время — секунды (tick(dt)), случайность — rng, лад — scale { on, snap }.
// Что должно прозвучать — события слушателям (listen): { t: 'spirit', s, on, added? } — дух целиком (печать, высота, тон…), 'fx'.
export const SMAX = 3, PMAX = 8;
// узлы по кругу от верха по часовой: знак (как соединяется с набранным) и сдвиг члена t >> s
export const NODES = [['|', 8], ['&', 5], ['^', 10], ['+', 6], ['*', 11], ['-', 4], ['%', 9], ['>', 7]].map(([op, s]) => ({ op, s }));
const OPTXT = { '|': '|', '&': '&', '^': '^', '+': '+', '*': '*', '-': '-', '%': '%', '>': '>>' };
const RANK = { R: 'rex', D: 'dux', P: 'princeps', M: 'marchio', S: 'praeses', C: 'comes', E: 'eques' };
export const SPIRITS = ('Bael R,Agares D,Vassago P,Samigina M,Marbas S,Valefor D,Amon M,Barbatos D,Paimon R,Buer S,Gusion D,Sitri P,Beleth R,Leraje M,Eligos D,Zepar D,' +
  'Botis S,Bathin D,Sallos D,Purson R,Marax C,Ipos C,Aim D,Naberius M,Glasya-Labolas S,Bune D,Ronove M,Berith D,Astaroth D,Forneus M,Foras S,Asmoday R,' +
  'Gaap S,Furfur C,Marchosias M,Stolas P,Phenex M,Halphas C,Malphas S,Raum C,Focalor D,Vepar D,Sabnock M,Shax M,Vine R,Bifrons C,Vual D,Haagenti S,' +
  'Crocell D,Furcas E,Balam R,Alloces D,Camio S,Murmur D,Orobas P,Gremory D,Ose S,Amy S,Oriax M,Vapula D,Zagan R,Volac S,Andras M,Haures D,' +
  'Andrealphus M,Cimejes M,Amdusias D,Belial R,Decarabia M,Seere P,Dantalion D,Andromalius C').split(',').map((q) => { const [n, r] = q.split(' '); return { name: n, rank: RANK[r] }; });
export const FX_DEF = { legio: 0.35, echo: 0.2, spread: 0.6, hall: 0.4 };

export const numOf = (path) => 1 + (path.reduce((h, k) => (h * 8 + k + 1) % 7919, path.length * 13) % 72);   // печать сама называет духа
export const spiritOf = (s) => SPIRITS[numOf(s.path) - 1];
export const progOf = (path) => path.map((k) => [NODES[k].op, NODES[k].s]);   // программа worklet: [[знак, сдвиг], …] — свёртка слева
export const trigOf = (s) => Math.max(9, ...s.path.map((k) => NODES[k].s));   // удар — по самому медленному члену (не чаще, чем бит IX): четыре удара на круг огонька
export const fcOf = (s) => 250 * (12000 / 250) ** s.tone;
export function formula(path) {                         // как её читать: свёртка слева, t·(…) & 255
  if (!path.length) return '';
  let str = `t>>${NODES[path[0]].s}`;
  for (let i = 1; i < path.length; i++) { const n = NODES[path[i]], term = n.op === '>' ? `(t>>${n.s}&7)` : '+-*%'.includes(n.op) ? `(t>>${n.s})` : `t>>${n.s}`; str = `${i > 1 ? `(${str})` : str}${OPTXT[n.op]}${term}`; }
  return `t*(${str})`;
}
export function randPath(R) {                           // печать: 3–5 узлов, без повторов подряд
  const n = 3 + Math.floor(R() * 3), p = [Math.floor(R() * 8)];
  while (p.length < n) { const k = Math.floor(R() * 8); if (k !== p[p.length - 1] && !p.includes(k)) p.push(k); }
  return p;
}

export function createModel({ scale = { on: false, snap: (s) => s }, rng = Math.random } = {}) {
  const spirits = [];                                   // {slot, path [узлы], semi, tone, rel, legio, lvl, born}
  const fx = { ...FX_DEF };
  const state = { spirits, fx, time: 0 };
  let bornSeq = 0;                                      // порядок призыва — кто старше (born растёт строго)
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };

  const semi = (s) => (scale.on ? scale.snap(s.semi + 24) - 24 : s.semi);
  const rate = (s) => 128 * 55 * 2 ** (semi(s) / 12);  // semi 0 — 7 040 отсчётов t в секунду

  function summon(path, opt = {}) {                     // дух в свободный треугольник; все заняты — уходит самый старый
    const used = new Set(spirits.map((s) => s.slot));
    let slot = [...Array(SMAX).keys()].find((k) => !used.has(k));
    if (slot == null) { const old = spirits.reduce((a, b) => (a.born < b.born ? a : b)); slot = old.slot; banish(old); }
    const s = { slot, path: [...path], semi: 0, tone: 0.45, rel: 1, legio: 1, lvl: 0.8, born: ++bornSeq, ...opt };
    spirits.push(s); emit({ t: 'spirit', s, on: true, added: true });
    return s;
  }
  function banish(s) { emit({ t: 'spirit', s, on: false }); spirits.splice(spirits.indexOf(s), 1); }
  function setSpirit(s, patch) { if (!spirits.includes(s)) return; Object.assign(s, patch); emit({ t: 'spirit', s, on: true }); }
  function setFx(k, v) { fx[k] = v; emit({ t: 'fx' }); }
  function loadFx(o) { Object.assign(fx, o); emit({ t: 'fx' }); }
  function clear() { while (spirits.length) banish(spirits[0]); }
  function tick(dt) { state.time += dt; }

  function dice() {                                     // два-три духа: случайные печати, высоты — кварта/квинта/октава от тоники; половина — удары
    const R = rng;
    clear();
    const n = 2 + (R() < 0.4 ? 1 : 0), SEMIS = [-12, -5, 0, 0, 7, 12];
    for (let k = 0; k < n; k++) summon(randPath(R), { semi: SEMIS[Math.floor(R() * SEMIS.length)], tone: 0.3 + R() * 0.3, rel: R() < 0.5 ? 1 : 0.1 + R() * 0.55, legio: R() < 0.5 ? 1 : 2, lvl: 0.7 });
  }
  const snapshot = () => JSON.stringify({ s: spirits.map(({ slot, path, semi, tone, rel, legio, lvl }) => ({ slot, path, semi, tone, rel, legio, lvl })), fx });
  function restore(js) {
    const st = JSON.parse(js);
    clear();
    for (const q of st.s) summon(q.path, { semi: q.semi, tone: q.tone, rel: q.rel != null ? q.rel : 1, legio: q.legio, lvl: q.lvl });
    loadFx(st.fx);
  }

  return {
    state, semi, rate,
    summon, banish, setSpirit, setFx, loadFx, clear, dice,
    tick, snapshot, restore, sounding: () => spirits.length > 0,
    listen(fn) { listeners.push(fn); },
  };
}
