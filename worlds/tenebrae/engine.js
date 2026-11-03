// Tenebrae (мир I) — звук и модель в ядре SDK (core/worlds/tenebrae → t2d.wasm, узел хоста core, слот 1). Здесь — тонкая склейка с узлом:
// сухой выход мира — в канал микшера мира I; шина, эхо, удар солнца, лад и посыл в общий зал — в ядре. Порт ядра отдаётся фасаду модели
// (bind: после смены контекста он шлёт новому ядру закреплённую сцену), зеркало и услышанное — ему же (sync).
import { LFO_KEYS, LINK_TYPES, SLOT } from './model.js';

export { LFO_KEYS, LINK_TYPES };
export const RES_MAX = 24;       // res: Q фильтра в дБ (как в ядре) — для подписей и LFO res на поле
export const DLY_REPEATS = 0.46; // обратная связь дилея (как в ядре) — для эха на поле

// model — фасад (worlds/tenebrae/model.js); core — ядро хоста (host/audio.js: send, dry, listen)
export function createEngine({ model }) {
  let dryTo = null, from = null, gen = 0;
  function build(core, out) {                            // новый контекст — новый узел ядра: сухой выход в канал, порт — фасаду
    if (dryTo) { try { from.disconnect(dryTo); } catch (_) { /* старый контекст закрыт */ } }
    from = core.dry[SLOT]; dryTo = out;
    from.connect(out);
    model.bind(core.send);
    const mine = ++gen;                                  // зеркало от прежнего ядра (до restartAudio) в очереди — не слушать
    core.listen((d) => { if (mine !== gen) return; const w = d.w && d.w[SLOT]; if (w) model.sync(w.mirror, d.n, w.heard); });
  }
  return { build, dispose() { if (dryTo) { try { from.disconnect(dryTo); } catch (_) { /* уже отключён */ } dryTo = null; } } };
}
