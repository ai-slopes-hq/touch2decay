// Monochordum — фасад модели. Сама модель живёт в ядре (core/worlds/monochord → t2d.wasm, узел t2d-worklet.js хоста, слот 7), здесь —
// её зеркало и действия касаний. API — прежней JS-модели (эталон — tools/ref/monochord-model.js), без DOM, холста и Web Audio:
// state.str — четыре живые струны (view держит ссылки), правятся на месте из зеркала; fx, auto, wind — так же.
// Действия применяются к state сразу и уходят в ядро через send (порт узла ядра, асинхронно; send → номер сообщения). Зеркало (sync)
// приходит ~60 раз в секунду с числом уже применённых ядром сообщений: поле, которое здесь правили, а ядро ещё не видело, зеркало не
// перетирает (как фасады Firmamentum и Goetia). Энергия струн и флажолетов (en, eh, hn) — только из зеркала: её считает звук ядра.
// Кубик — здесь (алгоритм эталона на rng) и в ядро действиями; restore — одним сообщением. Шаги автострама ставит ядро (sdk::Steps):
// autoStep / stepDur / swingAt / perBeat здесь — тот же алгоритм для тестов и подсказок, звук от них не зависит.
// События listen — как у прежней модели: 'tune' {i}, 'pluck', 'harm', 'bow', 'sus', 'wind', 'auto', 'fx'.
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const N = 4, F_OPEN = [55, 82.5, 110, 165];      // открытые струны: A1, E2, A2, E3 — квинты и октавы
// пифагоровы лады (доля звучащей длины) и сферы Фладда: нижняя октава — Terra…Sol, верхняя — до Эмпирея
export const MARKS = [
  [1, 'Terra'], [8 / 9, 'Aqua'], [64 / 81, 'Aer'], [3 / 4, 'Ignis'], [2 / 3, 'Luna'], [16 / 27, 'Mercurius'], [128 / 243, 'Venus'], [1 / 2, 'Sol'],
  [4 / 9, 'Mars'], [32 / 81, 'Iuppiter'], [3 / 8, 'Saturnus'], [1 / 3, 'Stellae'], [8 / 27, 'Crystallinum'], [1 / 4, 'Empyreum'],
];
export const NODES = [[1 / 2, 2], [1 / 3, 3], [2 / 3, 3], [1 / 4, 4], [3 / 4, 4]];   // узлы флажолетов на звучащей части
export const DIVS = [[1, '1/4'], [2, '1/8'], [3, '1/8T'], [4, '1/16']], PATTERNS = ['down', 'down-up', 'arpeggio', 'random'];
export const FX_DEF = { decay: 0.55, bright: 0.55, body: 0.4, sympathy: 0.4, chorus: 0, chance: 1, hall: 0.35 };
const STR_KEYS = ['r', 'sus', 'bright', 'decay', 'level'], AUTO_KEYS = ['on', 'bpm', 'div', 'pattern', 'strength', 'swing'];   // что в снимке

// ядро: слот мира в хосте, коды action, ключи, раскладка зеркала — core/worlds/monochord/world.hpp
export const SLOT = 7;
export const ACT = { pluck: 0, harm: 1, bow: 2, sus: 3, bridge: 4, string: 5, wind: 6, fx: 7, auto: 8, autopar: 9, clear: 10 };
export const FX_KEYS = Object.keys(FX_DEF), SET_KEYS = ['pitch', 'bright', 'decay', 'level', 'r'];
export const MSTR = ['r', 'sus', 'bright', 'decay', 'level', 'bow', 'en', 'eh', 'hn'];   // струна в зеркале
export const HEAD = FX_KEYS.length + 2 + AUTO_KEYS.length + 1;   // fx, wind, lastWind, auto, шаг
const OWN = ['r', 'sus', 'bright', 'decay', 'level', 'bow'];     // поля струны, которые правит фасад

export function createModel({ scale = { on: false, root: 0, snap: (s) => s }, rng = Math.random, send = () => 0 } = {}) {
  // струна: r — доля звучащей длины 1…1/4; en, eh, hn — что слышно (энергия струны, флажолета и его номер — из ядра)
  const str = F_OPEN.map((f, i) => ({ r: [1, 2 / 3, 1 / 2, 1 / 3][i], sus: false, bright: 0.55, decay: 0.55, level: 0.8, en: 0, bow: 0, eh: 0, hn: 2 }));
  const fx = { ...FX_DEF };
  const auto = { on: false, bpm: 90, div: 1, pattern: 1, strength: 0.6, swing: 0 };
  const state = { str, fx, auto, wind: 0, lastWind: 0.5, time: 0, step: 0 };   // ветер — часть патча (корзина глушит), не FX; step — шаг автострама (ядро)
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };
  let post = send;
  const strAt = [0, 0, 0, 0];                           // номер последнего сообщения, правившего струну / fx / ветер / автострам
  let fxAt = 0, windAt = 0, autoAt = 0, wipe = 0;
  const act = (kind, i = 0, a = []) => post({ t: 'action', slot: SLOT, kind, i, a });

  const tonic = () => (scale.on ? 2 ** (scale.root / 12) : 1);
  const hzOf = (i) => (F_OPEN[i] * tonic()) / str[i].r;
  function snapR(r) {                                   // с ладом — к ступеням лада; без — прилипает к пифагоровым ладам
    if (scale.on) { const s0 = -12 * Math.log2(r), s = scale.snap(Math.round(s0)); return clamp(2 ** (-s / 12), 0.25, 1); }
    for (const [m] of MARKS) if (Math.abs(Math.log2(r / m)) < 0.025) return m;
    return r;
  }

  // ---------- струны ----------
  function pluck(i, pos, vel = 0.9) { act(ACT.pluck, i, [pos, vel]); emit({ t: 'pluck', i, pos, vel }); }
  function harm(i, n, vel = 0.9) { act(ACT.harm, i, [n, vel]); emit({ t: 'harm', i, n, vel }); }   // флажолет: n — номер узла
  function bow(i, amp) { str[i].bow = amp; strAt[i] = act(ACT.bow, i, [amp]); emit({ t: 'bow', i, amp }); }
  function setSus(i, on) { str[i].sus = on; strAt[i] = act(ACT.sus, i, [on ? 1 : 0]); emit({ t: 'sus', i, on }); }
  const toggleSus = (i) => setSus(i, !str[i].sus);      // двойной тап — струна поёт сама (Эолова)
  function setBridge(i, r) { str[i].r = snapR(r); strAt[i] = act(ACT.string, i, [SET_KEYS.indexOf('r'), str[i].r]); emit({ t: 'tune', i }); }   // прилипание — здесь, в ядро — как есть
  function setString(i, k, v) {                        // плашка: pitch — r без прилипания
    if (k === 'pitch') str[i].r = clamp(2 ** (-2 * v), 0.25, 1); else str[i][k] = v;
    strAt[i] = act(ACT.string, i, [SET_KEYS.indexOf(k), v]);
    emit({ t: 'tune', i });
  }
  function meter() {}                                   // энергия — из зеркала (sync); оставлено для прежних вызовов

  // ---------- ветер, FX ----------
  function setWind(v) { state.wind = clamp(v); if (state.wind > 0.01) state.lastWind = state.wind; windAt = act(ACT.wind, 0, [state.wind]); emit({ t: 'wind', amt: state.wind }); }
  const toggleWind = () => setWind(state.wind > 0.01 ? 0 : state.lastWind);
  function setFx(k, v) { const i = FX_KEYS.indexOf(k); if (i < 0) return; fx[k] = v; fxAt = act(ACT.fx, i, [v]); emit({ t: 'fx' }); }
  function loadFx(o) { for (const [k, v] of Object.entries(o || {})) { const i = FX_KEYS.indexOf(k); if (i >= 0) { fx[k] = v; fxAt = act(ACT.fx, i, [v]); } } emit({ t: 'fx' }); }

  // ---------- автострам: Земля вращается в темпе, её горы задевают струны (шаги — в ядре) ----------
  function setAuto(on) { auto.on = on; autoAt = act(ACT.auto, 0, [on ? 1 : 0]); emit({ t: 'auto', on }); }
  function setAutoPar(k, v) { const i = AUTO_KEYS.indexOf(k); if (i <= 0) return; auto[k] = v; autoAt = act(ACT.autopar, i, [v]); }
  const setBpm = (bpm) => setAutoPar('bpm', bpm);
  const stepSec = () => 60 / auto.bpm / DIVS[auto.div][0];
  const stepDur = (step) => stepSec() * (step % 2 === 0 ? 1 + auto.swing * 0.5 : 1 - auto.swing * 0.5);   // swing: чётные длиннее
  const perBeat = () => DIVS[auto.div][0];
  const swingAt = (step) => (step % 2 ? auto.swing * 0.5 * stepSec() : 0);
  function autoStep(step) {                             // тот же алгоритм, что в ядре (Model::autoStep); null — шаг пропущен (chance)
    if (!(rng() < fx.chance)) return null;
    const p = auto.pattern, up = p === 1 && step % 2 === 1, acc = step % (DIVS[auto.div][0] * 4) === 0 ? 1.15 : 1, vel = clamp(auto.strength * acc, 0.15, 1);
    let order = up ? [3, 2, 1, 0] : [0, 1, 2, 3];
    if (p === 2) order = [step % 4];
    if (p === 3) order = [0, 1, 2, 3].filter(() => rng() < 0.55);
    const gap = 0.006 + 0.018 * (1 - auto.strength);
    return order.map((i, k) => ({ i, pos: 0.12 + 0.1 * rng(), vel: vel * (0.85 + 0.15 * rng()), dt: k * gap }));
  }

  // ---------- патч ----------
  const sounding = () => state.wind > 0.01 || auto.on || str.some((s) => s.sus || s.bow > 0);
  function dice() {                                     // подставки — на пифагоровы лады, одна-две струны поют сами
    const R = rng, pick = [1, 3 / 4, 2 / 3, 1 / 2, 4 / 9, 3 / 8, 1 / 3, 8 / 9];
    str.forEach((s, i) => {
      s.r = scale.on ? snapR(pick[Math.floor(R() * pick.length)]) : pick[Math.floor(R() * pick.length)]; s.sus = R() < 0.4;
      act(ACT.string, i, [SET_KEYS.indexOf('r'), s.r]); strAt[i] = act(ACT.sus, i, [s.sus ? 1 : 0]);
      emit({ t: 'tune', i }); emit({ t: 'sus', i, on: s.sus });
    });
    setWind(R() < 0.3 ? 0.15 + 0.35 * R() : 0);
  }
  function clear() {
    str.forEach((s, i) => { s.sus = false; s.bow = 0; emit({ t: 'sus', i, on: false }); emit({ t: 'bow', i, amp: 0 }); });
    state.wind = 0; auto.on = false;
    wipe = act(ACT.clear); strAt.fill(wipe); windAt = autoAt = wipe;
    emit({ t: 'wind', amt: 0 }); emit({ t: 'auto', on: false });
  }
  const snapshot = () => JSON.stringify({ str: str.map((s) => Object.fromEntries(STR_KEYS.map((k) => [k, s[k]]))), fx, wind: state.wind, auto: Object.fromEntries(AUTO_KEYS.map((k) => [k, auto[k]])) });
  function restore(js) {                                // как прежняя модель — здесь; в ядро — одним restore
    const st = JSON.parse(js);
    st.str.forEach((q, i) => { if (str[i]) { Object.assign(str[i], q); emit({ t: 'sus', i, on: q.sus }); } });
    Object.assign(fx, st.fx); emit({ t: 'fx' });
    state.wind = clamp(st.wind || 0); if (state.wind > 0.01) state.lastWind = state.wind; emit({ t: 'wind', amt: state.wind });
    if (st.auto) { const on = st.auto.on; Object.assign(auto, st.auto); auto.on = on; emit({ t: 'auto', on }); }
    wipe = post({ t: 'restore', slot: SLOT, js });
    strAt.fill(wipe); fxAt = windAt = autoAt = wipe;
  }

  function sync(m, applied) {                           // зеркало ядра → state; applied — сколько сообщений ядро уже применило
    let o = 0;
    if (applied >= fxAt) { let ch = false; FX_KEYS.forEach((k, i) => { if (fx[k] !== m[i]) { fx[k] = m[i]; ch = true; } }); if (ch) emit({ t: 'fx' }); }
    o = FX_KEYS.length;
    if (applied >= windAt) { state.wind = m[o]; state.lastWind = m[o + 1]; }
    o += 2;
    if (applied >= autoAt) AUTO_KEYS.forEach((k, i) => { auto[k] = k === 'on' ? m[o + i] !== 0 : m[o + i]; });
    o += AUTO_KEYS.length;
    state.step = m[o++];
    for (let i = 0; i < N; i++, o += MSTR.length) {
      const s = str[i];
      if (applied >= strAt[i] && applied >= wipe) {
        const was = s.r;
        for (const [j, k] of MSTR.entries()) if (OWN.includes(k)) s[k] = k === 'sus' ? m[o + j] !== 0 : m[o + j];
        if (s.r !== was) emit({ t: 'tune', i });
      }
      s.en = m[o + 6]; s.eh = m[o + 7]; s.hn = m[o + 8];
    }
  }
  function bind(fn) {                                   // новый узел ядра (новый контекст): счёт сообщений — заново, сцена — туда целиком
    post = fn;
    wipe = post({ t: 'restore', slot: SLOT, js: snapshot() });
    strAt.fill(wipe); fxAt = windAt = autoAt = wipe;
  }

  return {
    state, hzOf, snapR, stepDur, perBeat, swingAt, autoStep,
    pluck, harm, bow, setSus, toggleSus, setBridge, setString, meter, setWind, toggleWind, setFx, loadFx, setAuto, setBpm, setAutoPar,
    dice, clear, snapshot, restore, sounding,
    tick(dt) { state.time += dt; },                     // своего времени у струн нет: шаги автострама — в ядре
    listen(fn) { listeners.push(fn); },
    sync, bind,
  };
}
