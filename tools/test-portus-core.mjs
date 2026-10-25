// Portus в t2d.wasm (слот 13) против нативного core/build/portus-cli: одна сцена (снимок модели), сухой выход L / R — до 1e-5 по сэмплам
// (одни и те же исходники C++; различие — только libm wasm и хоста), «услышано» — шаги в своё время, зеркало, пуск и стоп.
// Плюс сцена, собранная действиями фасада, — это снимок ядра (модель в ядре = модель фасада).
//   core/build.sh && node --test tools/test-portus-core.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { loadT2d } from './t2d-core.mjs';
import * as ref from './ref/portus-model.js';
import { SLOT, ACT, MIRROR_N } from '../worlds/portus/model.js';
import { createModel as coreModel } from './models/portus-core.mjs';
import { seeded } from './models/util.mjs';

const SR = 48000, SECS = 4, BLOCKS = Math.floor(SECS * SR / 128);
const PAT = [[0, 0], [2, 7], [4, 3], [6, 10], [8, 0], [10, 7], [12, 5], [14, 12]];
const CASES = {
  default: () => {},
  echo: (m) => { m.setEcho('time', 2); m.setEcho('tone', 0.7); m.setEcho('mix', 0.9); m.setBuoy(0.5, 0.8); m.setFx('wow', 0.6); m.setPharos('oct', -1); },
  sea: (m) => { m.setFx('mare', 0.5); m.setFx('drive', 0.7); m.setFog('size', 0.2); m.setPharos('chord', 0); m.setPharos('swing', 0.4); },
};

for (const [name, setup] of Object.entries(CASES)) {
  test(`Portus [${name}]: ядро в wasm = нативное (1e-5), удары по шагам, зеркало`, () => {
    const model = ref.createModel({ rng: seeded(7) });
    for (const [j, p] of PAT) model.place(j, p);
    setup(model);
    const js = model.snapshot();
    const cli = spawnSync('core/build/portus-cli', { input: `snapshot ${js}\nsecs ${SECS}\n`, maxBuffer: 1 << 28 });
    assert.equal(cli.status, 0, String(cli.stderr));
    const nat = new Float32Array(cli.stdout.buffer.slice(cli.stdout.byteOffset, cli.stdout.byteOffset + cli.stdout.length));
    const k = loadT2d();
    k.init(SR, 1);
    k.restore(SLOT, js);
    k.action(SLOT, ACT.PLAY, 0, [1]);
    let worst = 0, peak = 0, sendE = 0;
    const steps = [];
    for (let b = 0; b < BLOCKS; b++) {
      k.process(128);
      const L = k.dry(SLOT, 0), R = k.dry(SLOT, 1);
      for (let i = 0; i < 128; i++) {
        const n = (b * 128 + i) * 4;
        worst = Math.max(worst, Math.abs(L[i] - nat[n]), Math.abs(R[i] - nat[n + 1]));
        peak = Math.max(peak, Math.abs(L[i]));
        sendE += nat[n + 2] * nat[n + 2];
      }
      const h = k.heard(SLOT);
      for (let i = 0; i + 1 < h.length; i += 2) if (h[i] > 0) steps.push([b * 128 / SR, h[i + 1]]);
    }
    assert.ok(peak > 0.02 && peak < 3, `звучит: пик ${peak}`);
    assert.ok(sendE > 0, 'посыл в зал есть (нативный)');
    assert.ok(worst < 1e-5, `худшее расхождение ${worst}`);
    assert.deepEqual(steps.map((s) => s[1]).slice(0, 4), [0, 2, 4, 6], 'шаги идут по порядку');
    assert.ok(Math.abs(steps[1][0] - steps[0][0] - 0.25) < 0.003, `шаг 0 → 2 — 0.25 с: ${steps[1][0] - steps[0][0]}`);
    const mir = k.mirror(SLOT);
    assert.equal(mir.length, MIRROR_N);
    assert.equal(mir[1], 1); assert.ok(mir[0] >= 0 && mir[0] < 16);
    k.action(SLOT, ACT.PLAY, 0, [0]);
    k.process(128);
    assert.deepEqual(k.mirror(SLOT).slice(0, 2), [-1, 0], 'стоп: шага нет');
    console.log(`  ${name}: max |wasm − native| ${worst.toExponential(2)}, пик ${peak.toFixed(3)}, ударов ${steps.length}`);
  });
}

test('Portus: сцена, собранная действиями фасада, — это снимок ядра; аудиция слышна, пустое место молчит', () => {
  const m = coreModel({ seed: 4, rng: seeded(4) });
  for (const [j, p] of PAT) m.place(j, p);
  m.setIsle(m.isleOn(2), 'oct', 1); m.setIsle(m.isleOn(6), 'lvl', 0.4); m.setNote(m.isleOn(0), 9); m.moveIsle(m.isleOn(14), 15); m.sink(m.isleOn(10));
  m.setBuoy(0.1, 0.6); m.setEcho('mix', 0.3); m.setLuna('cut', 0.8); m.setFog('amt', 0.7); m.setPharos('chord', 3); m.setBpm(99); m.setFx('chance', 0.8);
  const norm = (js) => { const o = JSON.parse(js); o.isles.sort((a, b) => a.step - b.step); return o; };
  const core = norm(m.core.snapshot(SLOT)), web = norm(m.snapshot());
  assert.deepEqual(Object.keys(core), Object.keys(web));
  for (const key of Object.keys(web)) if (key !== 'buoy') assert.deepEqual(core[key], web[key], key);
  for (const k2 of ['u', 'd']) assert.ok(Math.abs(core.buoy[k2] - web.buoy[k2]) < 1e-12);
  m.core.action(SLOT, ACT.AUDITION, 99);                // нет такого места
  m.core.action(SLOT, ACT.AUDITION, 5);                 // пусто — тишина
  let e = 0; for (let b = 0; b < 100; b++) { m.core.process(128); const L = m.core.dry(SLOT, 0); for (let i = 0; i < 128; i++) e += L[i] * L[i]; }
  assert.equal(e, 0, 'аудиция пустого места молчит');
  m.core.action(SLOT, ACT.AUDITION, 2);
  e = 0; for (let b = 0; b < 100; b++) { m.core.process(128); const L = m.core.dry(SLOT, 0); for (let i = 0; i < 128; i++) e += L[i] * L[i]; }
  assert.ok(e > 1e-4, `аудиция звучит: ${e}`);
  assert.ok(m.core.heard(SLOT).length >= 2, 'и «услышана»');
});
