// Фасад модели Portus (worlds/portus/model.js) над t2d.wasm в Node — см. sdk-facade.mjs. После каждого действия сверяет сцену ядра (зеркало)
// со state фасада: параметры, кораблики по местам (занято, p, oct, lvl, sd).
import assert from 'node:assert/strict';
import { createModel as facade, SLOT, ACT, NSTEP, MIRROR_HEAD, MIRROR_ISLE, MIRROR_N, LUNA_KEYS, ECHO_KEYS, FOG_KEYS, PHAROS_KEYS, FX_KEYS } from '../../worlds/portus/model.js';
import { sdkFacade } from './sdk-facade.mjs';

export { SLOT, ACT };
export const ACTIONS = ['place', 'sink', 'moveIsle', 'setNote', 'setIsle', 'setLuna', 'setBuoy', 'setEcho', 'setFog', 'setPharos', 'setBpm', 'setFx', 'loadFx', 'killEcho', 'play', 'dice', 'clear', 'restore'];

export function sceneOf(x) {                           // зеркало ядра → сцена, как в model.js
  let o = 3;
  const bpm = x[o++], grp = (keys) => Object.fromEntries(keys.map((k) => [k, x[o++]]));
  const luna = grp(LUNA_KEYS), echo = grp(ECHO_KEYS.slice(0, 3)), buoy = grp(['u', 'd']), fog = grp(FOG_KEYS), pharos = grp(PHAROS_KEYS), fx = grp(FX_KEYS);
  const isles = [];
  for (let j = 0; j < NSTEP; j++) {
    const p = MIRROR_HEAD + j * MIRROR_ISLE;
    if (x[p]) isles.push({ step: j, p: x[p + 1], oct: x[p + 2], lvl: x[p + 3], sd: x[p + 4] });
  }
  return { bpm, luna, echo, buoy, fog, pharos, fx, isles, step: x[0], playing: x[1] !== 0, voices: x[2] };
}

export function createModel(opts = {}) {
  const { check = true, ...rest } = opts;
  const m = sdkFacade(facade, SLOT, ACTIONS, rest);
  m.coreScene = () => sceneOf(m.mirror());
  m.agree = (what = '') => {                           // state фасада = сцена ядра
    const x = m.mirror();
    assert.equal(x.length, MIRROR_N, 'зеркало ядра');
    const c = sceneOf(x), S = m.state;
    assert.equal(c.bpm, S.seq.bpm, `${what}: bpm`);
    for (const g of ['luna', 'echo', 'buoy', 'fog', 'pharos', 'fx']) for (const [k, v] of Object.entries(c[g])) assert.ok(Math.abs(v - S[g][k]) < 1e-12, `${what}: ${g}.${k} core ${v} vs ${S[g][k]}`);
    const mine = [...S.isles].sort((a, b) => a.step - b.step);
    assert.equal(c.isles.length, mine.length, `${what}: isles ${JSON.stringify(c.isles)} vs ${JSON.stringify(mine)}`);
    c.isles.forEach((q, i) => { for (const k of ['step', 'p', 'oct', 'lvl', 'sd']) assert.ok(Math.abs(q[k] - mine[i][k]) < 1e-12, `${what}: isle ${q.step}.${k} core ${q[k]} vs ${mine[i][k]}`); });
  };
  if (check) for (const k of ACTIONS) { const f = m[k]; m[k] = (...a) => { const r = f(...a); m.agree(k); return r; }; }
  return m;
}
