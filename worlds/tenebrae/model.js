// Tenebrae (мир I) — модель: кружки (голоса), пальцы, плашка, закрепление. Без DOM, Web Audio и Math.random (случайность — rng).
// Картинки нет: x, y — позиция в (p, c), holeT — глубина дыры, которую считает вид. Звук — через движок (engine() может вернуть null).
// События для вида (burst, strike) копятся в очереди и отдаются events().
import { LINK_TYPES, LFO_KEYS } from './engine.js';
import { lerpLog } from '../../host/util.js';
import { LFO_RATE_MIN, LFO_RATE_MAX } from '../../host/sl.js';
export { LINK_TYPES };

export const VOICES = 6;          // 3 закреплённых + 3 временных
export const PIN_MAX = 3, TEMP_MAX = 3;
export const TAIL = 1.6;          // хвост после отпускания (τ, с)
export const UNPIN_TAIL = 0.8;    // хвост после снятия с закрепления
export const LINK_NEW = 0.5;      // глубина нового моста
export const BEAT_MIN = 0.05, BEAT_MAX = 24;
export const BEAT_DEF = 0.35;
export const CUT_DEF = 0.68;
export const RES_DEF = 0.21;
export const WAVE_DEF = 0.125;
export const SHIFT_DEF = 0.5;
export const SET_KEYS = ['wave', 'cut', 'res', 'beat', 'fm', 'shift', 'amp'];
export const LFO_DEF = { morph: 0, rate: 1.2, depth: 0.35 };

const makeVoice = (i) => ({
  i, x: 0.35, y: 0.22, beat: BEAT_DEF, wave: WAVE_DEF, fm: 0, cut: CUT_DEF, res: RES_DEF, shift: SHIFT_DEF, amp: 1, holeT: 0,
  mods: [], lfo: {}, pinned: false, active: false, live: false,
  env: 0, envT: 0, envTau: 0.05, held: 0, snap: true, dirty: false, sunT: 0, strikeNext: 0,
});

export function createModel({ rng = Math.random, engine = () => null, wake = () => {} } = {}) {
  const state = {
    voices: Array.from({ length: VOICES }, (_, i) => makeVoice(i)),
    fx: { rev: 0.3, decay: 3.5, dly: 0.3, chaos: 0, dirt: 0.2 },
    kept: [], time: 0, strikes: 0,
  };
  const V = state.voices;
  let queue = [];
  let chaosAt = 0;

  const kept = (v) => state.kept.includes(v.i);

  function attack(i) {
    const v = V[i], e = engine();
    v.active = true; v.envT = 1; v.envTau = 0.12;
    if (e) {
      if (!v.live) { v.live = true; e.live(i, true); }   // молчащий кружок отключён от графа
      e.on(i);
    }
    wake();
  }

  function release(i, tau) {
    const v = V[i], e = engine();
    v.envT = 0; v.envTau = tau;
    if (e) e.off(i, tau);
  }

  // внутренние помощники (их же берут связи и кубик)
  function removeLfo(v, key) {
    if (!v.lfo[key]) return;
    delete v.lfo[key];
    const e = engine();
    if (e) e.lfo(v.i, key, null);
  }
  const clearLfos = (v) => { for (const key of Object.keys(v.lfo)) removeLfo(v, key); };

  function addLink(dst, src, depth, type = 'tzfm') {   // src — номер голоса
    const m = { src, type, depth };
    dst.mods.push(m);
    dst.dirty = true;
    return m;
  }
  function dropLink(dst, m) {
    const k = dst.mods.indexOf(m);
    if (k < 0) return;
    dst.mods.splice(k, 1);
    dst.dirty = true;
  }

  function unlinkAll(v) {
    v.mods = [];
    v.dirty = true;
    for (const u of V) {
      const keepMods = [];
      for (const m of u.mods) { if (m.src === v.i) u.dirty = true; else keepMods.push(m); }
      u.mods = keepMods;
    }
  }

  // временных — не больше трёх. Мест нет — уступает только затухающий временный (самый тихий).
  // Закреплённые, удерживаемые и открытые в кольце не трогаются никогда
  function spawn(p, c, holeT) {
    const temps = V.filter((u) => u.active && !u.pinned).length;
    let v = temps < TEMP_MAX ? V.find((u) => !u.active) : null;
    if (!v) {
      for (const u of V) {
        if (!u.active || u.pinned || u.held || kept(u) || u.envT !== 0) continue;
        if (!v || u.env < v.env) v = u;
      }
    }
    if (!v) return -1;
    v.held = 0;
    unlinkAll(v);
    clearLfos(v);
    v.x = p; v.y = c; v.holeT = holeT;
    v.beat = BEAT_DEF; v.wave = WAVE_DEF; v.fm = 0; v.cut = CUT_DEF; v.res = RES_DEF; v.shift = SHIFT_DEF; v.amp = 1;
    v.pinned = false;
    v.snap = v.env < 0.02; v.dirty = true;
    attack(v.i);
    return v.i;
  }

  const grab = (i) => { if (!V[i].active) return; V[i].held++; };

  function letGo(i, fade = true) {
    const v = V[i];
    if (!v.held) return;
    v.held--;
    if (fade && !v.held && !v.pinned && !kept(v)) release(i, TAIL);
  }

  const keep = (ids) => { state.kept = [...ids]; };

  function unkeep() {
    const old = state.kept;
    state.kept = [];
    for (const i of old) {
      const v = V[i];
      if (v.active && !v.pinned && !v.held) release(i, TAIL);
    }
  }

  function move(i, p, c, holeT) {
    const v = V[i];
    if (!v.active) return;
    v.x = p; v.y = c; v.holeT = holeT;
    v.dirty = true;
  }

  function set(i, key, val) {
    if (!V[i].active || !SET_KEYS.includes(key)) return;
    V[i][key] = val;
    V[i].dirty = true;
  }

  function pin(i) {
    const v = V[i];
    if (!v.active) return null;
    queue.push({ t: 'burst', i });
    if (v.pinned) {
      v.pinned = false;
      if (!v.held && !kept(v)) release(i, UNPIN_TAIL);
      return 'unpinned';
    }
    if (V.filter((u) => u.active && u.pinned).length >= PIN_MAX) {   // закреплённых уже три — отказ
      if (!v.held && !kept(v)) release(i, TAIL);
      return 'full';
    }
    v.pinned = true;
    return 'pinned';
  }

  function remove(i) {
    const v = V[i];
    if (!v.active) return;
    v.pinned = false; v.held = 0;
    unlinkAll(v);
    release(i, 0.25);
    queue.push({ t: 'burst', i });
    state.kept = state.kept.filter((k) => k !== i);
  }

  // связи: dst модулируется кружком src. Есть связь — становится ручной, глубина остаётся
  function link(dst, src) {
    const d = V[dst];
    const m = d.mods.find((k) => k.src === src) || addLink(d, src, LINK_NEW);
    m.auto = false; d.dirty = true;
    return m;
  }
  const mod = (dst, src) => V[dst].mods.find((k) => k.src === src);
  function linkDepth(dst, src, depth) {
    const m = mod(dst, src);
    if (!m) return;
    m.depth = depth; V[dst].dirty = true;
  }
  function linkType(dst, src, type) {
    const m = mod(dst, src);
    if (!m) return;
    m.type = type; V[dst].dirty = true;
  }
  function unlink(dst, src) {
    const m = mod(dst, src);
    if (m) dropLink(V[dst], m);
  }

  // LFO: нет ключа — новый генератор (фаза для рисования с нуля); есть — правка на месте; null — снять
  function lfo(i, key, spec) {
    const v = V[i];
    if (!v.active || !LFO_KEYS.includes(key)) return;
    if (spec === null) {
      removeLfo(v, key);
      v.dirty = true;
      return;
    }
    if (v.lfo[key]) {
      Object.assign(v.lfo[key], spec);
    } else {
      const made = { ...LFO_DEF, ...spec };
      v.lfo[key] = made;
      const e = engine();
      if (e) e.lfo(i, key, made);
    }
    v.dirty = true;
  }

  const sun = (i, t) => { V[i].sunT = t; };

  // хаос: слабые случайные связи между звучащими кружками, которые сами меняются
  function chaos() {
    const act = V.filter((v) => v.active);
    const c = state.fx.chaos;
    for (const v of V) {
      const auto = v.mods.find((m) => m.auto);
      if (!v.active || c < 0.02 || act.length < 2) { if (auto) dropLink(v, auto); continue; }
      if (auto && state.time < auto.until && V[auto.src].active) { auto.depth = c * auto.k; v.dirty = true; continue; }
      if (auto) dropLink(v, auto);
      if (rng() > 0.35) continue;      // не все сразу
      const cands = act.filter((u) => u !== v && !v.mods.some((m) => m.src === u.i));
      if (!cands.length) continue;
      const m = addLink(v, cands[Math.floor(rng() * cands.length)].i, 0, LINK_TYPES[Math.floor(rng() * 4)]);
      m.auto = true;
      m.k = 0.15 + rng() * 0.4;
      m.depth = c * m.k;
      m.until = state.time + 3 + rng() * 7;
    }
  }

  // планету держат на солнце — оно бьёт: чем глубже, тем чаще
  function strikes() {
    for (const v of V) {
      if (v.held <= 0 || v.sunT <= 0 || state.time < v.strikeNext) continue;
      const t = v.sunT;
      v.strikeNext = state.time + (0.44 - 0.32 * t) * (0.6 + 0.8 * rng());
      const e = engine();
      if (e) e.strike(t);
      state.strikes++;
      queue.push({ t: 'strike', i: v.i, p: t });
    }
  }

  // голос изменился: связи и LFO — до полей, чтобы голос применился один раз (и со snap)
  function syncMods(v, e) {
    e.links(v.i, v.mods.map((m) => ({ src: m.src, type: m.type, depth: m.depth })));
    for (const key of LFO_KEYS) e.lfo(v.i, key, v.lfo[key] || null);
  }
  function sync(v) {
    const e = engine();
    if (!e) return;
    syncMods(v, e);
    e.voice(v.i, v);
    v.snap = false;
  }

  function tick(dt) {
    state.time += dt;
    if (state.time > chaosAt) { chaosAt = state.time + 0.4; chaos(); }
    strikes();
    let sum = 0;
    for (const v of V) {
      if (v.dirty) { v.dirty = false; sync(v); }
      v.env += (v.envT - v.env) * (1 - Math.exp(-dt / v.envTau));
      if (v.active && v.holeT > 0.9 && !v.held && v.envT !== 0) { v.pinned = false; release(v.i, 0.4); }   // отпущена в глубине дыры — умирает
      if (v.active && !v.pinned && !v.held && v.envT === 0 && v.env < 0.004) {
        v.active = false;
        unlinkAll(v);
        clearLfos(v);
        if (v.live) { v.live = false; const e = engine(); if (e) e.live(v.i, false); }
      }
      if (v.active) sum += v.env;
    }
    const e = engine();
    if (e) e.busEnv(sum);   // чем больше кружков, тем тише каждый
  }

  function retune() { for (const v of V) v.dirty = true; }

  function load() {
    const act = V.filter((v) => v.active);
    return (act.length + 0.15 * act.reduce((n, v) => n + Object.keys(v.lfo).length, 0)) / VOICES;
  }

  const sounding = () => V.some((v) => v.active);

  const NO_EVENTS = Object.freeze([]);
  function events() {
    if (!queue.length) return NO_EVENTS;   // кадр без событий — без новой пустой очереди
    const out = queue;
    queue = [];
    return out;
  }

  function fx(o) {
    Object.assign(state.fx, o);
    const e = engine();
    if (e) e.fx(state.fx);
  }

  // кубик: случайный тембр живым (не гаснущим) голосам, их ручным связям и LFO; пусто — false, rng не тронут
  function dice() {
    const vs = V.filter((v) => v.active && v.envT > 0);
    if (!vs.length) return false;
    const R = rng;
    for (const v of vs) {
      v.wave = R();
      v.cut = 0.3 + 0.62 * R();
      v.res = 0.75 * R() ** 1.5;
      v.beat = lerpLog(BEAT_MIN, BEAT_MAX, 0.85 * R());
      v.fm = R() < 0.45 ? 0 : 0.7 * R();
      v.shift = R() < 0.5 ? SHIFT_DEF : R();
      for (const m of v.mods) {
        if (m.auto) continue;
        m.type = LINK_TYPES[Math.floor(R() * 4)];
        m.depth = 0.15 + 0.75 * R();
      }
      for (const spec of Object.values(v.lfo)) { spec.morph = R(); spec.rate = lerpLog(LFO_RATE_MIN, LFO_RATE_MAX, 0.15 + 0.7 * R()); }
      v.dirty = true;
      queue.push({ t: 'burst', i: v.i });
    }
    return true;
  }

  // все активные гаснут за 0.25 с; движок забывает связи и LFO
  function clear() {
    for (const v of V) if (v.active) remove(v.i);
    const e = engine();
    if (e) e.clear();
    state.kept = [];
  }

  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  // строка побайтно та же, что у старого app.js (host/undo.js сравнивает снимки как строки)
  function snapshot() {
    const pins = V.filter((v) => v.active && v.pinned);
    const ids = new Set(pins.map((v) => v.i));
    return JSON.stringify({
      v: pins.map((v) => ({
        i: v.i, x: r4(v.x), y: r4(v.y), amp: r4(v.amp), wave: r4(v.wave), cut: r4(v.cut), res: r4(v.res), beat: r4(v.beat), fm: r4(v.fm), shift: r4(v.shift), hole: r4(v.holeT),
        lfo: Object.fromEntries(Object.entries(v.lfo).map(([k, sp]) => [k, { morph: r4(sp.morph), rate: r4(sp.rate), depth: r4(sp.depth) }])),
        mods: v.mods.filter((m) => !m.auto && ids.has(m.src)).map((m) => ({ src: m.src, type: m.type, depth: r4(m.depth) })),
      })),
      fx: Object.fromEntries(Object.entries(state.fx).map(([k, x]) => [k, r4(x)])),
    });
  }

  function restore(js) {
    const st = JSON.parse(js);
    const inSnap = new Set(st.v.map((d) => d.i));
    for (const v of V) if (v.active && v.pinned && !inSnap.has(v.i)) remove(v.i);
    for (const d of st.v) {
      const v = V[d.i];
      v.held = 0;
      unlinkAll(v);
      clearLfos(v);
      v.snap = !v.active || v.env < 0.02;
      Object.assign(v, { x: d.x, y: d.y, amp: d.amp == null ? 1 : d.amp, wave: d.wave, cut: d.cut, res: d.res, beat: d.beat, fm: d.fm, shift: d.shift, holeT: d.hole || 0 });
      v.pinned = true; v.dirty = true;
      if (!v.active || v.envT === 0) attack(v.i);
      queue.push({ t: 'burst', i: v.i });
    }
    for (const d of st.v) {
      const v = V[d.i];
      for (const m of d.mods) addLink(v, m.src, m.depth, m.type);
      for (const [k, sp] of Object.entries(d.lfo)) lfo(v.i, k, { ...sp });
    }
    fx(st.fx);
    state.kept = [];
  }

  // первая сборка движка (engine() уже отдаёт его): FX, LIVE — до полей и ON, затем связи, LFO, голоса со snap, ON
  function build() {
    const e = engine();
    if (!e) return;
    e.fx(state.fx);
    for (const v of V) { v.live = v.active; if (v.active) e.live(v.i, true); }
    for (const v of V) syncMods(v, e);
    for (const v of V) { v.snap = true; e.voice(v.i, v); v.snap = false; v.dirty = false; }
    for (const v of V) if (v.active && v.envT === 1) e.on(v.i);
  }

  return { fx, dice, clear, snapshot, restore, build, state, attack, release, spawn, grab, letGo, keep, unkeep, move, set, pin, remove, retune, load, sounding, events,
    link, mod, linkDepth, linkType, unlink, lfo, sun, tick };
}
