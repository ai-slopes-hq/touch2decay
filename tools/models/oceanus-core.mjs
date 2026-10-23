// Фасад модели Oceanus (worlds/oceanus/model.js) над t2d.wasm в Node — см. sdk-facade.mjs. Плюс помощники сверки с ядром.
import { createModel as facade, SLOT, ACT, HEAD, MVOICE } from '../../worlds/oceanus/model.js';
import { sdkFacade } from './sdk-facade.mjs';

export { SLOT, ACT };
const ACTIONS = ['addVoice', 'dropVoice', 'moveVoice', 'setVoice', 'setFx', 'loadFx', 'setLuna', 'push', 'release', 'splash', 'clear', 'dice', 'restore'];

export function createModel(opts = {}) {
  const m = sdkFacade(facade, SLOT, ACTIONS, { wake: ACT.wake, ...opts });
  const voicesOf = () => { const x = m.mirror(), N = MVOICE.length; return Array.from({ length: x[HEAD - 1] }, (_, i) => Object.fromEntries(MVOICE.map((k, j) => [k, x[HEAD + i * N + j]]))); };
  m.coreVoices = voicesOf;                              // города в зеркале ядра (сейчас, без фасада)
  m.coreIds = () => voicesOf().map((v) => v.id);
  m.coreVoice = (id) => voicesOf().find((v) => v.id === id) || null;
  return m;
}
