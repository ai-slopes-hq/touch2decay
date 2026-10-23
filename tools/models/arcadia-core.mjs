// Фасад модели Arcadia (worlds/arcadia/model.js) над t2d.wasm в Node — см. sdk-facade.mjs. Плюс странники и петли в зеркале ядра.
import { createModel as facade, SLOT, ACT, HEAD, SLOT_M, T_KEYS } from '../../worlds/arcadia/model.js';
import { sdkFacade } from './sdk-facade.mjs';

export { SLOT, ACT };
const ACTIONS = ['addT', 'dropT', 'moveT', 'setT', 'setFx', 'loadFx', 'newLand', 'clear', 'dice', 'restore'];

export function createModel(opts = {}) {
  const m = sdkFacade(facade, SLOT, ACTIONS, opts);
  m.coreT = () => { const x = m.mirror(); return [0, 1, 2, 3].map((s) => { const o = HEAD + s * SLOT_M; return x[o] ? { slot: s, ...Object.fromEntries(T_KEYS.map((k, j) => [k, x[o + 1 + j]])), f: x[o + 9] } : null; }).filter(Boolean); };
  m.landPending = () => m.mirror()[HEAD - 1] === 1;
  return m;
}
