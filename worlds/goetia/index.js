// Goetia — мир XV (в Таро XV — Дьявол): склейка model / engine / view и регистрация в хосте. Круг заклинателя из «Малого ключа Соломона».
// Звук — bytebeat (мир SDK: модель, звук и эхо — в ядре t2d.wasm): формула от счётчика t. На круге восемь узлов, у каждого знак (| & ^ + × − % ») и сдвиг (IV…XI). Ведёшь пальцем
// от узла к узлу — чертишь печать; со второго узла дух уже звучит, каждый новый узел дописывает в формулу член (t >> сдвиг) через свой знак.
// Печать сама называет духа (один из 72), он встаёт в треугольник над кругом. Духов — до трёх, у каждого свой цвет; четвёртый
// изгоняет самого старого. Тап по треугольнику — изгнать; тянешь вверх-вниз — выше/ниже (и тон, и ритм); держишь — плашка
// (pitch, tone, release, legio, level); вбок — release: влево — треск и удары (на подъёме бита самого медленного узла, не чаще бита IX; четыре на круг огонька), вправо —
// дольше, до ровного дрона. Узлы печати мигают своими битами: медленный сдвиг — ритм, быстрый — ровный свет; по печати бежит
// огонёк — цикл самого медленного члена. FX: legio (хор расходится по фазе), echo, spread, hall. Медный сосуд в углу — карта.
import { createModel, NODES, formula, numOf, spiritOf } from './model.js';
import { createEngine } from './engine.js';
import { createView, geo, nodeXY } from './view.js';

const T = window.T2D;
const model = createModel({ scale: { get on() { return T.scaleOn; }, snap: (s) => T.snapSemi(s) } });
const engine = createEngine(T, model);
const view = createView(T, model, engine);
model.listen((e) => { if (e.t === 'spirit' && !e.on) T.lfoClear(view.lfoId(e.s)); });   // изгнанный дух — LFO его строк сняты
model.listen(engine.on);

let last = 0;
T.registerWorld(15, {
  n: 'XV', title: 'Goetia', sub: 'sigilla · bytebeat', theme: view.theme, corner: view.corner, fx: view.fx, legend: view.legend,
  build: engine.build,
  tick(now) { model.tick(last ? (now - last) / 1000 : 0); last = now; view.tick(now); },
  draw: view.draw, down: view.down, move: view.move, up: view.up,
  dice: model.dice, clear() { view.reset(); model.clear(); }, snapshot: model.snapshot, restore(js) { view.reset(); model.restore(js); }, sounding: model.sounding,
});
window.t2d.goe = {
  spirits: model.state.spirits, fx: model.state.fx, geo: () => geo(T), NODES, formula, numOf, setFx: (k, v) => view.fx.set(k, v),
  get ready() { return engine.ready; }, get core() { return engine.core; }, get gains() { return engine.gains; }, get drawing() { return view.drawing; },
  node: (k) => nodeXY(geo(T), k), tri: (slot) => geo(T).tris[slot], name: (s) => spiritOf(s).name, rate: model.rate, seal: (path, opt) => model.summon(path, opt), model,
};
