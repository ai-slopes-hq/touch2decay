// Natura — модель, звук и часы живут в ядре SDK (core/worlds/natura → t2d.wasm, узел хоста T.core, слот 4): кувшинки, волны (sine / square /
// triangle / saw / sharp — band-limited), фильтр с огибающей, шина (срез дерева, хор, лента-задержка), посыл в общий зал, кораблик, лазер, лягушка,
// шелест, дерево (затухает в ядре); шаги по часам хоста (свой темп или сетка MIDI-часов — с точностью до сэмпла). Здесь — тонкая склейка: сухой
// выход мира — в канал микшера, посыл в зал и фейдер — в ядре; порт ядра отдаётся фасаду модели (bind), зеркало — ему (sync). Действия фасад
// шлёт ядру сам; engine следит за метрами: кораблик на воде (skiff), бегунок (phase), голоса.
// Из ядра обратно: зеркало [бегунок, играет, голосов, кораблик, …] и «услышано» → view: { note: pd, at } — нота ударила (утки),
// { played: i, at } — кувшинка шага (лягушка, стрекозы). Эталон прежнего движка на узлах Web Audio — tools/ref/natura-engine.js.
import { SLOT } from './model.js';

export function createEngine(T, model) {
  const S = model.state;
  let k = null, skiffOn = false;
  let mp = -1, mAt = 0, mPlay = false, voices = 0;       // зеркало: бегунок (шагов), когда пришёл, играет ли, голосов
  const listeners = [];
  const heard = (e) => { for (const fn of listeners) fn(e); };

  function build(ctx, input) {                           // новый контекст — новый узел ядра и новый мир в нём: сцена и пуск — заново
    k = T.core; skiffOn = false; mp = -1; mPlay = false; voices = 0;
    k.dry[SLOT].connect(input);
    model.bind(k.send);
    k.listen(mirrorFrom);
  }
  function mirrorFrom(d) {                               // ~60 раз в секунду
    const w = d.w && d.w[SLOT];
    if (!w) return;
    model.sync(w.mirror, d.n);
    const m = w.mirror || [];
    mp = m[0] ?? -1; mPlay = (m[1] ?? 0) > 0; voices = m[2] ?? 0; mAt = performance.now();
    for (const h of w.heard || []) {
      for (let i = 0; i + 1 < h.length; i += 2) {
        const now = performance.now();
        if (h[i] === 2) { const pd = S.pads.at[h[i + 1]]; if (pd) heard({ note: pd, at: now }); }   // для уток: нота ударила
        else if (h[i] === 1) heard({ played: h[i + 1], at: now });                                  // лягушка, стрекозы
      }
    }
  }
  // бегунок: шагов с начала; между зеркалами (16 мс) — вперёд по темпу, не дальше шага
  const phase = () => (S.seq.playing && k && mPlay && mp >= 0 ? mp + Math.min(1, (performance.now() - mAt) / (model.stepSec() * 1000)) : null);

  function on(e) { if (e.t === 'skiff') skiffOn = !!e.o; }   // остальное фасад шлёт ядру сам

  return {
    build, on, phase, clock: { next: 0, step: 0 },
    listen(fn) { listeners.push(fn); },
    get has() { return !!k; }, get skiff() { return skiffOn; }, get live() { return !!(k && k.ready); }, get voices() { return voices; }, get ready() { return !!(k && k.ready); },
  };
}
