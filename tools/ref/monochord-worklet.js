// Эталон для сверки ядра Monochordum: копия monochord-worklet.js, ГСЧ с зерном (mulberry32, processorOptions.seed) вместо Math.random — единственное отличие.
// Monochordum — звук струн: волновод Карплуса — Стронга в AudioWorklet (в графе Web Audio петля короче 128 отсчётов невозможна,
// а струне нужны задержки от 30 до 900 отсчётов). Струна: линия задержки с дробной длиной (линейная интерполяция), в петле —
// однополюсный lowpass (яркость) и потеря за проход (t60). Возбуждение: щипок — короткий шумовой всплеск, гребёнка по месту щипка;
// смычок и ветер — непрерывный шум, громкость задаёт главный поток. Энергия струн ~30 раз в секунду уходит обратно — для рисования.
const N_STR = 4, BUF = 4096;
class Mono extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.seed = (options?.processorOptions?.seed ?? 1) >>> 0;   // зерно mulberry32
    this.fs = sampleRate;
    this.s = Array.from({ length: N_STR }, (_, i) => ({
      buf: new Float32Array(BUF), w: 0, len: 400, lp: 0, b: 0.5, g: 0.996, level: 0.8, pan: (i - 1.5) / 2.2,
      ex: null, exi: 0, bow: 0, bowS: 0, sus: 0, en: 0, nz: 0, f: 110, y: 0, e2: 0,
      h: { buf: new Float32Array(2048), w: 0, len: 100, lp: 0, g: 0.99, n: 2, ex: null, exi: 0, en: 0, e2: 0 },   // флажолет: своя короткая петля
    }));
    this.cpl = 0.0004; this.pend = [];                                     // общая подставка: струны слышат друг друга (симпатический резонанс)
    this.wind = 0; this.count = 0; this.every = Math.round(this.fs / 30);
    this.port.onmessage = (e) => this.msg(e.data);
  }
  rnd() { let t = (this.seed = (this.seed + 0x6D2B79F5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  tune(s, d) {                                            // частота, яркость, затухание → длина петли, коэффициент lowpass, потеря за проход
    const f = Math.max(20, Math.min(2000, d.f));
    s.b = 0.15 + 0.83 * Math.max(0, Math.min(1, d.bright));
    const t60 = 0.3 + 14 * Math.max(0, Math.min(1, d.decay)) ** 2;
    s.g = Math.pow(10, -3 / (t60 * f));
    const lpDelay = (1 - s.b) / s.b;                      // задержка однополюсника на низких — вычитаем, чтобы строй не уезжал
    s.len = Math.max(4, this.fs / f - lpDelay); s.f = f; s.t60 = t60;
    if (d.level != null) s.level = d.level;
  }
  harm(s, n, vel) {                                       // флажолет: палец на узле 1/n — звучат только гармоники n, 2n, … — петля в n раз короче
    const h = s.h, f = Math.min(4000, s.f * n), lpDelay = (1 - s.b) / s.b;
    h.n = n; h.len = Math.max(4, this.fs / f - lpDelay); h.g = Math.pow(10, -3 / (s.t60 * 0.8 * f)); h.lp = 0;
    const L = Math.round(h.len), ex = new Float32Array(L);
    let y = 0;
    for (let i = 0; i < L; i++) { y += 0.5 * (this.rnd() * 2 - 1 - y); ex[i] = y * vel * 0.8; }
    h.ex = ex; h.exi = 0;
  }
  pluck(s, pos, vel) {                                    // щипок: шум с мягким срезом по силе, гребёнка по месту (у края — ярко, в середине — мягко)
    const L = Math.round(s.len), ex = new Float32Array(L), d = Math.max(1, Math.round(L * Math.max(0.04, Math.min(0.5, pos))));
    let y = 0;
    const a = 0.25 + 0.7 * vel;
    for (let i = 0; i < L; i++) { y += a * (this.rnd() * 2 - 1 - y); ex[i] = y; }
    for (let i = L - 1; i >= d; i--) ex[i] -= ex[i - d];
    for (let i = 0; i < L; i++) ex[i] *= vel * 0.9;
    s.ex = ex; s.exi = 0;
  }
  msg(d) {
    if (d.t === 'tune') { this.tune(this.s[d.i], d); return; }
    if (d.t === 'pluck') { if (d.at && d.at > currentTime) this.pend.push(d); else this.pluck(this.s[d.i], d.pos, d.vel); return; }   // по времени — для автострама: ложится в такт
    if (d.t === 'bow') { this.s[d.i].bow = Math.max(0, Math.min(1, d.amp)); return; }
    if (d.t === 'sus') { this.s[d.i].sus = d.on ? 1 : 0; return; }
    if (d.t === 'wind') { this.wind = d.amt; return; }
    if (d.t === 'harm') { this.harm(this.s[d.i], d.n, d.vel); return; }
    if (d.t === 'couple') { this.cpl = d.amt; return; }
  }
  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length;
    for (let k = 0; k < n; k++) { L[k] = 0; if (R !== L) R[k] = 0; }
    if (this.pend.length) { const t1 = currentTime + n / sampleRate; this.pend = this.pend.filter((d) => { if (d.at > t1) return true; this.pluck(this.s[d.i], d.pos, d.vel); return false; }); }
    if (!this.wind && this.s.every((s) => s.en < 1e-9 && s.h.en < 1e-9 && !s.ex && !s.h.ex && !s.bow && !s.bowS && !s.sus)) {   // всё молчит — не считаем
      this.count += n;
      if (this.count >= this.every) { this.count = 0; this.port.postMessage({ t: 'energy', e: [0, 0, 0, 0], h: [0, 0, 0, 0] }); }
      return true;
    }
    const S = this.s, c = this.cpl, own = 1 - 3 * c;     // струны стоят на одной подставке: каждая отдаёт ей долю и слышит остальных
    for (const s of S) { s.e2 = 0; s.h.e2 = 0; }
    for (let k = 0; k < n; k++) {
      let bridge = 0;
      for (const s of S) bridge += s.y;
      for (const s of S) {
        s.bowS += (s.bow - s.bowS) * 0.002;               // смычок плавно нажимает и отпускает
        let r = s.w - s.len; while (r < 0) r += BUF;
        const i0 = Math.floor(r), fr = r - i0, y = s.buf[i0 % BUF] * (1 - fr) + s.buf[(i0 + 1) % BUF] * fr;
        s.lp += s.b * (y - s.lp);
        let v = s.lp * s.g * own + c * (bridge - s.y);
        if (s.ex) { v += s.ex[s.exi++]; if (s.exi >= s.ex.length) s.ex = null; }
        const drive = s.bowS * 0.06 + s.sus * 0.012 + this.wind * 0.01;
        if (drive > 1e-5) { s.nz += 0.3 * (this.rnd() * 2 - 1 - s.nz); v += s.nz * drive; }
        s.buf[s.w] = v; s.w = (s.w + 1) % BUF; s.y = y;
        let out = y;
        const h = s.h;
        if (h.ex || h.en > 1e-9) {                        // флажолет
          let rh = h.w - h.len; while (rh < 0) rh += 2048;
          const j0 = Math.floor(rh), fj = rh - j0, yh = h.buf[j0 % 2048] * (1 - fj) + h.buf[(j0 + 1) % 2048] * fj;
          h.lp += s.b * (yh - h.lp);
          let vh = h.lp * h.g;
          if (h.ex) { vh += h.ex[h.exi++]; if (h.exi >= h.ex.length) h.ex = null; }
          h.buf[h.w] = vh; h.w = (h.w + 1) % 2048;
          out += yh; h.e2 += yh * yh;
        }
        L[k] += out * s.level * (1 - s.pan) * 0.5; if (R !== L) R[k] += out * s.level * (1 + s.pan) * 0.5;
        s.e2 += y * y;
      }
    }
    for (const s of S) { s.en += (s.e2 / n - s.en) * 0.3; s.h.en += (s.h.e2 / n - s.h.en) * 0.3; }
    for (let k = 0; k < n; k++) { L[k] = Math.tanh(L[k] * 0.8); if (R !== L) R[k] = Math.tanh(R[k] * 0.8); }   // мягкий потолок на случай резкого щипка всеми
    this.count += n;
    if (this.count >= this.every) { this.count = 0; this.port.postMessage({ t: 'energy', e: this.s.map((s) => Math.sqrt(s.en)), h: this.s.map((s) => Math.sqrt(s.h.en)), n: this.s.map((s) => s.h.n) }); }
    return true;
  }
}
registerProcessor('monochord', Mono);
