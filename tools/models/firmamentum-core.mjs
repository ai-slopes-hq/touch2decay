// Фасад модели Firmamentum над t2d.wasm (Node, для тестов): тот же API, что у worlds/firmamentum/model.js, но модель живёт в ядре.
// Касания — action в ядро, состояние — из зеркала (звёзды — живые объекты по id, правятся на месте), события star / fp / ff / fx —
// из разницы зеркал. tick(dt) → process на round(dt·sr) сэмплов кусками ≤ 128.
import { loadT2d } from '../t2d-core.mjs';
import { LIMEN, FX_DEF } from '../../worlds/firmamentum/model.js';

export const SR = 48000, SLOT = 10;                     // мир X — слот 10 в хосте
// свод ядра: place(s) = {x: u, y: −h·K}, комета разгоняет звёзды ближе R (core/worlds/firmamentum/model.hpp);
// на 390×844 одна единица свода по горизонтали — S px (RX · 0.94 у горизонта), так что R·S = 90 px, как было на экране
export const RX = 187, S = RX * 0.94, K = 1.75 / 0.94, R = 90 / S;
export const sky = (s) => ({ x: S * s.u, y: -S * K * s.h });   // свод → px на 390×844: для JS-модели (порог 90 px) и cometAt
export const ACT = { add: 0, close: 1, move: 2, set: 3, fx: 4, clear: 5, dice: 6, launch: 7 };
export const SET_KEYS = ['cyc', 'win', 'mask', 'lvl', 'h', 'u'];
export const FX_KEYS = Object.keys(FX_DEF);             // scintilla, drift, cometa, crepitus, fulgur, spread, hall
const STAR = ['slot', 'id', 'h', 'u', 'cyc', 'win', 'mask', 'lvl', 'dr', 'cm', 'fp', 'ff'];   // поля звезды в зеркале
const NFX = FX_KEYS.length, HEAD = 2 + 7 + NFX + 1;     // time, comets, comet[on, a.h, a.u, b.h, b.u, t0, dur], fx, число звёзд

export function createModel({ seed = 1, scale = null, place = sky } = {}) {
  const core = loadT2d();
  core.init(SR, seed);
  if (scale) core.scale(scale.on, scale.idx, scale.root);
  const stars = [], fx = { ...FX_DEF };
  const state = { stars, fx, comet: null, comets: 0, time: 0 };
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };
  let serial = 0;

  function sync() {                                     // зеркало ядра → state, разница — события
    const m = core.mirror(SLOT);
    state.time = m[0]; state.comets = m[1];
    state.comet = m[2] ? { a: { h: m[3], u: m[4] }, b: { h: m[5], u: m[6] }, t0: m[7], dur: m[8] } : null;
    let fxChanged = false;
    FX_KEYS.forEach((k, i) => { if (fx[k] !== m[9 + i]) { fx[k] = m[9 + i]; fxChanged = true; } });
    const n = m[HEAD - 1], seen = new Map(), next = [];
    for (let i = 0; i < n; i++) {
      const o = m.slice(HEAD + i * STAR.length, HEAD + (i + 1) * STAR.length), id = o[1];
      seen.set(id, o);
    }
    for (const s of stars) if (!seen.has(s.id)) emit({ t: 'star', s, on: false });
    for (const [id, o] of seen) {
      let s = stars.find((q) => q.id === id), added = false;
      if (!s) { s = { id }; added = true; }
      const was = { ...s };
      STAR.forEach((k, i) => { s[k] = o[i]; });
      serial = Math.max(serial, id);
      next.push(s);
      if (added) emit({ t: 'star', s, on: true, added: true });
      else {
        if (SET_KEYS.some((k) => was[k] !== s[k])) emit({ t: 'star', s, on: true });
        if (was.fp !== s.fp) emit({ t: 'fp', s });
        if (was.ff !== s.ff) emit({ t: 'ff', s });
      }
    }
    stars.length = 0; stars.push(...next);
    if (fxChanged) emit({ t: 'fx' });
  }
  const act = (kind, i = 0, a = []) => { core.action(SLOT, kind, i, a); sync(); };
  const live = (s) => s && stars.includes(s);

  function addStar(h, u) {
    const used = new Set(stars.map((s) => s.slot)), slot = [0, 1, 2, 3, 4, 5].find((k) => !used.has(k));
    if (slot == null) return null;
    const id = serial + 1;
    act(ACT.add, 0, [h, u, slot, id]);
    return stars.find((s) => s.id === id) || null;
  }
  function setStar(s, patch) {
    if (!live(s)) return;
    for (const [k, v] of Object.entries(patch)) { const key = SET_KEYS.indexOf(k); if (key >= 0) core.action(SLOT, ACT.set, s.id, [key, v]); }
    sync();
  }
  function setFx(k, v) { const key = FX_KEYS.indexOf(k); if (key >= 0) act(ACT.fx, key, [v]); }
  function loadFx(o) { for (const [k, v] of Object.entries(o)) { const key = FX_KEYS.indexOf(k); if (key >= 0) core.action(SLOT, ACT.fx, key, [v]); } sync(); }
  function tick(dt) {
    let n = Math.round(dt * SR);
    while (n > 0) { const k = Math.min(128, n); core.process(k); n -= k; }
    sync();
  }
  function cometAt(now = state.time) {                  // как у JS-модели: точка на прямой между концами в координатах place
    const c = state.comet;
    if (!c) return null;
    const k = Math.min(1, (now - c.t0) / c.dur), A = place(c.a), B = place(c.b);
    return { k, x: A.x + (B.x - A.x) * k, y: A.y + (B.y - A.y) * k, A, B };
  }
  const own = (s) => { if (!live(s)) throw new Error('fp/ff: not a live star of the core'); return s; };

  sync();
  return {
    state, LIMEN, cometAt, core,
    fp: (s) => own(s).fp, ff: (s) => own(s).ff,        // из зеркала: частоты считает ядро (с ладом хоста)
    addStar, closeStar: (s) => { if (live(s)) act(ACT.close, s.id); }, moveStar: (s, h, u) => { if (live(s)) act(ACT.move, s.id, [h, u]); },
    setStar, setFx, loadFx, clear: () => act(ACT.clear), dice: () => act(ACT.dice), launch: () => act(ACT.launch),
    tick, snapshot: () => core.snapshot(SLOT), restore: (js) => { core.restore(SLOT, js); sync(); },
    sounding: () => stars.length > 0,
    listen(fn) { listeners.push(fn); },
  };
}
