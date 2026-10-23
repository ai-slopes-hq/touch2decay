// Paradisus — мир VI: склейка model / engine / view и регистрация в хосте. Рай Данте над Cymatica: девять небесных сфер вокруг
// Небесной розы. Звук — хор гласных (vowel synth) в натуральном ряду, дрон без секвенсера. Сфера n — n-я гармоника тоники лада
// (без лада — от A2): Luna снаружи — основной тон, Primum Mobile у самого света — девятая. Тронул сферу — там ангел и поёт, пока держишь;
// вдоль сферы — гласная (a сверху, дальше по часовой e, i, o, u); поперёк — на другую сферу (прилипает к ближайшей). Двойной тап — ангел
// остаётся и поёт сам (до 4); держишь закреплённого — его плашка: хор (1–5 певчих), расстройка, вибрато, дыхание, регистр. Роза в центре —
// Gloria: облако зёрен хора, тап по ней — россыпь. FX: shimmer (лучи розы ярче; собор — общий ревербер ядра), gloria, aether (зал), vibrato, orbits.
// В правом нижнем углу (к центру карты) — божественный свет: тап — карта. Спека: docs/superpowers/specs/2026-10-20-paradisus-design.md
import { createModel } from './model.js';
import { createEngine } from './engine.js';
import { createView, geo, anglePos } from './view.js';

const T = window.T2D;
const model = createModel({ scale: { get on() { return T.scaleOn; }, get root() { return T.scaleRoot; } } });
const engine = createEngine(T, model);                  // worklet нет — обычные узлы
const view = createView(T, model);
model.listen(engine.on);
engine.listen((h) => { if (h.t === 'voice') model.voiced(h.a, h.on); });   // звучит ли ангел — модели (Gloria, chime, дрейф, свечение)
engine.listen(view.heard);

T.registerWorld(6, {
  n: 'VI', title: 'Paradisus', sub: 'sphaerae · chorus', theme: view.theme, corner: view.corner, fx: view.fx, legend: view.legend,
  build: engine.build,
  tick(now, dt) { model.tick(dt); view.tick(now, dt); },   // шаг кадра хоста (≤ 0.05 с), как было: после паузы Gloria не сыплет зёрна пачкой
  draw: view.draw, down: view.down, move: view.move, up: view.up,
  dice: () => model.dice(), clear: () => model.clear(), snapshot: model.snapshot, restore: model.restore, sounding: model.sounding,
});
window.t2d.par = {
  angels: model.state.angels, fx: model.state.fx, geo: () => geo(T), setFx: (k, v) => view.fx.set(k, v), get live() { return engine.live; },
  at: (k, v) => anglePos(geo(T), k, v), hz: (a) => model.hzOf(a), dice: () => model.dice(),
  get glitter() { return view.glitter; }, get flashes() { return view.flashes; }, get open() { return view.open; },
  planet: model.planetAt, vEff: model.vEff, orbit: (x) => model.setOrbit(x), model,
};
