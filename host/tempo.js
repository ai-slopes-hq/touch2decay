// один темп на всё: ручка темпа любого мира → мастер ядра и tempo.set у остальных миров с часами (без флагов — общий всегда)
import { setMasterBpm } from './audio.js';
import { worlds } from './registry.js';
export function tempoFrom(n, bpm) {
  setMasterBpm(bpm);
  for (const [k, w] of Object.entries(worlds)) if (+k !== n && w.tempo) w.tempo.set(bpm);
}
