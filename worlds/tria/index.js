// Tria corpora — мир XI: склейка model / engine / view и регистрация в хосте.
// Задача трёх тел на земле. Три начала Парацельса — Sal, Sulphur, Mercurius — на алхимическом блюде:
// тянут друг друга и кружат хаотически, а земля в середине тянет всех к себе (чтобы не разлетелись). Каждое тело — генератор:
// Harmonices mundi: тело бьёт свою ноту (соль — дерево, сера — колокол, ртуть — стекло), когда пересекает круг блюда или луч
// стихий (aspectus); высота — угловая скорость вокруг земли, как у Кеплера (flux — сколько октав), всегда по ступеням; удар о край —
// низкий тимпан; близкий пролёт — обе ноты разом; тело в тесной паре гудит своим тоном и пульсирует с оборотом пары (FM по кругу — nexus).
// Тело можно схватить и бросить (щелчок — скорость); двойной тап — тело встаёт на якорь;
// держишь — плашка (mass, note, level). Тап по знаку земли в середине — «Fiat lux»: тела встают на восьмёрку (устойчивая орбита
// Шенсине — Монтгомери) и звучат периодом; тронул тело — снова хаос. Корзина — тела замирают и молчат. Солнце — в левом верхнем углу: карта.
import { createModel } from './model.js';
import { createEngine } from './engine.js';
import { createView, geo, px } from './view.js';

const T = window.T2D;
const model = createModel({ scale: { get on() { return T.scaleOn; }, get root() { return T.scaleRoot; }, snap: (s) => T.snapSemi(s) } });
const engine = createEngine(T, model);                  // worklet нет — обычные узлы
const view = createView(T, model);
model.listen(engine.on);

let last = 0;
T.registerWorld(11, {
  n: 'XI', title: 'Tria corpora', sub: 'sal · sulphur · mercurius', theme: view.theme, corner: view.corner, fx: view.fx, legend: view.legend,
  build: engine.build,
  tick(now) { model.tick(last ? (now - last) / 1000 : 0); last = now; view.tick(now); },   // шаг физики модель обрежет сама, как хост (DT_MAX)
  draw: view.draw, down: view.down, move: view.move, up: view.up,
  dice: model.dice, clear: model.clear, snapshot: model.snapshot, restore: model.restore, sounding: model.sounding, mapShot: view.mapShot,
});
const B = model.state.bodies, d = (i, j) => Math.hypot(B[i].x - B[j].x, B[i].y - B[j].y);
window.t2d.tria = {
  bodies: B, fx: model.state.fx, geo: () => geo(T), setFx: (k, v) => view.fx.set(k, v),
  get still() { return model.state.still; }, get lux() { return model.state.lux; }, get cadit() { return model.state.cadit; },
  get encounters() { return engine.encounters; }, get strikes() { return engine.strikes; }, get pair() { return [...model.state.pairK]; },
  fiatLux: model.fiatLux, energy: model.energy, spread: () => (d(0, 1) + d(1, 2) + d(0, 2)) / 3, dmin: () => Math.min(d(0, 1), d(1, 2), d(0, 2)),
  at: (i) => px(geo(T), B[i]), model,
};
