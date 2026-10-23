// Natura — мир IV: склейка model / engine / view и регистрация в хосте.
// Река с кувшинками, древо, туча, птицы; карта Таро чёрным по сепии. Звучит: шаговый секвенсер на простых волнах.
// Секвенсер — река от гор к зрителю: вдоль течения 16 мест (шагов), кувшинка на месте — шаг; поперёк — нота
// (у левого берега ниже, у правого выше; пунктир по течению — октавы). Цветок на кувшинке — голос (ромашка — синус,
// тюльпан — меандр, звёздочка — треугольник, вертушка — пила, чертополох — sharp), раскрывается на шаге — огибающая. Бегунок — лист-лодочка
// по течению, запруда — длина петли. Древо на правом берегу, туча над ним поливает; дождь гуще — time; круги от задетой кувшинки
// повторяются — delay; облака вокруг тучи — тоже delay; птиц больше — chorus (хор); туман на горах — reverb.
// В сцене: туча вверх-вниз — cutoff (выше — светлее и ярче), горы вверх-вниз — res, утки в заводи — огибающая: левая attack, правая release.
// Жесты: тап по реке — посадить кувшинку (тап по ней — убрать), тянешь кувшинку поперёк — нота, вдоль — шаг, держишь — её плашка;
// запасной кораблик на левом берегу: берёшь и водишь по реке — поперёк звучит нота (с ладом — по ступеням, без — плавно), вниз по течению ярче;
// запруда тянешь — длина петли; причал у истока: тап — пуск/стоп (лодочка отчаливает), вбок — темп.
// Солнце — четверть в левом верхнем углу (к центру карты), тап — карта; надгробие слева внизу пока ни к чему не ведёт.
// Спека: docs/superpowers/specs/2026-10-20-natura-design.md
import { createModel } from './model.js';
import { createEngine } from './engine.js';
import { createView } from './view.js';

const T = window.T2D;
const model = createModel({ scale: { get on() { return T.scaleOn; }, get root() { return T.scaleRoot; }, get pcs() { return T.scalePCs; } } });
const engine = createEngine(T, model);                  // worklet нет — обычные узлы
const view = createView(T, model, engine);
model.listen(engine.on);
engine.listen(view.heard);
const S = model.state;

let last = performance.now();
T.registerWorld(4, {
  n: 'IV', title: 'Natura', sub: 'flumen · nymphaeae', theme: view.theme, corner: view.corner, fx: view.fx,
  build: engine.build,
  tick(now) { model.tick((now - last) / 1000); last = now; view.tick(now); },   // время модели — без обрезки (утки); дерево затихает с шагом ≤ 0.1 с, как было
  draw: view.draw, down: view.down, move: view.move, up: view.up,
  tempo: { get: () => S.seq.bpm, set: (bpm) => model.setBpm(bpm), play: (on) => { if (on !== S.seq.playing) model.play(on); }, playing: () => S.seq.playing, armed: () => S.pads.at.some(Boolean) },   // общие часы (карта → concordia)
  mapShot: view.mapShot,
  dice() { const was = S.seq.playing; model.dice(); if (!was) T.transportFrom(4, true); },   // кубик заводит реку
  clear: () => model.clear(), snapshot: model.snapshot, restore: model.restore, sounding: model.sounding,
});
// seq — как было: playing и bpm — модели, next и step — часы engine
const seq = {
  get playing() { return S.seq.playing; }, set playing(v) { S.seq.playing = v; }, get bpm() { return S.seq.bpm; }, set bpm(v) { S.seq.bpm = v; },
  get next() { return engine.clock.next; }, set next(v) { engine.clock.next = v; }, get step() { return engine.clock.step; }, set step(v) { engine.clock.step = v; },
};
window.t2d.nat = {
  fx: S.fx, pads: S.pads, geo: view.geo, seq, play: model.play, get phase() { return engine.phase(); }, get shake() { return S.shake; }, get birdsAt() { return view.birdsAt; },
  get fish() { return view.fish; }, scare: view.scare, get ducksGone() { return view.ducksGone; }, get envOpen() { return model.envOpen(); },
  ...view.nat, model,
};
