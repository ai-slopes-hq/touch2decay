// Фикстура страны Arcadia свежа (genLand и routeOf не менялись) и имена на месте. Ядро сверяется с ней в sdk_test (arcPicFixture).
//   node --test tools/test-arcadia-pic.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build, SEEDS } from './arcadia-pic-ref.mjs';
import { genLand, LACUS } from '../worlds/arcadia/model.js';

test('fixture core/tests/data/arcadia-pic.json is up to date', () => {
  const file = JSON.parse(readFileSync(new URL('../core/tests/data/arcadia-pic.json', import.meta.url), 'utf8'));
  assert.deepEqual(file, JSON.parse(JSON.stringify(build())));   // node tools/arcadia-pic-ref.mjs
});

test('genLand: lake names by cycle index, ponds unnamed', () => {
  for (const seed of SEEDS) {
    const { lakes } = genLand(seed);
    let k = 0;
    for (const l of lakes) {
      if (l.pond) assert.equal(l.name, '', `seed ${seed}: pond has a name`);
      else assert.equal(l.name, LACUS[(seed + k++) % LACUS.length], `seed ${seed}: lake ${k - 1}`);
    }
  }
});
