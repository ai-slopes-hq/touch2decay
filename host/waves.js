// таблицы волн: циклы как у аналоговых генераторов и морфинг между ними — для звука Tenebrae, рисования форм и LFO строк
import { clamp } from './util.js';
const tri = (t) => 1 - 4 * Math.abs((((t + 0.25) % 1) + 1) % 1 - 0.5);
const GRAIN = (() => { let s = 11; return Array.from({ length: 40 }, () => { s = (s * 16807) % 2147483647; return Math.tanh(3 * ((s / 2147483647) * 2 - 1)); }); })();
// волны — свои циклы, посчитанные как у аналоговых генераторов, а не встроенные идеальные формы
export const WAVES = [
  { label: 'triangle', fn: (t) => { const x = tri(t); return x + 0.1 * x * x; } },               // лёгкая асимметрия: чётные гармоники
  { label: 'sharp', fn: (t) => Math.tanh(2.6 * tri(t) + 0.35) },                                 // треугольник в насыщение, как у Лиры
  { label: 'saw', fn: (t) => { const k = 1.4; return (2 * (1 - Math.exp(-k * t))) / (1 - Math.exp(-k)) - 1; } },   // изгиб зарядки конденсатора
  { label: 'pulse', fn: (t) => Math.tanh(9 * (Math.sin(2 * Math.PI * t) - 0.35)) },              // узкий импульс со скруглёнными фронтами
  { label: 'fold', fn: (t) => Math.sin(2.8 * Math.sin(2 * Math.PI * t) + 0.4) },                 // волнофолдер
  // злые: дальше по той же линии морфинга
  { label: 'sync', fn: (t) => (2 * ((t * 2.63) % 1) - 1) * (1 - 0.35 * t) },                     // жёсткая синхронизация: пила рвётся на краю цикла
  { label: 'crush', fn: (t) => Math.round(Math.sin(2 * Math.PI * (Math.floor(t * 8) + 0.5) / 8) * 2.5) / 2.5 },   // 8 отсчётов, 5 уровней — цифровой хруст
  { label: 'metal', fn: (t) => Math.sin(2 * Math.PI * t + 2.2 * Math.sin(2 * Math.PI * 7 * t)) }, // фазовая модуляция на 7-й гармонике: гнусаво, металлически
  { label: 'grain', fn: (t) => { const x = t * GRAIN.length, i = Math.floor(x) % GRAIN.length, fr = x - Math.floor(x); return GRAIN[i] + (GRAIN[(i + 1) % GRAIN.length] - GRAIN[i]) * fr; } },   // застывший кусок шума: хрип сломанного радио
];
export const NW = WAVES.length;
// вес таблицы i при позиции морфинга: треугольный, соседние таблицы перетекают
export const weight = (i, p) => Math.max(0, 1 - Math.abs(clamp(p) * (NW - 1) - i));
// форма в точке t при позиции p — для рисования и для фазы LFO
export const morphFn = (p) => (t) => {
  let y = 0;
  for (let i = 0; i < NW; i++) { const k = weight(i, p); if (k) y += k * WAVES[i].samp[Math.floor((((t % 1) + 1) % 1) * 1024) % 1024]; }
  return y;
};
export function morphName(p) {
  const x = clamp(p) * (NW - 1), i = Math.min(NW - 2, Math.floor(x)), fr = x - i;
  if (fr < 0.08) return WAVES[i].label;
  if (fr > 0.92) return WAVES[i + 1].label;
  return `${WAVES[i].label} → ${WAVES[i + 1].label}`;
}

// нормированные циклы для рисования считаются сразу, без звука
for (const w of WAVES) {
  const N = 1024, smp = new Float32Array(N);
  let mean = 0, peak = 0;
  for (let i = 0; i < N; i++) { smp[i] = w.fn(i / N); mean += smp[i] / N; }
  for (let i = 0; i < N; i++) { smp[i] -= mean; peak = Math.max(peak, Math.abs(smp[i])); }
  for (let i = 0; i < N; i++) smp[i] /= peak;
  w.samp = smp;
}
