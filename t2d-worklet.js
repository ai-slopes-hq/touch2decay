// t2d — один узел AudioWorklet на хост и все миры SDK (ядро core/bridge → t2d.wasm; байты приходят в processorOptions.wasm, зерно — processorOptions.seed).
// processorOptions.worlds — слоты миров SDK (Firmamentum — 10). Входы: четыре стерео-посыла извне в ревербы room, plate, hall, cathedral.
// Выходы: [возврат ревербов, сухой звук каждого мира — в порядке worlds], все стерео. Ядро считает кусками по 128.
// Внутрь: {t:'action', slot, kind, i, a}, {t:'fader', slot, g}, {t:'scale', on, idx, root}, {t:'snap', slot, id} → {t:'snap', id, js}, {t:'restore', slot, js}.
// Наружу ~60 раз в секунду: {t:'m', w: {слот: {mirror, heard}}} — «услышанное» — список записей (по одной на блок, где что-то было; пустые, из одних нулей, пропускаются), копится между отправками — ничего не теряется, раскладку записи знает мир.
// Пока модуль не готов — тишина, сообщения ждут в очереди (порядок сохраняется); готов — {t:'ready'}, не загрузился — {t:'err'} и дальше тишина.
const REVS = 4;
class T2d extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const po = options.processorOptions || {};
    this.slots = po.worlds || [];
    this.x = null; this.queue = []; this.count = 0; this.every = Math.round(sampleRate / 60);
    this.heard = {}; for (const s of this.slots) this.heard[s] = [];
    this.td = new TextDecoder(); this.te = new TextEncoder();
    this.port.onmessage = (e) => { if (this.x) this.apply(e.data); else this.queue.push(e.data); };
    WebAssembly.instantiate(po.wasm, {}).then(({ instance }) => {
      const x = instance.exports;
      if (x._initialize) x._initialize();
      x.t2d_init(sampleRate, po.seed == null ? 1 : po.seed >>> 0);
      this.x = x; this.cap = x.t2d_str_cap();
      for (const d of this.queue) this.apply(d);
      this.queue = [];
      this.port.postMessage({ t: 'ready' });
    }).catch((err) => this.port.postMessage({ t: 'err', msg: String(err) }));
  }
  nums(n) { return Array.from(new Float64Array(this.x.memory.buffer, this.x.t2d_mbuf(), n)); }
  apply(d) {
    const x = this.x;
    if (d.t === 'action') {
      const a = d.a || [], n = Math.min(a.length, 64);
      new Float64Array(x.memory.buffer, x.t2d_args(), n).set(a.slice(0, n));
      x.t2d_action(d.slot, d.kind, d.i | 0, x.t2d_args(), n);
    } else if (d.t === 'fader') x.t2d_fader(d.slot, d.g);
    else if (d.t === 'scale') x.t2d_scale(d.on ? 1 : 0, d.idx | 0, d.root | 0);
    else if (d.t === 'snap') {
      const n = x.t2d_snapshot(d.slot);
      this.port.postMessage({ t: 'snap', id: d.id, js: n ? this.td.decode(new Uint8Array(x.memory.buffer, x.t2d_str_buf(), n)) : '' });
    } else if (d.t === 'restore') {
      const b = this.te.encode(d.js || '');
      if (b.length > this.cap) return;                    // не влезло в строковый буфер ядра — мимо
      new Uint8Array(x.memory.buffer, x.t2d_str_buf(), b.length).set(b);
      x.t2d_restore(d.slot, b.length);
    }
  }
  process(inputs, outputs) {
    const x = this.x;
    if (!x) return true;                                  // выходы уже нулевые
    const n = outputs[0][0].length;
    for (let k = 0; k < n; k += 128) {
      const m = Math.min(128, n - k);
      for (let r = 0; r < REVS; r++) {                    // посылы извне; нет входа — тишина
        const inp = inputs[r];
        for (let c = 0; c < 2; c++) {
          const dst = new Float32Array(x.memory.buffer, x.t2d_ext(r, c), m), src = inp && (inp[c] || inp[0]);
          if (src && src.length >= k + m) dst.set(src.subarray(k, k + m)); else dst.fill(0);
        }
      }
      x.t2d_process(m);
      for (let c = 0; c < 2; c++) {
        if (outputs[0][c]) outputs[0][c].set(new Float32Array(x.memory.buffer, x.t2d_ret(c), m), k);
        this.slots.forEach((s, j) => { const o = outputs[1 + j]; if (o && o[c]) o[c].set(new Float32Array(x.memory.buffer, x.t2d_dry(s, c), m), k); });
      }
      for (const s of this.slots) {                       // услышанное очищается при чтении — копим до отправки
        const h = this.nums(x.t2d_heard(s));
        if (h.some((v) => v !== 0)) this.heard[s].push(h);
      }
    }
    this.count += n;
    if (this.count >= this.every) {
      this.count = 0;
      const w = {};
      for (const s of this.slots) { w[s] = { mirror: this.nums(x.t2d_mirror(s)), heard: this.heard[s] }; this.heard[s] = []; }
      this.port.postMessage({ t: 'm', w });
    }
    return true;
  }
}
registerProcessor('t2d', T2d);
