// Firmamentum — пульсарный синтез (Curtis Roads): поток коротких пульсаретов. Каждый период 1/fp начинается пульсарет —
// несколько периодов синуса на частоте форманта ff в окне; остаток периода — тишина. fp — частота пульсаций (низко — ритм,
// выше 20 Гц — тон), ff — формант (окраска), cycles — сколько периодов в пульсарете (длиннее — уже формант), window — окно
// (0 — колокол Ханна, 0.5 — острый удар с хвостом, 1 — прямоугольник, резко), mask — вероятность пропустить пульсарет
// (звёзды мерцают). crepitus — треск пыли (в духе Jan Jelinek): редкие щелчки разной силы, иногда стайками, и тёплое шипение;
// fulgur — вспышки (в духе Ryoji Ikeda): на пульсарете звезды изредка — чистый синус у края слуха (10–17 кГц) жёстко
// в один канал на 6–60 мс или одиночный цифровой щелчок. События треска и вспышек уходят наверх — для картинки. Счётчики прозвучавших пульсаретов ~30 раз в секунду уходят обратно: звезда вспыхивает на каждом.
const VMAX = 6;
class Pulsar extends AudioWorkletProcessor {
  constructor() {
    super();
    this.vo = Array.from({ length: VMAX }, () => ({ on: false, fp: 4, ff: 600, cyc: 2, win: 0, mask: 0, lvl: 0.8, pan: 0, g: 0, fpS: 4, ffS: 600, ph: 1, pt: -1, plen: 0, pf: 600, pa: 1, n: 0 }));
    this.jit = 0; this.drift = 0; this.spread = 0.6; this.dc = [0, 0]; this.dcx = [0, 0];
    this.crep = 0; this.fulg = 0; this.act = 0; this.burst = 0; this.burstT = 0; this.cr = []; this.pips = []; this.hiss = [0, 0]; this.ck = []; this.fl = [];
    this.count = 0; this.every = Math.round(sampleRate / 30);
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.t === 'voice') { const o = this.vo[d.i]; for (const k of ['on', 'fp', 'ff', 'cyc', 'win', 'mask', 'lvl', 'pan']) if (d[k] != null) o[k] = d[k]; if (d.on && o.g < 1e-4) { o.fpS = o.fp; o.ffS = o.ff; o.ph = 1; } }
      else if (d.t === 'fx') { this.jit = d.jit; this.spread = d.spread; if (d.crep != null) this.crep = d.crep; if (d.fulg != null) this.fulg = d.fulg; }
    };
  }
  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length, sr = sampleRate, TAU = Math.PI * 2;
    for (let k = 0; k < n; k++) { L[k] = 0; if (R !== L) R[k] = 0; }
    for (const o of this.vo) {
      if (!o.on && o.g < 1e-5) continue;
      const pan = o.pan * this.spread, gl = (1 - pan) * 0.5, gr = (1 + pan) * 0.5;
      for (let k = 0; k < n; k++) {
        o.g += ((o.on ? o.lvl : 0) - o.g) * (o.on ? 0.002 : 0.0008);
        o.fpS += (o.fp - o.fpS) * 0.002; o.ffS += (o.ff - o.ffS) * 0.002;
        o.ph += o.fpS / sr;
        if (o.ph >= 1) {                                    // новый пульсарет
          o.ph -= 1;
          if (this.jit) o.ph -= Math.random() * this.jit * 0.3;   // scintilla: пульсы чуть не в такт
          const skip = Math.random() < Math.min(0.95, o.mask + this.jit * 0.35);
          o.plen = Math.max(8, Math.min(sr / o.fpS, (o.cyc / o.ffS) * sr)); o.pf = o.ffS; o.pt = skip ? -1 : 0;
          o.pa = 0.75 + 0.25 * Math.random();
          if (!skip) { o.n++; if (this.fulg > 0 && Math.random() < this.fulg * Math.min(0.25, 4 / o.fpS)) this.flash(this.vo.indexOf(o), k); }
        }
        if (o.pt >= 0) {
          const x = o.pt / o.plen, w0 = Math.sin(Math.PI * x) ** 2, w1 = Math.min(1, x * 40) * Math.exp(-x * 5), w = o.win < 0.5 ? w0 + (w1 - w0) * o.win * 2 : w1 + (1 - w1) * (o.win - 0.5) * 2;
          const y = Math.sin((TAU * o.pf * o.pt) / sr) * w * o.g * o.pa;
          L[k] += y * gl; if (R !== L) R[k] += y * gr;
          if (++o.pt >= o.plen) o.pt = -1;
        }
      }
    }
    if (this.crep > 0 || this.pips.length || this.cr.length) this.dust(L, R, n);
    const dc = this.dc, dx = this.dcx;                    // без постоянной составляющей (нецелое число периодов в окне), мягкий потолок
    for (let k = 0; k < n; k++) {
      let x = L[k], y = x - dx[0] + 0.995 * dc[0]; dx[0] = x; dc[0] = y; L[k] = Math.tanh(y * 0.7);
      if (R !== L) { x = R[k]; y = x - dx[1] + 0.995 * dc[1]; dx[1] = x; dc[1] = y; R[k] = Math.tanh(y * 0.7); }
    }
    this.count += n;
    if (this.count >= this.every) { this.count = 0; this.port.postMessage({ t: 'p', c: this.vo.map((o) => o.n), g: this.vo.map((o) => o.g), k: this.ck, f: this.fl }); this.ck = []; this.fl = []; }
    return true;
  }
  flash(i, k0) {                                          // fulgur: чистый высокий синус в один канал или цифровой щелчок
    const r = Math.random(), sr = sampleRate, side = Math.random() < 0.5 ? -1 : 1;
    if (this.pips.length > 6) return;
    if (r < 0.25) this.pips.push({ k0, len: 1, f: 0, side, a: 0.5 * (0.6 + 0.4 * this.fulg), t: 0 });
    else { const F = [10500, 12800, 14000, 15600, 17200], f = Math.min(F[Math.floor(Math.random() * F.length)], sr * 0.42); this.pips.push({ k0, len: Math.round((0.006 + 0.054 * Math.random() ** 2) * sr), f, side, a: 0.06 + 0.1 * this.fulg, t: 0 }); }
    if (this.fl.length < 8) this.fl.push(i);
  }
  dust(L, R, n) {                                         // crepitus + fulgur поверх пульсаров
    const sr = sampleRate, on = this.vo.some((o) => o.on), c = this.crep, TAU = Math.PI * 2;
    for (let k = 0; k < n; k++) {
      this.act += ((on ? 1 : 0) - this.act) * 0.0005;
      if (c > 0 && this.act > 0.01) {
        if (--this.burstT <= 0) { this.burstT = Math.round((0.3 + 2.5 * Math.random()) * sr); this.burst = Math.random() < 0.25 ? 3 + 5 * Math.random() : 0.4 + 0.8 * Math.random(); }   // треск идёт стайками
        const rate = (2 + 90 * c ** 2.2) * this.burst;
        if (Math.random() < rate / sr && this.cr.length < 10) {
          const a = c * this.act * (0.04 + 0.7 * Math.random() ** 5), pan = Math.random() * 2 - 1;
          this.cr.push({ a: Math.random() < 0.5 ? a : -a, d: Math.exp(-1 / ((0.0002 + 0.0018 * Math.random()) * sr)), pan, hp: 0, x: 0 });
          if (this.ck.length < 12) this.ck.push([pan, a]);
        }
        const h = this.hiss, w = (Math.random() * 2 - 1) * c * c * 0.012 * this.act;   // тёплое шипение пластинки
        const w2 = (Math.random() * 2 - 1) * c * c * 0.012 * this.act; h[0] += (w - h[0]) * 0.18; h[1] += (w2 - h[1]) * 0.18;
        L[k] += h[0]; if (R !== L) R[k] += h[1];
      }
      for (let j = this.cr.length - 1; j >= 0; j--) {     // щелчок: короткий всплеск шума, сверху — без низа
        const q = this.cr[j], nz = (Math.random() * 2 - 1) * 0.5 + 0.5 * Math.sign(q.a), v = nz * q.a, y = v - q.x; q.x = v;
        L[k] += y * (1 - q.pan) * 0.5; if (R !== L) R[k] += y * (1 + q.pan) * 0.5;
        q.a *= q.d; if (Math.abs(q.a) < 1e-4) this.cr.splice(j, 1);
      }
      for (let j = this.pips.length - 1; j >= 0; j--) {
        const p = this.pips[j];
        if (k < p.k0 && p.t === 0) continue;
        let y;
        if (!p.f) y = p.t === 0 ? p.a : 0;
        else { const fade = Math.min(1, p.t / (0.0004 * sr), (p.len - p.t) / (0.0004 * sr)); y = Math.sin((TAU * p.f * p.t) / sr) * p.a * fade; }
        if (p.side < 0) L[k] += y; else if (R !== L) R[k] += y; else L[k] += y;
        if (++p.t >= p.len) this.pips.splice(j, 1);
      }
    }
    for (const p of this.pips) p.k0 = 0;
  }
}
registerProcessor('pulsar', Pulsar);
