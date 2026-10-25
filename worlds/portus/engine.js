// Portus — звук и часы живут в ядре SDK (core/worlds/portus → t2d.wasm, узел хоста T.core, слот 13): стабы, шина, эхо, туман и море, шаги
// по часам хоста (свой темп или сетка MIDI-часов — с точностью до сэмпла). Здесь — тонкая склейка: модель (пока в вебе, этап 1) шлёт ядру
// состояние целиком — раз, когда оно изменилось (событие модели или опрос раз в кадр: луна, маяк и лад событий не шлют); сухой выход
// мира — в канал микшера, посыл в зал и фейдер — в ядре.
// Из ядра обратно: зеркало [текущий шаг, играет, живых голосов] и «услышано» — удар шага (кораблик вспыхивает, маяк светит, круги эха).
// Чего нет против прежнего engine.js: часов наружу для ведущего MIDI (pulse) — t2d ведомый (решение 23.10).
import { DT } from './model.js';

export const SLOT = 13;
export const ACT = { STATE: 0, PLAY: 1, KILL: 2, AUDITION: 3 };
export const STATE_HEAD = 19, NSTEP = 16, STATE_N = STATE_HEAD + NSTEP * 4;       // как S_HEAD и STATE_N в core/worlds/portus/world.hpp

// состояние для ядра: bpm, chance, swing, chord, lvl, len, fc, res, env, dt, tone, mix, fb, fog, size, drive, wow, mare, spread, затем 16 мест (on, hz, p, lvl)
export function stateArgs(model) {
  const { luna, echo, fog, pharos, fx, seq } = model.state;
  const a = [seq.bpm, fx.chance, pharos.swing, pharos.chord, pharos.lvl, pharos.len, model.fcOf(), luna.res, luna.env, DT[echo.time], echo.tone, echo.mix,
    model.fbOf(), fog.amt, fog.size, fx.drive, fx.wow, fx.mare, fx.spread];
  for (let j = 0; j < NSTEP; j++) {
    const is = model.isleOn(j);
    a.push(is ? 1 : 0, is ? model.hzOf(is) : 0, is ? is.p : 0, is ? (is.lvl ?? 1) : 0);
  }
  return a;
}
const same = (a, b) => { if (!a || !b || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

export function createEngine(T, model) {
  let k = null, last = null, step = -1, voices = 0, audAt = -1e9;
  const listeners = [];
  const heard = (e) => { for (const fn of listeners) fn(e); };
  const send = (kind, a = []) => { if (k) k.send({ t: 'action', slot: SLOT, kind, i: 0, a }); };
  const { seq, echo } = model.state;

  function sync(force = false) {                           // состояние в ядро, если изменилось
    if (!k) return;
    const a = stateArgs(model);
    if (!force && same(a, last)) return;
    last = a; send(ACT.STATE, a);
  }
  function build(ctx, input) {                             // новый контекст — новый узел ядра и новый мир в нём: состояние и пуск — заново
    k = T.core; last = null; step = -1; voices = 0;
    k.dry[SLOT].connect(input);
    k.listen(mirrorFrom);
    sync(true);
    if (seq.playing) send(ACT.PLAY, [1]);
  }
  function mirrorFrom(d) {                                 // ~60 раз в секунду
    const w = d.w && d.w[SLOT];
    if (!w) return;
    step = w.mirror[0] ?? -1; voices = w.mirror[2] ?? 0;      // старый t2d.wasm без слота 13 отвечает пустым зеркалом
    for (const h of w.heard || []) {
      for (let i = 0; i + 1 < h.length; i += 2) {
        if (h[i] <= 0) continue;
        const is = model.isleOn(h[i + 1]);
        if (is) heard({ hit: is, dt: DT[echo.time] * model.stepSec() * 1000, fb: model.fbOf() });   // для картинки: кораблик вспыхивает, маяк светит, круги эха
      }
    }
  }
  function audition(is) {                                  // часы стоят — услышать аккорд, пока ставишь (не чаще 140 мс)
    const now = performance.now();
    if (seq.playing || !k || now - audAt < 140) return;
    audAt = now;
    sync();
    send(ACT.AUDITION, [model.hzOf(is), is.p, is.lvl ?? 1, is.step]);
  }
  function on(e) {                                         // событие модели → ядру
    if (e.t === 'fx') sync();
    else if (e.t === 'play') { sync(); send(ACT.PLAY, [e.on ? 1 : 0]); }
    else if (e.t === 'kill') send(ACT.KILL);
    else if (e.t === 'audition') audition(e.is);
  }
  let polled = 0;
  function poll(now) {                                     // раз в кадр, не чаще 30 мс: луна, маяк, лад и кораблики событий не шлют
    if (now - polled < 30) return;
    polled = now; sync();
  }

  return {
    build, on, poll, apply: () => sync(true),
    listen(fn) { listeners.push(fn); },
    get voices() { return voices; }, get step() { return seq.playing ? step : -1; },
    get ready() { return !!(k && k.ready); }, get live() { return !!(k && k.ready); },
  };
}
