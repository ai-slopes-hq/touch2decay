// Monochordum — модель: четыре струны с подставками, ветер, автострам Земли. Только данные и алгоритм — без DOM, холста и Web Audio.
// Время — секунды (tick(dt)), случайность — rng, лад — scale { on, root, snap }. Что должно прозвучать — события слушателям (listen):
// 'tune' {i} — высота и тембр струны, 'pluck' {i, pos, vel}, 'harm' {i, n, vel}, 'bow' {i, amp}, 'sus' {i, on}, 'wind' {amt}, 'auto' {on}, 'fx'.
// Автострам: модель говорит, что играет шаг (autoStep) и сколько он длится (stepDur); часы (ctx.currentTime) — в engine.
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

export function createModel({ scale = { on: false, root: 0, snap: (s) => s }, rng = Math.random } = {}) {
  // струна: r — доля звучащей длины 1…1/4; en, eh, hn — что слышно (энергия струны, флажолета и его номер; пишет engine через meter)
  const str = F_OPEN.map((f, i) => ({ r: [1, 2 / 3, 1 / 2, 1 / 3][i], sus: false, bright: 0.55, decay: 0.55, level: 0.8, en: 0, bow: 0, eh: 0, hn: 2 }));
  const fx = { ...FX_DEF };
  const auto = { on: false, bpm: 90, div: 1, pattern: 1, strength: 0.6, swing: 0 };
  const state = { str, fx, auto, wind: 0, lastWind: 0.5, time: 0 };   // ветер — часть патча (корзина глушит), не FX: роза ветров слева
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };

  const tonic = () => (scale.on ? 2 ** (scale.root / 12) : 1);
  const hzOf = (i) => (F_OPEN[i] * tonic()) / str[i].r;
  function snapR(r) {                                   // с ладом — к ступеням лада; без — прилипает к пифагоровым ладам
    if (scale.on) { const s0 = -12 * Math.log2(r), s = scale.snap(Math.round(s0)); return clamp(2 ** (-s / 12), 0.25, 1); }
    for (const [m] of MARKS) if (Math.abs(Math.log2(r / m)) < 0.025) return m;
    return r;
  }

  // ---------- струны ----------
  const pluck = (i, pos, vel = 0.9) => emit({ t: 'pluck', i, pos, vel });
  const harm = (i, n, vel = 0.9) => emit({ t: 'harm', i, n, vel });   // флажолет: n — номер узла
  function bow(i, amp) { str[i].bow = amp; emit({ t: 'bow', i, amp }); }
  function setSus(i, on) { str[i].sus = on; emit({ t: 'sus', i, on }); }
  const toggleSus = (i) => setSus(i, !str[i].sus);      // двойной тап — струна поёт сама (Эолова)
  function setBridge(i, r) { str[i].r = snapR(r); emit({ t: 'tune', i }); }   // подставка: прилипает к ладам
  function setString(i, k, v) { if (k === 'pitch') str[i].r = clamp(2 ** (-2 * v), 0.25, 1); else str[i][k] = v; emit({ t: 'tune', i }); }   // плашка: pitch — r без прилипания
  function meter(e, h, n) { e.forEach((v, i) => { str[i].en = v; str[i].eh = h[i]; if (n) str[i].hn = n[i]; }); }   // что слышно — из worklet

  // ---------- ветер, FX ----------
  function setWind(v) { state.wind = clamp(v); if (state.wind > 0.01) state.lastWind = state.wind; emit({ t: 'wind', amt: state.wind }); }
  const toggleWind = () => setWind(state.wind > 0.01 ? 0 : state.lastWind);
  function setFx(k, v) { fx[k] = v; emit({ t: 'fx' }); }
  function loadFx(o) { Object.assign(fx, o); emit({ t: 'fx' }); }

  // ---------- автострам: Земля вращается в темпе, её горы задевают струны ----------
  function setAuto(on) { auto.on = on; emit({ t: 'auto', on }); }   // engine заводит часы с начала
  const setBpm = (bpm) => { auto.bpm = bpm; };
  const setAutoPar = (k, v) => { auto[k] = v; };          // div, pattern, strength, swing — читаются на каждом шаге
  const stepSec = () => 60 / auto.bpm / DIVS[auto.div][0];
  const stepDur = (step) => stepSec() * (step % 2 === 0 ? 1 + auto.swing * 0.5 : 1 - auto.swing * 0.5);   // swing: чётные длиннее
  function autoStep(step) {                             // одно касание Земли: струны по очереди, с промежутком; null — шаг пропущен (chance)
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
    str.forEach((s, i) => { s.r = scale.on ? snapR(pick[Math.floor(R() * pick.length)]) : pick[Math.floor(R() * pick.length)]; s.sus = R() < 0.4; emit({ t: 'tune', i }); emit({ t: 'sus', i, on: s.sus }); });
    setWind(R() < 0.3 ? 0.15 + 0.35 * R() : 0);
  }
  function clear() { str.forEach((s, i) => { s.sus = false; s.bow = 0; emit({ t: 'sus', i, on: false }); emit({ t: 'bow', i, amp: 0 }); }); setWind(0); setAuto(false); }
  const snapshot = () => JSON.stringify({ str: str.map((s) => Object.fromEntries(STR_KEYS.map((k) => [k, s[k]]))), fx, wind: state.wind, auto: Object.fromEntries(AUTO_KEYS.map((k) => [k, auto[k]])) });
  function restore(js) {
    const st = JSON.parse(js);
    st.str.forEach((q, i) => { Object.assign(str[i], q); emit({ t: 'sus', i, on: q.sus }); });
    loadFx(st.fx); setWind(st.wind || 0);
    if (st.auto) { const on = st.auto.on; Object.assign(auto, st.auto); setAuto(on); }
  }

  return {
    state, hzOf, snapR, stepDur, autoStep,
    pluck, harm, bow, setSus, toggleSus, setBridge, setString, meter, setWind, toggleWind, setFx, loadFx, setAuto, setBpm, setAutoPar,
    dice, clear, snapshot, restore, sounding,
    tick(dt) { state.time += dt; },                     // своего времени у струн нет: часы автострама — в engine
    listen(fn) { listeners.push(fn); },
  };
}
