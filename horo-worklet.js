// Horologium — голос West Coast (Buchla 259 + 292), по сэмплам. На каждую шестерню — свой голос.
// Сложный генератор: модулятор (треугольник, f·ratio) модулирует не высоту, а тембр — глубину складок (timbre mod, как у 259:
// так звучит Букла, а не DX); FM — едва-едва, чтобы оживить. idx — глубина этой модуляции.
// Складыватель (259 timbre): синус × A (1…10) с небольшим сдвигом (symmetry) отражается от ±1 — острые перегибы, жёсткие
// нечётные гармоники; A тоже идёт за вактролом: удар — звенящие складки, хвост — почти чистый синус. Считается с 2× запасом.
// Low pass gate (292, режим combo): вактрол — светодиод + фоторезистор: заряд за ~1 мс, спад сначала быстрый, потом всё
// медленнее (хвост). Один и тот же вактрол ведёт срез фильтра (экспоненциально, 30 Гц … fmax) и громкость — звук темнеет
// быстрее, чем тихнет: «бонг», деревянный, перкуссионный. Фильтр — TPT SVF, без резонанса.
// Сообщения: {t: 'hit', i, at, f, ratio, idx, fold, dec, vel, peak, fmax, pan}. Удар в прошлом (> 30 мс) пропускается.
const NV = 4;
class Horo extends AudioWorkletProcessor {
  constructor() {
    super();
    this.vo = Array.from({ length: NV }, () => ({ v: 0, gate: 0, tgt: 0, f: 110, ratio: 1.5, idx: 0, fold: 0, tau: 0.1, fmax: 8000, peak: 0, gl: 0.7, gr: 0.7, cph: 0, mph: 0, c1: 0, c2: 0, live: false }));
    this.q = []; this.dc = [0, 0]; this.dx = [0, 0];
    this.port.onmessage = (e) => { const d = e.data; if (d.t === 'hit') { this.q.push(d); this.q.sort((a, b) => a.at - b.at); } else if (d.t === 'stop') { this.q.length = 0; for (const o of this.vo) o.gate = 0; } };
  }
  trig(d) {
    const o = this.vo[d.i], sr = sampleRate;
    o.f = d.f; o.ratio = d.ratio; o.idx = d.idx; o.fold = d.fold; o.tau = d.dec * 0.32; o.fmax = Math.min(d.fmax, sr * 0.45); o.peak = d.peak;
    const p = (d.pan + 1) * Math.PI / 4; o.gl = Math.cos(p); o.gr = Math.sin(p);
    o.tgt = 0.6 + 0.4 * d.vel; o.gate = Math.round(0.004 * sr); o.live = true;
  }
  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length, sr = sampleRate, t0 = currentTime, TAU = Math.PI * 2;
    for (let k = 0; k < n; k++) { L[k] = 0; if (R !== L) R[k] = 0; }
    const ev = [];                                          // удары этого блока: [сэмпл, сообщение]
    while (this.q.length && this.q[0].at < t0 + n / sr) { const d = this.q.shift(); if (d.at < t0 - 0.03) continue; ev.push([Math.max(0, Math.round((d.at - t0) * sr)), d]); }
    const aA = 1 - Math.exp(-1 / (0.0011 * sr)), ins = 0.5 / sr;
    for (let k = 0, e = 0; k < n; k++) {
      while (e < ev.length && ev[e][0] <= k) this.trig(ev[e++][1]);
      for (const o of this.vo) {
        if (!o.live) continue;
        if (o.gate > 0) { o.v += (o.tgt - o.v) * aA; o.gate--; }            // вактрол: заряд
        else { const u = 1 - o.v; o.v -= o.v / (o.tau * sr * (0.4 + 1.1 * u * u)); if (o.v < 2e-5) { o.v = 0; o.live = false; o.c1 = o.c2 = 0; continue; } }   // спад всё медленнее
        const v = o.v, dev = o.idx * o.f * 0.25 * v, A0 = 1 + o.fold * 7 * (0.1 + 0.9 * v * v), sym = 0.15 * o.fold;
        let y = 0;
        for (let s = 0; s < 2; s++) {                       // 2× запас: складки дают много гармоник
          o.mph += o.f * o.ratio * ins; o.mph -= Math.floor(o.mph);
          const tri = 1 - 4 * Math.abs(o.mph - 0.5);
          o.cph += (o.f + dev * tri) * ins; o.cph -= Math.floor(o.cph);
          const A = A0 * (1 + o.idx * 1.4 * v * (0.5 + 0.5 * tri));   // модулятор гнёт складки
          let x = (Math.sin(TAU * o.cph) + sym) * A;
          if (x > 1 || x < -1) { let u = (x + 1) % 4; if (u < 0) u += 4; x = u < 2 ? u - 1 : 3 - u; }   // отражение от ±1
          y += x * (1.5 - 0.5 * x * x);                     // чуть скруглить вершины
        }
        y *= 0.5;
        const fc = Math.min(sr * 0.45, 30 * (o.fmax / 30) ** (v ** 0.6)), g = Math.tan(Math.PI * fc / sr), kq = 1.3;   // LPG: срез от вактрола
        const a1 = 1 / (1 + g * (g + kq)), a2 = g * a1, a3 = g * a2, v3 = y - o.c2, v1 = a1 * o.c1 + a2 * v3, v2 = o.c2 + a2 * o.c1 + a3 * v3;
        o.c1 = 2 * v1 - o.c1; o.c2 = 2 * v2 - o.c2;
        const s = v2 * v * o.peak;                          // combo: и срез, и громкость
        L[k] += s * o.gl; if (R !== L) R[k] += s * o.gr;
      }
    }
    const dc = this.dc, dx = this.dx;                       // без постоянной (symmetry), мягкий потолок
    for (let k = 0; k < n; k++) {
      let x = L[k], y = x - dx[0] + 0.997 * dc[0]; dx[0] = x; dc[0] = y; L[k] = Math.tanh(y);
      if (R !== L) { x = R[k]; y = x - dx[1] + 0.997 * dc[1]; dx[1] = x; dc[1] = y; R[k] = Math.tanh(y); }
    }
    return true;
  }
}
registerProcessor('horo', Horo);
