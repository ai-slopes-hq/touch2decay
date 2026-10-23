// Фасад модели Tria (worlds/tria/model.js) над t2d.wasm в Node — см. sdk-facade.mjs; вспышки — из услышанного ядра.
import { createModel as facade, SLOT } from '../../worlds/tria/model.js';
import { sdkFacade } from './sdk-facade.mjs';

const ACTIONS = ['fiatLux', 'plumb', 'anchor', 'grab', 'drop', 'drag', 'release', 'setBody', 'setFx', 'loadFx', 'dice', 'clear', 'restore'];
export const createModel = (opts = {}) => sdkFacade(facade, SLOT, ACTIONS, { heard: true, ...opts });
