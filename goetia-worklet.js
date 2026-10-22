// Goetia — bytebeat: звук — формула от счётчика t. Печать духа — путь через узлы круга; узел k — член (t >> s_k), знак узла —
// как он соединяется с тем, что уже набрано: acc = (t>>s0) ∘1 (t>>s1) ∘2 … ; выход — (t·acc) & 255, восемь бит, −1…1.
// t идёт со скоростью rate (около 8 кГц, как в классическом bytebeat) — выше rate, выше всё: и тон, и ритм.
// Голос (дух) — до 3; легион — 1…4 одинаковых формулы с чуть разной скоростью: расходятся по фазе, как хор (fx legio — насколько).
// tone — однополюсный lowpass на голос (bytebeat без него режет уши). release — удар ↔ дрон: каждый подъём бита самого медленного
// члена печати (trig = его сдвиг) — удар, дальше затухание 4 мс … 2 с; rel ≥ 0.97 — без затухания, ровный дрон. У каждого легиона
// свой t — и свой удар (с legio удары расходятся во флэм). Наверх ~30 раз в секунду: t и громкость голоса (с огибающей) — для картинки.
// DSP — ядро core/worlds/goetia (C++ → goetia.wasm, байты приходят в processorOptions.wasm); здесь только сообщения и копия буфера.
// Пока модуль не готов — тишина, сообщения ждут в очереди; готов — {t:'ready'}, не загрузился — {t:'err'} и дальше тишина.
const VMAX = 3, PMAX = 8;
const OPS = ['|', '&', '^', '+', '*', '-', '%', '>'];   // знак → код ядра; неизвестный — '|'
const FIELDS = ['on', 'rate', 'lp', 'lvl', 'legio', 'pan', 'rel', 'trig'];
class Goetia extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.vo = Array.from({ length: VMAX }, () => ({ on: false, rate: 8000, lp: 0.3, lvl: 0.7, legio: 1, pan: 0, rel: 1, trig: 8 }));   // последние поля — для неполных сообщений
    this.x = null; this.queue = []; this.count = 0; this.every = Math.round(sampleRate / 30);
    this.port.onmessage = (e) => { if (this.x) this.apply(e.data); else this.queue.push(e.data); };
    WebAssembly.instantiate(options.processorOptions.wasm, {}).then(({ instance }) => {
      const x = instance.exports;
      if (x._initialize) x._initialize();
      x.gt_init(sampleRate);
      this.x = x;
      for (const d of this.queue) this.apply(d);
      this.queue = [];
      this.port.postMessage({ t: 'ready' });
    }).catch((err) => this.port.postMessage({ t: 'err', msg: String(err) }));
  }
  apply(d) {
    const x = this.x;
    if ((d.t === 'voice' || d.t === 'sett') && !(d.i >= 0 && d.i < VMAX)) return;   // чужой номер голоса — мимо, не в память ядра
    if (d.t === 'voice') {
      const o = this.vo[d.i];
      if (d.prog) {                                       // программа — раньше полей голоса, как в прежнем worklet
        const n = Math.min(PMAX, d.prog.length), buf = new Int32Array(x.memory.buffer, x.gt_prog_buf(), 2 * PMAX);
        for (let q = 0; q < n; q++) { buf[2 * q] = Math.max(0, OPS.indexOf(d.prog[q][0])); buf[2 * q + 1] = d.prog[q][1]; }
        x.gt_prog(d.i, n);
      }
      for (const k of FIELDS) if (d[k] != null) o[k] = d[k];
      x.gt_voice(d.i, o.on ? 1 : 0, o.rate, o.lp, o.lvl, o.legio | 0, o.pan, o.rel, o.trig);
    } else if (d.t === 'fx') x.gt_fx(d.spread, d.wide);
    else if (d.t === 'sett') x.gt_set_t(d.i, d.t0);       // только тесты: стартовое t
  }
  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1], n = L.length, x = this.x;
    if (!x) return true;                                  // выход уже нулевой
    for (let k = 0; k < n; k += 128) {                    // ядро считает не больше 128 за раз
      const m = Math.min(128, n - k), p = x.gt_process(m) >> 2;
      if (!this.mem || this.mem.buffer !== x.memory.buffer) this.mem = new Float32Array(x.memory.buffer);
      L.set(this.mem.subarray(p, p + m), k);
      if (R) R.set(this.mem.subarray(p + m, p + 2 * m), k);
    }
    this.count += n;
    if (this.count >= this.every) {
      this.count = 0;
      const tt = [], g = [];
      for (let i = 0; i < VMAX; i++) { tt.push(x.gt_t0(i)); g.push(x.gt_gv(i)); }
      this.port.postMessage({ t: 'p', tt, g });
    }
    return true;
  }
}
registerProcessor('goetia', Goetia);
