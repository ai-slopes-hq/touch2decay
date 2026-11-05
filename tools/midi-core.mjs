// Служба MIDI-часов хоста (host/midi.js) над ядром t2d.wasm в Node — для тестов: сообщения и байты уходят в ядро синхронно (время ядра —
// now() на момент вызова), события часов ядра сразу возвращаются в midi.events, сетка — из зеркала хоста. tick() — блок ядра в now():
// так ядро замечает, что часы пропали (1 с без долей) или время пошло назад (новый контекст).
import { createMidi } from '../host/midi.js';
import { loadT2d } from './t2d-core.mjs';

export function coreMidi({ worlds, now, current = () => null }) {
  const c = loadT2d(); c.init(48000, 1);
  const x = c.exports, mb = (n) => Array.from(new Float64Array(x.memory.buffer, x.t2d_mbuf(), n));
  let m = null;
  const drain = () => { const n = x.t2d_hevents(); if (n && m) m.events(mb(n)); };
  // Сетка мира в ядре идёт всегда (мастер); «внешняя» сетка для оболочки — та, что даёт MIDI: пока часы идут (не стоп, не секунда тишины)
  // и сетка не дефолтная мастера. ABI про «внешнюю» ничего не знает — это политика теста.
  let stopped = false, lastAt = -Infinity;
  const core = {
    send(d) {
      x.t2d_time(now());
      const stop = d.t === 'midi' ? d.b === 0xFC : d.kind === 4, start = d.t === 'midi' ? d.b === 0xFA : d.kind === 3;
      if (stop) stopped = true; else if (start) stopped = false;
      if (!stop && !start) lastAt = d.at;
      if (d.t === 'midi') x.t2d_midi_byte(d.src, d.b, d.at); else x.t2d_midi_msg(d.kind, d.n, d.bpm, d.at);
      drain();
    },
    grid() {
      x.t2d_time(now()); const n = x.t2d_hmirror(), h = mb(n);
      const fresh = !stopped && now() >= lastAt - 1e-9 && now() - lastAt <= 1 && !(h[1] === 0 && h[2] === 0.6);
      return h[0] && h[2] > 0 && fresh ? { t0: h[1], p: h[2] } : null;
    },
  };
  m = createMidi({ worlds, now, current, core });
  const tick = m.tick;
  m.tick = () => { x.t2d_time(now()); c.process(128); drain(); tick(); };
  m.core = c;
  return m;
}
