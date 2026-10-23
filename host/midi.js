// Внешние MIDI-часы. Разбор байтов (24 тика на долю) и сетка долей живут в ядре (core/sdk/transport.hpp, хост t2d.wasm) — одна сетка
// на все миры: и миры ядра (автострам Monochordum ставит шаги сам, с точностью до сэмпла), и миры на JS (Portus, Natura, Cymatica,
// Horologium — спрашивают сетку через T.midiGrid() и ставят шаги по stepTime). Здесь — вход и политика:
//   вход   — байты с Web MIDI (host/webmidi.js → byte) и разобранные сообщения оболочки iOS (window.t2dMidi → message: beat / tempo /
//            start / stop с ago) уходят в ядро с отметкой времени в секундах контекста;
//   выход  — события ядра (onClock: пуск, стоп, темп, доля, launch — первая доля после пуска): кому темп, кого остановить, кого запустить.
// Прежний JS-разбор и сетка (clockParser, nextBeat) — эталон для сверки ядра: tools/ref/midi.js.
export const TEMPO_EPS = 0.3;      // порог перестройки темпа миров, BPM
export const LATE_FIRST = 0.03;    // первый шаг после Start, опоздавший меньше — играет сразу
export const EV = ['', 'start', 'stop', 'tempo', 'beat', 'launch'];   // коды событий ядра (sdk::Follower::Ev)
const KIND = { beat: 1, tempo: 2, start: 3, stop: 4 };                   // sdk::MidiMsg::Type

export const stepTime = (grid, k, perBeat) => grid.t0 + (k / perBeat) * grid.p;
// когда играть шаг со временем t: в будущем — как есть; первый после Start, чуть опоздавший, — сейчас; иначе пропустить
export function due(t, now, first) {
  if (t > now + 0.003) return t;
  if (first && now - t < LATE_FIRST) return now + 0.005;
  return null;
}

let inst = null;
export const midiOn = () => !!(inst && inst.grid());

// worlds — миры с tempo; now — время контекста (секунды) или null; current — мир на экране; core — { send(m), grid() } ядра хоста;
// perf — часы событий MIDI (секунды performance.now; нет — время события считается от now)
export function createMidi({ worlds, now, current = () => null, core, perf = null }) {
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
    if (!(bpm > 0)) return;                                           // темп ещё не известен (меньше доли тиков)
    const b = Math.round(bpm * 10) / 10;
    for (const w of worlds()) if (w.tempo) each(() => { const cur = w.tempo.get ? w.tempo.get() : NaN; if (!(Math.abs(b - cur) <= TEMPO_EPS)) w.tempo.set(b); });
  };
  // время события в секундах контекста. currentTime на главном потоке обновляется рывками и иногда запаздывает; раньше темп считался
  // по отметкам performance.now, теперь тики считает ядро — в секундах контекста. Поэтому сдвиг «контекст − performance» берём самый
  // свежий (наибольший) за последние 5 с: запоздавший currentTime его только уменьшает. Новый контекст (сдвиг упал больше чем на 0.25 с) — заново.
  let off = null, offAt = 0;
  function ctxAt(ago) {
    const t = now();
    if (t == null) return null;
    if (!perf) return t - ago;
    const p = perf(), o = t - p;
    if (off === null || o > off || o < off - 0.25 || p - offAt > 5) { off = o; offAt = p; }
    return p + off - ago;
  }
  function toCore(m) {                                                // в ядро — со временем события в секундах контекста
    const at = ctxAt(m.ago || 0);
    if (at == null) return false;
    core.send(m.b != null ? { t: 'midi', src: m.src | 0, b: m.b, at } : { t: 'midimsg', kind: KIND[m.t] || 0, n: m.n || 0, bpm: m.bpm || 0, at });
    return true;
  }
  function message(m) { for (const f of subs) f(m); toCore(m); }     // оболочка iOS: уже разобранное (beat / tempo / start / stop)
  function byte(src, b, ago) { toCore({ src, b, ago }); }             // Web MIDI: байт реального времени, ago — сколько секунд назад
  function events(ev) {                                               // события ядра: по 2 числа — код, bpm
    for (let i = 0; i < ev.length; i += 2) {
      const t = EV[ev[i]], bpm = ev[i + 1];
      if (t !== 'launch') for (const f of subs) f({ t, bpm, from: 'core' });
      if (t === 'stop') {
        scan();
        const on = new Set();                                         // Elektron шлёт Stop 2–3 раза: пустой повтор прежний набор не затирает
        for (const w of seqs()) each(() => { if (w.tempo.playing?.()) { on.add(w); play(w, false); } });
        if (on.size) stopped = on;
      } else if (t === 'tempo' || t === 'beat') setTempo(bpm);
      else if (t === 'launch') {
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
  const tick = () => { scan(); };                                     // часы пропали, время назад — следит ядро
  inst = { message, byte, events, tick, grid: () => core.grid(), listen: (f) => { subs.push(f); } };
  return inst;
}
