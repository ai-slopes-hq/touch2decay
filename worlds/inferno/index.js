// Inferno — мир V, ад Данте над Tenebrae: склейка model / engine / view и регистрация в хосте.
// Воронка из девяти кругов. Звук — шум сквозь банк резонаторов (как Rings, накормленный шумом), дрон без секвенсера; модель и звук — в ядре SDK (слот 5).
// Круг — резонатор из трёх полос; ниже круг — ниже, темнее и грязнее (свой перегруз и срез верха).
// Тап по кругу — удар: всплеск шума звенит в резонаторе; держишь — круг тлеет (шум идёт, пока палец на нём); вдоль круга — высота
// внутри его зоны (с ладом — по ступеням); быстро провёл сквозь круги — арфа, каскад вниз. Двойной тап — на круге остаётся грешник,
// круг горит сам (до 4). Держишь круг с грешником — плашка: цвет шума, ширина полос, перегруз, уровень. FX: structure (гармоники · лад · металл),
// fire (перегруз), smoke (тёмный зал), ice (Коцит: добротность растёт, звон стоит сам), storm (буря второго круга).
// В левом нижнем углу — вечная тьма (к центру карты): тап — карта. Спека: docs/superpowers/specs/2026-10-20-inferno-design.md
import { createModel } from './model.js';
import { createEngine } from './engine.js';
import { createView, geo } from './view.js';

const T = window.T2D;
const model = createModel({ scale: { get on() { return T.scaleOn; }, get pcs() { return T.scalePCs; }, snap: (s) => T.snapSemi(s) } });
const engine = createEngine(T, model);                  // модель и звук — в ядре (t2d.wasm, слот 5); model.js — фасад, engine.js — сухой выход и зеркало
const view = createView(T, model);
engine.listen(view.heard);

T.registerWorld(5, {
  n: 'V', title: 'Inferno', sub: 'circuli novem', theme: view.theme, corner: view.corner, fx: view.fx, legend: view.legend,
  build: engine.build,
  tick(now, dt) { view.hold(now); view.tick(now, dt); },   // время модели идёт в ядре; здесь — пальцы (hold), вращение, угольки
  draw: view.draw, down: view.down, move: view.move, up: view.up,
  dice: model.dice, clear: model.clear, snapshot: model.snapshot, restore: model.restore, sounding: model.sounding,
});
const S = model.state;
window.t2d.inf = {
  circ: S.circ, fx: S.fx, geo: () => geo(T), get strikes() { return engine.strikes; }, get ice() { return S.iceE; }, get storm() { return S.stormSemi; },
  get sparks() { return view.sparks; }, get live() { return engine.live; }, setFx: (k, v) => view.fx.set(k, v), get ready() { return engine.ready; }, get core() { return engine.core; },
  at: (k, pos = 0.5) => { const G = geo(T), r = G.rings[k]; return { x: G.cx - r.rx + 2 * r.rx * pos, y: r.cy }; },
  model,
};
