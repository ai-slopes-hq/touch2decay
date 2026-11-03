// Tenebrae (мир I) — фасад модели. Сама модель живёт в ядре (core/worlds/tenebrae → t2d.wasm, узел t2d-worklet.js хоста), здесь — её
// зеркало и действия касаний. API — модели-эталона (tools/ref/tenebrae-model.js) без build и engine: state.voices — шесть объектов,
// правятся на месте (view держит ссылки на голоса, связи и спеки LFO); связи переиспользуются по (dst, src), спеки LFO — по ключу,
// контуры звука лежат в заранее созданных Float32Array(128) на голос (scope(i)).
// Действие применяется к state сразу, правилами эталона (spawn, pin, dice отвечают синхронно по своему state), и уходит в ядро через
// send (порт узла, асинхронно; send → номер сообщения). Зеркало (sync) приходит ~60 раз в секунду с числом уже применённых ядром
// сообщений: голос, который здесь правили, а ядро ещё не видело (номер в dirty[i] больше applied), зеркало не перетирает — кроме env.
// time, strikes, env — только из зеркала; fx и kept — когда ядро применило свою правку; кубик (dice) и хаос — только зеркалом,
// busy() = кубик или очистка ещё не дошли. События вида (burst, strike) — из heard ядра. tick пустой: время и шаг модели — в ядре.
// Номер для spawn выбирает фасад (правило pick эталона по своему state, env — из зеркала), ядро берёт тот же голос (SPAWN i).
// Коды действий и раскладка зеркала — core/worlds/tenebrae/world.hpp (те же числа в tools/models/tenebrae-core.mjs, тест сверяет).
export const VOICES = 6;
export const PIN_MAX = 3, TEMP_MAX = 3;
export const TAIL = 1.6, UNPIN_TAIL = 0.8, LINK_NEW = 0.5;
export const BEAT_MIN = 0.05, BEAT_MAX = 24;
export const CUT_DEF = 0.68, RES_DEF = 0.21, WAVE_DEF = 0.125, SHIFT_DEF = 0.5, BEAT_DEF = 0.35;
export const LFO_DEF = { morph: 0, rate: 1.2, depth: 0.35 };
export const LINK_TYPES = ['fm', 'tzfm', 'am', 'rm'];
export const LFO_KEYS = ['pitch', 'wave', 'cut', 'res', 'beat', 'shift', 'amp', 'fm'];
export const SET_KEYS = ['wave', 'cut', 'res', 'beat', 'fm', 'shift', 'amp'];
// ядро: слот мира в хосте, коды action, раскладка зеркала — core/worlds/tenebrae/world.hpp
export const SLOT = 1;
export const ACT = {
  spawn: 16, grab: 17, letGo: 18, keep: 19, unkeep: 20, move: 21, sun: 22, set: 23, pin: 24, remove: 25, attack: 26, release: 27,
  link: 28, linkDepth: 29, linkType: 30, unlink: 31, lfo: 32, fx: 33, dice: 34, clear: 35, retune: 36,
};
export const MIRROR = { HEAD: 15, VOICE: 62, MODEL_N: 387, SCOPE_V: 129, N: 1161 };
const FX_KEYS = ['rev', 'decay', 'dly', 'chaos', 'dirt'];
const NUM = ['x', 'y', 'beat', 'wave', 'fm', 'cut', 'res', 'shift', 'amp', 'holeT', 'sunT'];   // поля 4…14 голоса в зеркале

const makeVoice = (i) => ({
  i, x: 0.35, y: 0.22, beat: BEAT_DEF, wave: WAVE_DEF, fm: 0, cut: CUT_DEF, res: RES_DEF, shift: SHIFT_DEF, amp: 1, holeT: 0, sunT: 0,
  mods: [], lfo: {}, pinned: false, active: false, live: false, env: 0, envT: 0, held: 0,
});

export function createModel({ send = () => 0, wake = () => {} } = {}) {
  const state = {
    voices: Array.from({ length: VOICES }, (_, i) => makeVoice(i)),
    fx: { rev: 0.3, decay: 3.5, dly: 0.3, chaos: 0, dirt: 0.2 },
    kept: [], time: 0, strikes: 0,
  };
  const V = state.voices;
  const scopes = V.map(() => new Float32Array(128)), scopeOn = V.map(() => false);
  let queue = [], post = send;
  const dirty = V.map(() => 0);                          // голос → номер сообщения: правили здесь, ядро ещё не видело
  let fxAt = 0, keptAt = 0, waitAt = 0, applied = 0;     // номера последних правок fx / kept / кубика-очистки; сколько ядро применило
  const act = (kind, i = 0, a = []) => post({ t: 'action', slot: SLOT, kind, i, a });
  const mark = (n, i) => { if (i == null) dirty.fill(n); else dirty[i] = n; return n; };
  const ok = (i) => Number.isInteger(i) && i >= 0 && i < VOICES;
  const kept = (v) => state.kept.includes(v.i);

  // --- правила эталона над state (без отправки) ---
  function attackLocal(v) { v.active = true; v.envT = 1; v.live = true; }
  function releaseLocal(v) { v.envT = 0; }
  function unlinkAll(v) {
    v.mods.length = 0;
    for (const u of V) { for (let k = u.mods.length - 1; k >= 0; k--) if (u.mods[k].src === v.i) u.mods.splice(k, 1); }
  }
  function clearLfos(v) { for (const key of Object.keys(v.lfo)) delete v.lfo[key]; }
  function removeLocal(v) {
    v.pinned = false; v.held = 0;
    unlinkAll(v);
    releaseLocal(v);
    const at = state.kept.indexOf(v.i);
    if (at >= 0) state.kept.splice(at, 1);
  }
  function addLink(v, src, depth, type) {
    const m = { src, type, depth, auto: false };
    v.mods.push(m);
    return m;
  }
  const findMod = (dst, src) => V[dst].mods.find((k) => k.src === src);
  function setLfo(v, key, spec) {                        // нет ключа — новая спека, есть — правка на месте
    if (v.lfo[key]) Object.assign(v.lfo[key], spec);
    else v.lfo[key] = { ...LFO_DEF, ...spec };
    return v.lfo[key];
  }
  function pick() {                                      // голос под новый кружок (−1 — нет места): временных не больше трёх, уступает только самый тихий затухающий
    const temps = V.filter((u) => u.active && !u.pinned).length;
    let v = temps < TEMP_MAX ? V.find((u) => !u.active) : null;
    if (!v) {
      for (const u of V) {
        if (!u.active || u.pinned || u.held || kept(u) || u.envT !== 0) continue;
        if (!v || u.env < v.env) v = u;
      }
    }
    return v ? v.i : -1;
  }

  // --- действия ---
  function spawn(p, c, holeT) {
    const i = pick();
    if (i < 0) return -1;
    const v = V[i];
    v.held = 0;
    unlinkAll(v); clearLfos(v);
    v.x = p; v.y = c; v.holeT = holeT;
    v.beat = BEAT_DEF; v.wave = WAVE_DEF; v.fm = 0; v.cut = CUT_DEF; v.res = RES_DEF; v.shift = SHIFT_DEF; v.amp = 1;
    v.pinned = false;
    attackLocal(v); wake();
    mark(act(ACT.spawn, i, [p, c, holeT]));
    return i;
  }
  function grab(i) {
    if (!ok(i) || !V[i].active) return;
    V[i].held++;
    mark(act(ACT.grab, i), i);
  }
  function letGo(i, fade = true) {
    if (!ok(i)) return;
    const v = V[i];
    if (!v.held) return;
    v.held--;
    if (fade && !v.held && !v.pinned && !kept(v)) releaseLocal(v);
    mark(act(ACT.letGo, i, [fade ? 1 : 0]), i);
  }
  function keep(ids) {
    const list = [...ids];
    state.kept.length = 0; state.kept.push(...list);
    keptAt = act(ACT.keep, 0, list);
  }
  function unkeep() {
    const old = state.kept.slice();
    state.kept.length = 0;
    for (const i of old) { const v = V[i]; if (v && v.active && !v.pinned && !v.held) releaseLocal(v); }
    keptAt = mark(act(ACT.unkeep));
  }
  function move(i, p, c, holeT) {
    if (!ok(i) || !V[i].active) return;
    const v = V[i];
    v.x = p; v.y = c; v.holeT = holeT;
    mark(act(ACT.move, i, [p, c, holeT]), i);
  }
  function set(i, key, val) {
    const k = SET_KEYS.indexOf(key);
    if (!ok(i) || !V[i].active || k < 0) return;
    V[i][key] = val;
    mark(act(ACT.set, i, [k, val]), i);
  }
  function pin(i) {
    if (!ok(i) || !V[i].active) return null;
    const v = V[i];
    let r;
    if (v.pinned) {
      v.pinned = false;
      if (!v.held && !kept(v)) releaseLocal(v);
      r = 'unpinned';
    } else if (V.filter((u) => u.active && u.pinned).length >= PIN_MAX) {   // закреплённых уже три — отказ
      if (!v.held && !kept(v)) releaseLocal(v);
      r = 'full';
    } else { v.pinned = true; r = 'pinned'; }
    mark(act(ACT.pin, i), i);
    return r;
  }
  function remove(i) {
    if (!ok(i) || !V[i].active) return;
    removeLocal(V[i]);
    keptAt = mark(act(ACT.remove, i));
  }
  function attack(i) {
    if (!ok(i)) return;
    attackLocal(V[i]); wake();
    mark(act(ACT.attack, i), i);
  }
  function release(i, tau) {
    if (!ok(i)) return;
    releaseLocal(V[i]);
    mark(act(ACT.release, i, [tau]), i);
  }
  // связи: dst модулируется кружком src. Есть связь — становится ручной, глубина остаётся. Сам на себя — ничего (как в ядре)
  function link(dst, src) {
    if (!ok(dst) || !ok(src) || dst === src) return undefined;
    const m = findMod(dst, src) || addLink(V[dst], src, LINK_NEW, 'tzfm');
    m.auto = false;
    mark(act(ACT.link, dst, [src]), dst);
    return m;
  }
  const mod = (dst, src) => (ok(dst) ? findMod(dst, src) : undefined);
  function linkDepth(dst, src, depth) {
    const m = mod(dst, src);
    if (!m) return;
    m.depth = depth;
    mark(act(ACT.linkDepth, dst, [src, depth]), dst);
  }
  function linkType(dst, src, type) {
    const m = mod(dst, src), t = LINK_TYPES.indexOf(type);
    if (!m || t < 0) return;
    m.type = type;
    mark(act(ACT.linkType, dst, [src, t]), dst);
  }
  function unlink(dst, src) {
    const m = mod(dst, src);
    if (!m) return;
    V[dst].mods.splice(V[dst].mods.indexOf(m), 1);
    mark(act(ACT.unlink, dst, [src]), dst);
  }
  // LFO: нет ключа — новый генератор, есть — правка на месте, null — снять. Неполная спека сливается со своим state, в ядро — всегда полная
  function lfo(i, key, spec) {
    const k = LFO_KEYS.indexOf(key);
    if (!ok(i) || !V[i].active || k < 0) return;
    const v = V[i];
    if (spec === null) {
      if (!v.lfo[key]) return;
      delete v.lfo[key];
      mark(act(ACT.lfo, i, [k, 0, 0, -1]), i);
      return;
    }
    const s = setLfo(v, key, spec);
    mark(act(ACT.lfo, i, [k, s.morph, s.rate, s.depth]), i);
  }
  function sun(i, t) {
    if (!ok(i)) return;
    V[i].sunT = t;
    mark(act(ACT.sun, i, [t]), i);
  }
  function fx(o) {
    Object.assign(state.fx, o);
    fxAt = act(ACT.fx, 0, FX_KEYS.map((k) => state.fx[k]));
  }
  // кубик: результат придёт зеркалом (rng — только в ядре); отвечаем, есть ли живые, state не трогаем
  function dice() {
    if (!V.some((v) => v.active && v.envT > 0)) return false;
    waitAt = act(ACT.dice);
    return true;
  }
  function clear() {
    for (const v of V) if (v.active) removeLocal(v);
    state.kept.length = 0;
    waitAt = keptAt = mark(act(ACT.clear));
  }
  function retune() { act(ACT.retune); }

  const load = () => {
    const a = V.filter((v) => v.active);
    return (a.length + 0.15 * a.reduce((n, v) => n + Object.keys(v.lfo).length, 0)) / VOICES;
  };
  const sounding = () => V.some((v) => v.active);
  const busy = () => applied < waitAt;

  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  // строка побайтно та же, что у эталона (host/undo.js сравнивает снимки как строки)
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
  // сцена целиком: здесь — сразу, алгоритмом эталона; в ядро — одним restore (там тот же алгоритм)
  function restore(js) {
    const st = JSON.parse(js);
    const inSnap = new Set(st.v.map((d) => d.i));
    for (const v of V) if (v.active && v.pinned && !inSnap.has(v.i)) removeLocal(v);
    for (const d of st.v) {
      const v = V[d.i];
      v.held = 0;
      unlinkAll(v); clearLfos(v);
      Object.assign(v, { x: d.x, y: d.y, amp: d.amp == null ? 1 : d.amp, wave: d.wave, cut: d.cut, res: d.res, beat: d.beat, fm: d.fm, shift: d.shift, holeT: d.hole || 0 });
      v.pinned = true;
      if (!v.active || v.envT === 0) { attackLocal(v); wake(); }
    }
    for (const d of st.v) {
      const v = V[d.i];
      for (const m of d.mods) addLink(v, m.src, m.depth, m.type);
      for (const [k, sp] of Object.entries(d.lfo)) setLfo(v, k, { ...sp });
    }
    Object.assign(state.fx, st.fx);
    state.kept.length = 0;
    fxAt = keptAt = mark(post({ t: 'restore', slot: SLOT, js }));
  }

  // --- зеркало ядра → state ---
  function syncVoice(v, m, b) {
    v.active = m[b] !== 0; v.live = m[b + 1] !== 0; v.pinned = m[b + 2] !== 0; v.held = m[b + 3];
    for (let k = 0; k < NUM.length; k++) v[NUM[k]] = m[b + 4 + k];
    v.envT = m[b + 16];
    const mods = v.mods, n = m[b + 17];
    for (let k = 0; k < n; k++) {                        // связи — по src, объекты переиспользуются, порядок — как в ядре
      const q = b + 18 + 4 * k, src = m[q];
      let j = k;
      while (j < mods.length && mods[j].src !== src) j++;
      if (j === mods.length) mods.push({ src, type: 'tzfm', depth: 0, auto: false });
      if (j !== k) { const t = mods[j]; mods[j] = mods[k]; mods[k] = t; }
      const l = mods[k];
      l.type = LINK_TYPES[m[q + 1]]; l.depth = m[q + 2]; l.auto = m[q + 3] !== 0;
    }
    mods.length = n;
    for (let k = 0; k < LFO_KEYS.length; k++) {         // LFO — по ключу; depth −1 — нет (глубина 0 — настоящий LFO)
      const q = b + 38 + 3 * k, key = LFO_KEYS[k];
      if (m[q + 2] < 0) { if (key in v.lfo) delete v.lfo[key]; continue; }
      const s = v.lfo[key] || (v.lfo[key] = { morph: 0, rate: 0, depth: 0 });
      s.morph = m[q]; s.rate = m[q + 1]; s.depth = m[q + 2];
    }
  }
  function sync(m, ack, heard = []) {                    // ack — сколько сообщений ядро уже применило
    applied = ack;
    state.time = m[1]; state.strikes = m[2];
    if (ack >= fxAt) for (let k = 0; k < FX_KEYS.length; k++) state.fx[FX_KEYS[k]] = m[3 + k];
    if (ack >= keptAt) { state.kept.length = 0; for (let k = 0; k < m[8]; k++) state.kept.push(m[9 + k]); }
    const withScope = m.length >= MIRROR.N;
    for (let i = 0; i < VOICES && i < m[0]; i++) {
      const v = V[i], b = MIRROR.HEAD + i * MIRROR.VOICE;
      if (ack >= dirty[i]) syncVoice(v, m, b);   // тронут здесь и ядро не видело — поля свои; env — всегда из зеркала
      v.env = m[b + 15];
      const s = MIRROR.MODEL_N + i * MIRROR.SCOPE_V;
      scopeOn[i] = withScope && m[s] !== 0;
      if (scopeOn[i]) { const sc = scopes[i]; for (let k = 0; k < 128; k++) sc[k] = m[s + 1 + k]; }
    }
    for (const h of heard) {                             // услышанное блока: [1, i] — burst, [2, i, p] — strike
      for (let k = 0; k < h.length;) {
        if (h[k] === 1) { queue.push({ t: 'burst', i: h[k + 1] }); k += 2; }
        else if (h[k] === 2) { queue.push({ t: 'strike', i: h[k + 1], p: h[k + 2] }); k += 3; }
        else break;
      }
    }
  }
  function bind(fn) {                                    // новый узел ядра: счёт сообщений — заново, закреплённая сцена — туда целиком
    post = fn; applied = 0;
    fxAt = keptAt = waitAt = mark(post({ t: 'restore', slot: SLOT, js: snapshot() }));
  }
  const scope = (i) => (ok(i) && scopeOn[i] ? scopes[i] : null);

  const NO_EVENTS = Object.freeze([]);
  function events() {
    if (!queue.length) return NO_EVENTS;                 // кадр без событий — без новой пустой очереди
    const out = queue;
    queue = [];
    return out;
  }

  return {
    state, spawn, grab, letGo, keep, unkeep, move, set, pin, remove, attack, release, link, linkDepth, linkType, unlink, mod, lfo, sun, fx, dice, clear, retune,
    snapshot, restore, load, sounding, events, tick() {},   // время модели идёт в ядре
    sync, bind, scope, busy,
  };
}
