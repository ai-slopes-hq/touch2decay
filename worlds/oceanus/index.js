// Oceanus — мир VIII: склейка model / engine / view и регистрация в хосте.
// Средневековая карта T-O (Orbis Terrarum): круг земли, разделённый буквой T на Asia, Europa и Africa,
// вокруг — Мировой океан, по краю — двенадцать ветров. Звук — сканирующий синтез (ocean-worklet.js): кольцо океана — цепочка
// масс на пружинах, его форма — форма волны. Голоса — города на земле: тап — город звучит, пока держишь; двойной тап — остаётся
// (до четырёх); место на круге — нота (по часовой от верха — полутоны), климат — октава (у берега низко, к Иерусалиму выше).
// Тронул воду — тянешь её к пальцу, по кольцу бегут волны, тембр живёт и успокаивается; быстрый тап по воде — всплеск.
// Луна обходит карту и тянет воду на себя (tide — чистый тон), ветер — рябь. Солнце — четвертью в левом верхнем углу: тап — карта.
import { createModel } from './model.js';
import { createEngine } from './engine.js';
import { createView, geo, at, moonPos } from './view.js';

const T = window.T2D;
const VER = new URL(import.meta.url).searchParams.get('v') || '0';
const model = createModel({ scale: { get on() { return T.scaleOn; }, get root() { return T.scaleRoot; }, snap: (s) => T.snapSemi(s) } });
const engine = createEngine(T, model, VER);
const view = createView(T, model, engine);
model.listen(engine.on);

let last = 0;
T.registerWorld(8, {
  n: 'VIII', title: 'Oceanus', sub: 'orbis terrarum', theme: view.theme, corner: view.corner, fx: view.fx, legend: view.legend,
  build: engine.build, enter: engine.start,
  tick(now) { model.tick(last ? (now - last) / 1000 : 0); last = now; view.tick(now); },
  draw: view.draw, down(f) { engine.start(); view.down(f); }, move: view.move, up: view.up,
  dice: model.dice, clear: model.clear, snapshot: model.snapshot, restore: model.restore, sounding: model.sounding, mapShot: view.mapShot,
});
window.t2d.ocean = {
  voices: model.state.voices, fx: model.state.fx, geo: () => geo(T), setFx: (k, v) => view.fx.set(k, v), get ready() { return engine.ready; }, get live() { return engine.live; },
  luna: model.state.luna, moonAt: () => moonPos(geo(T), engine.moon), get shape() { return engine.shape; }, get ripples() { return view.ripples; }, send: (v) => model.setVoice(v, {}), get gains() { return engine.gains; }, hz: model.hz,
  at: (a, rn) => at(geo(T), a, rn * geo(T).Rd), water: (a, k) => { const G = geo(T); return at(G, a, G.Rd + (G.Ro - G.Rd) * k); }, model,
};
