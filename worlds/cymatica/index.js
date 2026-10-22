// Cymatica — мир II: склейка model / engine / view и регистрация в хосте.
// Звучащая пластина Хладни — ханг: тап — удар (клетка — нота: сектор — ступень лада, кольцо — октава), щипок или колесо — размер
// пластины, то есть высота. Астролябия вокруг — секвенсер: ритм и мелодия своей длины (полиритм), часы — в plate-worklet.js.
// Спека: docs/superpowers/specs/2026-10-20-cymatica-design.md, часть 2.
import { createModel } from './model.js';
import { createEngine } from './engine.js';
import { createView, BOWS_ON } from './view.js';
import * as core from './core.js';

const T = window.T2D;
const VER = new URL(import.meta.url).searchParams.get('v') || '0';
const model = createModel({ scale: { get on() { return T.scaleOn; }, get pcs() { return T.scalePCs; }, snap: (s) => T.snapSemi(s) } });
const engine = createEngine(T, model, VER);
const view = createView(T, model, engine);
model.listen(engine.on);
model.listen(view.changed);                     // новое в гнезде — вспышка
engine.listen(view.heard);
const { plate, seq } = model.state;

let last = 0;
T.registerWorld(2, {
  n: 'II', title: 'Cymatica', sub: 'figurae sonorae', corner: view.corner, fx: view.fx,
  build: engine.build,
  tick(now) { model.tick(last ? (now - last) / 1000 : 0); last = now; view.tick(now); },
  tempo: { get: () => seq.bpm, set: (bpm) => model.setBpm(bpm), play: (on) => { if (on !== seq.playing) model.play(on); }, playing: () => seq.playing },   // общие часы (карта → concordia)
  enter() { engine.start(); },
  draw: view.draw, down: view.down, move: view.move, up: view.up, wheel: view.wheel,
  dice() { model.dice(); T.transportFrom(2, true); },
  clear() { view.detach(); model.clear(); },     // палец на метке смычка отпускает его
  snapshot: model.snapshot,
  restore(js) { view.detach(); model.restore(js); },
  sounding: () => view.touching() || plate.bows.length > 0 || engine.level > 1e-4 || model.sounding(),
});

// отладка и тесты: window.t2d.cym
window.t2d.cym = {
  get ready() { return engine.ready; }, get f0() { return plate.f0; }, get fx() { return { ...plate.fx }; },
  get bows() { return plate.bows.map((b) => ({ ...b })); }, get energy() { return Array.from(engine.energy); },
  get ringOpen() { return view.ringOpen; }, get live() { return view.live; },
  get geo() { return view.geo(); },
  get seq() { return JSON.parse(JSON.stringify(seq)); }, get notes() { return model.notesOf(seq.melody.steps); },   // notes — ноты мест мелодии
  get sentSeq() { return JSON.parse(JSON.stringify(model.state.sentSeq)); }, get base() { return model.base(); },
  get lastStep() { return view.lastStep; },
  play: model.play, rec: model.rec,
  get astro() { const g = view.geo(); return { ...view.astro(g), cx: g.cx, cy: g.cy }; },
  load: model.load,                              // готовый узор (рендер, отладка)
  core: {
    euclid: core.euclid, nearestStep: core.nearestStep, walkMelody: core.walkMelody, rotateSteps: core.rotateSteps, twistOrPinch: core.twistOrPinch,
    noteList: model.noteList, degPerOct: model.degPerOct, cellIdx: core.cellIdx, noteAt: core.noteAt, cellOf: core.cellOf, cellCenter: core.cellCenter,
    transposeHits: core.transposeHits, scaleSemis: model.scaleSemis, snapToGrid: core.snapToGrid, quantizeRhythm: core.quantizeRhythm,
  },
  get echo() { return { label: model.echoDiv()[0], sec: model.echoSec(), fb: model.echoFb() }; }, get echoMax() { return engine.echoMax; },
  get echoChains() { return engine.echoChains; },
  get gesture() { return view.gesture; }, get shownF0() { return view.shownF0; }, bowsOn: BOWS_ON, get ringTurn() { return view.ringTurn; }, get grid() { return model.state.grid; }, get waveStep() { return view.waveStep(); },
  get cursor() { return model.state.cursor; }, get stepRec() { return model.state.stepRec && { ...model.state.stepRec }; }, get drift() { return { ...model.state.drift }; }, get effF0() { return model.effF0(); }, get stars() { return view.stars; }, get answerAt() { return view.answerAt; }, get lit() { return [...view.litCells().keys()]; }, get bornM() { return view.bornM; }, get showNotes() { return view.showNotes(performance.now()); }, get lastStrike() { return model.state.lastStrike; },
  strike(x, y) { engine.send({ t: 'strike', x, y, vel: 1, hard: 0.5 }); },
  bow(x, y, on = true) { engine.send({ t: 'bow', id: 'dbg', x, y, on, exciter: 0, pressure: 0.5, amp: 0.8 }); },
  model,
};
