// Cymatica — чистые помощники: раскладка ханга, секвенсер (Евклид, сетка, поворот колец), содержимое сообщения seq.
// Без DOM, холста, Web Audio и window.T2D; лад — scale { on, pcs, snap } (без лада — пентатоника). Тесты — tools/models/cymatica.test.mjs.
export const SLOTS = 16;
export const F_MIN = 55, F_MAX = 880, F_DEF = 110;
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const wrap = (i, n) => ((i % n) + n) % n;
const NO_SCALE = { on: false, pcs: null, snap: (s) => s };

export function nearestIdx(list, s) {
  let j = 0;
  for (let i = 1; i < list.length; i++) if (Math.abs(list[i] - s) < Math.abs(list[j] - s)) j = i;
  return j;
}
export const NOTES = ['A', 'A♯', 'B', 'C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯'];
export function noteName(hz) {
  const s = Math.round(12 * Math.log2(hz / F_MIN));
  return NOTES[((s % 12) + 12) % 12] + (1 + Math.floor((s + 9) / 12));
}
// доли эха в четвертях: t — триоль, d — с точкой
export const ECHO_DIVS = [['1/16t', 1 / 6], ['1/16', 1 / 4], ['1/8t', 1 / 3], ['1/16d', 3 / 8], ['1/8', 1 / 2], ['1/4t', 2 / 3], ['1/8d', 3 / 4], ['1/4', 1], ['1/4d', 3 / 2]];

// ритм по Евклиду: k ударов на n шагов как можно ровнее, первый — удар
export function euclid(k, n) { return Array.from({ length: n }, (_, i) => (i * k) % n < k); }
// шаг ритма, ближайший ко времени касания: с последнего тика прошло больше полшага — уже следующий
export function nearestStep(nowMs, stepAtMs, idx, stepMs, len) {
  return (idx + Math.round((nowMs - stepAtMs) / stepMs)) % len;
}
// мелодия — случайное блуждание по ступеням (scaleSemis — допустимые полутоны по возрастанию)
export function walkMelody(len, startSemi, scaleSemis, rng = Math.random) {
  let i = 0;
  for (let k = 1; k < scaleSemis.length; k++) if (Math.abs(scaleSemis[k] - startSemi) < Math.abs(scaleSemis[i] - startSemi)) i = k;
  const out = [];
  for (let n = 0; n < len; n++) {
    out.push(scaleSemis[i]);
    const d = [-2, -1, 1, 2][Math.floor(rng() * 4)];
    i = Math.min(scaleSemis.length - 1, Math.max(0, i + d));
  }
  return out;
}
// поворот кольца: первые len гнёзд сдвигаются по кругу (i → i + k), остальные — как были
export function rotateSteps(steps, len, k) {
  const out = steps.slice();
  for (let i = 0; i < len; i++) out[(((i + k) % len) + len) % len] = steps[i];
  return out;
}
// ---------- раскладка ханга: по кругу — ступени лада (n секторов от верха по часовой), от края к центру — 3 октавы ----------
// кольца равной площади: край r > √(2/3) — кольцо 0 (ниже), до √(1/3) — 1, центр — 2 (выше); b — индекс ступени пластины в списке
const NOTE_TOP = 60;                           // 55–1760 Гц
export const RING_R = [0.9, 0.7, 0.33];        // середины колец
export function noteList(scale = NO_SCALE) {
  const out = [];
  for (let s = 0; s <= NOTE_TOP; s++) if (scale.on ? scale.snap(s) === s : [0, 3, 5, 7, 10].includes(s % 12)) out.push(s);
  return out;
}
export const degPerOct = (scale = NO_SCALE) => (scale.on && scale.pcs ? scale.pcs.length : 5);
export function cellIdx(x, y, b, n) {
  const r = Math.hypot(x, y);
  if (r > 1) return null;
  const ring = r > Math.sqrt(2 / 3) ? 0 : r > Math.sqrt(1 / 3) ? 1 : 2;
  const a = r < 1e-9 ? 0 : (Math.atan2(x, -y) + Math.PI * 2) % (Math.PI * 2);   // в самом центре угла нет — сектор 0
  return b + ring * n + (Math.floor((a / (Math.PI * 2)) * n) % n);
}
export function noteAt(x, y, b, n, list) {
  const i = cellIdx(x, y, b, n);
  return i == null || i >= list.length ? null : list[i];
}
export function cellOf(idx, b, n) {
  const k = idx - b;
  return k < 0 || k >= 3 * n ? null : { ring: Math.floor(k / n), sector: k % n };
}
export function cellCenter(ring, sector, n) {
  const a = ((sector + 0.5) / n) * Math.PI * 2, r = RING_R[ring];
  return { x: r * Math.sin(a), y: -r * Math.cos(a) };
}
// поворот пластины: каждый удар — на k ступеней, в середину клетки новой ноты (в пределах колец)
export function transposeHits(steps, k, b, n, list) {
  const top = Math.min(b + 3 * n, list.length) - 1;
  return steps.map((st) => {
    if (!st) return st;
    const i = cellIdx(st.x, st.y, b, n);
    if (i == null) return st;
    const c = cellOf(clamp(i + k, b, top), b, n), p = cellCenter(c.ring, c.sector, n);
    return { ...st, x: p.x, y: p.y };
  });
}
// два пальца: поворот или щипок — что изменилось сильнее (угол через ±180° — в градусах, расстояние — в px)
export function twistOrPinch(a0, a1, d0, d1) {
  const dA = Math.abs(((((a1 - a0) * 180) / Math.PI + 540) % 360) - 180), dD = Math.abs(d1 - d0);
  if (dA < 10 && dD < 20) return null;
  return dA / 10 >= dD / 20 ? 'twist' : 'pinch';
}
// сетка записи: ближайшая доля (кратная g гнёзд) по кругу длины; при равенстве — вперёд
export function snapToGrid(i, g, len) {
  let best = 0, bd = 1e9;
  for (let c = 0; c < len; c += g) {
    const d = Math.min(Math.abs(c - i), len - Math.abs(c - i));
    if (d < bd || (d === bd && c > i)) { bd = d; best = c; }
  }
  return best;
}
// причесать ритм: удары — на ближайшие доли сетки; в занятое гнездо встаёт первый, гнёзда за длиной не трогаются
export function quantizeRhythm(steps, len, g) {
  const out = steps.slice();
  for (let i = 0; i < len; i++) out[i] = null;
  for (let i = 0; i < len; i++) { const j = snapToGrid(i, g, len); if (steps[i] && !out[j]) out[j] = steps[i]; }
  return out;
}
// ступени для кубика: лад, если включён, иначе пентатоника; 0–48 полутонов от 55 Гц
export function scaleSemis(scale = NO_SCALE) {
  const out = [];
  for (let s = 0; s <= 48; s++) if (scale.on ? scale.snap(s) === s : [0, 3, 5, 7, 10].includes(s % 12)) out.push(s);
  return out;
}
// сообщение seq для worklet: ритм {vel, chance}, мелодия {s, x, y}; место в молчащей клетке (за 1760 Гц) уходит пустым — пауза
export function seqMessage(seq, notes, chance) {
  const sent = {
    rhythm: { len: seq.rhythm.len, steps: seq.rhythm.steps.map((st) => (st ? { vel: st.vel, chance: st.chance ?? 1 } : null)) },
    melody: { len: seq.melody.len, steps: seq.melody.steps.map((st, i) => (notes[i] == null ? null : { s: notes[i], x: st.x, y: st.y })) },
  };
  return { t: 'seq', bpm: seq.bpm, playing: seq.playing, chance, ...sent };
}
