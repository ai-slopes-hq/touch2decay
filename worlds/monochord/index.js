// Monochordum — мир VII: склейка model / engine / view и регистрация в хосте.
// Монохорд мира Роберта Фладда (1617): струны натянуты от Земли (внизу) к руке Бога в облаке (вверху). Звук — Карплус — Стронг
// (monochord-worklet.js), четыре струны; на каждой — подставка: звучит часть от подставки вверх, к колкам; подставка прилипает к
// пифагоровым ладам (с ладом — к ступеням лада). Тап — щипок, поперёк туда-сюда — смычок, провёл по струнам — страм, двойной тап —
// струна поёт сама (Эолова арфа), держишь — плашка. Роза ветров — ветер, Земля — автострам в темпе. Рука Бога в облаке — карта.
import { createModel } from './model.js';
import { createEngine } from './engine.js';
import { createView, geo, yOfR, earthG } from './view.js';

const T = window.T2D;
const VER = new URL(import.meta.url).searchParams.get('v') || '0';
const model = createModel({ scale: { get on() { return T.scaleOn; }, get root() { return T.scaleRoot; }, snap: (s) => T.snapSemi(s) } });
const engine = createEngine(T, model, VER);
const view = createView(T, model);
model.listen(engine.on);
engine.listen((h) => { if (h.energy) model.meter(h.energy.e, h.energy.h, h.energy.n); });   // что слышно — в модель, её читают view и t2d.mono
engine.listen(view.heard);
const { str, fx, auto } = model.state;

let last = 0;
T.registerWorld(7, {
  n: 'VII', title: 'Monochordum', sub: 'chorda mundi', corner: view.corner, fx: view.fx, legend: view.legend,
  build: engine.build, enter: engine.start,
  tick(now) { model.tick(last ? (now - last) / 1000 : 0); last = now; view.tick(now); },
  draw: view.draw, down(f) { engine.start(); view.down(f); }, move: view.move, up: view.up,
  dice: model.dice, clear() { T.lfoClear('mono-wind'); model.clear(); },   // корзина: и порывы ветра снимаются
  snapshot: model.snapshot, restore: model.restore, sounding: model.sounding,
  tempo: { get: () => auto.bpm, set: (bpm) => model.setBpm(bpm), play: (on) => model.setAuto(on), playing: () => auto.on, armed: () => false },
});
window.t2d.mono = {
  str, fx, geo: () => geo(T), setFx: (k, v) => view.fx.set(k, v), setWind: model.setWind, auto, earth: () => earthG(geo(T)),
  get wind() { return model.state.wind; }, get chorus() { return engine.chorus; }, get ready() { return engine.ready; }, get live() { return engine.live; },
  at: (i, r) => { const G = geo(T); return { x: G.xs[i], y: yOfR(G, r) }; }, hz: (i) => model.hzOf(i), model,
};
