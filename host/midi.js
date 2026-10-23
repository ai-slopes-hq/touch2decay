// Внешние MIDI-часы: одна сетка долей на все миры-секвенсеры, пуск/стоп и темп (оболочка зовёт window.t2dMidi).
// Время — секунды часов звука (ctx.currentTime); миры спрашивают сетку через T.midiGrid() и ставят шаги по stepTime.
export const JUMP = 0.05;          // ошибка доли больше — принять сразу
export const TEMPO_EPS = 0.3;      // порог перестройки темпа миров, BPM
export const LOST = 1;             // секунд без долей — часы пропали
export const LATE_FIRST = 0.03;    // первый шаг после Start, опоздавший меньше — играет сразу

// подстройка сетки по доле n, пришедшей в момент at; не мутирует. p — среднее по последним 4 интервалам долей
export function nextBeat(grid, n, at, bpm) {
  if (!grid) return { t0: at - n * (60 / bpm), p: 60 / bpm, last: at, n, ints: [] };
  const ints = grid.ints.slice();
  if (n > grid.n) ints.push((at - grid.last) / (n - grid.n));
  if (ints.length > 4) ints.shift();
  const p = ints.length ? ints.reduce((a, b) => a + b, 0) / ints.length : grid.p;
  const e = at - (grid.t0 + n * grid.p);
  const target = Math.abs(e) > JUMP ? at : at - e / 2;                // где сетка стоит на этой доле
  return { t0: target - n * p, p, last: at, n, ints };                // t0 пересчитан под новый p: сетка на доле n не прыгает
}
export const stepTime = (grid, k, perBeat) => grid.t0 + (k / perBeat) * grid.p;
// когда играть шаг со временем t: в будущем — как есть; первый после Start, чуть опоздавший, — сейчас; иначе пропустить
export function due(t, now, first) {
  if (t > now + 0.003) return t;
  if (first && now - t < LATE_FIRST) return now + 0.005;
  return null;
}

let inst = null;
export const midiOn = () => !!(inst && inst.grid());

export function createMidi({ worlds, now }) {
  let grid = null, cue = false, halted = false;
  let stopped = new Set();                                            // миры, игравшие в момент прошлого Stop
  const subs = [];
  const seqs = () => worlds().filter((w) => w.tempo);
  const setTempo = (bpm) => {
    const b = Math.round(bpm * 10) / 10;
    for (const w of seqs()) { const cur = w.tempo.get ? w.tempo.get() : NaN; if (!(Math.abs(b - cur) <= TEMPO_EPS)) w.tempo.set(b); }
  };
  function message(m) {
    for (const f of subs) f(m);
    const t = now();
    if (t == null) return;
    const at = t - (m.ago || 0);
    if (m.t === 'start') { cue = true; halted = false; grid = null; }
    else if (m.t === 'stop') {
      stopped = new Set();
      for (const w of seqs()) if (w.tempo.playing()) { stopped.add(w); w.tempo.play(false); }
      grid = null; cue = false; halted = true;
    } else if (m.t === 'tempo') setTempo(m.bpm);
    else if (m.t === 'beat' && !halted) {
      grid = nextBeat(cue ? null : grid, m.n, at, m.bpm);
      setTempo(m.bpm);
      if (cue) {
        cue = false;
        for (const w of seqs()) {
          const playing = w.tempo.playing();
          if (!(w.tempo.armed?.() || playing || stopped.has(w))) continue;
          if (playing) w.tempo.play(false);
          w.tempo.play(true);
        }
        stopped = new Set();
      }
    }
  }
  function tick() { const t = now(); if (grid && t != null && t > grid.last + LOST) grid = null; }
  inst = { message, tick, grid: () => grid, listen: (f) => { subs.push(f); } };
  return inst;
}
