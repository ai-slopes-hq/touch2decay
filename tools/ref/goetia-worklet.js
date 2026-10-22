// Эталон для сверки ядра (tools/test-goetia-core.mjs): прежний goetia-worklet.js на JS, плюс тестовое сообщение sett.
// Goetia — bytebeat: звук — формула от счётчика t. Печать духа — путь через узлы круга; узел k — член (t >> s_k), знак узла —
// как он соединяется с тем, что уже набрано: acc = (t>>s0) ∘1 (t>>s1) ∘2 … ; выход — (t·acc) & 255, восемь бит, −1…1.
// t идёт со скоростью rate (около 8 кГц, как в классическом bytebeat) — выше rate, выше всё: и тон, и ритм.
// Голос (дух) — до 3; легион — 1…4 одинаковых формулы с чуть разной скоростью: расходятся по фазе, как хор (fx legio — насколько).
// tone — однополюсный lowpass на голос (bytebeat без него режет уши). release — удар ↔ дрон: каждый подъём бита самого медленного
// члена печати (trig = его сдвиг) — удар, дальше затухание 4 мс … 2 с; rel ≥ 0.97 — без затухания, ровный дрон. У каждого легиона
// свой t — и свой удар (с legio удары расходятся во флэм). Наверх ~30 раз в секунду: t и громкость голоса (с огибающей) — для картинки.
const VMAX = 3, LMAX = 4;
const OPS = {                                             // знак узла → действие; аргументы — 32-битные целые
  '|': (a, b) => a | b,
  '&': (a, b) => a & b,
  '^': (a, b) => a ^ b,
  '+': (a, b) => (a + b) | 0,
  '-': (a, b) => (a - b) | 0,
  '*': (a, b) => Math.imul(a, b),
  '%': (a, b) => a % ((b & 15) + 1),
  '>': (a, b) => a >> (b & 7),
};
class Goetia extends AudioWorkletProcessor {
  constructor() {
    super();
    this.vo = Array.from({ length: VMAX }, () => ({ on: false, prog: [], rate: 8000, rateS: 8000, lp: 0.3, lvl: 0.7, legio: 1, pan: 0, rel: 1, trig: 8, g: 0, gv: 0, t: new Float64Array(LMAX), y: new Float64Array(LMAX), env: new Float64Array(LMAX).fill(1), envS: new Float64Array(LMAX).fill(1), lb: new Uint8Array(LMAX), dc: 0, dx: 0 }));
    this.spread = 0.6; this.wide = 0.3; this.count = 0; this.every = Math.round(sampleRate / 30);
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.t === 'voice') {
        const o = this.vo[d.i];
        if (d.prog) o.prog = d.prog.map(([op, s]) => [OPS[op] || OPS['|'], s]);
        for (const k of ['on', 'rate', 'lp', 'lvl', 'legio', 'pan', 'rel', 'trig']) if (d[k] != null) o[k] = d[k];
        if (d.on && o.g < 1e-4) { o.rateS = o.rate; o.t.fill(0); for (let j = 1; j < LMAX; j++) o.t[j] = j * 1777; }   // новый дух — с начала; легионы чуть вразнобой
      } else if (d.t === 'fx') { this.spread = d.spread; this.wide = d.wide; }
      else if (d.t === 'sett') { const o = this.vo[d.i]; for (let j = 0; j < LMAX; j++) o.t[j] = d.t0 + j * 1777; }   // только тесты: стартовое t
    };
  }
  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length, sr = sampleRate;
    for (let k = 0; k < n; k++) { L[k] = 0; if (R !== L) R[k] = 0; }
    for (const o of this.vo) {
      if ((!o.on && o.g < 1e-5) || !o.prog.length) { if (!o.on) o.g = 0; continue; }
      const P = o.prog, np = P.length, nl = Math.max(1, Math.min(LMAX, o.legio | 0)), norm = 1 / Math.sqrt(nl);
      const drone = o.rel >= 0.97, dec = drone ? 1 : Math.exp(-1 / (0.004 * 500 ** o.rel * sr));
      const pans = [], dets = [];
      for (let j = 0; j < nl; j++) {
        const u = nl === 1 ? 0 : (j / (nl - 1)) * 2 - 1;
        dets.push(1 + u * this.wide * 0.006);              // легион: скорость ±0.6 % при legio 100 %
        const p = Math.max(-1, Math.min(1, o.pan * this.spread + u * 0.6 * this.spread));
        pans.push([(1 - p) * 0.5, (1 + p) * 0.5]);
      }
      for (let k = 0; k < n; k++) {
        o.g += ((o.on ? o.lvl : 0) - o.g) * (o.on ? 0.0015 : 0.0006);
        o.rateS += (o.rate - o.rateS) * 0.0015;
        let sl = 0, sr2 = 0;
        for (let j = 0; j < nl; j++) {
          const tf = (o.t[j] += (o.rateS * dets[j]) / sr), ti = tf | 0;
          let acc = ti >> P[0][1];
          for (let q = 1; q < np; q++) acc = P[q][0](acc, ti >> P[q][1]);
          const v = (Math.imul(ti, acc) & 255) / 127.5 - 1;
          const y = (o.y[j] += (v - o.y[j]) * o.lp);
          const b = (ti >> o.trig) & 1;
          if (drone) o.env[j] = 1; else { if (b && !o.lb[j]) o.env[j] = 1; else o.env[j] *= dec; }   // подъём бита — удар
          o.lb[j] = b;
          const e = (o.envS[j] += (o.env[j] - o.envS[j]) * 0.06);   // фронт ~0.3 мс — без щелчка
          sl += y * e * pans[j][0]; sr2 += y * e * pans[j][1];
        }
        const m = (sl + sr2) * 0.5, dcy = m - o.dx + 0.997 * o.dc; o.dx = m; o.dc = dcy;   // постоянную составляющую — вон (общая на оба канала)
        const off = dcy - m, gg = o.g * norm;
        o.gv = o.g * o.envS[0];
        L[k] += (sl + off) * gg; if (R !== L) R[k] += (sr2 + off) * gg;
      }
    }
    for (let k = 0; k < n; k++) { L[k] = Math.tanh(L[k] * 0.8); if (R !== L) R[k] = Math.tanh(R[k] * 0.8); }
    this.count += n;
    if (this.count >= this.every) { this.count = 0; this.port.postMessage({ t: 'p', tt: this.vo.map((o) => o.t[0]), g: this.vo.map((o) => o.gv) }); }
    return true;
  }
}
registerProcessor('goetia', Goetia);
