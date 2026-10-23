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
  if (n > grid.n) { const iv = (at - grid.last) / (n - grid.n); if (iv >= 0.5 * grid.p && iv <= 2 * grid.p) ints.push(iv); }   // правдоподобный интервал; остальное (пауза, новый контекст) среднее не портит
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

export function createMidi({ worlds, now, current = () => null }) {
  let grid = null, cue = false, halted = false;
  let stopped = new Set();                                            // миры, игравшие в момент прошлого Stop
  const joined = new Set(), was = new Map();                          // joined — миры, которые запускали руками в этой сессии (автор: «натура, куда не заходил, не должна играть»)
  const subs = [];
  const seqs = () => worlds().filter((w) => w.tempo && w.tempo.play);
  const each = (f) => { try { f(); } catch (e) { console.error('midi', e); } };   // один сбойный мир не мешает остальным
  const play = (w, on) => { w.tempo.play(on); was.set(w, on); };     // пуск службой — не «руками»
  function scan() {                                                   // мир пошёл не от службы — его запустили руками
    for (const w of seqs()) each(() => { const on = !!w.tempo.playing?.(); if (on && !was.get(w)) joined.add(w); was.set(w, on); });
  }
  const setTempo = (bpm) => {
    const b = Math.round(bpm * 10) / 10;
    for (const w of worlds()) if (w.tempo) each(() => { const cur = w.tempo.get ? w.tempo.get() : NaN; if (!(Math.abs(b - cur) <= TEMPO_EPS)) w.tempo.set(b); });
  };
  function message(m) {
    for (const f of subs) f(m);
    const t = now();
    if (t == null) return;
    const at = t - (m.ago || 0);
    if (grid && t < grid.last - 0.05) { grid = null; }                // время пошло назад — новый AudioContext (restartAudio): сетка старых часов не годится, следующая доля встанет заново
    if (m.t === 'start') { cue = true; halted = false; grid = null; }
    else if (m.t === 'stop') {
      scan();
      const on = new Set();                                           // Elektron шлёт Stop 2–3 раза: пустой повтор прежний набор не затирает
      for (const w of seqs()) each(() => { if (w.tempo.playing?.()) { on.add(w); play(w, false); } });
      if (on.size) stopped = on;
      grid = null; cue = false; halted = true;
    } else if (m.t === 'tempo') setTempo(m.bpm);
    else if (m.t === 'beat' && !halted) {
      grid = nextBeat(cue ? null : grid, m.n, at, m.bpm);
      setTempo(m.bpm);
      if (cue) {
        cue = false;
        scan();
        const here = current();
        for (const w of seqs()) each(() => {                          // свои (запускали руками), играющие, остановленные Stop и мир на экране, если в нём есть узор
          const playing = !!w.tempo.playing?.();
          if (!(joined.has(w) || playing || stopped.has(w) || (w === here && w.tempo.armed?.()))) return;
          if (playing) play(w, false);
          play(w, true);
        });
        stopped = new Set();
      }
    }
  }
  function tick() { scan(); const t = now(); if (grid && t != null && t < grid.last - 0.05) grid = null; if (grid && t != null && t > grid.last + LOST) grid = null; }
  inst = { message, tick, grid: () => grid, listen: (f) => { subs.push(f); } };
  return inst;
}
