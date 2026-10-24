// Cymatica ↔ ядро: сообщения формата прежнего worklet (их шлёт модель, они же — сценарии сверки) → action мира SDK (слот 2).
// Коды и раскладка чисел — core/worlds/cymatica/world.hpp; пустое поле — NaN (Float64Array его сохраняет). Без DOM и Web Audio.
export const SLOT = 2;
export const ACT = { PARAMS: 0, F0: 1, STRIKE: 2, SEQ: 3, LOCK: 4, BOW: 5, FX: 6 };
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
  for (const h of recs) for (let p = 0; p + 4 < h.length; p += 5) out.push({ t: 'step', r: h[p + 1], m: h[p + 2], time: h[p + 3], hit: h[p + 4] !== 0 });
  return out;
}
// зеркало: энергии 24 мод, затем (hz, level) четырёх голосов
export function parseMirror(mb) {
  const voices = [];
  for (let v = 0; v < 4; v++) voices.push({ hz: mb[24 + 2 * v], level: mb[25 + 2 * v] });
  return { energy: Float32Array.from(mb.slice(0, 24)), voices, level: voices.reduce((s, v) => s + v.level, 0) };
}
