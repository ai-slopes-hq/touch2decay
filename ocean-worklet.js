// Oceanus — сканирующий синтез (Verplank, Mathews, Shaw, 2000): кольцо из N масс на пружинах — Мировой океан. Кольцо медленно
// колышется (физика — раз в STEP отсчётов, «тактильная» скорость), а голоса читают его форму по кругу со звуковой частотой:
// форма кольца — форма волны. Тронул воду — по кольцу бегут волны, тембр живой и сам успокаивается. Луна тянет воду на себя —
// горб первой моды (чистый тон), ветер — мелкая рябь, натяжение — скорость волн, затухание — сколько они живут.
// Между шагами физики таблица плавно перетекает (линейно), чтобы не было ступенек. Форма кольца ~30 раз в секунду уходит обратно.
// DSP — ядро core/worlds/oceanus (C++ → ocean.wasm, байты приходят в processorOptions.wasm, зерно ГСЧ — processorOptions.seed); здесь только сообщения и копия буфера.
// Пока модуль не готов — тишина, сообщения ждут в очереди; готов — {t:'ready'}, не загрузился — {t:'err'} и дальше тишина.
const N = 64, VMAX = 6;
const PK = ['kt', 'damp', 'kc', 'wind', 'tide', 'moonRate', 'storm', 'sway', 'swayTo'];
class Ocean extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const po = options.processorOptions;
    this.pr = { kt: 0.03, damp: 0.002, kc: 0.004, wind: 0, tide: 0.5, moonRate: 0.04, storm: 0, sway: 0, swayTo: 0 };   // последние значения — для неполных сообщений
    this.vo = Array.from({ length: VMAX }, () => ({ f: 110, lvl: 0.8, path: 0 }));
    this.x = null; this.queue = []; this.count = 0; this.every = Math.round(sampleRate / 30);
    this.port.onmessage = (e) => { if (this.x) this.apply(e.data); else this.queue.push(e.data); };
    WebAssembly.instantiate(po.wasm, {}).then(({ instance }) => {
      const x = instance.exports;
      if (x._initialize) x._initialize();
      x.oc_init(sampleRate, po.seed == null ? 1 : po.seed >>> 0);
      this.x = x;
      for (const d of this.queue) this.apply(d);
      this.queue = [];
      this.port.postMessage({ t: 'ready' });
    }).catch((err) => this.port.postMessage({ t: 'err', msg: String(err) }));
  }
  apply(d) {
    const x = this.x;
    if (d.t === 'params') {
      const p = this.pr;
      for (const k of PK) if (d[k] != null) p[k] = d[k];     // нет поля — прежнее значение
      x.oc_params(p.kt, p.damp, p.kc, p.wind, p.tide, p.moonRate, p.storm, p.sway, p.swayTo);
    } else if (d.t === 'push') {
      if (d.off) x.oc_release(d.id); else x.oc_push(d.id, d.a, d.d, d.k || 0.08);
    } else if (d.t === 'splash') {
      x.oc_splash(d.a, d.amt);
    } else if (d.t === 'voice') {
      if (!(d.i >= 0 && d.i < VMAX)) return;              // чужой номер голоса — мимо, не в память ядра
      const o = this.vo[d.i];
      if (d.f) o.f = d.f;
      if (d.lvl != null) o.lvl = d.lvl;
      if (d.path != null) o.path = d.path;
      x.oc_voice(d.i, d.on ? 1 : 0, o.f, o.lvl, o.path);
    }
  }
  views(x) {                                            // представления памяти ядра — заново, только когда память выросла
    if (this.mem && this.mem.buffer === x.memory.buffer) return;
    this.mem = new Float32Array(x.memory.buffer);
  }
  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1], n = L.length, x = this.x;
    if (!x) return true;                                  // выход уже нулевой
    for (let k = 0; k < n; k += 128) {                    // ядро считает не больше 128 за раз
      const m = Math.min(128, n - k), p = x.oc_process(m) >> 2;
      this.views(x);
      L.set(this.mem.subarray(p, p + m), k);
      if (R) R.set(this.mem.subarray(p + m, p + 2 * m), k);
    }
    this.count += n;
    if (this.count >= this.every) {
      this.count = 0;
      const sp = x.oc_shape() >> 2, g = [];
      for (let i = 0; i < VMAX; i++) g.push(x.oc_gain(i));
      this.views(x);
      this.port.postMessage({ t: 'shape', x: Array.from(this.mem.subarray(sp, sp + N)), moon: x.oc_moon(), g });
    }
    return true;
  }
}
registerProcessor('ocean', Ocean);
