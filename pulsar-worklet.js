// Firmamentum — пульсарный синтез (Curtis Roads): поток коротких пульсаретов. Каждый период 1/fp начинается пульсарет —
// несколько периодов синуса на частоте форманта ff в окне; остаток периода — тишина. fp — частота пульсаций (низко — ритм,
// выше 20 Гц — тон), ff — формант (окраска), cycles — сколько периодов в пульсарете (длиннее — уже формант), window — окно
// (0 — колокол Ханна, 0.5 — острый удар с хвостом, 1 — прямоугольник, резко), mask — вероятность пропустить пульсарет
// (звёзды мерцают). crepitus — треск пыли (в духе Jan Jelinek): редкие щелчки разной силы, иногда стайками, и тёплое шипение;
// fulgur — вспышки (в духе Ryoji Ikeda): на пульсарете звезды изредка — чистый синус у края слуха (10–17 кГц) жёстко
// в один канал на 6–60 мс или одиночный цифровой щелчок. События треска и вспышек уходят наверх — для картинки. Счётчики прозвучавших пульсаретов ~30 раз в секунду уходят обратно: звезда вспыхивает на каждом.
// DSP — ядро core/worlds/firmamentum (C++ → pulsar.wasm, байты приходят в processorOptions.wasm, зерно ГСЧ — processorOptions.seed); здесь только сообщения и копия буфера.
// Пока модуль не готов — тишина, сообщения ждут в очереди; готов — {t:'ready'}, не загрузился — {t:'err'} и дальше тишина.
const VMAX = 6;
const VF = ['fp', 'ff', 'cyc', 'win', 'mask', 'lvl', 'pan'];
class Pulsar extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const po = options.processorOptions;
    this.vo = Array.from({ length: VMAX }, () => ({ fp: 4, ff: 600, cyc: 2, win: 0, mask: 0, lvl: 0.8, pan: 0 }));   // последние поля — для неполных сообщений
    this.fxv = { jit: 0, spread: 0.6, crep: 0, fulg: 0 };
    this.x = null; this.queue = []; this.count = 0; this.every = Math.round(sampleRate / 30);
    this.port.onmessage = (e) => { if (this.x) this.apply(e.data); else this.queue.push(e.data); };
    WebAssembly.instantiate(po.wasm, {}).then(({ instance }) => {
      const x = instance.exports;
      if (x._initialize) x._initialize();
      x.pl_init(sampleRate, po.seed == null ? 1 : po.seed >>> 0);
      this.x = x;
      for (const d of this.queue) this.apply(d);
      this.queue = [];
      this.port.postMessage({ t: 'ready' });
    }).catch((err) => this.port.postMessage({ t: 'err', msg: String(err) }));
  }
  apply(d) {
    const x = this.x;
    if (d.t === 'voice') {
      if (!(d.i >= 0 && d.i < VMAX)) return;              // чужой номер голоса — мимо, не в память ядра
      const o = this.vo[d.i];
      for (const k of VF) if (d[k] != null) o[k] = d[k];
      x.pl_voice(d.i, d.on == null ? -1 : d.on ? 1 : 0, o.fp, o.ff, o.cyc, o.win, o.mask, o.lvl, o.pan);
    } else if (d.t === 'fx') {
      const f = this.fxv;
      f.jit = d.jit; f.spread = d.spread;
      if (d.crep != null) f.crep = d.crep;
      if (d.fulg != null) f.fulg = d.fulg;
      x.pl_fx(f.jit, f.spread, f.crep, f.fulg);
    }
  }
  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1], n = L.length, x = this.x;
    if (!x) return true;                                  // выход уже нулевой
    for (let k = 0; k < n; k += 128) {                    // ядро считает не больше 128 за раз
      const m = Math.min(128, n - k), p = x.pl_process(m) >> 2;
      if (!this.mem || this.mem.buffer !== x.memory.buffer) this.mem = new Float32Array(x.memory.buffer);
      L.set(this.mem.subarray(p, p + m), k);
      if (R) R.set(this.mem.subarray(p + m, p + 2 * m), k);
    }
    this.count += n;
    if (this.count >= this.every) {
      this.count = 0;
      const c = [], g = [], k = [], f = [];
      for (let i = 0; i < VMAX; i++) { c.push(x.pl_count(i)); g.push(x.pl_gain(i)); }
      const nk = x.pl_ck(), kp = x.pl_ck_buf() >> 3, nf = x.pl_fl(), fp = x.pl_fl_buf() >> 2;
      const f64 = new Float64Array(x.memory.buffer), i32 = new Int32Array(x.memory.buffer);
      for (let j = 0; j < nk; j++) k.push([f64[kp + 2 * j], f64[kp + 2 * j + 1]]);
      for (let j = 0; j < nf; j++) f.push(i32[fp + j]);
      this.port.postMessage({ t: 'p', c, g, k, f });
    }
    return true;
  }
}
registerProcessor('pulsar', Pulsar);
