// Portus — мир XIII: склейка model / engine / view и регистрация в хосте.
// Ночная бухта в псевдоперспективе, как в Natura. Звук — dub techno: аккорды-стабы сквозь фильтр, эхо и туман.
// Одна дорожка на 16 шагов, как река Natura: фарватер — путь от набережной в море, вдоль него 16 мест (вехи по левому краю);
// бумажный кораблик на месте — удар аккорда, поперёк фарватера — его тоника (слева ниже, справа выше, октава). Аккорд один на всю
// дорожку (квинта, sus, m7, m9, m11) и октава (−2…+2) — у маяка; у кораблика — только нота (и сдвиг октавы, громкость). Делей, ревер и фильтр — не веер FX, а сама сцена:
//   · луна — фильтр (и вместо солнца — тап по ней — карта): выше — открыт, садится к горизонту — закрыт, вбок — резонанс;
//   · колокол-буй — эхо: поперёк — время (1/8 … 1/2), дальше в море — дольше повторы (до бесконечных); круги на воде — повторы;
//     тап по небу — падает звезда и гасит накопившееся эхо;
//   · туман на горизонте — ревер: выше туман — больше зала, он прячет дальние кораблики и садящуюся луну.
// Маяк — пуск/стоп, вбок — темп. Держишь предмет — плашка. Веер FX: wow (лента), mare (шум моря), drive, spread, chance.
import { createModel } from './model.js';
import { createEngine } from './engine.js';
import { createView, geo, P, slotPt, markPt } from './view.js';

const T = window.T2D;
const model = createModel({ scale: { get on() { return T.scaleOn; }, get root() { return T.scaleRoot; }, snap: (s) => T.snapSemi(s) } });
const engine = createEngine(T, model);                  // worklet нет — обычные узлы
const view = createView(T, model, engine);
model.listen(engine.on);
engine.listen(view.heard);
const S = model.state, { isles, luna, echo, buoy, fog, pharos, fx, seq } = S;

let last = 0;
T.registerWorld(13, {
  n: 'XIII', title: 'Portus', sub: 'pharos · echo · nebula', theme: view.theme, corner: view.corner, fx: view.fx, legend: view.legend,
  build: engine.build,
  tick(now) { model.tick(last ? (now - last) / 1000 : 0); last = now; view.tick(now); engine.poll(now); },
  draw: view.draw, down: view.down, move: view.move, up: view.up,
  dice: model.dice, clear: model.clear, snapshot: model.snapshot, restore: model.restore, sounding: model.sounding,
  tempo: { get: () => seq.bpm, set: (bpm) => model.setBpm(bpm), play: (on) => model.play(on), playing: () => seq.playing, min: 60, max: 180 },
  mapShot: view.mapShot,
});
const G = () => geo(T, S);
window.t2d.portus = {
  isles, get steps() { return isles.map((i) => i.step); }, luna, echo, buoy, fog, pharos, fx, seq, geo: G, play: (on) => model.play(on), setFx: (k, v) => view.fx.set(k, v), get live() { return engine.live; }, hz: model.hzOf, name: model.nameOf, fc: model.fcOf, fb: model.fbOf,
  sea: (u, d) => P(G(), u, d), col: (i, p) => slotPt(G(), i, p), lantern: (i) => { const g = G(), m = markPt(g, i); return { x: m.x, y: m.y - (10 + 14 * m.s) }; }, sky: () => { const g = G(); return { x: g.cx + g.Ws * 0.2, y: (g.top + g.fogTop) / 2 }; }, kill: () => view.kill(0, 0), get killed() { return view.killed; }, buoyAt: () => { const g = G(), B = P(g, buoy.u, buoy.d); return { x: B.x, y: B.y - 8 }; },
  get stepNow() { return engine.step; }, apply: engine.apply, model,
};
