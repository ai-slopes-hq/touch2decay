import { worlds, nav, onRegister } from './registry.js';
import { scl } from './scale.js';
// ---------- отмена: 10 шагов. Шаг — законченный жест, после которого изменилось сохраняемое:
// закреплённые кружки (место, тембр, LFO, связи между ними), FX и лад. Временные кружки не в счёт ----------
export const UNDO_MAX = 10;
export const hists = {}, lasts = {};               // мир → история и последнее сохранённое
// состояние мира и общий лад; в истории — мир до шага и лад до и после: лад откатывается в том мире, где его меняли
export const entry = (n) => JSON.stringify({ w: worlds[n].snapshot(), scl: { on: scl.on, idx: scl.idx, root: scl.root } });
onRegister.push((n) => { hists[n] = []; lasts[n] = entry(n); });
// после каждого жеста (когда отпущены все пальцы — один жест, один шаг): если сохраняемое изменилось — прежнее состояние в историю
export function commit() {
  for (const k of Object.keys(worlds)) {      // шаг — только у мира на экране; изменения других миров «из-за кадра» — без шага
    const n = +k, now = entry(n), h = hists[n];
    if (n === nav.world && now !== lasts[n]) {
      const was = JSON.parse(lasts[n]);
      h.push({ w: was.w, scl: was.scl, after: JSON.parse(now).scl });   // лад до и после шага
      if (h.length > UNDO_MAX) h.shift();
    }
    lasts[n] = now;
  }
}
// retune — лад вернулся: мир I перестраивает высоты планет
export function undo(retune) {
  const n = nav.world, h = hists[n];
  if (!h.length) return;
  const st = h.pop(), same = (a, b) => a.on === b.on && a.idx === b.idx && a.root === b.root;
  worlds[n].restore(st.w);
  if (!same(st.scl, st.after) && same(scl, st.after)) {   // лад менялся в этом шаге и с тех пор не трогали — вернуть
    Object.assign(scl, st.scl); scl.slideUntil = performance.now() + 500; retune();
  }
  for (const k of Object.keys(worlds)) lasts[k] = entry(+k);
  undoAt = performance.now();
}
export let undoAt = -1e9;
