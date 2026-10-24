// Cymatica ↔ ядро: сообщения формата прежнего worklet (они же — сценарии сверки) → action мира SDK (слот 2); действия модели (ACT от STRIKE_AT)
// шлёт фасад (model.js) — модель в ядре. Коды и раскладка чисел — core/worlds/cymatica/world.hpp; пустое поле — NaN (Float64Array его сохраняет).
// Без DOM и Web Audio.
export const SLOT = 2;
export const ACT = {
  PARAMS: 0, F0: 1, STRIKE: 2, SEQ: 3, LOCK: 4, BOW: 5, FX: 6,                         // уровень пластины
  STRIKE_AT: 7, PLAY: 8, REC: 9, STEPREC: 10, SKIP: 11, CURSOR: 12, GRID: 13, BPM: 14, LEN: 15, CHANCE_AT: 16, BEAT: 17, NUDGE: 18, MOVE_MARK: 19,
  DROP_MARK: 20, COMB: 21, TURN: 22, DRIFT_TOGGLE: 23, DRIFT_SET: 24, SET_F0: 25, STEP_SCALE: 26, SET_FX: 27, LOAD_FX: 28, DICE: 29, CLEAR: 30, LOAD: 31, BOW_ADD: 32, BOW_SET: 33, BOW_DROP: 34, HUM: 35,   // уровень модели
};
export const FX_KEYS = ['structure', 'damping', 'brightness', 'hall', 'echo', 'time', 'chance'];   // Fx в model.hpp
export const DRIFT_KEYS = ['depth', 'rate', 'shape'];                                              // DriftKey
// зеркало: 24 энергии, 4 × (hz, level), затем модель — те же смещения, что M_* в world.hpp
export const M = { F0: 32, FX: 33, SEQ: 40, RHY: 45, MEL: 109, DRIFT: 157, MISC: 162, ECHO: 169, N: 175 };
const SLOTS = 16;                                          // гнёзд узора — как SLOTS в core.js
const num = (x, d = NaN) => (x == null ? d : x);

// узор целиком: bpm, playing, chance, rhythm.len, melody.len, затем 16 шагов ритма (on, vel, chance) и 16 шагов мелодии (on, s, x, y)
export function seqArgs(m) {
  const a = [m.bpm, m.playing ? 1 : 0, num(m.chance, 1), m.rhythm.len, m.melody.len];
  for (let i = 0; i < SLOTS; i++) { const st = m.rhythm.steps[i]; a.push(st ? 1 : 0, st ? num(st.vel, 1) : 0, st ? num(st.chance, 1) : 1); }
  for (let i = 0; i < SLOTS; i++) { const st = m.melody.steps[i]; a.push(st ? 1 : 0, st ? st.s : 0, st ? st.x : 0, st ? st.y : 0); }
  return a;
}

// сообщение → { kind, i, a, abs? }; abs — номера аргументов во времени контекста (t2d-worklet.js переводит их во время ядра); null — ядру не нужно.
// idOf — числовой id смычка по id из сообщения
export function toAction(m, idOf = (id) => id) {
  switch (m.t) {
    case 'params': return { kind: ACT.PARAMS, i: 0, a: [num(m.structure), num(m.damping), num(m.brightness)] };
    case 'f0': return { kind: ACT.F0, i: 0, a: [m.hz] };
    case 'strike': return { kind: ACT.STRIKE, i: 0, a: [m.x, m.y, m.hz || NaN, num(m.vel), num(m.hard), m.rec ? 1 : 0] };
    case 'seq': return { kind: ACT.SEQ, i: 0, a: seqArgs(m) };
    case 'lock': return m.off || !(m.p > 0) ? { kind: ACT.LOCK, i: 0, a: [1, 0, 0] } : { kind: ACT.LOCK, i: 0, a: [0, m.t0, m.p], abs: [1] };
    case 'bow': return { kind: ACT.BOW, i: idOf(m.id), a: [m.on ? 1 : 0, num(m.x), num(m.y), num(m.exciter), num(m.pressure), num(m.amp)] };
    case 'hall': return { kind: ACT.FX, i: 0, a: [m.hall] };
  }
  return null;
}

// «услышанное» ядра: записи по 5 — [1, r, m, time, hit] на каждый сыгранный шаг
export function parseHeard(recs) {
  const out = [];
  for (const h of recs) for (let p = 0; p + 4 < h.length; p += 5) if (h[p] === 1) out.push({ t: 'step', r: h[p + 1], m: h[p + 2], time: h[p + 3], hit: h[p + 4] !== 0 });
  return out;
}
// резонатор отзывается: записи [2, нота] — нота удара совпала с основным тоном пластины по классу высоты
export function parseAnswers(recs) {
  const out = [];
  for (const h of recs) for (let p = 0; p + 4 < h.length; p += 5) if (h[p] === 2) out.push({ t: 'answer', semi: h[p + 1] });
  return out;
}
// модель из зеркала: числа как в M_*; шаги — { on, … } как есть (пустые — on: false)
export function parseModel(mb) {
  const o = { f0: mb[M.F0], fx: {}, bpm: mb[M.SEQ], playing: mb[M.SEQ + 1] !== 0, rec: mb[M.SEQ + 2] !== 0, rlen: mb[M.SEQ + 3], mlen: mb[M.SEQ + 4], rhythm: [], melody: [] };
  FX_KEYS.forEach((k, i) => { o.fx[k] = mb[M.FX + i]; });
  for (let i = 0; i < 16; i++) {
    const r = M.RHY + i * 4, m = M.MEL + i * 3;
    o.rhythm.push({ on: mb[r] !== 0, vel: mb[r + 1], chance: mb[r + 2], has: mb[r + 3] !== 0 });
    o.melody.push({ on: mb[m] !== 0, x: mb[m + 1], y: mb[m + 2] });
  }
  o.drift = { on: mb[M.DRIFT] !== 0, depth: mb[M.DRIFT + 1], rate: mb[M.DRIFT + 2], shape: mb[M.DRIFT + 3], k: mb[M.DRIFT + 4] };
  o.grid = mb[M.MISC]; o.lastHit = { x: mb[M.MISC + 1], y: mb[M.MISC + 2] }; o.cursor = mb[M.MISC + 3] < 0 ? null : mb[M.MISC + 3];
  o.stepRec = mb[M.MISC + 4] !== 0 ? { r: mb[M.MISC + 5], m: mb[M.MISC + 6] } : null;
  return o;
}
// эхо из зеркала: живые пары (время задержки, с) в порядке рождения и длина линии
export function parseEcho(mb) {
  const n = mb[M.ECHO], chains = [];
  for (let i = 0; i < n; i++) chains.push({ sec: mb[M.ECHO + 1 + i], real: mb[M.ECHO + 1 + i] });
  return { chains, max: mb[M.ECHO + 5] };
}
// зеркало: энергии 24 мод, затем (hz, level) четырёх голосов
export function parseMirror(mb) {
  const voices = [];
  for (let v = 0; v < 4; v++) voices.push({ hz: mb[24 + 2 * v], level: mb[25 + 2 * v] });
  return { energy: Float32Array.from(mb.slice(0, 24)), voices, level: voices.reduce((s, v) => s + v.level, 0) };
}
