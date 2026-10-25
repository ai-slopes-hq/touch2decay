// t2d.wasm в Node: синхронная загрузка (модуль компилируется один раз, на каждый вызов — свой экземпляр: хост и миры — свои)
// и обёртки над экспортами t2d_* (core/bridge/wasm.cpp). Для тестов; в вебе тот же модуль крутит worklet.
import { readFileSync } from 'node:fs';

// T2D_WASM — путь к другой сборке (например, собранной без emscripten: zig c++ -target wasm32-wasi даёт импорты WASI — ниже заглушки)
export const WASM = process.env.T2D_WASM ? process.env.T2D_WASM : new URL('../t2d.wasm', import.meta.url);
const wasiStubs = (m) => { const o = {}; for (const i of WebAssembly.Module.imports(m)) (o[i.module] ??= {})[i.name] = () => 0; return o; };
let mod = null;

export function loadT2d() {
  if (!mod) mod = new WebAssembly.Module(readFileSync(WASM));
  const x = new WebAssembly.Instance(mod, wasiStubs(mod)).exports;
  if (x._initialize) x._initialize();
  const f64 = (p, n) => new Float64Array(x.memory.buffer, p, n);
  const f32 = (p, n) => new Float32Array(x.memory.buffer, p, n);
  const strCap = x.t2d_str_cap();
  return {
    exports: x,
    init: (sr, seed) => x.t2d_init(sr, seed >>> 0),
    action(slot, kind, i = 0, a = []) { f64(x.t2d_args(), a.length).set(a); x.t2d_action(slot, kind, i, x.t2d_args(), a.length); },
    process: (n) => x.t2d_process(n),
    dry: (slot, ch, n = 128) => f32(x.t2d_dry(slot, ch), n),        // вид на память ядра — до следующего process
    ret: (ch, n = 128) => f32(x.t2d_ret(ch), n),
    ext: (rev, ch, n = 128) => f32(x.t2d_ext(rev, ch), n),
    mirror(slot) { const n = x.t2d_mirror(slot); return Array.from(f64(x.t2d_mbuf(), n)); },
    heard(slot) { const n = x.t2d_heard(slot); return Array.from(f64(x.t2d_mbuf(), n)); },
    snapshot(slot) { const n = x.t2d_snapshot(slot); return new TextDecoder().decode(new Uint8Array(x.memory.buffer, x.t2d_str_buf(), n)); },
    restore(slot, js) {
      const b = new TextEncoder().encode(js);
      if (b.length > strCap) throw new Error(`t2d: snapshot ${b.length} > ${strCap} bytes`);
      new Uint8Array(x.memory.buffer, x.t2d_str_buf(), b.length).set(b);
      x.t2d_restore(slot, b.length);
    },
    fader: (slot, g) => x.t2d_fader(slot, g),
    scale: (on, idx, root) => x.t2d_scale(on ? 1 : 0, idx, root),
  };
}
