// лад: общий для миров (или свой у мира, когда лад не связан — см. perScl в app.js)
export const SCALES = [                            // ступени от тоники, в полутонах
  { label: 'major', steps: [0, 2, 4, 5, 7, 9, 11] },
  { label: 'minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  { label: 'dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { label: 'phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  { label: 'lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  { label: 'mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
];
export const scl = { idx: 0, root: 0, on: false, slideUntil: 0 };
export const inScale = (n) => SCALES[scl.idx].steps.includes((((n - scl.root) % 12) + 12) % 12);
// высота в полутонах от 55 Гц → ближайшая нота лада (для других миров); без лада — как есть
export function snapSemi(s) {
  if (!scl.on) return s;
  let best = s, bd = 99;
  for (let n = Math.floor(s) - 7; n <= Math.ceil(s) + 7; n++) {
    if (n < 0 || !inScale(n)) continue;
    if (Math.abs(n - s) < bd) { bd = Math.abs(n - s); best = n; }
  }
  return best;
}
// для других миров (T2D): тоника — класс высоты от A, классы высот лада; без лада — 0 и null
export const scaleRoot = () => (scl.on ? scl.root : 0);
export const scalePCs = () => (scl.on ? SCALES[scl.idx].steps.map((s) => (s + scl.root) % 12) : null);
