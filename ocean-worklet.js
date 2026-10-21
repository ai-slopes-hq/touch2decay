// Oceanus — сканирующий синтез (Verplank, Mathews, Shaw, 2000): кольцо из N масс на пружинах — Мировой океан. Кольцо медленно
// колышется (физика — раз в STEP отсчётов, «тактильная» скорость), а голоса читают его форму по кругу со звуковой частотой:
// форма кольца — форма волны. Тронул воду — по кольцу бегут волны, тембр живой и сам успокаивается. Луна тянет воду на себя —
// горб первой моды (чистый тон), ветер — мелкая рябь, натяжение — скорость волн, затухание — сколько они живут.
// Между шагами физики таблица плавно перетекает (линейно), чтобы не было ступенек. Форма кольца ~30 раз в секунду уходит обратно.
const N = 64, STEP = 16, VMAX = 6;
class Ocean extends AudioWorkletProcessor {
  constructor() {
    super();
    this.x = new Float32Array(N); this.v = new Float32Array(N);
    this.a = new Float32Array(N); this.b = new Float32Array(N);   // таблица до и после шага физики
    this.kt = 0.03; this.damp = 0.002; this.kc = 0.004; this.wind = 0; this.tide = 0.5; this.moon = 0; this.moonRate = 0.04; this.storm = 0; this.sway = 0; this.swayTo = 0; this.sm = 1; this.pm = 1;   // луна — LFO: орбита, рывки (storm), что качает (sway)
    this.push = new Map();                                         // палец в воде: id → {a, d, k}
    this.vo = Array.from({ length: VMAX }, () => ({ on: false, f: 110, ph: Math.random(), g: 0, lvl: 0.8, lp: 0, lpR: 0, path: 0 }));
    this.k = 0; this.count = 0; this.every = Math.round(sampleRate / 30);
    for (let i = 0; i < N; i++) { const th = (i / N) * 2 * Math.PI; this.x[i] = this.b[i] = this.a[i] = 0.5 * Math.cos(th); }
    this.port.onmessage = (e) => this.msg(e.data);
  }
  msg(d) {
    if (d.t === 'params') { for (const k of ['kt', 'damp', 'kc', 'wind', 'tide', 'moonRate', 'storm', 'sway', 'swayTo']) if (d[k] != null) this[k] = d[k]; return; }
    if (d.t === 'push') { if (d.off) this.push.delete(d.id); else this.push.set(d.id, { a: d.a, d: d.d, k: d.k || 0.08 }); return; }
    if (d.t === 'splash') {                                        // всплеск: толчок скорости колоколом вокруг места
      for (let i = 0; i < N; i++) { let u = i / N - d.a; u -= Math.round(u); this.v[i] += d.amt * Math.exp(-(u * u) / (2 * 0.025 * 0.025)); }
      return;
    }
    if (d.t === 'voice') { const o = this.vo[d.i]; o.on = d.on; if (d.f) o.f = d.f; if (d.lvl != null) o.lvl = d.lvl; if (d.path != null) o.path = d.path; return; }
  }
  step() {                                                         // шаг физики: соседи тянут, луна держит горб, трение, ветер, пальцы
    const th0 = this.moon * 2 * Math.PI, ls = Math.sin(th0), sw = this.sway * ls;   // луна качает: натяжение, высоту городов или затухание
    if (this.storm) { this.sm += (Math.random() - 0.5) * 0.08; this.sm = Math.max(0, Math.min(4, this.sm + (1 - this.sm) * 0.002)); } else this.sm = 1;   // storm: луна идёт рывками
    this.moon = (this.moon + (this.moonRate * this.sm * STEP) / sampleRate) % 1;
    this.pm = this.swayTo === 1 ? 2 ** ((2 * sw) / 12) : 1;
    const x = this.x, v = this.v, kt = this.kt * (this.swayTo === 0 ? Math.max(0.05, 1 + 0.9 * sw) : 1), kc = this.kc, dm = 1 - this.damp * (this.swayTo === 2 ? Math.max(0.05, 1 + 0.9 * sw) : 1), tide = this.tide;
    for (let i = 0; i < N; i++) {
      const l = x[(i + N - 1) % N], r = x[(i + 1) % N], rest = tide * Math.cos((i / N) * 2 * Math.PI - th0);
      let f = kt * (l + r - 2 * x[i]) - kc * (x[i] - rest);
      if (this.wind) f += this.wind * 0.004 * (Math.random() * 2 - 1);
      v[i] = (v[i] + f) * dm;
    }
    for (const p of this.push.values()) {                          // палец тянет воду к своей глубине, колоколом
      for (let i = 0; i < N; i++) { let u = i / N - p.a; u -= Math.round(u); const w = Math.exp(-(u * u) / (2 * 0.03 * 0.03)); v[i] += p.k * w * (p.d - x[i]) - 0.1 * w * v[i]; }
    }
    let m = 0;
    for (let i = 0; i < N; i++) { x[i] += v[i]; if (x[i] > 3) { x[i] = 3; v[i] = 0; } else if (x[i] < -3) { x[i] = -3; v[i] = 0; } m += x[i]; }
    m /= N;
    this.a.set(this.b);
    for (let i = 0; i < N; i++) this.b[i] = x[i] - m;              // без постоянной составляющей
  }
  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length, sr = sampleRate, a = this.a, b = this.b;
    for (let s = 0; s < n; s++) {
      if (this.k === 0) this.step();
      const fr = this.k / STEP;
      this.k = (this.k + 1) % STEP;
      let yl = 0, yr = 0;
      for (let j = 0; j < VMAX; j++) {
        const o = this.vo[j];
        o.g += ((o.on ? o.lvl : 0) - o.g) * (o.on ? 0.0015 : 0.0006);    // мягкая атака и отпускание
        if (o.g < 1e-5 && !o.on) continue;
        o.ph += (o.f * this.pm) / sr; if (o.ph >= 1) o.ph -= 1;
        const q = o.path === 1 ? 1 - o.ph : o.path === 2 ? (o.ph < 0.5 ? 2 * o.ph : 2 - 2 * o.ph) : o.ph;   // путь скана: по кругу, назад, туда-обратно
        const p = Math.min(N - 1e-6, q * N), i0 = p | 0, u = p - i0, i1 = (i0 + 1) % N;
        const y0 = a[i0] + (b[i0] - a[i0]) * fr, y1 = a[i1] + (b[i1] - a[i1]) * fr;
        let y = (y0 + (y1 - y0) * u) * o.g;
        const c = Math.min(0.9, (2 * Math.PI * 6000) / sr);         // мягкий срез верха: острые углы кольца не звенят наложением
        o.lp += c * (y - o.lp); y = o.lp;
        const pan = (j % 3 - 1) * 0.35;
        yl += y * (1 - pan); yr += y * (1 + pan);
      }
      L[s] = Math.tanh(yl * 0.45); if (R !== L) R[s] = Math.tanh(yr * 0.45);
    }
    this.count += n;
    if (this.count >= this.every) { this.count = 0; this.port.postMessage({ t: 'shape', x: Array.from(this.x), moon: this.moon, g: this.vo.map((o) => o.g) }); }
    return true;
  }
}
registerProcessor('ocean', Ocean);
