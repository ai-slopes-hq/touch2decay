// Firmamentum — мир X: склейка model / engine / view и регистрация в хосте. Мир SDK: модель и звук — в ядре (t2d.wasm, узел хоста),
// model.js — фасад над ним, engine.js — сухой выход и зеркало.
// Звук — пульсарный синтез, дрон без секвенсера. Тап по своду — прокол: в тверди звезда, сквозь неё бьёт свет — поток пульсаретов.
// Высота над горизонтом — частота пульсаций: у горизонта звезда мигает ритмом, выше мерцание сливается в тон (граница — пунктир limen,
// около 20 Гц); вбок по своду — формант. Тап по звезде — закрыть дыру; тянешь — двигаешь; держишь — плашка. Солнце под землёй — карта.
import { createModel } from './model.js';
import { createEngine } from './engine.js';
import { createView, geo, fromSky } from './view.js';

const T = window.T2D;
const model = createModel({
  scale: { get on() { return T.scaleOn; }, snap: (s) => T.snapSemi(s) },
  place: (s) => fromSky(geo(T), s),                     // комета разгоняет звёзды в 90 px от себя — расстояние на экране
});
const engine = createEngine(T, model);
const view = createView(T, model, engine);
model.listen((e) => { if (e.t === 'star' && !e.on) T.lfoClear(view.lfoId(e.s)); });   // закрытая звезда — LFO её строк сняты
engine.listen(view.heard);

T.registerWorld(10, {
  n: 'X', title: 'Firmamentum', sub: 'stellae · pulsar', theme: view.theme, corner: view.corner, fx: view.fx, legend: view.legend,
  build: engine.build,
  tick(now) { view.tick(now); },                       // время модели идёт в ядре
  draw: view.draw, down: view.down, move: view.move, up: view.up,
  dice: model.dice, clear: model.clear, snapshot: model.snapshot, restore: model.restore, sounding: model.sounding, mapShot: view.mapShot,
});
window.t2d.firm = {
  stars: model.state.stars, fx: model.state.fx, geo: () => geo(T), setFx: (k, v) => view.fx.set(k, v),
  get comets() { return model.state.comets; }, get comet() { return model.state.comet; }, launch: model.launch,
  get ready() { return engine.ready; }, get core() { return engine.core; }, get specks() { return view.specks; }, get bolts() { return view.bolts; }, get gains() { return engine.gains; }, get counts() { return engine.counts; },
  fp: model.fp, ff: model.ff, LIMEN: model.LIMEN, at: (h, u) => fromSky(geo(T), { h, u }), model,
};
