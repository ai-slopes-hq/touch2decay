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
// тела по лучу structure: струна, мембрана, пластина, колокол, поющая чаша, ханг, маримба, калимба
var TUNINGS = (() => {
  const T = () => new Float64Array(NM);
  const s = T(), mem = T(), pl = T(), bell = T(), bowl = T(), hang = T(), mar = T(), kal = T();
  for (let k = 0; k < NM; k++) { s[k] = k + 1; mem[k] = MODES[k].j / MODES[0].j; pl[k] = mem[k] * mem[k]; }
  [0.5, 1, 1.2, 1.5, 2].forEach((x, k) => { bell[k] = x; });
  for (let k = 5; k < NM; k++) bell[k] = (pl[k] * 2.5) / pl[5];
  // поющая чаша: моды парами, чуть врозь (+0.4 %) — долгий звон с биениями
  const BW = [1, 2.71, 5.15, 8.43, 12.5, 17.4, 23.1, 29.6, 36.9, 45.0, 54.0, 63.8];
  for (let k = 0; k < NM; k++) bowl[k] = BW[k >> 1] * (k & 1 ? 1.004 : 1);
  // ханг: настроенные основной, октава и квинта через октаву; выше — как у пластины
  [1, 2, 3].forEach((x, k) => { hang[k] = x; });
  for (let k = 3; k < NM; k++) hang[k] = (pl[k] * 4) / pl[3];
  // брусок со свободными концами: β_n — корни cos·ch = 1; маримба настроена 1 : 4 : 10, выше — как брусок
  const ff = (n) => (n === 1 ? 4.7300 : n === 2 ? 7.8532 : ((2 * n + 1) * Math.PI) / 2);
  [1, 4, 10].forEach((x, k) => { mar[k] = x; });
  for (let k = 3; k < NM; k++) mar[k] = ((ff(k + 1) / ff(1)) ** 2 * 10) / (ff(3) / ff(1)) ** 2;
  // калимба — язычок, закреплённый с одного конца: β_n — корни cos·ch = −1, обертоны далеко и неровно
  const cf = (n) => (n === 1 ? 1.8751 : n === 2 ? 4.6941 : n === 3 ? 7.8548 : ((2 * n - 1) * Math.PI) / 2);
  for (let k = 0; k < NM; k++) kal[k] = (cf(k + 1) / cf(1)) ** 2;
  return [s, mem, pl, bell, bowl, hang, mar, kal];
})();

// structure 0..1 — по телам через 1/7: струна, мембрана, пластина, колокол, чаша, ханг, маримба, калимба;
// между соседними — интерполяция отношений в логарифме
function modeRatios(structure) {
  const n = TUNINGS.length - 1, x = clamp01(structure) * n, seg = Math.min(n - 1, Math.floor(x)), t = x - seg;
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
// выход: до 0.8 — прямая (удар звенит чисто), выше — мягко к 1.6; громкость дальше ловит общий ограничитель.
// Раньше тут был сплошной tanh, и нижние ноты у края пластины уходили в перегруз (искажения −16 дБ — хрип)
function outKnee(x) {
  const a = Math.abs(x);
  return a < 0.8 ? x : Math.sign(x) * (0.8 + 0.8 * Math.tanh((a - 0.8) / 0.8));
}
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

// ---------- часы секвенсера ----------
// шаг часов — шестнадцатая: отсчётов на шаг
function stepSamples(bpm, fs) { return Math.round((fs * 60) / bpm / 4); }
// отсчётов от момента t (с) до ближайшей шестнадцатой сетки MIDI-часов t0 + j·p/4 строго после t; не меньше 1.
// «Строго после» — с запасом в отсчёт: t — округлённый до отсчёта узел прошлого тика, он бывает раньше настоящего узла на полотсчёта
function nextTickFrame(t, t0, p, fs) {
  const q = p / 4, j = Math.floor((t + 0.6 / fs - t0) / q) + 1;
  return Math.max(1, Math.round((t0 + j * q - t) * fs));
}

// ---------- процессор ----------
var F_LO = 55, NV = 4, GRID_N = 96, SLEEP = 1e-14, BOW_TILT = 1.5, BOW_GAIN = 6, MAX_STRIKES = 16, OUT_GAIN = 0.2, STRIKE_GAIN = 5;   // удар — громкость одного касания примерно как у смычка
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
      // секвенсер: узор целиком из основного потока; r, m — текущие шаги ритма и мелодии; toNext — отсчётов до тика
      this.t = 0; this.lastLive = -1e12; this.lastTick = 0;
      this.seq = { bpm: 96, playing: false, rhythm: { len: 16, steps: [] }, melody: { len: 7, steps: [] } };
      this.stepN = stepSamples(96, this.fs); this.r = -1; this.m = -1; this.toNext = 0;
      this.lock = null;                              // сетка MIDI-часов { t0, p } (время контекста) или null: тики по ней, счёт r, m — свой
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
    strike(g, hz, vel, hard) {
      const i = pickVoice(this.voices, hz), v = this.voices[i];
      if (Math.abs(1200 * Math.log2(v.hz / hz)) >= 10) this.tune(v, hz);
      // длина импульса — твёрдость молоточка, но не дольше 0.4 периода основного тона: иначе удар гасит сам себя
      const len = Math.max(2, Math.round(Math.min(((5 - 4.5 * clamp01(hard)) * this.fs) / 1000, (0.4 * this.fs) / hz)));
      v.awake = true;
      if (this.strikes.length >= MAX_STRIKES) this.strikes.shift();
      this.strikes.push({ v: i, g, n: 0, len, a: vel });
    }
    // новый узор: удары шагов с готовыми весами мод; пуск — с первого шага сразу; смена темпа — от последнего тика
    setSeq(d) {
      const was = this.seq.playing, stepN = this.lock ? stepSamples(60 / this.lock.p, this.fs) : stepSamples(d.bpm, this.fs);
      this.seq = {
        bpm: d.bpm, playing: !!d.playing, chance: d.chance == null ? 1 : d.chance,
        // веса мод — заново только у шагов, чьё место изменилось: тянешь темп или длину — в звуковом потоке ничего тяжёлого.
        // место удара — у шага мелодии { s, x, y } (нота — клетка пластины) или, по-старому, у шага ритма (мелодия — полутоны)
        rhythm: { len: d.rhythm.len, steps: d.rhythm.steps.map((st, i) => {
          if (!st) return null;
          const old = this.seq.rhythm.steps[i], vel = st.vel == null ? 1 : st.vel, chance = st.chance == null ? 1 : st.chance;
          return st.x == null ? { vel, chance } : { x: st.x, y: st.y, vel, chance, g: old && old.x === st.x && old.y === st.y ? old.g : strikeGains(st.x, st.y) };
        }) },
        melody: { len: d.melody.len, steps: d.melody.steps.map((m, i) => {
          if (m == null || typeof m === 'number') return m;
          const old = this.seq.melody.steps[i];
          return { s: m.s, x: m.x, y: m.y, g: old && old.x === m.x && old.y === m.y ? old.g : strikeGains(m.x, m.y) };
        }) },
      };
      if (this.seq.playing && !was) {
        this.r = -1; this.m = -1; this.toNext = 0;
        if (this.lock) {                             // пуск при сетке: шаг 0 — на узле; опоздал меньше 30 мс — сразу, иначе на следующем (полшага-защита не сдвинет шаг 1 на лишний узел)
          const q = this.lock.p / 4, ph = (currentTime - this.lock.t0) - Math.floor((currentTime - this.lock.t0) / q) * q;
          if (ph >= 0.03) this.toNext = nextTickFrame(currentTime, this.lock.t0, this.lock.p, this.fs);
        }
      }
      else if (this.seq.playing && !this.lock && stepN !== this.stepN) this.toNext = Math.max(0, stepN - (this.t - this.lastTick));
      this.stepN = stepN;
    }
    // сетка: тик — на ближайшей шестнадцатой (от начала блока); прыжок сетки сдвигает только момент тика, r и m не трогаем.
    // Не раньше полушага после прошлого тика — иначе сдвиг сетки на ε дал бы двойной тик
    setLock(d) {
      const was = this.lock;
      this.lock = d.off || !(d.p > 0) ? null : { t0: d.t0, p: d.p };
      this.stepN = stepSamples(this.lock ? 60 / this.lock.p : this.seq.bpm, this.fs);
      if (!this.seq.playing || this.r < 0) return;
      if (!this.lock) { if (was) this.toNext = Math.max(0, this.stepN - (this.t - this.lastTick)); return; }
      const last = currentTime - (this.t - this.lastTick) / this.fs, from = Math.max(currentTime, last + this.lock.p / 8);
      this.toNext = nextTickFrame(from, this.lock.t0, this.lock.p, this.fs) + Math.round((from - currentTime) * this.fs);
    }
    tick() {
      const sq = this.seq;
      this.r = (this.r + 1) % sq.rhythm.len;
      this.m = (this.m + 1) % sq.melody.len;
      this.lastTick = this.t;
      const st0 = sq.rhythm.steps[this.r], hit = !!st0 && Math.random() < (st0.chance == null ? 1 : st0.chance) * (sq.chance == null ? 1 : sq.chance);   // шанс удара: свой у шага × общий
      this.port.postMessage({ t: 'step', r: this.r, m: this.m, time: this.t / this.fs, hit });
      const st = hit ? st0 : null, mel = sq.melody.steps[this.m];
      const at = mel && mel.g ? mel : st, semi = mel == null || typeof mel === 'number' ? mel : mel.s;
      if (!st || !at || !at.g || this.t - this.lastLive < this.stepN / 2) return;   // шаг мелодии без места — пауза
      this.strike(at.g, semi == null ? this.f0 : F_LO * 2 ** (semi / 12), st.vel, 0.5);
    }
    msg(d) {
      if (d.t === 'params') { Object.assign(this.fx, d); this.retune(); return; }
      if (d.t === 'f0') { this.f0 = Math.min(880, Math.max(55, d.hz)); return; }
      if (d.t === 'strike') {
        if (d.rec) this.lastLive = this.t;          // удар при записи: ближайший тик ритма его не повторит (без записи — играешь поверх)
        this.strike(strikeGains(d.x, d.y), d.hz || this.f0, d.vel == null ? 1 : d.vel, d.hard == null ? 0.5 : d.hard);
        return;
      }
      if (d.t === 'seq') { this.setSeq(d); return; }
      if (d.t === 'lock') { this.setLock(d); return; }
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
      if (!this.seq.playing && !this.strikes.length && bi < 0 && this.voices.every((v) => !v.awake)) {   // тишина: не считаем, выход — нули
        L.fill(0); if (R !== L) R.fill(0);
        this.count += N; this.t += N;
        if (this.count >= this.every) { this.count = 0; this.report(); }
        return true;
      }
      for (let n = 0; n < N; n++, this.t++) {
        if (this.seq.playing && --this.toNext < 0) {
          this.tick();
          if (this.lock) this.toNext = nextTickFrame(currentTime + n / fs, this.lock.t0, this.lock.p, fs) - 1;
          else this.toNext += this.stepN;
        }
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
        L[n] = outKnee(l * OUT_GAIN);
        if (R !== L) R[n] = outKnee(r * OUT_GAIN);
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
