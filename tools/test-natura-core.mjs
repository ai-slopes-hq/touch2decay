// Natura в t2d.wasm (слот 4) против нативного core/build/natura-cli: одна сцена (состояние STATE), сухой выход — до 1e-5 по сэмплам
// (одни и те же исходники C++; различие — только libm wasm и хоста), «услышано» — шаги и ноты в своё время, зеркало, пуск и стоп.
//   core/build.sh && node --test tools/test-natura-core.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { loadT2d } from './t2d-core.mjs';
import { createModel } from './ref/natura-model.js';
import { stateArgs, SLOT, ACT } from '../worlds/natura/engine.js';
import { seeded } from './models/util.mjs';

const SR = 48000, SECS = 4, BLOCKS = Math.floor(SECS * SR / 128);
const PAT = [[0, 2], [2, 7], [4, 5], [6, 11], [8, 4], [10, 9], [12, 0], [14, 12]];
const scene = (w, fx = {}) => {
  const m = createModel({ rng: seeded(7) });
  for (let i = 0; i < 16; i++) m.state.pads.at[i] = null;
  m.state.pads.len = 16;
  for (const [j, n] of PAT) m.state.pads.at[j] = { note: n, wave: w < 0 ? (j / 2) % 5 : w, glide: w < 0 && j % 4 === 2 };
  Object.assign(m.state.fx, fx);
  return m.state;
};
const ACTS = [[0.9, ACT.LASER, 0, []], [1.4, ACT.CROAK, 0, [5]], [1.9, ACT.SHAKE, 0, [0.8]], [2.4, ACT.SHAKE, 0, [0]], [2.6, ACT.SKIFF, 0, [0.1, 0.5, 3]], [3.4, ACT.SKIFF_OFF, 0, []]];
const CASES = { saw: [scene(3), []], mixed: [scene(-1, { chorus: 1, delay: 0.8, res: 0.7 }), ACTS], sharp: [scene(4, { time: 0.2 }), ACTS] };

for (const [name, [S, acts]] of Object.entries(CASES)) {
  test(`Natura [${name}]: ядро в wasm = нативное (1e-5), удары по шагам, зеркало`, () => {
    const st = stateArgs(S);
    let inp = `state ${st.join(' ')}\nsecs ${SECS}\nact 0 1 0 1\n`;
    for (const [t, kind, i, a] of acts) inp += `act ${t} ${kind} ${i} ${a.join(' ')}\n`;
    const cli = spawnSync('core/build/natura-cli', { input: inp, maxBuffer: 1 << 28 });
    assert.equal(cli.status, 0, String(cli.stderr));
    const nat = new Float32Array(cli.stdout.buffer.slice(cli.stdout.byteOffset, cli.stdout.byteOffset + cli.stdout.length));
    const k = loadT2d();
    k.init(SR, 1);
    k.action(SLOT, ACT.STATE, 0, st);
    k.action(SLOT, ACT.PLAY, 0, [1]);
    let worst = 0, peak = 0, sendE = 0, a = 0;
    const played = [], notes = [];
    for (let b = 0; b < BLOCKS; b++) {
      const t = b * 128 / SR;
      while (a < acts.length && acts[a][0] <= t + 1e-9) { k.action(SLOT, acts[a][1], acts[a][2], acts[a][3]); a++; }
      k.process(128);
      const L = k.dry(SLOT, 0), R = k.dry(SLOT, 1);
      for (let i = 0; i < 128; i++) {
        const n = (b * 128 + i) * 4;
        worst = Math.max(worst, Math.abs(L[i] - nat[n]), Math.abs(R[i] - nat[n + 1]));
        peak = Math.max(peak, Math.abs(L[i]));
        sendE += nat[n + 2] * nat[n + 2];
      }
      const h = k.heard(SLOT);
      for (let i = 0; i + 1 < h.length; i += 2) (h[i] === 1 ? played : notes).push([t, h[i + 1]]);
    }
    assert.ok(peak > 0.02 && peak < 3, `звучит: пик ${peak}`);
    assert.ok(sendE > 0, 'посыл в зал есть (нативный)');
    assert.ok(worst < 1e-5, `худшее расхождение ${worst}`);
    assert.deepEqual(played.map((s) => s[1]).slice(0, 4), [0, 2, 4, 6], 'шаги идут по порядку');
    assert.deepEqual(notes.map((s) => s[1]).slice(0, 4), [0, 2, 4, 6], 'и каждая нота «ударила»');
    assert.ok(Math.abs(played[1][0] - played[0][0] - 0.3125) < 0.003, `шаг 0 → 2 — 0.3125 с: ${played[1][0] - played[0][0]}`);
    const mir = k.mirror(SLOT);
    assert.equal(mir.length, 4);
    assert.equal(mir[1], 1); assert.ok(mir[0] >= 0);
    k.action(SLOT, ACT.PLAY, 0, [0]);
    k.process(128);
    assert.deepEqual(k.mirror(SLOT).slice(0, 2), [-1, 0], 'стоп: бегунка нет');
    console.log(`  ${name}: max |wasm − native| ${worst.toExponential(2)}, пик ${peak.toFixed(3)}, шагов ${played.length}`);
  });
}

test('Natura: послушать (HEAR) звучит и «ударяет»; пустое место молчит; кораблик отпущен — гаснет', () => {
  const k = loadT2d();
  k.init(SR, 1);
  k.action(SLOT, ACT.STATE, 0, stateArgs(scene(0, { delay: 0, chorus: 0, rel: 0.1 })));
  const energy = (blocks) => { let e = 0; for (let b = 0; b < blocks; b++) { k.process(128); const L = k.dry(SLOT, 0); for (let i = 0; i < 128; i++) e += L[i] * L[i]; } return e; };
  k.action(SLOT, ACT.HEAR, 5, []);                       // пусто
  assert.equal(energy(100), 0);
  k.action(SLOT, ACT.HEAR, 2, []);
  assert.ok(energy(100) > 1e-4);
  assert.deepEqual(k.heard(SLOT), [2, 2], 'нота ударила, шаг не сыгран');
  k.action(SLOT, ACT.SKIFF, 0, [0.1, 0.5, 0]);
  assert.equal(k.mirror(SLOT)[3], 1);
  assert.ok(energy(100) > 1e-4, 'кораблик на воде звучит');
  k.action(SLOT, ACT.SKIFF_OFF, 0, []);
  assert.equal(k.mirror(SLOT)[3], 0);
  energy(900);                                           // ~2.4 с: кораблик гаснет (τ 0.25) и голос снимается через 2 с; хвоста эха нет (delay 0)
  assert.ok(energy(100) < 1e-5, 'и затихает');
});
