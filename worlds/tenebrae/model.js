// Tenebrae (мир I) — модель: кружки (голоса), пальцы, плашка, закрепление. Без DOM, Web Audio и Math.random (случайность — rng).
// Картинки нет: x, y — позиция в (p, c), holeT — глубина дыры, которую считает вид. Звук — через движок (engine() может вернуть null).
// События для вида (burst, strike) копятся в очереди и отдаются events().
import { LINK_TYPES, LFO_KEYS } from './engine.js';
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
export const LFO_DEF = { morph: 0, rate: 1.2, depth: 0.35 };

const makeVoice = (i) => ({
  i, x: 0.35, y: 0.22, beat: BEAT_DEF, wave: WAVE_DEF, fm: 0, cut: CUT_DEF, res: RES_DEF, shift: SHIFT_DEF, amp: 1, holeT: 0,
  mods: [], lfo: {}, pinned: false, active: false, live: false,
  env: 0, envT: 0, envTau: 0.05, held: 0, snap: true, dirty: true, sunT: 0, strikeNext: 0,
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

  function addLink(dst, src, depth, type = 'tzfm') {
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
      for (const m of u.mods) { if (m.src === v) u.dirty = true; else keepMods.push(m); }
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

  const grab = (i) => { V[i].held++; };

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
    v.x = p; v.y = c; v.holeT = holeT;
    v.dirty = true;
  }

  function set(i, key, val) {
    V[i][key] = val;
    V[i].dirty = true;
  }

  function pin(i) {
    const v = V[i];
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
    v.pinned = false; v.held = 0;
    unlinkAll(v);
    release(i, 0.25);
    queue.push({ t: 'burst', i });
    state.kept = state.kept.filter((k) => k !== i);
  }

  // связи: dst модулируется кружком src. Есть связь — становится ручной, глубина остаётся
  function link(dst, src) {
    const d = V[dst], s = V[src];
    const m = d.mods.find((k) => k.src === s) || addLink(d, s, LINK_NEW);
    m.auto = false; d.dirty = true;
    return m;
  }
  const find = (dst, src) => V[dst].mods.find((k) => k.src === V[src]);
  function linkDepth(dst, src, depth) {
    const m = find(dst, src);
    if (!m) return;
    m.depth = depth; V[dst].dirty = true;
  }
  function linkType(dst, src, type) {
    const m = find(dst, src);
    if (!m) return;
    m.type = type; V[dst].dirty = true;
  }
  function unlink(dst, src) {
    const m = find(dst, src);
    if (m) dropLink(V[dst], m);
  }

  // LFO: нет ключа — новый генератор (фаза для рисования с нуля); есть — правка на месте; null — снять
  function lfo(i, key, spec) {
    const v = V[i];
    if (spec === null) {
      removeLfo(v, key);
      v.dirty = true;
      return;
    }
    if (v.lfo[key]) {
      Object.assign(v.lfo[key], spec);
    } else {
      spec.ph = 0;
      v.lfo[key] = spec;
      const e = engine();
      if (e) e.lfo(i, key, spec);
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
      if (auto && state.time < auto.until && auto.src.active) { auto.depth = c * auto.k; v.dirty = true; continue; }
      if (auto) dropLink(v, auto);
      if (rng() > 0.35) continue;      // не все сразу
      const cands = act.filter((u) => u !== v && !v.mods.some((m) => m.src === u));
      if (!cands.length) continue;
      const m = addLink(v, cands[Math.floor(rng() * cands.length)], 0, LINK_TYPES[Math.floor(rng() * 4)]);
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
  function sync(v) {
    const e = engine();
    if (!e) return;
    e.links(v.i, v.mods.map((m) => ({ src: m.src.i, type: m.type, depth: m.depth })));
    for (const key of LFO_KEYS) e.lfo(v.i, key, v.lfo[key] || null);
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

  function events() {
    const out = queue;
    queue = [];
    return out;
  }

  return { state, attack, release, spawn, grab, letGo, keep, unkeep, move, set, pin, remove, retune, load, sounding, events,
    link, linkDepth, linkType, unlink, lfo, sun, tick };
}
