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
