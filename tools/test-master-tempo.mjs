// Один мастер-темп веба: tempoFrom(n, bpm) ставит мастер ядра и set(bpm) у всех миров с tempo (кроме n); флага link.clock нет.
//   node --test tools/test-master-tempo.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.localStorage = { getItem: () => null, setItem() {} };
const { tempoFrom, syncModelsToMaster } = await import('../host/tempo.js');
const { createMidi } = await import('../host/midi.js');
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

const fake = (n, bpm, extra = {}) => { const m = { n, bpm, tempo: { get: () => m.bpm, set: (b) => { m.bpm = b; }, ...extra } }; worlds[n] = m; return m; };

test('syncModelsToMaster: models show the master (default 100), master is untouched, clamped to world range', () => {
  const a = fake(4, 96), p = fake(13, 120, { min: 60, max: 180 });
  syncModelsToMaster();
  assert.equal(a.bpm, audio.masterBpm() || 100); assert.equal(p.bpm, audio.masterBpm() || 100);
  const before = audio.masterBpm();
  tempoFrom(0, 40);                     // у Portus диапазон 60…180 — зажим; у Natura — 40
  assert.equal(a.bpm, 40); assert.equal(p.bpm, 60);
  assert.equal(audio.masterBpm(), 40); assert.notEqual(before, undefined);
  tempoFrom(0, 190); assert.equal(p.bpm, 180);
  delete worlds[4]; delete worlds[13];
});

test('restore and dice of a registered world re-sync the model to the master', async () => {
  const { registerWorld } = await import('../host/registry.js');
  audio.setMasterBpm(133);
  let bpm = 96; const calls = [];
  registerWorld(21, { tempo: { get: () => bpm, set: (b) => { bpm = b; calls.push(b); } }, restore() { bpm = 77; }, dice() { bpm = 55; } });
  worlds[21].restore('{}'); assert.equal(bpm, 133);
  worlds[21].dice(); assert.equal(bpm, 133);
  delete worlds[21];
});

test('external MIDI: tempoFrom and sync stay silent', () => {
  const a = fake(4, 96);
  let on = true;
  createMidi({ worlds: () => [], now: () => 0, core: { send() {}, grid: () => (on ? { t0: 0, p: 0.5 } : null) } });
  tempoFrom(0, 150); syncModelsToMaster();
  assert.equal(a.bpm, 96); assert.notEqual(audio.masterBpm(), 150);
  on = false; tempoFrom(0, 150); assert.equal(a.bpm, 150);
  delete worlds[4];
});

test('restartAudio takes the master bpm from the core, not the manual-change cache', () => {
  const src = readFileSync(new URL('../host/audio.js', import.meta.url), 'utf8');
  assert.match(src, /masterBpm = \(\) => \(core && core\.node && core\.bpm > 0 \? core\.bpm : masterBpmNow\)/);
  assert.match(src, /export function restartAudio\(\) \{\n  if \(!ctx\) return;\n  masterBpmNow = masterBpm\(\)/);
  assert.match(src, /d\.mbpm > 0\) k\.bpm = d\.mbpm/);
  assert.match(readFileSync(new URL('../t2d-worklet.js', import.meta.url), 'utf8'), /mbpm: x\.t2d_master_bpm_get\(\)/);
});
