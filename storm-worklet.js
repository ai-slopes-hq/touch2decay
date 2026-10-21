// Tonitrus — дождь, ветер и колокола звонницы (гром — буфером в tonitrus.js, сюда он приходит входом и раскачивает колокола).
// Дождь: подложка — шум в полосе, плотнее и ярче с силой дождя; капли — пуассоновы события: «пузырь» (капля в луже —
// затухающий синус, высота чуть поднимается, как у пузырька Миннарта) или «стук» (короткий щелчок шума по траве и земле).
// Крупнее капли — ниже пузыри и глуше стук. Ветер — розовый шум сквозь медленно плавающую полосу.
// Колокола: у каждого 8 мод с отношениями старых колоколов (hum, prime, tierce, quint, nominal, …) — двухполюсные резонаторы.
// Удар — толчок по всем модам (выше скорость — ярче); вход (гром) раскачивает их, если включено сочувствие (symp).
// Обратно ~20 раз в секунду: громкость каждого колокола (для качания на экране).
const NB = 5, NM = 8, MAXD = 40;
const RATIO = [0.25, 0.5, 0.6, 0.75, 1, 1.5, 2, 2.66];
const AMP = [0.45, 0.55, 0.5, 0.22, 1, 0.42, 0.28, 0.14];
const T60 = [1, 0.8, 0.62, 0.5, 0.45, 0.3, 0.22, 0.15];   // доля общего хвоста колокола
class Storm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rain = 0; this.rainT = 0; this.size = 0.4; this.rainLvl = 0.7; this.wind = 0; this.windT = 0;
    this.symp = 0; this.symT = 0; this.bellLvl = 0.8; this.decay = 0.6;
    this.drops = [];
    this.b1 = 0; this.b2 = 0; this.p0 = 0; this.p1 = 0; this.p2 = 0; this.bh = [0, 0]; this.bl = [0, 0]; this.bb = [0, 0];
    this.wl = 0; this.wb = 0; this.wph = Math.random() * 6; this.wph2 = Math.random() * 6;
    this.bells = Array.from({ length: NB }, (_, i) => ({ f: 220, pan: (i / (NB - 1) - 0.5) * 0.8, m: Array.from({ length: NM }, () => ({ a1: 0, a2: 0, y1: 0, y2: 0, w: 0 })), lv: 0 }));
    this.count = 0; this.every = Math.round(sampleRate / 20);
    this.port.onmessage = (e) => this.msg(e.data);
  }
  tune(i, f) {                                                     // частоты и затухания мод колокола
    const b = this.bells[i], sr = sampleRate, big = Math.min(2.4, Math.max(0.5, 220 / f));
    b.f = f;
    for (let k = 0; k < NM; k++) {
      const m = b.m[k], fr = Math.min(sr * 0.45, f * RATIO[k]), w = (2 * Math.PI * fr) / sr;
      const t60 = (1.5 + 9 * this.decay) * big * T60[k], r = Math.exp(-6.91 / (t60 * sr));
      m.a1 = 2 * r * Math.cos(w); m.a2 = -r * r; m.w = w; m.g = (1 - r) * 6;   // вход (гром) — слабее для долгих мод
    }
  }
  msg(d) {
    if (d.t === 'params') { for (const k of ['rainT', 'size', 'rainLvl', 'windT', 'symT', 'bellLvl']) if (d[k] != null) this[k] = d[k]; if (d.decay != null && d.decay !== this.decay) { this.decay = d.decay; this.bells.forEach((b, i) => this.tune(i, b.f)); } return; }
    if (d.t === 'bells') { d.f.forEach((f, i) => this.tune(i, f)); return; }
    if (d.t === 'strike') {                                        // удар языка: толчок по модам, у верхних — по скорости
      const b = this.bells[d.i]; if (!b) return;
      const v = d.vel ?? 1;
      for (let k = 0; k < NM; k++) { const m = b.m[k], a = AMP[k] * v * (k > 4 ? 0.4 + 0.6 * v : 1) * 0.16 * (0.85 + 0.3 * Math.random()); m.y1 += a * Math.sin(m.w); }
      return;
    }
    if (d.t === 'damp') { for (const b of this.bells) for (const m of b.m) { m.y1 *= 0.02; m.y2 *= 0.02; } this.drops.length = 0; this.rain = this.rainT = 0; return; }
  }
  drop(size) {                                                     // новая капля
    const big = 0.4 + size * 1.2 * Math.random();
    if (Math.random() < 0.28) {                                    // пузырь в луже
      const f = (700 + 2600 * Math.random() ** 1.5) / (0.6 + big * 0.7);
      this.drops.push({ k: 0, ph: 0, f, rise: 1 + 2.5 * Math.random(), a: (0.04 + 0.1 * Math.random()) * big, d: Math.exp(-1 / ((0.004 + 0.012 * Math.random()) * sampleRate)), pan: Math.random() * 2 - 1, t: 0 });
    } else {                                                       // стук по траве и земле
      this.drops.push({ k: 1, a: (0.05 + 0.14 * Math.random()) * big, d: Math.exp(-1 / ((0.0006 + 0.002 * Math.random()) * sampleRate)), lp: 0, c: 0.15 + 0.6 * Math.random() / big, pan: Math.random() * 2 - 1, t: 0 });
    }
  }
  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length, sr = sampleRate, inp = inputs[0] && inputs[0][0];
    for (let k = 0; k < n; k++) { L[k] = 0; if (R !== L) R[k] = 0; }
    this.rain += (this.rainT - this.rain) * Math.min(1, n / (sr * 0.8));
    this.wind += (this.windT - this.wind) * Math.min(1, n / (sr * 1.5));
    this.symp += (this.symT - this.symp) * Math.min(1, n / (sr * 0.3));
    const rn = this.rain, rate = rn * rn * 520;                    // капель в секунду
    // подложка дождя: розоватый шум, срез верха растёт с силой
    if (rn > 0.002) {
      const bed = rn ** 1.3 * 0.09 * this.rainLvl, ch = Math.exp(-2 * Math.PI * (1800 + 5500 * rn) / sr), cl = Math.exp(-2 * Math.PI * 450 / sr);
      for (let c = 0; c < 2; c++) {
        const o = c ? R : L; if (c && R === L) break;
        let h = this.bh[c], l = this.bl[c], bb = this.bb[c];
        for (let k = 0; k < n; k++) {
          const w = Math.random() * 2 - 1; bb = 0.97 * bb + 0.03 * w; const x = w * 0.6 + bb * 2.5;
          l = x + (l - x) * ch;                                    // срез верха
          h = l + (h - l) * cl;                                    // срез низа (вычитанием)
          o[k] += (l - h) * bed;
        }
        this.bh[c] = h; this.bl[c] = l; this.bb[c] = bb;
      }
      // капли: пуассоновы события по отсчётам
      let p = (rate * n) / sr;
      while (p > 0 && this.drops.length < MAXD) { if (Math.random() < Math.min(1, p)) this.drop(this.size); p -= 1; }
    }
    for (let j = this.drops.length - 1; j >= 0; j--) {
      const dr = this.drops[j], g = this.rainLvl, gl = (1 - dr.pan * 0.8) * 0.5, gr = (1 + dr.pan * 0.8) * 0.5;
      const at = Math.floor(Math.random() * n * 0.9) * (dr.t === 0 ? 1 : 0);
      for (let k = at; k < n; k++) {
        let s;
        if (dr.k === 0) { dr.ph += (dr.f * (1 + dr.rise * dr.t)) / sr; s = Math.sin(6.2832 * dr.ph) * dr.a; dr.a *= dr.d; dr.t += 1 / sr; }
        else { dr.lp += dr.c * ((Math.random() * 2 - 1) - dr.lp); s = dr.lp * dr.a; dr.a *= dr.d; dr.t += 1 / sr; }
        s *= g; L[k] += s * gl; if (R !== L) R[k] += s * gr;
      }
      if (dr.a < 1e-4) this.drops.splice(j, 1);
    }
    // ветер: розовый шум сквозь плавающую полосу
    if (this.wind > 0.002) {
      this.wph += (n / sr) * 0.07; this.wph2 += (n / sr) * 0.023;
      const gust = 0.55 + 0.45 * Math.sin(this.wph) * Math.sin(this.wph2 * 1.7 + 1), fc = 260 + 900 * gust * this.wind, a = Math.exp(-2 * Math.PI * fc / sr), gw = this.wind * this.wind * 0.22 * gust;
      let wl = this.wl, wb = this.wb;
      for (let k = 0; k < n; k++) { const w = Math.random() * 2 - 1; wb = 0.98 * wb + 0.02 * w; wl = wb * 6 + (wl - wb * 6) * a; L[k] += wl * gw * 0.9; if (R !== L) R[k] += wl * gw * 1.1; }
      this.wl = wl; this.wb = wb;
    }
    // колокола
    const sy = this.symp * 0.5, gb = this.bellLvl;
    for (const b of this.bells) {
      const gl = (1 - b.pan) * 0.5, gr = (1 + b.pan) * 0.5;
      let e = 0;
      for (let q = 0; q < NM; q++) {
        const m = b.m[q];
        if (Math.abs(m.y1) + Math.abs(m.y2) < 1e-7 && !(sy > 0 && inp)) continue;
        let y1 = m.y1, y2 = m.y2; const a1 = m.a1, a2 = m.a2, gi = (m.g || 0) * sy * AMP[q];
        for (let k = 0; k < n; k++) {
          const y = a1 * y1 + a2 * y2 + (inp ? inp[k] * gi : 0);
          y2 = y1; y1 = y;
          const s = y * gb; L[k] += s * gl; if (R !== L) R[k] += s * gr;
        }
        m.y1 = y1; m.y2 = y2; e += y1 * y1 + y2 * y2;
      }
      b.lv = Math.sqrt(e);
    }
    for (let k = 0; k < n; k++) { L[k] = Math.tanh(L[k]); if (R !== L) R[k] = Math.tanh(R[k]); }
    this.count += n;
    if (this.count >= this.every) { this.count = 0; this.port.postMessage({ t: 'lv', b: this.bells.map((b) => b.lv), rain: this.rain }); }
    return true;
  }
}
registerProcessor('storm', Storm);
