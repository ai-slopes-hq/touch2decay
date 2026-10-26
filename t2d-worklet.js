// t2d — один узел AudioWorklet на хост и все миры SDK (ядро core/bridge → t2d.wasm; байты приходят в processorOptions.wasm, зерно — processorOptions.seed).
// processorOptions.worlds — слоты миров SDK (Cymatica — 2, Firmamentum — 10). Входы: четыре стерео-посыла извне в ревербы room, plate, hall, cathedral.
// Выходы: [возврат ревербов, сухой звук каждого мира — в порядке worlds], все стерео. Ядро считает кусками по 128.
// Внутрь: {t:'action', slot, kind, i, a}, {t:'fader', slot, g}, {t:'scale', on, idx, root}, {t:'snap', slot, id} → {t:'snap', id, js}, {t:'restore', slot, js},
// MIDI-часы: {t:'midi', src, b, at} — байт реального времени от входа src, {t:'midimsg', kind, n, bpm, at} — разобранное (оболочка iOS); at — секунды контекста.
// Время ядра — currentTime: перед каждым куском t2d_time. События часов (пуск, стоп, темп, доля, launch) — {t:'h', ev: [код, bpm, …], grid} сразу после
// блока, где они случились (решение «кого запускать» не должно ждать 1/60 с); сетка {on, t0, p} — ещё и в каждом {t:'m'} (host).
// Наружу ~60 раз в секунду: {t:'m', n, w: {слот: {mirror, heard}}} — n: сколько сообщений порта уже применено (по нему фасад в вебе
// понимает, догнало ли зеркало его действия); — «услышанное» — список записей (по одной на блок, где что-то было; пустые, из одних нулей, пропускаются), копится между отправками — ничего не теряется, раскладку записи знает мир.
// Пока модуль не готов — тишина, сообщения ждут в очереди (порядок сохраняется); готов — {t:'ready'}, не загрузился — {t:'err'} и дальше тишина.
const REVS = 4;
// UTF-8 строки снимка — вручную: в AudioWorkletGlobalScope нет TextEncoder / TextDecoder (Chromium, Safari) — конструктор падал бы
function utf8(s) {
  const o = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 0x80) o.push(c);
    else if (c < 0x800) o.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) o.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else o.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(o);
}
function unutf8(b) {
  let s = '';
  for (let i = 0; i < b.length;) {
    const c = b[i++];
    let cp = c;
    if (c >= 0xf0) cp = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
    else if (c >= 0xe0) cp = ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
    else if (c >= 0xc0) cp = ((c & 31) << 6) | (b[i++] & 63);
    s += String.fromCodePoint(cp);
  }
  return s;
}
// сборка без emscripten (core/build-wasi.sh) просит три функции WASI от stdio — не вызываются; emcc-сборке импорты не нужны
const WASI_STUBS = { wasi_snapshot_preview1: { fd_close: () => 0, fd_seek: () => 0, fd_write: () => 0 } };
class T2d extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const po = options.processorOptions || {};
    this.slots = po.worlds || [];
    this.base = null; this.pend = [];                       // base — время контекста, с которого пошёл счёт ядра (первый блок); до него действия ждут
    this.x = null; this.queue = []; this.count = 0; this.applied = 0; this.every = Math.round(sampleRate / 60);
    this.heard = {}; for (const s of this.slots) this.heard[s] = [];
    this.port.onmessage = (e) => { if (this.x) this.apply(e.data); else this.queue.push(e.data); };
    WebAssembly.instantiate(po.wasm, WASI_STUBS).then(({ instance }) => {
      const x = instance.exports;
      if (x._initialize) x._initialize();
      x.t2d_init(sampleRate, po.seed == null ? 1 : po.seed >>> 0);
      this.x = x; this.cap = x.t2d_str_cap();
      for (const d of this.queue) this.apply(d);
      this.queue = [];
      this.port.postMessage({ t: 'ready' });
    }).catch((err) => this.port.postMessage({ t: 'err', msg: String(err) }));
  }
  nums(n) { this.views(this.x); return Array.from(this.mb.subarray(0, n)); }
  grid() { const n = this.x.t2d_hmirror(), m = this.mb; return n ? { on: m[0] !== 0, t0: m[1], p: m[2] } : null; }
  apply(d) {
    const x = this.x;
    if (d.abs && this.base == null) { this.pend.push(d); return; }   // время контекста пока не с чем сверить: счёт ядра начнётся с первого блока
    this.applied++;
    if (d.t === 'action') {
      const a = d.a ? d.a.slice() : [], n = Math.min(a.length, 256);
      if (d.abs) {                                        // числа во времени контекста (сетка MIDI-часов) → во время ядра (секунды от старта счёта)
        for (const k of d.abs) if (k < n) a[k] -= this.base;
      }
      new Float64Array(x.memory.buffer, x.t2d_args(), n).set(a.slice(0, n));
      x.t2d_action(d.slot, d.kind, d.i | 0, x.t2d_args(), n);
    } else if (d.t === 'fader') x.t2d_fader(d.slot, d.g);
    else if (d.t === 'scale') x.t2d_scale(d.on ? 1 : 0, d.idx | 0, d.root | 0);
    else if (d.t === 'midi') x.t2d_midi_byte(d.src | 0, d.b | 0, +d.at || 0);
    else if (d.t === 'midimsg') x.t2d_midi_msg(d.kind | 0, +d.n || 0, +d.bpm || 0, +d.at || 0);
    else if (d.t === 'snap') {
      const n = x.t2d_snapshot(d.slot);
      this.port.postMessage({ t: 'snap', id: d.id, js: n ? unutf8(new Uint8Array(x.memory.buffer, x.t2d_str_buf(), n)) : '' });
    } else if (d.t === 'restore') {
      const b = utf8(d.js || '');
      if (b.length > this.cap) return;                    // не влезло в строковый буфер ядра — мимо
      new Uint8Array(x.memory.buffer, x.t2d_str_buf(), b.length).set(b);
      x.t2d_restore(d.slot, b.length);
    }
  }
  views(x) {                                            // представления памяти ядра — кэш; заново, только когда память выросла (в process без выделений)
    if (this.buf === x.memory.buffer) return;
    const b = this.buf = x.memory.buffer;
    this.ext = []; this.ret = []; this.dry = [];
    for (let r = 0; r < REVS; r++) this.ext.push([new Float32Array(b, x.t2d_ext(r, 0), 128), new Float32Array(b, x.t2d_ext(r, 1), 128)]);
    for (let c = 0; c < 2; c++) this.ret.push(new Float32Array(b, x.t2d_ret(c), 128));
    for (const s of this.slots) this.dry.push([new Float32Array(b, x.t2d_dry(s, 0), 128), new Float32Array(b, x.t2d_dry(s, 1), 128)]);
    this.mb = new Float64Array(b, x.t2d_mbuf(), 1024);
  }
  process(inputs, outputs) {
    const x = this.x;
    if (!x) return true;                                  // выходы уже нулевые
    this.views(x);
    if (this.base == null) { this.base = typeof currentTime === 'number' ? currentTime : 0; const p = this.pend; this.pend = []; for (const d of p) this.apply(d); }
    const out0 = outputs[0], n = out0[0].length, ns = this.slots.length;
    for (let k = 0; k < n; k += 128) {
      const m = Math.min(128, n - k);
      for (let r = 0; r < REVS; r++) {                    // посылы извне; нет входа — тишина
        const inp = inputs[r];
        for (let c = 0; c < 2; c++) {
          const dst = this.ext[r][c], src = inp && (inp[c] || inp[0]);
          if (src && src.length >= k + m) for (let i = 0; i < m; i++) dst[i] = src[k + i];
          else for (let i = 0; i < m; i++) dst[i] = 0;
        }
      }
      x.t2d_time(currentTime + k / sampleRate);
      x.t2d_process(m);
      this.views(x);
      const ne = x.t2d_hevents();                         // события часов — редкие (раз в долю): сразу
      if (ne) { const ev = this.nums(ne); this.port.postMessage({ t: 'h', ev, grid: this.grid() }); }
      for (let c = 0; c < 2; c++) {
        const o = out0[c], rt = this.ret[c];
        if (o) for (let i = 0; i < m; i++) o[k + i] = rt[i];
        for (let j = 0; j < ns; j++) {
          const w = outputs[1 + j], d = this.dry[j][c];
          if (w && w[c]) for (let i = 0; i < m; i++) w[c][k + i] = d[i];
        }
      }
      for (let j = 0; j < ns; j++) {                      // услышанное очищается при чтении — копим до отправки; в массив — только если что-то было
        const s = this.slots[j], h = x.t2d_heard(s), mb = this.mb;
        let any = false;
        for (let i = 0; i < h; i++) if (mb[i] !== 0) { any = true; break; }
        if (any) this.heard[s].push(Array.from(mb.subarray(0, h)));
      }
    }
    this.count += n;
    if (this.count >= this.every) {
      this.count = 0;
      const w = {};
      for (const s of this.slots) { w[s] = { mirror: this.nums(x.t2d_mirror(s)), heard: this.heard[s] }; this.heard[s] = []; }
      this.port.postMessage({ t: 'm', n: this.applied, w, host: this.grid() });
    }
    return true;
  }
}
registerProcessor('t2d', T2d);
