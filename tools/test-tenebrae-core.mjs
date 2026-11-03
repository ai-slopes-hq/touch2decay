// Tenebrae в t2d.wasm (слот 1) против нативного core/build/tenebrae-cli на сценах сверки (tools/ref/tenebrae-scenes.js): сухой выход L и R —
// до 1e-5 по сэмплам (одни и те же исходники C++; различие — только libm wasm и хоста), зеркало — модель 387 чисел, затем 6 контуров по 129 (live и 128 точек), live как в сцене,
// у живого голоса контур не пустой, у молчащего — нули.
//   core/build.sh && node --test tools/test-tenebrae-core.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { loadT2d } from './t2d-core.mjs';
import { ACT, SCENES, SR, cliInput } from './ref/tenebrae-scenes.js';

const SLOT = 1, VOICES = 6, MODEL_N = 387, SCOPE_V = 129, MIRROR_N = MODEL_N + VOICES * SCOPE_V;   // как MODEL_N, SCOPE_V, MIRROR_N в core/worlds/tenebrae/world.hpp

for (const [name, sc] of Object.entries(SCENES)) {
  test(`Tenebrae [${name}]: ядро в wasm = нативное (1e-5), зеркало`, () => {
    const cli = spawnSync('core/build/tenebrae-cli', { input: cliInput(sc), maxBuffer: 1 << 28 });
    assert.equal(cli.status, 0, String(cli.stderr));
    const nat = new Float32Array(cli.stdout.buffer.slice(cli.stdout.byteOffset, cli.stdout.byteOffset + cli.stdout.length));
    const k = loadT2d();
    k.init(SR, 1);
    const blocks = Math.floor(sc.secs * SR / 128), live = new Array(VOICES).fill(false);
    let worst = 0, peak = 0, a = 0;
    for (let b = 0; b < blocks; b++) {
      const t = b * 128 / SR;
      while (a < sc.acts.length && sc.acts[a][0] <= t + 1e-9) {
        const [, kind, i, args] = sc.acts[a++];
        if (kind === ACT.LIVE) live[i] = args[0] !== 0;
        k.action(SLOT, kind, i, args);
      }
      k.process(128);
      const L = k.dry(SLOT, 0), R = k.dry(SLOT, 1);
      for (let j = 0; j < 128; j++) {
        const n = (b * 128 + j) * 4;
        worst = Math.max(worst, Math.abs(L[j] - nat[n]), Math.abs(R[j] - nat[n + 1]));
        peak = Math.max(peak, Math.abs(L[j]));
      }
    }
    assert.equal(nat.length, blocks * 128 * 4, 'CLI: столько же сэмплов');
    assert.ok(peak > 0.02 && peak < 3, `звучит: пик ${peak}`);
    assert.ok(worst < 1e-5, `худшее расхождение ${worst}`);
    const mir = k.mirror(SLOT);
    assert.equal(mir.length, MIRROR_N);
    assert.equal(mir[0], VOICES);
    for (let i = 0; i < VOICES; i++) {
      const v = mir.slice(MODEL_N + i * SCOPE_V, MODEL_N + (i + 1) * SCOPE_V), pts = v.slice(1);
      assert.equal(v[0], live[i] ? 1 : 0, `голос ${i}: live`);
      assert.equal(pts.length, 128);
      if (live[i]) assert.ok(pts.some((p) => p !== 0), `голос ${i}: контур есть`);
      else assert.ok(pts.every((p) => p === 0), `голос ${i}: молчит — нули`);
    }
    console.log(`  ${name}: max |wasm − native| ${worst.toExponential(2)}, пик ${peak.toFixed(3)}`);
  });
}

// ---------- модель в ядре (действия от 16) против эталона: JS-модель → клей кодов 0–8 → то же ядро ----------
// Сухой L/R — 1e-6 на сэмпл; события (burst, strike) — по блокам, в том же порядке. Модель в ядре шлёт голосам те же команды, что клей.
import { ACTS, refPath, corePath } from './tenebrae-scenarios.mjs';

const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
const same = (a, b, what) => {
  assert.equal(a.length, b.length, `${what}: length`);
  for (let k = 0; k < a.length; k++) if (!(Math.abs(a[k] - b[k]) <= 1e-6)) assert.fail(`${what}: sample ${k}: ${a[k]} vs ${b[k]}`);
};
const SANITY = {
  sun: (r) => r.heard.some((h) => h.events.some((e) => e.t === 'strike')),
  chaos: (r) => r.autos > 0,
  dice: (r) => r.heard.some((h) => h.events.some((e) => e.t === 'burst')),
};
for (const name of Object.keys(ACTS)) {
  test(`sdk: dry output matches the reference: ${name}`, () => {
    const r = refPath(ACTS[name]), c = corePath(ACTS[name]);
    assert.ok(rms(r.L) + rms(r.R) > 1e-3, `${name}: reference is silent`);
    if (SANITY[name]) assert.ok(SANITY[name](r), `${name}: scenario does not exercise what it should`);
    same(c.L, r.L, `${name} L`); same(c.R, r.R, `${name} R`);
    assert.deepEqual(c.heard, r.heard, `${name}: heard`);
  });
}
