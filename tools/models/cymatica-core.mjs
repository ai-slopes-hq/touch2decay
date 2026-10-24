// Фасад модели Cymatica (worlds/cymatica/model.js) над t2d.wasm в Node — см. sdk-facade.mjs. Плюс то, что ядро услышало: шаги часов и отзывы
// резонатора (после каждого куска process), и модель из зеркала ядра — для сверки со state фасада.
import { createModel as facade, } from '../../worlds/cymatica/model.js';
import { SLOT, ACT, parseHeard, parseAnswers, parseModel } from '../../worlds/cymatica/bridge.js';
import { sdkFacade } from './sdk-facade.mjs';

export { SLOT, ACT };
const ACTIONS = ['play', 'rec', 'stepRecToggle', 'setCursor', 'cycleGrid', 'setF0', 'stepScale', 'strikeAt', 'skipStep', 'setBpm', 'setLen', 'setChance', 'toggleBeat',
  'nudgeNote', 'moveMark', 'dropMark', 'comb', 'turn', 'toggleDrift', 'setDrift', 'setFx', 'loadFx', 'dice', 'clear', 'restore', 'load'];

export function createModel(opts = {}) {
  const steps = [], answers = [];
  const m = sdkFacade(facade, SLOT, ACTIONS, { ...opts, chunk: (core) => { const h = core.heard(SLOT); if (h.length) { steps.push(...parseHeard([h])); answers.push(...parseAnswers([h])); } } });
  m.rebind(opts.seed ?? 1);                      // как engine.build: сцена фасада — в узел ядра целиком (иначе у пластины умолчания 0.66 вместо 2/7)
  m.steps = steps; m.answers = answers;
  m.coreModel = () => parseModel(m.mirror());    // модель из зеркала ядра
  m.coreSnapshot = () => m.core.snapshot(SLOT);  // снимок модели ядра (JSON)
  return m;
}
