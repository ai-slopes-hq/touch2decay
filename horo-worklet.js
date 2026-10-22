// Horologium Nova — волшебные числа (по духу — Rhythmicon Кауэлла и Термена). Одно колесо-«единица» оборачивается со
// скоростью F (оборотов в секунду). Кольцо даёт m ударов за оборот: обертон — m = n, унтертон — m = 12/n. Каждый удар —
// щелчок в резонатор на m·B (B — основной тон): медленно — деревянное/металлическое тиканье ноты n-й гармоники; быстро —
// поток щелчков сам становится тоном m·F (резонатор следует за ним), и 4 : 5 : 6 из полиритма становится трезвучием.
// aequalis — от чистых чисел к равномерному строю (m → ближайший полутон): появляются биения, полиритм расползается.
// materia — резонатор: 0 — дерево (коротко), 1 — металл (долго). concursus — удар сильнее, где кольца совпадают.
// chance — вероятность удара. Спуск руками: {t:'step', d} — колесо доворачивается на d оборота за 40 мс.
// Наверх ~30/с: {t:'p', P, F, hits: [номера колец, ударившие с прошлого раза]}.
const NR = 8;
class Horo extends AudioWorkletProcessor {
  constructor() {
    super();
    this.P = 0; this.F = 0; this.Ft = 0; this.glide = 0; this.glideN = 0; this.B = 55;
    this.mat = 0.35; this.conc = 0.4; this.chance = 1; this.aeq = 0;
    this.r = Array.from({ length: NR }, (_, i) => ({ n: i + 2, on: false, under: false, phi: 0, lvl: 0.8, x: 0, y1: 0, y2: 0, nz: 0, pan: -0.7 + (1.4 * i) / (NR - 1), m: i + 2, hit: 0 }));
    this.dc = [0, 0]; this.dx = [0, 0]; this.lp = [0, 0];
    this.count = 0; this.every = Math.round(sampleRate / 30); this.hits = [];
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.t === 'set') {
        if (d.F != null) this.Ft = d.F;
        for (const k of ['B', 'mat', 'conc', 'chance', 'aeq']) if (d[k] != null) this[k] = d[k];
        if (d.rings) d.rings.forEach((q, i) => Object.assign(this.r[i], q));
      } else if (d.t === 'step') { this.glide += d.d; this.glideN = Math.round(0.04 * sampleRate); }
      else if (d.t === 'stop') { this.Ft = 0; this.F = 0; }
    };
  }
  mOf(o) {                                                // ударов за оборот: обертон n, унтертон 12/n; aequalis тянет к полутону
    const m = o.under ? 12 / o.n : o.n;
    if (this.aeq <= 0) return m;
    const et = 2 ** (Math.round(12 * Math.log2(m)) / 12);
    return m * (et / m) ** this.aeq;
  }
  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length, sr = sampleRate, TAU = Math.PI * 2;
    const act = this.r.filter((o) => o.on);
    for (const o of act) o.m = this.mOf(o);
    const kF = 1 - Math.exp(-1 / (0.06 * sr));
    for (let k = 0; k < n; k++) {
      this.F += (this.Ft - this.F) * kF;
      let dP = this.F / sr;
      if (this.glideN > 0) { const g = this.glide / this.glideN; dP += g; this.glide -= g; this.glideN--; }
      const P0 = this.P; this.P += dP;
      const Fe = Math.abs(dP) * sr;                       // мгновенная скорость (и при спуске руками)
      let yl = 0, yr = 0;
      for (const o of act) {
        const x0 = P0 * o.m + o.phi, x1 = this.P * o.m + o.phi;
        let ex = 0;
        if (Math.floor(x1) !== Math.floor(x0) && Math.random() < this.chance) {   // удар
          const rate = Math.max(1e-3, Fe * o.m);
          let acc = 1;
          if (this.conc > 0) {                            // concursus: совпал с ударом другого кольца или с «раз»
            const w = Math.min(0.05, 0.006 * Fe);
            let hitc = Math.abs(this.P - Math.round(this.P)) < w;
            for (const q of act) if (q !== o) { const xq = this.P * q.m + q.phi; if (Math.abs(xq - Math.round(xq)) < w * q.m) { hitc = true; break; } }
            if (hitc) acc += this.conc * 1.2; else acc *= 1 - 0.35 * this.conc;
          }
          ex = acc * o.lvl;
          o.nz = Math.round(0.0015 * sr * (1 - this.mat));   // дерево — с шорохом
          o.rate = rate;
          if (this.hits.length < 32) this.hits.push(o.n - 2);
        }
        const f = Math.min(sr * 0.42, o.m * Math.max(this.B, Math.min(Fe, 400))), T = 0.012 * 50 ** this.mat * Math.sqrt(Math.min(4, 220 / f));
        const rr = Math.exp(-1 / (T * sr)), w = (TAU * f) / sr, sw = Math.sin(w);
        const norm = 1 - Math.exp(-1 / (T * Math.max(1, o.rate || 1)));   // часто — сумма не растёт без меры
        let xin = ex * sw * norm * 1.6;
        if (o.nz > 0) { xin += (Math.random() * 2 - 1) * 0.08 * sw * o.lvl * norm; o.nz--; }
        const y = 2 * rr * Math.cos(w) * o.y1 - rr * rr * o.y2 + xin;
        o.y2 = o.y1; o.y1 = y;
        const pl = (1 - o.pan) * 0.5, pr = (1 + o.pan) * 0.5;
        yl += y * pl; yr += y * pr;
      }
      const og = (0.7 + 1.1 * (1 - this.mat)) / Math.sqrt(1 + Fe / 8);   // дерево тише металла — подтянуть; быстро — поток плотнее, громче — убавить
      L[k] = yl * og; if (R !== L) R[k] = yr * og;
    }
    for (const o of this.r) if (!o.on) { o.y1 *= 0.9; o.y2 *= 0.9; }
    const dc = this.dc, dx = this.dx;
    for (let k = 0; k < n; k++) {
      let x = L[k], y = x - dx[0] + 0.997 * dc[0]; dx[0] = x; dc[0] = y; L[k] = Math.tanh(y * 0.9);
      if (R !== L) { x = R[k]; y = x - dx[1] + 0.997 * dc[1]; dx[1] = x; dc[1] = y; R[k] = Math.tanh(y * 0.9); }
    }
    this.count += n;
    if (this.count >= this.every) { this.count = 0; this.port.postMessage({ t: 'p', P: this.P, F: this.F, hits: this.hits }); this.hits = []; }
    return true;
  }
}
registerProcessor('horo', Horo);
