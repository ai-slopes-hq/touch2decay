// Goetia — фасад модели. Сама модель живёт в ядре (core/worlds/goetia → t2d.wasm, узел t2d-worklet.js хоста, слот 15), здесь — её
// зеркало и действия касаний. API — прежней JS-модели (эталон — tools/ref/goetia-model.js), без DOM, холста и Web Audio:
// state.spirits — живые объекты по born (порядок призыва — id духа; view держит ссылку на рисуемого духа), правятся на месте из зеркала.
// Действия применяются к state сразу (summon — синхронно: слот — первый свободный, как в ядре, born — свой) и уходят в ядро через send
// (порт узла ядра, асинхронно; send → номер сообщения). Зеркало (sync) приходит ~60 раз в секунду с числом уже применённых ядром
// сообщений: поля духа, которые здесь правили, а ядро ещё не видело, зеркало не перетирает; призванного здесь, ещё не дошедшего, —
// не убирает; изгнанного здесь — не возвращает (как фасад Firmamentum). clear, restore и кубик — целиком здесь (кубик — алгоритм эталона
// на rng) и в ядро: restore — одним сообщением со слотами и born. Счётчик t и громкость духа — только из зеркала (t, gain).
// Чистые функции печати (NODES, имя духа, программа, формула) — здесь же: их берут view и тесты.
// События listen — из действий и разницы зеркал: { t: 'spirit', s, on, added? }, 'fx'.
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

// ядро: слот мира в хосте, коды action, ключи set и fx, раскладка зеркала — core/worlds/goetia/world.hpp
export const SLOT = 15, SEAL_MAX = 8;
export const ACT = { summon: 0, path: 1, banish: 2, set: 3, fx: 4, clear: 5, dice: 6, sett: 7 };
export const SET_KEYS = ['semi', 'tone', 'rel', 'legio', 'lvl'];
export const FX_KEYS = Object.keys(FX_DEF);             // legio, echo, spread, hall
export const MSPIRIT = ['slot', 'born', 'semi', 'tone', 'rel', 'legio', 'lvl', 'np', ...Array.from({ length: SEAL_MAX }, (_, k) => `p${k}`), 't', 'gain'];   // дух в зеркале
export const HEAD = FX_KEYS.length + 1;                 // fx, число духов
const OWN = ['slot', 'semi', 'tone', 'rel', 'legio', 'lvl'];   // поля, которые правит фасад (и path); t и gain — только ядро

export function createModel({ scale = { on: false, snap: (s) => s }, rng = Math.random, send = () => 0 } = {}) {
  const spirits = [];                                   // {slot, path [узлы], semi, tone, rel, legio, lvl, born, t, gain}
  const fx = { ...FX_DEF };
  const state = { spirits, fx, time: 0 };
  let bornSeq = 0;                                      // порядок призыва — кто старше (born растёт строго)
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };
  let post = send;
  const dirty = new Map(), gone = new Map();            // born → номер сообщения: духа правили / изгнали здесь, ядро ещё не видело
  let wipe = 0, fxAt = 0;
  const act = (kind, i = 0, a = []) => post({ t: 'action', slot: SLOT, kind, i, a });
  const live = (s) => !!s && spirits.includes(s);

  const semi = (s) => (scale.on ? scale.snap(s.semi + 24) - 24 : s.semi);
  const rate = (s) => 128 * 55 * 2 ** (semi(s) / 12);  // semi 0 — 7 040 отсчётов t в секунду

  function make(path, opt) {                            // новый дух здесь: первый свободный треугольник, свой born
    const used = new Set(spirits.map((s) => s.slot)), slot = [...Array(SMAX).keys()].find((k) => !used.has(k));
    const s = { slot, path: [...path].slice(0, SEAL_MAX), semi: 0, tone: 0.45, rel: 1, legio: 1, lvl: 0.8, born: ++bornSeq, t: 0, gain: 0, ...opt };
    spirits.push(s);
    return s;
  }
  function summon(path, opt = {}) {                     // дух в свободный треугольник; все заняты — уходит самый старый
    if (spirits.length >= SMAX) banish(spirits.reduce((a, b) => (a.born < b.born ? a : b)));
    const s = make(path, opt);
    dirty.set(s.born, act(ACT.summon, 0, [s.slot, s.born, s.semi, s.tone, s.rel, s.legio, s.lvl, ...s.path]));
    emit({ t: 'spirit', s, on: true, added: true });
    return s;
  }
  function banish(s) {
    if (!live(s)) return;
    emit({ t: 'spirit', s, on: false });
    spirits.splice(spirits.indexOf(s), 1); dirty.delete(s.born);
    gone.set(s.born, act(ACT.banish, s.born));
  }
  function setSpirit(s, patch) {
    if (!live(s)) return;
    Object.assign(s, patch);
    let q = 0;
    if (patch.path) { s.path = [...patch.path].slice(0, SEAL_MAX); q = act(ACT.path, s.born, s.path); }
    for (const k of SET_KEYS) if (patch[k] != null) q = act(ACT.set, s.born, [SET_KEYS.indexOf(k), patch[k]]);
    if (q) dirty.set(s.born, q);
    emit({ t: 'spirit', s, on: true });
  }
  function setFx(k, v) { const i = FX_KEYS.indexOf(k); if (i < 0) return; fx[k] = v; fxAt = act(ACT.fx, i, [v]); emit({ t: 'fx' }); }
  function loadFx(o) { for (const [k, v] of Object.entries(o || {})) { const i = FX_KEYS.indexOf(k); if (i >= 0) { fx[k] = v; fxAt = act(ACT.fx, i, [v]); } } emit({ t: 'fx' }); }
  function dropAll() { const was = spirits.splice(0); dirty.clear(); gone.clear(); for (const s of was) emit({ t: 'spirit', s, on: false }); }
  function clear() { dropAll(); wipe = act(ACT.clear); }
  function tick(dt) { state.time += dt; }

  const scene = () => JSON.stringify({ s: spirits.map(({ slot, path, semi: se, tone, rel, legio, lvl, born }) => ({ slot, path, semi: se, tone, rel, legio, lvl, born })), fx });
  function replace(list, fo) {                          // сцена целиком: здесь — сразу, в ядро — одним restore со слотами и born
    dropAll();
    for (const q of list.slice(0, SMAX)) make(q.path || [], { semi: q.semi, tone: q.tone, rel: q.rel != null ? q.rel : 1, legio: q.legio, lvl: q.lvl });
    if (fo) Object.assign(fx, fo);
    wipe = fxAt = post({ t: 'restore', slot: SLOT, js: scene() });
    for (const s of spirits) emit({ t: 'spirit', s, on: true, added: true });
    emit({ t: 'fx' });
  }
  function dice() {                                     // два-три духа: случайные печати, высоты — кварта/квинта/октава от тоники; половина — удары
    const R = rng, list = [];
    const n = 2 + (R() < 0.4 ? 1 : 0), SEMIS = [-12, -5, 0, 0, 7, 12];
    for (let k = 0; k < n; k++) list.push({ path: randPath(R), semi: SEMIS[Math.floor(R() * SEMIS.length)], tone: 0.3 + R() * 0.3, rel: R() < 0.5 ? 1 : 0.1 + R() * 0.55, legio: R() < 0.5 ? 1 : 2, lvl: 0.7 });
    replace(list);
  }
  const snapshot = () => JSON.stringify({ s: spirits.map(({ slot, path, semi: se, tone, rel, legio, lvl }) => ({ slot, path, semi: se, tone, rel, legio, lvl })), fx });
  function restore(js) { const st = JSON.parse(js); replace(st.s || [], st.fx); }

  function sync(m, applied) {                           // зеркало ядра → state; applied — сколько сообщений ядро уже применило
    if (applied >= fxAt) {
      let changed = false;
      FX_KEYS.forEach((k, i) => { if (fx[k] !== m[i]) { fx[k] = m[i]; changed = true; } });
      if (changed) emit({ t: 'fx' });
    }
    if (applied < wipe) return;                         // ядро ещё до последней сцены целиком — духи в зеркале старые
    for (const [b, q] of dirty) if (q <= applied) dirty.delete(b);
    for (const [b, q] of gone) if (q <= applied) gone.delete(b);
    const byBorn = new Map(spirits.map((s) => [s.born, s])), next = [], ev = [], NS = MSPIRIT.length;
    const at = (o, k) => m[o + MSPIRIT.indexOf(k)];
    for (let i = 0; i < m[HEAD - 1]; i++) {
      const o = HEAD + i * NS, born = at(o, 'born');
      if (gone.has(born)) continue;                     // изгнан здесь — ядро ещё не видело
      let s = byBorn.get(born);
      const added = !s;
      if (added) s = { born };
      byBorn.delete(born);
      const was = added ? null : [...OWN.map((k) => s[k]), s.path.join()];
      if (!dirty.has(born)) {                           // свои правки в пути — поля не трогаем
        for (const k of OWN) s[k] = at(o, k);
        s.path = Array.from({ length: at(o, 'np') }, (_, q) => at(o, `p${q}`));
      }
      s.t = at(o, 't'); s.gain = at(o, 'gain');
      bornSeq = Math.max(bornSeq, born);
      next.push(s);
      if (added) ev.push({ t: 'spirit', s, on: true, added: true });
      else if ([...OWN.map((k) => s[k]), s.path.join()].some((x, j) => x !== was[j])) ev.push({ t: 'spirit', s, on: true });
    }
    for (const s of byBorn.values()) {                  // в зеркале нет
      if (dirty.has(s.born)) next.push(s);              // призван здесь, ядро ещё не видело
      else ev.push({ t: 'spirit', s, on: false });      // изгнало ядро
    }
    spirits.length = 0; spirits.push(...next);
    for (const e of ev) emit(e);
  }
  function bind(fn) {                                   // новый узел ядра (новый контекст): счёт сообщений — заново, сцена — туда целиком
    post = fn; dirty.clear(); gone.clear();
    wipe = fxAt = post({ t: 'restore', slot: SLOT, js: scene() });
  }

  return {
    state, semi, rate,
    summon, banish, setSpirit, setFx, loadFx, clear, dice,
    tick, snapshot, restore, sounding: () => spirits.length > 0,
    listen(fn) { listeners.push(fn); },
    sync, bind,
    sett(slot, t) { act(ACT.sett, slot, [t]); },        // для тестов: стартовое t голоса
  };
}
