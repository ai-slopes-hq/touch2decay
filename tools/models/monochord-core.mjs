// Фасад модели Monochordum (worlds/monochord/model.js) над t2d.wasm в Node — см. sdk-facade.mjs. Плюс струны в зеркале ядра.
import { createModel as facade, SLOT, ACT, HEAD, MSTR } from '../../worlds/monochord/model.js';
import { sdkFacade } from './sdk-facade.mjs';

export { SLOT, ACT };
const ACTIONS = ['pluck', 'harm', 'bow', 'setSus', 'toggleSus', 'setBridge', 'setString', 'setWind', 'toggleWind', 'setFx', 'loadFx', 'setAuto', 'setBpm', 'setAutoPar', 'dice', 'clear', 'restore'];

export function createModel(opts = {}) {
  const m = sdkFacade(facade, SLOT, ACTIONS, opts);
  m.coreStr = () => { const x = m.mirror(); return [0, 1, 2, 3].map((i) => Object.fromEntries(MSTR.map((k, j) => [k, x[HEAD + i * MSTR.length + j]]))); };
  return m;
}
