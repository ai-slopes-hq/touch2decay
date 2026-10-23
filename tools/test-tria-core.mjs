// Tria в ядре против эталона (tools/tria-scenarios.mjs): модель — 1e-9 по телам каждый блок, вспышки — те же, снимок — тот же JSON.
//   core/build.sh && node --test tools/test-tria-core.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTS, SLOT, refRun, coreBoot, coreApply, coreBodies, coreFlashes } from './tria-scenarios.mjs';
import { hostScale } from './models/sdk-facade.mjs';

const EPS = 1e-9;
for (const name of Object.keys(ACTS)) {
  test(`Tria [${name}]: модель ядра = эталон (1e-9 каждый блок), вспышки, снимок`, () => {
    const sc = ACTS[name].scale || { on: false, idx: 0, root: 0 };
    const k = coreBoot(sc);
    let worst = 0, at = '', nfl = 0;
    const { model } = refRun(name, hostScale(sc), (m, b, acts, fresh) => {
      coreApply(k, acts);
      k.process(128);
      const mir = k.mirror(SLOT), cb = coreBodies(mir);
      m.state.bodies.forEach((r, i) => {
        for (const key of ['x', 'y', 'vx', 'vy', 'amp', 'hz']) {
          const d = Math.abs(r[key] - cb[i][key]) / (key === 'hz' ? r.hz : 1);
          if (!(d <= worst)) { worst = d; at = `block ${b} body ${i} ${key}: ref ${r[key]} core ${cb[i][key]}`; }
        }
        for (const [key, v] of [['pairK', m.state.pairK[i]], ['trem', m.state.trem[i]]]) { const d = Math.abs(v - cb[i][key]); if (!(d <= worst)) { worst = d; at = `block ${b} body ${i} ${key}: ref ${v} core ${cb[i][key]}`; } }
      });
      assert.deepEqual([mir[6], mir[7], mir[8]], [m.state.still ? 1 : 0, m.state.lux ? 1 : 0, m.state.cadit ? 1 : 0], `флаги, блок ${b}`);
      const cf = coreFlashes(k.heard(SLOT));
      assert.equal(cf.length, fresh.length, `вспышки в блоке ${b}`);
      cf.forEach((f, j) => { const r = fresh[j]; assert.equal(f.kind, r.kind); assert.equal(f.i, r.i); assert.ok(Math.abs(f.x - r.x) < EPS && Math.abs(f.y - r.y) < EPS && Math.abs(f.q - (r.q || 0)) < EPS, `вспышка ${b}`); });
      nfl += cf.length;
    });
    assert.ok(worst < EPS, `худшее расхождение ${worst} — ${at}`);
    assert.equal(k.snapshot(SLOT), model.snapshot(), 'снимок');
    console.log(`  ${name}: max |core − ref| ${worst.toExponential(2)}, вспышек ${nfl}`);
  });
}
