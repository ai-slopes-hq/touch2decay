// Monochordum — звук струн: волновод Карплуса — Стронга в AudioWorklet (в графе Web Audio петля короче 128 отсчётов невозможна,
// а струне нужны задержки от 30 до 900 отсчётов). Струна: линия задержки с дробной длиной (линейная интерполяция), в петле —
// однополюсный lowpass (яркость) и потеря за проход (t60). Возбуждение: щипок — короткий шумовой всплеск, гребёнка по месту щипка;
// смычок и ветер — непрерывный шум, громкость задаёт главный поток. Энергия струн ~30 раз в секунду уходит обратно — для рисования.
const N_STR = 4, BUF = 4096;
class Mono extends AudioWorkletProcessor {
  constructor() {
    super();
    this.fs = sampleRate;
    this.s = Array.from({ length: N_STR }, (_, i) => ({
      buf: new Float32Array(BUF), w: 0, len: 400, lp: 0, b: 0.5, g: 0.996, level: 0.8, pan: (i - 1.5) / 2.2,
      ex: null, exi: 0, bow: 0, bowS: 0, sus: 0, en: 0, nz: 0,
    }));
    this.wind = 0; this.count = 0; this.every = Math.round(this.fs / 30);
    this.port.onmessage = (e) => this.msg(e.data);
  }
  tune(s, d) {                                            // частота, яркость, затухание → длина петли, коэффициент lowpass, потеря за проход
    const f = Math.max(20, Math.min(2000, d.f));
    s.b = 0.15 + 0.83 * Math.max(0, Math.min(1, d.bright));
    const t60 = 0.3 + 14 * Math.max(0, Math.min(1, d.decay)) ** 2;
    s.g = Math.pow(10, -3 / (t60 * f));
    const lpDelay = (1 - s.b) / s.b;                      // задержка однополюсника на низких — вычитаем, чтобы строй не уезжал
    s.len = Math.max(4, this.fs / f - lpDelay);
    if (d.level != null) s.level = d.level;
  }
  pluck(s, pos, vel) {                                    // щипок: шум с мягким срезом по силе, гребёнка по месту (у края — ярко, в середине — мягко)
    const L = Math.round(s.len), ex = new Float32Array(L), d = Math.max(1, Math.round(L * Math.max(0.04, Math.min(0.5, pos))));
    let y = 0;
    const a = 0.25 + 0.7 * vel;
    for (let i = 0; i < L; i++) { y += a * (Math.random() * 2 - 1 - y); ex[i] = y; }
    for (let i = L - 1; i >= d; i--) ex[i] -= ex[i - d];
    for (let i = 0; i < L; i++) ex[i] *= vel * 0.9;
    s.ex = ex; s.exi = 0;
  }
  msg(d) {
    if (d.t === 'tune') { this.tune(this.s[d.i], d); return; }
    if (d.t === 'pluck') { this.pluck(this.s[d.i], d.pos, d.vel); return; }
    if (d.t === 'bow') { this.s[d.i].bow = Math.max(0, Math.min(1, d.amp)); return; }
    if (d.t === 'sus') { this.s[d.i].sus = d.on ? 1 : 0; return; }
    if (d.t === 'wind') { this.wind = d.amt; return; }
  }
  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length;
    for (let k = 0; k < n; k++) { L[k] = 0; if (R !== L) R[k] = 0; }
    if (!this.wind && this.s.every((s) => s.en < 1e-9 && !s.ex && !s.bow && !s.bowS && !s.sus)) {   // всё молчит — не считаем
      this.count += n;
      if (this.count >= this.every) { this.count = 0; this.port.postMessage({ t: 'energy', e: [0, 0, 0, 0] }); }
      return true;
    }
    for (const s of this.s) {
      const gl = s.level * (1 - s.pan) * 0.5, gr = s.level * (1 + s.pan) * 0.5;
      let e2 = 0;
      for (let k = 0; k < n; k++) {
        s.bowS += (s.bow - s.bowS) * 0.002;               // смычок плавно нажимает и отпускает
        let r = s.w - s.len; while (r < 0) r += BUF;
        const i0 = Math.floor(r), fr = r - i0, y = s.buf[i0 % BUF] * (1 - fr) + s.buf[(i0 + 1) % BUF] * fr;
        s.lp += s.b * (y - s.lp);
        let v = s.lp * s.g;
        if (s.ex) { v += s.ex[s.exi++]; if (s.exi >= s.ex.length) s.ex = null; }
        const drive = s.bowS * 0.06 + s.sus * 0.012 + this.wind * 0.01;
        if (drive > 1e-5) { s.nz += 0.3 * (Math.random() * 2 - 1 - s.nz); v += s.nz * drive; }
        s.buf[s.w] = v; s.w = (s.w + 1) % BUF;
        L[k] += y * gl; if (R !== L) R[k] += y * gr;
        e2 += y * y;
      }
      s.en += (e2 / n - s.en) * 0.3;
    }
    for (let k = 0; k < n; k++) { L[k] = Math.tanh(L[k] * 0.8); if (R !== L) R[k] = Math.tanh(R[k] * 0.8); }   // мягкий потолок на случай резкого щипка всеми
    this.count += n;
    if (this.count >= this.every) { this.count = 0; this.port.postMessage({ t: 'energy', e: this.s.map((s) => Math.sqrt(s.en)) }); }
    return true;
  }
}
registerProcessor('monochord', Mono);
