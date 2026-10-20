// Пластина Cymatica — AudioWorklet: 24 моды круглой пластины, удар / смычок / шум, 4 голоса-пластины.
// Чистые функции — на верхнем уровне (их проверяет tools/test-plate.mjs через vm), процессор — внизу.
// Спека: docs/superpowers/specs/2026-10-20-cymatica-design.md, часть 2.

// ---------- математика мод ----------
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function lerpLog(a, b, t) { return a * (b / a) ** t; }

// функция Бесселя первого рода — степенной ряд: для x ≤ 20 и m ≤ 8 точности хватает с запасом
function besselJ(m, x) {
  let term = (x / 2) ** m;
  for (let i = 2; i <= m; i++) term /= i;
  let sum = term;
  const q = -(x * x) / 4;
  for (let k = 1; k < 120; k++) {
    term *= q / (k * (k + m));
    sum += term;
    if (k > x && Math.abs(term) < 1e-17) break;
  }
  return sum;
}

// 24 моды круглой пластины: пары (m — узловые диаметры 0–8, n — узловые окружности 1–4) по возрастанию нуля j(m,n)
var MODES = (() => {
  const all = [];
  for (let m = 0; m <= 8; m++) {
    let n = 0, x0 = 0.05, f0 = besselJ(m, x0);
    for (let x = 0.1; x < 20 && n < 4; x += 0.05) {
      const f = besselJ(m, x);
      if (f0 * f < 0) {                              // смена знака — уточняем бисекцией
        let a = x - 0.05, b = x;
        for (let i = 0; i < 60; i++) { const c = (a + b) / 2; if (besselJ(m, a) * besselJ(m, c) <= 0) b = c; else a = c; }
        all.push({ m, n: ++n, j: (a + b) / 2 });
      }
      f0 = f;
    }
  }
  return all.sort((a, b) => a.j - b.j).slice(0, 24);
})();
var NM = MODES.length;

// максимум |J_m(j·r)| на r ∈ [0, 1] — форма моды нормируется на него
var NORM = (() => {
  const out = new Float64Array(NM);
  MODES.forEach((d, k) => { for (let i = 0; i <= 400; i++) out[k] = Math.max(out[k], Math.abs(besselJ(d.m, (d.j * i) / 400))); });
  return out;
})();

// строи: струна (1, 2, 3…), мембрана j/j01, пластина (j/j01)², колокол (hum, prime, tierce, quint, nominal, дальше — строй пластины от 2.5)
var TUNINGS = (() => {
  const s = new Float64Array(NM), mem = new Float64Array(NM), pl = new Float64Array(NM), bell = new Float64Array(NM);
  for (let k = 0; k < NM; k++) { s[k] = k + 1; mem[k] = MODES[k].j / MODES[0].j; pl[k] = mem[k] * mem[k]; }
  [0.5, 1, 1.2, 1.5, 2].forEach((x, k) => { bell[k] = x; });
  for (let k = 5; k < NM; k++) bell[k] = (pl[k] * 2.5) / pl[5];
  return [s, mem, pl, bell];
})();

// structure 0..1: 0 струна, ⅓ мембрана, ⅔ пластина, 1 колокол; между соседними — интерполяция отношений в логарифме
function modeRatios(structure) {
  const x = clamp01(structure) * 3, seg = Math.min(2, Math.floor(x)), t = x - seg;
  const A = TUNINGS[seg], B = TUNINGS[seg + 1], r = new Float64Array(NM);
  for (let k = 0; k < NM; k++) r[k] = A[k] * (B[k] / A[k]) ** t;
  return r;
}

// форма моды в точке пластины: x, y ∈ [−1, 1], центр — 0; вне круга — 0
function modeShape(k, x, y) {
  const r = Math.hypot(x, y);
  if (r > 1) return 0;
  const d = MODES[k];
  return (besselJ(d.m, d.j * r) * Math.cos(d.m * Math.atan2(y, x))) / NORM[k];
}
// громкость мод при ударе в точку: в узле мода молчит
function strikeGains(x, y) {
  const g = new Float64Array(NM);
  for (let k = 0; k < NM; k++) g[k] = Math.abs(modeShape(k, x, y));
  return g;
}

// затухание: damping — общая длина (0.08–12 с), brightness — насколько дольше живёт верх
function t60s(ratios, damping, brightness) {
  const T = lerpLog(0.08, 12, clamp01(damping)), e = 2 * (1 - clamp01(brightness)), out = new Float64Array(NM);
  for (let k = 0; k < NM; k++) out[k] = T * (1 / ratios[k]) ** e;
  return out;
}
// двухполюсный резонатор моды: y = b1·y1 + b2·y2 + g·x
function resCoefs(hz, t60, fs) {
  const R = 10 ** (-3 / (t60 * fs)), w = (2 * Math.PI * hz) / fs;
  return { b1: 2 * R * Math.cos(w), b2: -R * R };
}
// голос для ноты: тот же (±10 центов), иначе самый тихий
function pickVoice(voices, hz) {
  for (let i = 0; i < voices.length; i++) if (Math.abs(1200 * Math.log2(voices[i].hz / hz)) < 10) return i;
  let best = 0;
  for (let i = 1; i < voices.length; i++) if (voices[i].level < voices[best].level) best = i;
  return best;
}
// форма одной моды на сетке n×n: J_m(j·r) — из радиальной таблицы (1024 точки), дальше только cos(mθ) — дёшево
function modeGrid(k, n) {
  const d = MODES[k], RN = 1024, rad = new Float64Array(RN + 2), out = new Float32Array(n * n);
  for (let i = 0; i <= RN + 1; i++) rad[i] = besselJ(d.m, (d.j * i) / RN) / NORM[k];
  for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
    const x = ((ix + 0.5) / n) * 2 - 1, y = ((iy + 0.5) / n) * 2 - 1, r = Math.hypot(x, y);
    if (r > 1) continue;
    const u = r * RN, i = Math.floor(u), f = u - i;
    out[iy * n + ix] = (rad[i] + (rad[i + 1] - rad[i]) * f) * Math.cos(d.m * Math.atan2(y, x));
  }
  return out;
}
// формы всех мод на сетке n×n (для песка в основном потоке)
function shapeGrid(n) {
  const grid = new Float32Array(NM * n * n);
  for (let k = 0; k < NM; k++) grid.set(modeGrid(k, n), k * n * n);
  return grid;
}

// ---------- процессор ----------
var NV = 4, GRID_N = 96, SLEEP = 1e-14, BOW_TILT = 1.5, BOW_GAIN = 6, MAX_STRIKES = 16, OUT_GAIN = 0.2, STRIKE_GAIN = 5;   // удар — громкость одного касания примерно как у смычка
// смычок: трение по разности скоростей смычка и пластины в точке (кривая как у bowed-string), нормировано на покой
function bowTable(d) { return Math.min(1, (Math.abs(d) * 5 + 0.75) ** -4); }

if (typeof AudioWorkletProcessor !== 'undefined') {
  class PlateProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.fs = sampleRate;
      this.fx = { structure: 0.66, damping: 0.5, brightness: 0.5 };
      this.f0 = 110;
      this.voices = Array.from({ length: NV }, () => ({
        hz: 110, level: 0, awake: false,
        y1: new Float64Array(NM), y2: new Float64Array(NM), b1: new Float64Array(NM), b2: new Float64Array(NM),
        gs: new Float64Array(NM), wb: new Float64Array(NM), en: new Float64Array(NM), x: new Float64Array(NM),
      }));
      this.strikes = [];
      this.bows = new Map();
      this.lp = 0;                                   // шум для возбудителя «дыхание»
      this.grid = new Float32Array(NM * GRID_N * GRID_N); this.gridK = 0;   // сетка форм мод — по одной моде за блок
      this.count = 0; this.every = Math.round(this.fs / 30);
      this.enA = 1 - Math.exp(-1 / (0.05 * this.fs));
      this.retune();
      this.port.onmessage = (e) => this.msg(e.data);
    }
    retune() {
      this.ratios = modeRatios(this.fx.structure);
      this.t60 = t60s(this.ratios, this.fx.damping, this.fx.brightness);
      for (const v of this.voices) this.tune(v, v.hz);
    }
    // коэффициенты голоса: усиление удара — sin ω (импульс даёт амплитуду ~1), смычка — ещё ·√(1−R²) (шум даёт ~1) и спад по модам
    tune(v, hz) {
      v.hz = hz;
      for (let k = 0; k < NM; k++) {
        const f = hz * this.ratios[k];
        if (f > 18000 || f > 0.45 * this.fs) { v.b1[k] = 0; v.b2[k] = 0; v.gs[k] = 0; v.wb[k] = 0; v.y1[k] = 0; v.y2[k] = 0; continue; }
        const c = resCoefs(f, this.t60[k], this.fs), s = Math.sin((2 * Math.PI * f) / this.fs);
        // смычок и дыхание — шум: без спада по модам верх режет уши; вес ratio^−1.5, как у настоящего смычка
        v.b1[k] = c.b1; v.b2[k] = c.b2; v.gs[k] = s; v.wb[k] = Math.sqrt(1 + c.b2) * this.ratios[k] ** -BOW_TILT;
      }
    }
    msg(d) {
      if (d.t === 'params') { Object.assign(this.fx, d); this.retune(); return; }
      if (d.t === 'f0') { this.f0 = Math.min(880, Math.max(55, d.hz)); return; }
      if (d.t === 'strike') {
        const hz = d.hz || this.f0, i = pickVoice(this.voices, hz), v = this.voices[i];
        if (Math.abs(1200 * Math.log2(v.hz / hz)) >= 10) this.tune(v, hz);
        // длина импульса — твёрдость молоточка, но не дольше 0.4 периода основного тона: иначе удар гасит сам себя
        const len = Math.max(2, Math.round(Math.min(((5 - 4.5 * clamp01(d.hard == null ? 0.5 : d.hard)) * this.fs) / 1000, (0.4 * this.fs) / hz)));
        v.awake = true;
        if (this.strikes.length >= MAX_STRIKES) this.strikes.shift();
        this.strikes.push({ v: i, g: strikeGains(d.x, d.y), n: 0, len, a: d.vel == null ? 1 : d.vel });
        return;
      }
      if (d.t === 'bow') {
        if (!d.on) { this.bows.delete(d.id); return; }
        const b = this.bows.get(d.id) || { x: 0, y: 0, exciter: 0, pressure: 0.5, amp: 1, g: null };
        for (const k of ['x', 'y', 'exciter', 'pressure', 'amp']) if (d[k] != null) b[k] = d[k];
        if (!b.g || d.x != null || d.y != null) b.g = strikeGains(b.x, b.y);
        this.bows.set(d.id, b);
      }
    }
    process(inputs, outputs) {
      const out = outputs[0], L = out[0], R = out[1] || out[0], N = L.length, fs = this.fs;
      if (this.gridK < NM) {
        this.grid.set(modeGrid(this.gridK, GRID_N), this.gridK * GRID_N * GRID_N);
        if (++this.gridK === NM) this.port.postMessage({ t: 'shapes', n: GRID_N, grid: this.grid });
      }
      // смычки звучат на текущей высоте: голос этой ноты (или самый тихий, перестроенный)
      let bi = -1;
      if (this.bows.size) {
        bi = pickVoice(this.voices, this.f0);
        const bv = this.voices[bi];
        if (Math.abs(1200 * Math.log2(bv.hz / this.f0)) >= 10) this.tune(bv, this.f0);
        bv.awake = true;
      }
      if (!this.strikes.length && bi < 0 && this.voices.every((v) => !v.awake)) {   // тишина: не считаем, выход — нули
        L.fill(0); if (R !== L) R.fill(0);
        this.count += N;
        if (this.count >= this.every) { this.count = 0; this.report(); }
        return true;
      }
      for (let n = 0; n < N; n++) {
        for (const v of this.voices) v.x.fill(0);
        // удары: полукосинус единичной площади, длина — твёрдость молоточка
        for (let s = this.strikes.length - 1; s >= 0; s--) {
          const st = this.strikes[s], p = (st.a * (1 - Math.cos((2 * Math.PI * st.n) / st.len))) / st.len, x = this.voices[st.v].x;
          for (let k = 0; k < NM; k++) x[k] += st.g[k] * p * STRIKE_GAIN;
          if (++st.n >= st.len) this.strikes.splice(s, 1);
        }
        if (bi >= 0) {
          const v = this.voices[bi];
          this.lp += 0.1 * (Math.random() * 2 - 1 - this.lp);
          for (const b of this.bows.values()) {
            let vp = 0;                               // скорость пластины в точке смычка
            for (let k = 0; k < NM; k++) vp += b.g[k] * (v.y1[k] - v.y2[k]);
            const vb = 0.25, fric = bowTable(vb - vp) / bowTable(vb);
            const bow = (Math.random() * 2 - 1) * fric, breath = this.lp * 3;
            const e = ((1 - b.exciter) * bow + b.exciter * breath) * b.amp * (0.5 + b.pressure) * BOW_GAIN;
            for (let k = 0; k < NM; k++) v.x[k] += b.g[k] * e * v.wb[k];
          }
        }
        let l = 0, r = 0;
        for (const v of this.voices) {
          if (!v.awake) continue;
          for (let k = 0; k < NM; k++) {
            const y = v.b1[k] * v.y1[k] + v.b2[k] * v.y2[k] + v.gs[k] * v.x[k];
            v.y2[k] = v.y1[k]; v.y1[k] = y;
            v.en[k] += (y * y - v.en[k]) * this.enA;
            if (k & 1) { l += 0.65 * y; r += 0.35 * y; } else { l += 0.35 * y; r += 0.65 * y; }
          }
        }
        L[n] = 0.98 * Math.tanh(l * OUT_GAIN);
        if (R !== L) R[n] = 0.98 * Math.tanh(r * OUT_GAIN);
        if (++this.count >= this.every) { this.count = 0; this.report(); }
      }
      // голос без ударов и смычков, отзвеневший до тишины, засыпает: состояние в ноль, дальше не считается
      for (let i = 0; i < NV; i++) {
        const v = this.voices[i];
        if (!v.awake || i === bi || this.strikes.some((st) => st.v === i)) continue;
        let e = 0;
        for (let k = 0; k < NM; k++) e += v.en[k];
        if (e < SLEEP) { v.awake = false; v.y1.fill(0); v.y2.fill(0); v.en.fill(0); }
      }
      return true;
    }
    // ~30 раз в секунду: энергии мод (сумма по голосам) и уровни голосов — для песка и резонатора
    report() {
      const e = new Float32Array(NM), voices = [];
      for (const v of this.voices) {
        let lv = 0;
        for (let k = 0; k < NM; k++) { e[k] += v.en[k]; lv += v.en[k]; }
        v.level = lv;
        voices.push({ hz: v.hz, level: lv });
      }
      this.port.postMessage({ t: 'energy', e, voices });
    }
  }
  registerProcessor('plate', PlateProcessor);
}
