// Сценарии t2d-worklet.js: vm-песочница (sandbox из goetia-scenarios.mjs) с t2d.wasm, прогон блоков, сравнение с tools/t2d-core.mjs.
import { readFileSync } from 'node:fs';
import { sandbox, SR, BLOCK } from './goetia-scenarios.mjs';
import { WASM } from './t2d-core.mjs';

export { SR, BLOCK };
export function loadWorklet(worlds = [10], seed = 1) {   // обёртка над t2d.wasm; ready — когда пришло {t:'ready'}
  const { reg, posted, ctx } = sandbox('../t2d-worklet.js', { currentTime: 0 });   // без TextEncoder / TextDecoder — в AudioWorkletGlobalScope их нет; currentTime — двигает block
  const b = readFileSync(WASM);
  const proc = new reg.t2d({ processorOptions: { wasm: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), worlds, seed } });
  const ready = new Promise((res, rej) => {
    const post = proc.port.postMessage;
    proc.port.postMessage = (m) => { post(m); if (m.t === 'ready') res(); else if (m.t === 'err') rej(new Error(m.msg)); };
  });
  return { proc, posted, ready, nOut: 1 + worlds.length, ctx };
}

// один блок: ext — {rev: [L, R]} посылы извне (по умолчанию тишина — пустые входы); возвращает outputs[o][c] (Float32Array)
export function block(w, ext = {}, n = BLOCK) {
  const inputs = [0, 1, 2, 3].map((r) => (ext[r] ? [Float32Array.from(ext[r][0]), Float32Array.from(ext[r][1])] : []));
  const outputs = Array.from({ length: w.nOut }, () => [new Float32Array(n), new Float32Array(n)]);
  w.proc.process(inputs, outputs, {});
  if (w.ctx) w.ctx.currentTime += n / SR;              // как в браузере: следующий квант — позже
  return outputs;
}
