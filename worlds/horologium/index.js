// Horologium (Nova) — мир IX: склейка model / engine / view и регистрация в хосте. Волшебные числа музыки. Астрономические часы:
// одно колесо-«единица» (стрелка с солнцем) и концентрические кольца II…IX. Кольцо n — n ударов за оборот, каждый — нота n-й гармоники
// (как Rhythmicon Кауэлла и Термена): 2 : 3, 3 : 4, 4 : 5 : 6 — медленно это полиритм, быстро — интервал и аккорд в чистом строе.
// Двойной тап по кольцу — унтертон (12/n ударов, ноты вниз: 1/IV : 1/V : 1/VI — минор). Ведёшь пальцем вдоль кольца — его фаза.
// Маятник — как в детстве: хватаешь и качаешь — часы идут от руки (каждый проход через низ — спуск, колесо на четверть оборота);
// бросил сильно — раскачан, часы разгоняются и медленно успокаиваются к темпу; перекинул через верх — крутится, и ритм за порогом
// (limen) сливается в тон; поймал — стоп. Звук — horo-worklet.js (щелчок в резонатор). Солнце — четвертью справа сверху: карта.
import { createModel } from './model.js';
import { createEngine } from './engine.js';
import { createView, geo, ringR, bobXY, stripX } from './view.js';

const T = window.T2D;
const VER = new URL(import.meta.url).searchParams.get('v') || '0';
const model = createModel({ scale: { get on() { return T.scaleOn; }, get root() { return T.scaleRoot; } } });
const engine = createEngine(T, model, VER);
const view = createView(T, model, engine);
model.listen(engine.on);
engine.listen((h) => { if (h.ready) model.sendAll(); });   // worklet завёлся — кольца, тоника и скорость разом (и модель помнит, что ушло)
engine.listen(view.heard);
const { rings, fx, clock, pend } = model.state;

T.registerWorld(9, {
  n: 'IX', title: 'Horologium', sub: 'numeri · horae', theme: view.theme, corner: view.corner, fx: view.fx, legend: view.legend,
  build: engine.build, enter: engine.start,
  tick(now, dt) { model.tick(dt); view.tick(now); },     // шаг кадра хоста, как было
  draw: view.draw, down(f) { engine.start(); view.down(f); }, move: view.move, up: view.up,
  dice: model.dice, clear: model.clear, snapshot: model.snapshot, restore: model.restore, sounding: model.sounding,
  tempo: { get: () => clock.bpm, set: (bpm) => model.setBpm(bpm), play: (on) => { if (on) model.setRun(true); else model.stop(); }, playing: () => clock.run, armed: () => rings.some((r) => r.on) }, mapShot: view.mapShot,
});
window.t2d.horo = {
  rings, fx, clock, pend, geo: () => geo(T), setFx: (k, v) => view.fx.set(k, v), get ready() { return engine.ready; }, get live() { return engine.live; },
  get F() { return engine.F; }, get P() { return engine.P; }, get strikes() { return engine.strikes; }, get handSteps() { return model.handSteps; },
  ring: (i, a = 0) => { const G = geo(T), r = ringR(G, i); return { x: G.cx + Math.sin(a) * r, y: G.cy - Math.cos(a) * r }; }, bob: () => bobXY(geo(T), pend), hub: () => { const G = geo(T); return { x: G.cx, y: G.cy }; },
  run: model.setRun, ratio: () => model.ratio(engine.F), strip: (F) => { const S = geo(T).strip; return { x: stripX(S, F), y: S.y }; }, model,
};
