// Лад хоста (C++ Scale) против host/scale.js: snapSemi на сетке s от −3 до 90 шаг 0.13, все лады × 12 тоник × on/off.
// C++ печатает числа: core/build/sdk-test --scale. Запуск: core/build.sh && node --test tools/test-scale.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCALES, scl, snapSemi, inScale } from '../host/scale.js';

const BIN = fileURLToPath(new URL('../core/build/sdk-test', import.meta.url));

test('Scale::snapSemi совпадает с host/scale.js', (t) => {
  if (!existsSync(BIN)) return t.skip('core/build/sdk-test не собран (core/build.sh)');
  const p = spawnSync(BIN, ['--scale'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  assert.equal(p.status, 0, p.stderr);
  const lines = p.stdout.trim().split('\n');
  assert.equal(lines.length, SCALES.length * 12 * 2);
  let n = 0;
  for (const line of lines) {
    const f = line.split(' ');
    scl.idx = +f[0]; scl.root = +f[1]; scl.on = f[2] === '1';
    const vals = f.slice(3).map(Number);
    let k = 0;
    for (; -3 + k * 0.13 <= 90; k++) {
      const s = -3 + k * 0.13;
      assert.equal(vals[k], snapSemi(s), `idx ${scl.idx} root ${scl.root} on ${scl.on} s ${s}`);
      n++;
    }
    assert.equal(vals.length, k);
  }
  assert.ok(n > 100000);
  scl.on = false; scl.idx = 0; scl.root = 0;
  assert.ok(inScale(0));
});
