// Тесты блоков core/sdk (C++, нативно): запускает core/build/sdk-test.
//   core/build.sh && node --test tools/test-sdk.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../core/build/sdk-test', import.meta.url));

test('sdk blocks (native)', (t) => {
  if (!existsSync(BIN)) return t.skip('core/build/sdk-test не собран (core/build.sh)');
  const p = spawnSync(BIN, { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.match(p.stdout, /0 failed/);
});

// t2d.wasm — хост и миры SDK одним модулем: без импортов (как goetia.wasm), все экспорты t2d_* на месте,
// Firmamentum в слоте 10 — модель идёт, звук пока тишина (задача 5)
test('t2d.wasm: standalone, exports, Firmamentum in slot 10', async (t) => {
  const { WASM, loadT2d } = await import('./t2d-core.mjs');
  if (!existsSync(WASM)) return t.skip('t2d.wasm не собран (core/build.sh)');
  const { readFileSync } = await import('node:fs');
  const mod = new WebAssembly.Module(readFileSync(WASM));
  assert.ok(WebAssembly.Module.imports(mod).every((i) => i.module === 'wasi_snapshot_preview1'));   // emcc — ни одного, wasi-sdk — fd_*
  const names = WebAssembly.Module.exports(mod).map((e) => e.name);
  for (const n of ['init', 'args', 'action', 'process', 'dry', 'ret', 'ext', 'mbuf', 'mirror', 'heard', 'str_buf', 'str_cap', 'snapshot', 'restore', 'fader', 'scale'])
    assert.ok(names.includes(`t2d_${n}`), `t2d_${n}`);
  const c = loadT2d();
  c.init(48000, 1);
  assert.equal(c.mirror(10)[16], 0, 'no stars');
  assert.equal(c.mirror(3).length, 0, 'empty slot — no mirror');
  c.action(10, 0, 0, [0.5, 0]);                         // add
  for (let k = 0; k < 10; k++) c.process(128);
  const m = c.mirror(10);
  assert.equal(m[16], 1); assert.ok(Math.abs(m[0] - 1280 / 48000) < 1e-12, `time ${m[0]}`);
  let dry = 0, ret = 0;                                 // звезда звучит, её посыл доходит до зала
  for (let k = 0; k < 200; k++) { c.process(128); dry = Math.max(dry, ...c.dry(10, 0).map(Math.abs)); ret = Math.max(ret, ...c.ret(0).map(Math.abs)); }
  assert.ok(dry > 1e-3 && ret > 1e-5, `dry ${dry}, return ${ret}`);
  assert.match(c.snapshot(10), /^\{"s":\[\{"h":0\.5,"u":0,/);
});
