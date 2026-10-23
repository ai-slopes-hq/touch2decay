// Фасад модели Horologium (worlds/horologium/model.js) над t2d.wasm в Node — см. sdk-facade.mjs.
import { createModel as facade, SLOT, ACT } from '../../worlds/horologium/model.js';
import { sdkFacade } from './sdk-facade.mjs';

export { SLOT, ACT };
const ACTIONS = ['toggleRing', 'toggleUnder', 'setPhase', 'setRing', 'setFx', 'loadFx', 'setRun', 'stop', 'setBpm', 'grab', 'swing', 'tapPendulum', 'release',
  'holdStrip', 'dragStrip', 'freeStrip', 'resetSpeed', 'dice', 'clear', 'restore'];

export const createModel = (opts = {}) => sdkFacade(facade, SLOT, ACTIONS, opts);
