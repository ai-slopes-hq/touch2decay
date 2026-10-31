// Arcadia — мир XII: склейка model / engine / view и регистрация в хосте. Гравированная карта холмистой страны — горы, холмы, озёра, реки.
// Звук — синтез по рельефу (мир SDK: ядро t2d.wasm, слот 12): пейзаж — поверхность высот, а странник обходит по ней маленькую петлю со звуковой частотой —
// высоты под петлёй и есть форма волны. Тап по земле — странник, вокруг него петля-орбита; север — выше нота, юг — ниже (деления по левому
// краю карты — полутоны), а земля под петлёй — тембр: на ровном склоне почти синус, через хребет — богато. Тянешь край петли — шире или уже.
// Петля сама бродит (путь): стоит, кругом, наугад, вниз по реке к озеру или вверх к вершине. Тап по страннику — уходит, держишь — плашка.
// Кубик — новая страна и новые пути. FX: relief, pace, wind, chorus, phaser, hall. Солнце — четвертью в правом верхнем углу: тап — карта.
import { createModel } from './model.js';
import { createEngine } from './engine.js';
import { createView, geo, at, proj, loopPts } from './view.js';

const T = window.T2D;
const model = createModel({ scale: { get on() { return T.scaleOn; }, snap: (s) => T.snapSemi(s), get root() { return T.scaleRoot; } } });
const engine = createEngine(T, model);
const view = createView(T, model, engine);
model.listen(engine.on);
model.listen((e) => { if (e.t === 'trav' && !e.on) T.lfoClear(view.lfoId(e.tr)); });   // ушедший странник — LFO его строк сняты

let last = 0;
T.registerWorld(12, {
  n: 'XII', title: 'Arcadia', sub: 'montes · lacus · flumina', theme: view.theme, corner: view.corner, fx: view.fx, legend: view.legend,
  build: engine.build, enter: engine.start,
  tick(now) { view.tick(now); model.tick(last ? (now - last) / 1000 : 0); last = now; },
  draw: view.draw, down(f) { engine.start(); view.down(f); }, move: view.move, up: view.up,
  dice: model.dice, clear: model.clear, snapshot: model.snapshot, restore: model.restore, sounding: model.sounding, mapShot: view.mapShot,
});
const { travellers, fx } = model.state;
window.t2d.arc = {
  travellers, fx, geo: () => geo(T), setFx: (k, v) => view.fx.set(k, v), get land() { return model.state.land; }, get ready() { return engine.ready; }, get core() { return engine.core; }, get centers() { return engine.centers; }, get gains() { return engine.gains; }, hz: model.hzOf,
  at: (u, v) => at(geo(T), model.zAt, u, v), ground: (u, v) => proj(geo(T), u, v), loop: (i) => loopPts(geo(T), model.zAt, travellers[i], engine.centers[travellers[i].slot], 48), z: model.zAt, newLand: model.newLand, addT: model.addT, routeOf: model.routeOf, model,
};
