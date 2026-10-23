// Фасад модели Goetia (worlds/goetia/model.js) над t2d.wasm в Node — см. sdk-facade.mjs. Плюс помощники сверки с ядром.
import { createModel as facade, SLOT, ACT, HEAD, MSPIRIT } from '../../worlds/goetia/model.js';
import { sdkFacade } from './sdk-facade.mjs';

export { SLOT, ACT };
const ACTIONS = ['summon', 'banish', 'setSpirit', 'setFx', 'loadFx', 'clear', 'dice', 'restore'];

export function createModel(opts = {}) {
  const m = sdkFacade(facade, SLOT, ACTIONS, opts);
  const spiritsOf = () => {
    const x = m.mirror(), N = MSPIRIT.length;
    return Array.from({ length: x[HEAD - 1] }, (_, i) => {
      const o = Object.fromEntries(MSPIRIT.map((k, j) => [k, x[HEAD + i * N + j]]));
      return { ...o, path: Array.from({ length: o.np }, (_, q) => o[`p${q}`]) };
    });
  };
  m.coreSpirits = spiritsOf;                            // духи в зеркале ядра (сейчас, без фасада)
  m.coreBorns = () => spiritsOf().map((s) => s.born);
  m.coreSpirit = (born) => spiritsOf().find((s) => s.born === born) || null;
  return m;
}
