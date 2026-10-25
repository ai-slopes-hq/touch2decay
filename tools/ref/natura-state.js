// Состояние эталонной модели Natura → числа для действия STATE ядра (сцена целиком — natura-cli, test-natura-core, natura-bus):
// [bpm, len, fx×9, 16 × (занято, note, wave, glide, chance, cutoff, res, att, rel)]; −1 — общее значение / не задан.
import { ACT } from '../../worlds/natura/model.js';
export { ACT };
const FX = ['reverb', 'delay', 'time', 'chorus', 'cutoff', 'res', 'att', 'rel', 'chance'];
const LOCKS = ['cutoff', 'res', 'att', 'rel'];
export function stateArgs(S) {
  const a = [S.seq.bpm, S.pads.len, ...FX.map((k) => S.fx[k])];
  for (let i = 0; i < 16; i++) {
    const pd = S.pads.at[i];
    if (!pd) { a.push(0, 0, 0, 0, -1, -1, -1, -1, -1); continue; }
    a.push(1, pd.note, pd.wave, pd.glide ? 1 : 0, pd.chance ?? -1, ...LOCKS.map((k) => (pd.lock && pd.lock[k] != null ? pd.lock[k] : -1)));
  }
  return a;
}
