// один темп на всё: ручка темпа любого мира → мастер ядра и tempo.set у остальных миров с часами (без флагов — общий всегда)
import { masterBpm, setMasterBpm } from './audio.js';
import { midiOn } from './midi.js';
import { onRegister, worlds } from './registry.js';
const MASTER_DEF = 100;                                  // мастер ядра стартует со 100 bpm (Host::masterBpm)
// темп в диапазоне самого мира (tempo.min/max; по умолчанию 40…200 — как у мастера)
const fit = (w, bpm) => Math.min(w.tempo.max ?? 200, Math.max(w.tempo.min ?? 40, bpm));
// ручка темпа: мастеру — как есть, остальным мирам — в их диапазоне; внешний MIDI ведёт темп сам (мастер ручной игнорирует) — молчим
export function tempoFrom(n, bpm) {
  if (midiOn()) return;
  setMasterBpm(bpm);
  for (const [k, w] of Object.entries(worlds)) if (+k !== n && w.tempo) w.tempo.set(fit(w, bpm));
}
// модели ← мастер (только отображение; мастер не трогаем): после нового узла ядра, restore снимка и кубика мира
export function syncModelsToMaster() {
  if (midiOn()) return;
  const bpm = masterBpm() || MASTER_DEF;
  for (const w of Object.values(worlds)) if (w.tempo) { const b = fit(w, bpm); if (w.tempo.get?.() !== b) w.tempo.set(b); }
}
// restore снимка и кубик мира меняют bpm модели — после них модели снова показывают мастер
onRegister.push((n, w) => {
  for (const f of ['restore', 'dice']) if (typeof w[f] === 'function') { const orig = w[f]; w[f] = function (...a) { const r = orig.apply(this, a); syncModelsToMaster(); return r; }; }
});
