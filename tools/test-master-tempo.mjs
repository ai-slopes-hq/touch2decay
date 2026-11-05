// Один мастер-темп веба: tempoFrom(n, bpm) ставит мастер ядра и set(bpm) у всех миров с tempo (кроме n); флага link.clock нет.
//   node --test tools/test-master-tempo.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.localStorage = { getItem: () => null, setItem() {} };
const { tempoFrom } = await import('../host/tempo.js');
const { worlds } = await import('../host/registry.js');
const audio = await import('../host/audio.js');

test('tempoFrom: master gets bpm, every other world with tempo gets set(bpm)', () => {
  const got = {};
  const mk = (n) => ({ tempo: { get: () => 100, set: (b) => { got[n] = b; } } });
  worlds[2] = mk(2); worlds[4] = mk(4); worlds[13] = mk(13); worlds[10] = {};
  tempoFrom(4, 133);
  assert.equal(audio.masterBpm(), 133);   // уходит в ядро сообщением {t:'master', bpm}
  assert.deepEqual(got, { 2: 133, 13: 133 });
  for (const n of [2, 4, 13, 10]) delete worlds[n];
});

test('no link.clock flag, concordia has no shared tempo row', () => {
  const src = readFileSync(new URL('../host/concordia.js', import.meta.url), 'utf8');
  assert.ok(!/clock:\s*(false|true)/.test(src) && !/link\.clock/.test(src) && !/shared tempo/.test(src));
});

test('restore does not touch the master', () => {
  for (const f of ['../worlds/cymatica/index.js', '../worlds/natura/index.js', '../worlds/portus/index.js']) {
    let src = ''; try { src = readFileSync(new URL(f, import.meta.url), 'utf8'); } catch (_) { continue; }
    assert.ok(!/setMasterBpm|tempoFrom/.test(src.split('restore')[1] || ''), f);
  }
});
