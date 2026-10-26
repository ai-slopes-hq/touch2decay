// Чистые формулы звука Tenebrae (мир I): без DOM и Web Audio. Их берут и app.js (рисование, Web Audio),
// и движок мира; числа закреплены тестом tools/models/tenebrae-tone.test.mjs.
import { clamp, lerpLog } from '../../host/util.js';

const F_LO = 55, SEMIS = 60, WARP = 1.45;      // A1, пять октав, растяжка низа (как в app.js)
const CUT_LO = 40, CUT_HI = 18000;
const SHIFT_MAX = 1500;
const HARM = 220, N = 1024;

const semi = (x) => SEMIS * clamp(x) ** WARP;
const xOf = (s) => (clamp(s, 0, SEMIS) / SEMIS) ** (1 / WARP);

// x поля → x ближайшей ноты лада; scale — { on, inScale(n) }
export function quantX(x, scale) {
  const s = semi(x);
  let best = s, bd = 99;
  for (let n = Math.floor(s) - 7; n <= Math.ceil(s) + 7; n++) {
    if (n < 0 || n > SEMIS || !scale.inScale(n)) continue;
    const d = Math.abs(n - s);
    if (d < bd) { bd = d; best = n; }
  }
  return xOf(best);
}

// высота кружка в Гц: x поля (с ладом — к ноте) → полутоны от A1
export const freqOf = (x, scale) => F_LO * 2 ** (semi(scale.on ? quantX(x, scale) : x) / 12);

// detune: в модели beat уже в Гц, c2 = f + beat
export const beatHz = (beat) => beat;

// cutoff кружка — на весь диапазон; ось Y ведёт его ещё на ±2.25 октавы; открытая FM приоткрывает фильтр (fmOpen 0…1)
export const cutoffOf = (cut, y, fmOpen) =>
  clamp(lerpLog(CUT_LO, CUT_HI, cut) * 2 ** ((y - 0.5) * 4.5) * 2 ** (1.5 * fmOpen), 20, 20000);

// сдвиг частоты: середина луча — ноль, дальше вверх, ближе к центру — вниз; до ±1.5 кГц, у нуля — медленно
export const shiftHz = (t) => {
  const u = 2 * t - 1, a = Math.abs(u);
  return a < 0.04 ? 0 : Math.sign(u) * (2 ** (((a - 0.04) / 0.96) * 11) - 1) * (SHIFT_MAX / 2047);
};

// цикл волны fn(t), t 0…1 → гармоники для PeriodicWave; громкость выравнивается по RMS
export function waveCoeffs(fn) {
  const smp = new Float64Array(N);
  let mean = 0;
  for (let i = 0; i < N; i++) { smp[i] = fn(i / N); mean += smp[i] / N; }
  let peak = 0;
  for (let i = 0; i < N; i++) { smp[i] -= mean; peak = Math.max(peak, Math.abs(smp[i])); }
  let rms = 0;
  for (let i = 0; i < N; i++) { smp[i] /= peak; rms += (smp[i] * smp[i]) / N; }
  const re = new Float64Array(HARM), im = new Float64Array(HARM);
  for (let h = 1; h < HARM; h++) {
    let a = 0, b = 0;
    for (let i = 0; i < N; i++) { const ph = (2 * Math.PI * h * i) / N; a += smp[i] * Math.cos(ph); b += smp[i] * Math.sin(ph); }
    re[h] = (2 * a) / N; im[h] = (2 * b) / N;
  }
  return { re, im, level: 0.24 / Math.sqrt(rms) };
}

// для голосов фазы гармоник у всех таблиц одни (как у saw, ref — её индекс в списке): морф между
// соседями — чистая интерполяция амплитуд, без провалов громкости и взаимного гашения посередине
export function alignCoeffs(list, ref = 2) {
  const r = list[ref];
  return list.map((w) => {
    const re = new Float64Array(w.re.length), im = new Float64Array(w.im.length);
    for (let h = 1; h < re.length; h++) {
      const m = Math.hypot(w.re[h], w.im[h]), th = Math.atan2(r.im[h], r.re[h]);
      re[h] = m * Math.cos(th); im[h] = m * Math.sin(th);
    }
    return { re, im };
  });
}
