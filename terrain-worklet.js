// Arcadia — синтез по рельефу (wave terrain, Bischoff, Gold, Horton, 1978): пейзаж — поверхность высот z(u, v), а звук — то,
// что слышит сканер, обходящий по ней замкнутую петлю (орбиту) со звуковой частотой: высоты под петлёй — форма волны.
// Маленькая петля на ровном склоне — почти синус; большая, через хребты и долины, — богатый тембр. Центр петли медленно
// бродит (путь): кругом, наугад, вниз по течению или вверх к вершине — тембр сам живёт. Рельеф — сетка GX × GY,
// между узлами — кубически (Catmull — Rom), чтобы петля не цеплялась за изломы. Над озёрами ветер рябит воду.
// relief — сколько складок: высоты проходят через синус, выше рельеф — больше перегибов. Новый пейзаж — плавно (полсекунды).
// Карта — портрет: по вертикали длиннее в asp раз, петля делит вертикаль на asp, чтобы на местности быть круглой.
// Обратно ~30 раз в секунду: где сейчас центр каждой петли и громкость.
const VMAX = 4;
const reflect = (x) => { x = ((x + 1) % 4 + 4) % 4; return (x > 2 ? 4 - x : x) - 1; };   // за краем — зеркало: петля не упирается в стену
class Terrain extends AudioWorkletProcessor {
  constructor() {
    super();
    this.gx = 80; this.gy = 160; this.asp = 3.2;               // сетка и вытянутость карты приходят с рельефом
    this.z = new Float32Array(this.gx * this.gy); this.z0 = new Float32Array(this.z.length); this.lake = new Float32Array(this.z.length); this.xf = 1;
    this.relief = 0.3; this.speed = 0.05; this.wind = 0; this.spread = 0.6; this.t = 0;
    this.vo = Array.from({ length: VMAX }, (_, i) => ({
      on: false, f: 110, ph: 0, g: 0, lvl: 0.8, hx: 0, hy: 0, cx: 0, cy: 0, tx: 0, ty: 0, r: 0.18, rs: 0.18, fig: 0, mode: 0, sp: 0.25, wp: Math.random() * 6.28,
      route: null, cum: null, rl: 0, pan: 0, dx: 0, dy: 0, env: 0.01, ag: 1, lp: 0, nz: 0, nzT: 0, seed: [Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28], i,
    }));
    this.count = 0; this.every = Math.round(sampleRate / 30);
    this.port.onmessage = (e) => this.msg(e.data);
  }
  msg(d) {
    if (d.t === 'terrain') {
      if (d.z.length !== this.z.length) { this.z = new Float32Array(d.z.length); this.z0 = new Float32Array(d.z.length); this.lake = new Float32Array(d.z.length); }
      this.gx = d.gx; this.gy = d.gy; this.asp = d.asp;
      this.z0.set(this.z); this.z.set(d.z); this.lake.set(d.lake); this.xf = d.now ? 1 : 0; return;
    }
    if (d.t === 'params') { for (const k of ['relief', 'speed', 'wind', 'spread']) if (d[k] != null) this[k] = d[k]; return; }
    if (d.t === 'voice') {
      const o = this.vo[d.i];
      const fresh = d.on && !o.on && o.g < 1e-4;
      for (const k of ['on', 'f', 'hx', 'hy', 'r', 'fig', 'lvl', 'mode', 'sp', 'pan']) if (d[k] != null) o[k] = d[k];
      if (d.route !== undefined) {                          // путь по течению или к вершине: ломаная от дома, накопленные длины
        o.route = d.route && d.route.length >= 4 ? Float32Array.from(d.route) : null;
        if (o.route) { const n = o.route.length / 2; o.cum = new Float32Array(n); for (let k = 1; k < n; k++) o.cum[k] = o.cum[k - 1] + Math.hypot(o.route[2 * k] - o.route[2 * k - 2], o.route[2 * k + 1] - o.route[2 * k - 1]); o.rl = o.cum[n - 1]; }
      }
      if (fresh) { this.target(o); o.cx = o.tx; o.cy = o.ty; o.rs = o.r; o.env = 0.01; o.ag = 1; }
    }
  }
  target(o) {                                               // куда идёт центр петли: стоит, кругом, наугад, по ломаной туда-обратно
    const w = o.wp, sp = o.sp, a = this.asp;                // по вертикали карта длиннее: круг на местности — делим на asp
    if (o.mode === 1) { o.tx = o.hx + sp * Math.cos(w); o.ty = o.hy + (sp * Math.sin(w)) / a; }
    else if (o.mode === 2) { const s = o.seed; o.tx = o.hx + sp * (0.62 * Math.sin(0.73 * w + s[0]) + 0.38 * Math.sin(1.91 * w + s[1])); o.ty = o.hy + (sp * (0.6 * Math.sin(0.89 * w + s[2]) + 0.4 * Math.sin(1.37 * w + s[3]))) / a; }
    else if ((o.mode === 3 || o.mode === 4) && o.route && o.rl > 0.02) {
      const q = (0.5 - 0.5 * Math.cos(w * 0.5)) * o.rl, c = o.cum, n = c.length;
      let k = 1; while (k < n - 1 && c[k] < q) k++;
      const u = (q - c[k - 1]) / Math.max(1e-6, c[k] - c[k - 1]), r = o.route;
      o.tx = r[2 * k - 2] + (r[2 * k] - r[2 * k - 2]) * u; o.ty = r[2 * k - 1] + (r[2 * k + 1] - r[2 * k - 1]) * u;
    } else { o.tx = o.hx; o.ty = o.hy; }
  }
  cub(z, gx, gy) {                                          // Catmull — Rom по 4 × 4 узлам
    const GX = this.gx, GY = this.gy, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const wx0 = ((-0.5 * fx + 1) * fx - 0.5) * fx, wx1 = (1.5 * fx - 2.5) * fx * fx + 1, wx2 = ((-1.5 * fx + 2) * fx + 0.5) * fx, wx3 = (0.5 * fx - 0.5) * fx * fx;
    const wy0 = ((-0.5 * fy + 1) * fy - 0.5) * fy, wy1 = (1.5 * fy - 2.5) * fy * fy + 1, wy2 = ((-1.5 * fy + 2) * fy + 0.5) * fy, wy3 = (0.5 * fy - 0.5) * fy * fy;
    const x0 = Math.max(0, ix - 1), x1 = Math.max(0, Math.min(GX - 1, ix)), x2 = Math.min(GX - 1, ix + 1), x3 = Math.min(GX - 1, ix + 2);
    let s = 0;
    for (let j = 0; j < 4; j++) {                           // без замыканий и массивов: в звуковом потоке не мусорить
      const yy = Math.min(GY - 1, Math.max(0, iy - 1 + j)) * GX, w = j === 0 ? wy0 : j === 1 ? wy1 : j === 2 ? wy2 : wy3;
      s += w * (z[yy + x0] * wx0 + z[yy + x1] * wx1 + z[yy + x2] * wx2 + z[yy + x3] * wx3);
    }
    return s;
  }
  height(u, v) {
    u = reflect(u); v = reflect(v);
    const GX = this.gx, gx = (u + 1) * 0.5 * (GX - 1), gy = (v + 1) * 0.5 * (this.gy - 1);
    let h = this.cub(this.z, gx, gy);
    if (this.xf < 1) h = this.cub(this.z0, gx, gy) * (1 - this.xf) + h * this.xf;
    if (this.wind > 0.01) {                                 // озеро: ветер рябит воду
      const i = Math.min(GX - 2, gx | 0), j = Math.min(this.gy - 2, gy | 0), fx = gx - i, fy = gy - j, L = this.lake;
      const m = (L[j * GX + i] * (1 - fx) + L[j * GX + i + 1] * fx) * (1 - fy) + (L[(j + 1) * GX + i] * (1 - fx) + L[(j + 1) * GX + i + 1] * fx) * fy;
      if (m > 0.01) h += m * this.wind * 0.16 * Math.sin(29 * u + this.t * 2.3) * Math.sin(23 * v * this.asp - this.t * 1.7);
    }
    return h;
  }
  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length, sr = sampleRate, TAU = Math.PI * 2, fold = 1.5708 * (1 + 3 * this.relief);
    for (let k = 0; k < n; k++) { L[k] = 0; if (R !== L) R[k] = 0; }
    const dt = n / sr;
    this.t += dt;
    if (this.xf < 1) this.xf = Math.min(1, this.xf + dt / 0.5);
    for (const o of this.vo) {
      if (!o.on && o.g < 1e-5) continue;
      o.wp += TAU * this.speed * dt;
      this.target(o);
      o.nzT += dt * 7; if (o.nzT > 1) { o.nzT -= 1; o.nzN = Math.random() * 2 - 1; }   // ветер: петля дрожит
      const pan = o.pan * this.spread, gl = (1 - pan) * 0.5, gr = (1 + pan) * 0.5;
      for (let k = 0; k < n; k++) {
        o.g += ((o.on ? o.lvl : 0) - o.g) * (o.on ? 0.0015 : 0.0006);
        o.cx += (o.tx - o.cx) * 0.0008; o.cy += (o.ty - o.cy) * 0.0008; o.rs += (o.r - o.rs) * 0.001;
        o.nz += ((o.nzN || 0) - o.nz) * 0.0004;
        o.ph += o.f / sr; if (o.ph >= 1) o.ph -= 1;
        const a = TAU * o.ph, r = o.rs * (1 + this.wind * 0.25 * o.nz);
        let du, dv;
        if (o.fig === 1) { du = Math.sin(a); dv = 0.55 * Math.sin(2 * a); }                 // восьмёрка
        else if (o.fig === 2) { du = Math.sin(2 * a); dv = 0.8 * Math.sin(3 * a + 0.7); }   // узел 2 : 3
        else { du = Math.cos(a); dv = Math.sin(a); }                                         // круг
        let y = Math.sin(fold * this.height(o.cx + r * du, o.cy + (r * dv) / this.asp));
        const yd = y - o.dx + 0.996 * o.dy; o.dx = y; o.dy = yd; y = yd;                     // без постоянной составляющей
        o.env += (y * y - o.env) * 0.00006;                                                   // ровная громкость: петля над равниной не пропадает, над хребтом не орёт
        o.ag += (Math.min(4, 0.32 / Math.sqrt(o.env + 1e-5)) - o.ag) * 0.00005;
        o.lp += 0.55 * (y - o.lp);                                                             // мягкий срез верха: изломы рельефа не звенят наложением
        const s = o.lp * o.ag * o.g;
        L[k] += s * gl; if (R !== L) R[k] += s * gr;
      }
    }
    for (let k = 0; k < n; k++) { L[k] = Math.tanh(L[k] * 0.7); if (R !== L) R[k] = Math.tanh(R[k] * 0.7); }
    this.count += n;
    if (this.count >= this.every) {
      this.count = 0;
      this.port.postMessage({ t: 'p', c: this.vo.map((o) => [o.cx, o.cy, o.rs]), g: this.vo.map((o) => o.g * Math.min(1, Math.sqrt(o.env) * o.ag * 2.2)) });
    }
    return true;
  }
}
registerProcessor('terrain', Terrain);
