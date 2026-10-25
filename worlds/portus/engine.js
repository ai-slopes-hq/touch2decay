// Portus — звук и часы живут в ядре SDK (core/worlds/portus → t2d.wasm, узел хоста T.core, слот 13): модель, стабы, шина, эхо, туман и море,
// шаги по часам хоста (свой темп или сетка MIDI-часов — с точностью до сэмпла). Здесь — тонкая склейка: сухой выход мира — в канал микшера,
// посыл в зал и фейдер — в ядре; порт ядра отдаётся фасаду модели (bind), зеркало — ему (sync).
// Из ядра обратно: зеркало [текущий шаг, играет, живых голосов, …] и «услышано» — удар шага (кораблик вспыхивает, маяк светит, круги эха).
// Чего нет против прежнего engine.js: часов наружу для ведущего MIDI (pulse) — t2d ведомый (решение 23.10).
import { DT, SLOT, ACT } from './model.js';

export function createEngine(T, model) {
  let k = null, step = -1, voices = 0, audAt = -1e9;
  const listeners = [];
  const heard = (e) => { for (const fn of listeners) fn(e); };
  const { seq, echo } = model.state;

  function build(ctx, input) {                           // новый контекст — новый узел ядра и новый мир в нём: сцена и пуск — заново
    k = T.core; step = -1; voices = 0;
    k.dry[SLOT].connect(input);
    model.bind(k.send);
    k.listen(mirrorFrom);
  }
  function mirrorFrom(d) {                               // ~60 раз в секунду
    const w = d.w && d.w[SLOT];
    if (!w) return;
    model.sync(w.mirror, d.n);
    step = w.mirror[0] ?? -1; voices = w.mirror[2] ?? 0;      // старый t2d.wasm без слота 13 отвечает пустым зеркалом
    for (const h of w.heard || []) {
      for (let i = 0; i + 1 < h.length; i += 2) {
        if (h[i] <= 0) continue;
        const is = model.isleOn(h[i + 1]);
        if (is) heard({ hit: is, dt: DT[echo.time] * model.stepSec() * 1000, fb: model.fbOf() });   // для картинки: кораблик вспыхивает, маяк светит, круги эха
      }
    }
  }
  function audition(is) {                                // часы стоят — услышать аккорд, пока ставишь (не чаще 140 мс)
    const now = performance.now();
    if (seq.playing || !k || now - audAt < 140) return;
    audAt = now;
    k.send({ t: 'action', slot: SLOT, kind: ACT.AUDITION, i: is.step, a: [] });
  }
  function on(e) { if (e.t === 'audition') audition(e.is); }   // остальное фасад шлёт ядру сам

  return {
    build, on,
    listen(fn) { listeners.push(fn); },
    get voices() { return voices; }, get step() { return seq.playing ? step : -1; },
    get ready() { return !!(k && k.ready); }, get live() { return !!(k && k.ready); },
  };
}
