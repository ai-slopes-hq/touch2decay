// Firmamentum — пульсарный синтез (Curtis Roads): поток коротких пульсаретов. Каждый период 1/fp начинается пульсарет —
// несколько периодов синуса на частоте форманта ff в окне; остаток периода — тишина. fp — частота пульсаций (низко — ритм,
// выше 20 Гц — тон), ff — формант (окраска), cycles — сколько периодов в пульсарете (длиннее — уже формант), window — окно
// (0 — колокол Ханна, 0.5 — острый удар с хвостом, 1 — прямоугольник, резко), mask — вероятность пропустить пульсарет
// (звёзды мерцают). Счётчики прозвучавших пульсаретов ~30 раз в секунду уходят обратно: звезда вспыхивает на каждом.
const VMAX = 6;
class Pulsar extends AudioWorkletProcessor {
  constructor() {
    super();
    this.vo = Array.from({ length: VMAX }, () => ({ on: false, fp: 4, ff: 600, cyc: 2, win: 0, mask: 0, lvl: 0.8, pan: 0, g: 0, fpS: 4, ffS: 600, ph: 1, pt: -1, plen: 0, pf: 600, pa: 1, n: 0 }));
    this.jit = 0; this.drift = 0; this.spread = 0.6; this.dc = [0, 0]; this.dcx = [0, 0];
    this.count = 0; this.every = Math.round(sampleRate / 30);
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.t === 'voice') { const o = this.vo[d.i]; for (const k of ['on', 'fp', 'ff', 'cyc', 'win', 'mask', 'lvl', 'pan']) if (d[k] != null) o[k] = d[k]; if (d.on && o.g < 1e-4) { o.fpS = o.fp; o.ffS = o.ff; o.ph = 1; } }
      else if (d.t === 'fx') { this.jit = d.jit; this.spread = d.spread; }
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
          if (!skip) o.n++;
        }
        if (o.pt >= 0) {
          const x = o.pt / o.plen, w0 = Math.sin(Math.PI * x) ** 2, w1 = Math.min(1, x * 40) * Math.exp(-x * 5), w = o.win < 0.5 ? w0 + (w1 - w0) * o.win * 2 : w1 + (1 - w1) * (o.win - 0.5) * 2;
          const y = Math.sin((TAU * o.pf * o.pt) / sr) * w * o.g * o.pa;
          L[k] += y * gl; if (R !== L) R[k] += y * gr;
          if (++o.pt >= o.plen) o.pt = -1;
        }
      }
    }
    const dc = this.dc, dx = this.dcx;                    // без постоянной составляющей (нецелое число периодов в окне), мягкий потолок
    for (let k = 0; k < n; k++) {
      let x = L[k], y = x - dx[0] + 0.995 * dc[0]; dx[0] = x; dc[0] = y; L[k] = Math.tanh(y * 0.7);
      if (R !== L) { x = R[k]; y = x - dx[1] + 0.995 * dc[1]; dx[1] = x; dc[1] = y; R[k] = Math.tanh(y * 0.7); }
    }
    this.count += n;
    if (this.count >= this.every) { this.count = 0; this.port.postMessage({ t: 'p', c: this.vo.map((o) => o.n), g: this.vo.map((o) => o.g) }); }
    return true;
  }
}
registerProcessor('pulsar', Pulsar);
