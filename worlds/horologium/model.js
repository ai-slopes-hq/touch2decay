// Horologium — фасад модели. Кольца, fx, ход часов (успокоение u к uT), колесо и замок к такту MIDI живут в ядре (core/worlds/horologium →
// t2d.wasm, слот 9); здесь — их зеркало, действия касаний и маятник. Маятник — касание и картинка (где груз, энергия броска, проход через
// низ, качание по скорости хода): в ядро уходят итоги — пуск / стоп и u, «в руке», спуск на 1/Z оборота, шкала tempus.
// API — прежней JS-модели (эталон — tools/ref/horologium-model.js), без DOM, холста и Web Audio. Действия — сразу в state и в ядро (send →
// номер сообщения); зеркало ~60/с с числом применённых сообщений не перетирает то, что здесь правили, а ядро ещё не видело. Колесо (P, F,
// удары) — state.wheel, из зеркала. События listen — как у прежней модели: 'all', 'rings', 'speed', 'step', 'fx', 'wake'.
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
export const NR = 8, Z = 4;                             // кольца II…IX; спуск: четыре прохода маятника за оборот
export const MAGIC = [[2, 3], [3, 4], [4, 5, 6], [3, 4, 5], [2, 3, 5], [4, 5, 6, 7], [5, 7, 9], [6, 7, 8, 9], [8, 9], [2, 3, 4, 5, 6], [5, 6], [4, 5]];
export const NAMES = [[[1, 2], 'diapason'], [[2, 3], 'diapente'], [[3, 4], 'diatessaron'], [[4, 5], 'ditonus'], [[5, 6], 'semiditonus'], [[8, 9], 'tonus'], [[4, 5, 6], 'trias harmonica'], [[10, 12, 15], 'trias mollis'], [[4, 5, 6, 7], 'septima naturalis'], [[3, 4, 5], 'trias harmonica'], [[2, 3, 4], 'diapente · diapason']];
export const ET = 0.0447, OM0 = TAU * 0.8;              // энергия маятника на темпе (размах 0.3 рад); его собственная частота
export const uOfE = (e) => clamp(0.9 * Math.log2(e / ET), -3, 8);
export const eOfU = (u) => ET * 2 ** (u / 0.9);
export const noteName = (f) => { const m = Math.round(12 * Math.log2(f / 55)); return `${NOTES[((m % 12) + 12) % 12]}${Math.floor((m + 9) / 12) + 1}`; };

// ядро: слот, коды action, ключи, раскладка зеркала — core/worlds/horologium/world.hpp
export const SLOT = 9;
export const ACT = { ring: 0, fx: 1, run: 2, held: 3, step: 4, bpm: 5, speed: 6, clear: 7 };
export const FX_KEYS = ['aequalis', 'materia', 'concursus', 'chance', 'hall'], RING_KEYS = ['on', 'under', 'phi', 'lvl'];
export const HEAD = FX_KEYS.length + 10, M = { run: 5, u: 6, uT: 7, bpm: 8, strip: 9, held: 10, P: 11, F: 12, strikes: 13, locked: 14 };

export function createModel({ scale = { on: false, root: 0 }, rng = Math.random, send = () => 0 } = {}) {
  const rings = Array.from({ length: NR }, (_, i) => ({ n: i + 2, on: [4, 5, 6].includes(i + 2), under: false, phi: 0, lvl: 0.8 }));
  const fx = { aequalis: 0, materia: 0.35, concursus: 0.4, chance: 1, hall: 0.35 };
  const clock = { run: false, u: 0, uT: 0, bpm: 100, strip: false };   // u — во сколько октав быстрее темпа (оборот колеса = такт); uT — куда успокаивается
  const pend = { th: 0, ph: 0, spin: false, held: false };
  const wheel = { P: 0, F: 0, strikes: 0, locked: false };   // колесо — из зеркала ядра
  const state = { rings, fx, clock, pend, wheel };
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };
  let post = send, handSteps = 0, fxAt = 0, clockAt = 0, wipe = 0;
  const ringAt = new Array(NR).fill(0);
  const act = (kind, i = 0, a = []) => post({ t: 'action', slot: SLOT, kind, i, a });
  const sendRing = (i) => { const r = rings[i]; RING_KEYS.forEach((k, j) => { ringAt[i] = act(ACT.ring, i, [j, typeof r[k] === 'boolean' ? (r[k] ? 1 : 0) : r[k]]); }); };
  const sendRun = () => { clockAt = act(ACT.run, 0, [clock.run ? 1 : 0, clock.u]); };
  const sendSpeed = () => { clockAt = act(ACT.speed, 0, [clock.u, clock.uT, clock.strip ? 1 : 0]); };

  const Ft = () => clock.bpm / 240;
  const Fnow = () => (clock.run && !pend.held ? Ft() * 2 ** clock.u : 0);
  const mOf = (r) => { const m = r.under ? 12 / r.n : r.n; if (fx.aequalis <= 0) return m; const et = 2 ** (Math.round(12 * Math.log2(m)) / 12); return m * (et / m) ** fx.aequalis; };
  const baseB = () => 55 * 2 ** ((scale.on ? scale.root : 0) / 12);
  const sounding = () => (clock.run || pend.held) && rings.some((r) => r.on);
  function sendAll() { emit({ t: 'all' }); }            // прежний API: всё разом (в ядро всё уходит действиями сразу)

  // ---------- кольца ----------
  function toggleRing(i) { const r = rings[i]; r.on = !r.on; sendRing(i); sendAll(); if (r.on) emit({ t: 'wake' }); }
  function toggleUnder(i) { const r = rings[i]; r.under = !r.under; r.on = true; sendRing(i); sendAll(); emit({ t: 'wake' }); }   // двойной тап — унтертон
  function setPhase(i, phi) { rings[i].phi = phi; ringAt[i] = act(ACT.ring, i, [2, phi]); emit({ t: 'rings' }); }   // вдоль кольца — фаза
  function setRing(i, k, v) { const r = rings[i]; if (k === 'on' || k === 'under') r[k] = v >= 0.5; else r[k] = v; sendRing(i); sendAll(); }   // плашка кольца
  function setFx(k, v) { const i = FX_KEYS.indexOf(k); if (i < 0) return; fx[k] = v; fxAt = act(ACT.fx, i, [v]); emit({ t: 'fx' }); }
  function loadFx(o) { for (const [k, v] of Object.entries(o || {})) { const i = FX_KEYS.indexOf(k); if (i >= 0) { fx[k] = v; fxAt = act(ACT.fx, i, [v]); } } emit({ t: 'fx' }); }

  // ---------- маятник и ход ----------
  function setRun(on, u = clock.uT) { clock.run = on; clock.u = u; sendRun(); if (on) { emit({ t: 'wake' }); const A = Math.acos(1 - Math.min(1.9, eOfU(u))); pend.ph = Math.asin(clamp(pend.th / A, -1, 1)); } }
  const stop = () => { clock.run = false; sendRun(); };
  const setBpm = (bpm) => { clock.bpm = bpm; clockAt = act(ACT.bpm, 0, [bpm]); };
  const setHeld = (on) => { pend.held = on; act(ACT.held, 0, [on ? 1 : 0]); };
  function grab(th) { setHeld(true); pend.spin = false; pend.th = th; emit({ t: 'speed', F: 0 }); emit({ t: 'wake' }); }   // схватил маятник — колесо стоит
  function swing(prev, th) {                              // ведёшь маятник: каждый проход через низ — спуск, колесо на 1/Z оборота
    if (Math.sign(th) !== Math.sign(prev) && Math.abs(th) < Math.PI / 2 && Math.abs(prev) < Math.PI / 2) { act(ACT.step, 0, [1 / Z]); emit({ t: 'step', d: 1 / Z }); handSteps++; }
    pend.th = th;
  }
  function tapPendulum(was) { setHeld(false); if (was) stop(); else setRun(true); }   // тап — пуск / стоп
  function release(th, om) {                               // отпустил маятник: энергия броска → скорость хода
    const e = (om / OM0) ** 2 / 2 + (1 - Math.cos(th));
    setHeld(false);
    if (e < ET / 6 || (Math.abs(om) < 0.3 && Math.abs(th) < 0.45)) { stop(); return; }   // поймал и отпустил у низа — стоп; поднял повыше и отпустил — пошёл
    clock.run = true; clock.u = uOfE(e); sendRun(); emit({ t: 'wake' });
    pend.spin = e >= 1.95;
    if (!pend.spin) { const A = Math.acos(1 - e); pend.ph = om >= 0 ? Math.asin(clamp(th / A, -1, 1)) : Math.PI - Math.asin(clamp(th / A, -1, 1)); }
  }
  function holdStrip(u) { clock.strip = true; clock.uT = clock.u = clamp(u, -8, 8.5); if (!clock.run) setRun(true, clock.u); sendSpeed(); }   // палец на шкале tempus — скорость
  function dragStrip(u) { clock.uT = clock.u = clamp(u, -8, 8.5); sendSpeed(); }
  function freeStrip() { clock.strip = false; sendSpeed(); }
  function resetSpeed() { clock.uT = 0; clock.u = 0; sendSpeed(); }   // двойной тап по шкале — назад к темпу
  function tickPendulum(dt) {                              // только картинка: ход (u) успокаивает ядро
    if (clock.run && !pend.held) {
      const e = eOfU(clock.u), F = Fnow();
      if (e < 1.95) {
        const A = Math.acos(1 - e);
        if (pend.spin) { pend.spin = false; pend.ph = Math.asin(clamp(Math.sin(pend.th) / A, -1, 1)); }
        pend.ph += TAU * (Z * F / 2) * dt; pend.th = A * Math.sin(pend.ph);
      } else { pend.spin = true; pend.th = ((pend.th + TAU * Z * F * dt / 2 + Math.PI) % TAU + TAU) % TAU - Math.PI; }
    } else if (!pend.held) { pend.th *= Math.exp(-dt * 3); }   // стоит — повисает отвесно
  }

  // ---------- что звучит: отношение и его имя ----------
  function ratio(F) {                                     // F — скорость колеса (из зеркала)
    const act2 = rings.filter((r) => r.on);
    if (!act2.length) return { a: 'quies', b: 'tap a ring' };
    const a = act2.map((r) => (r.under ? `1/${ROMAN[r.n]}` : ROMAN[r.n])).join(' : ');
    const ms = act2.map((r) => (r.under ? 12 / r.n : r.n)).sort((x, y) => x - y);
    let name = '';
    for (const [set, nm] of NAMES) if (set.length === ms.length && set.every((v, k) => Math.abs(v / set[0] - ms[k] / ms[0]) < 1e-6)) { name = nm; break; }
    const tone = F * ms[0] >= 20;
    const b = tone ? `tonus${name ? ` — ${name}` : ''} · ${ms.map((m) => noteName(m * F)).join(' ')}` : `rhythmus · ${ms.map((m) => +m.toFixed(2)).join(' · ')} ictus in circuitu${name ? ` · ${name}` : ''}`;
    return { a, b };
  }

  // ---------- патч ----------
  const scene = () => JSON.stringify({ r: rings.map(({ on, under, phi, lvl }) => ({ on, under, phi, lvl })), fx, bpm: clock.bpm, run: clock.run, u: clock.u, uT: clock.uT });
  function sendScene() { wipe = fxAt = clockAt = post({ t: 'restore', slot: SLOT, js: scene() }); ringAt.fill(wipe); }
  function dice() {                                       // волшебное отношение, иногда — унтертонами; фаза — у одного кольца; часы идут
    const R = rng, set = MAGIC[Math.floor(R() * MAGIC.length)], under = R() < 0.25;
    rings.forEach((r) => { r.on = set.includes(r.n); r.under = under; r.phi = 0; r.lvl = 0.8; });
    if (R() < 0.4) { const on = rings.filter((r) => r.on); on[Math.floor(R() * on.length)].phi = [0.25, 0.5, 0.75][Math.floor(R() * 3)]; }
    fx.materia = R(); clock.uT = 0; clock.run = true; clock.u = 0;
    sendScene();
    emit({ t: 'fx' }); sendAll(); emit({ t: 'wake' });
    const A = Math.acos(1 - Math.min(1.9, eOfU(0))); pend.ph = Math.asin(clamp(pend.th / A, -1, 1));
  }
  function clear() { for (const r of rings) r.on = false; clock.run = false; wipe = act(ACT.clear); ringAt.fill(wipe); clockAt = wipe; sendAll(); }
  const snapshot = scene;
  function restore(js) {
    const st = JSON.parse(js);
    if (!st.r) return;                                   // снимок старого Horologium — не наш
    st.r.forEach((q, i) => Object.assign(rings[i], q));
    Object.assign(fx, st.fx); clock.bpm = st.bpm; clock.run = st.run; clock.u = st.u || 0; clock.uT = st.uT || 0;
    sendScene(); emit({ t: 'fx' }); sendAll();
  }

  function sync(m, applied) {                           // зеркало ядра → state; applied — сколько сообщений ядро уже применило
    if (applied >= fxAt) { let ch = false; FX_KEYS.forEach((k, i) => { if (fx[k] !== m[i]) { fx[k] = m[i]; ch = true; } }); if (ch) emit({ t: 'fx' }); }
    if (applied >= clockAt) { clock.run = m[M.run] !== 0; clock.u = m[M.u]; clock.uT = m[M.uT]; clock.bpm = m[M.bpm]; clock.strip = m[M.strip] !== 0; }
    wheel.P = m[M.P]; wheel.F = m[M.F]; wheel.strikes = m[M.strikes]; wheel.locked = m[M.locked] !== 0;
    let ch = false;
    for (let i = 0; i < NR; i++) {
      if (applied < ringAt[i] || applied < wipe) continue;
      const r = rings[i], o = HEAD + i * RING_KEYS.length;
      const on = m[o] !== 0, under = m[o + 1] !== 0;
      if (r.on !== on || r.under !== under || r.phi !== m[o + 2] || r.lvl !== m[o + 3]) { r.on = on; r.under = under; r.phi = m[o + 2]; r.lvl = m[o + 3]; ch = true; }
    }
    if (ch) emit({ t: 'rings' });
  }
  function bind(fn) { post = fn; sendScene(); act(ACT.held, 0, [pend.held ? 1 : 0]); }   // новый узел ядра: сцена целиком

  return {
    state, Ft, Fnow, mOf, baseB, ratio, sounding, sendAll,
    toggleRing, toggleUnder, setPhase, setRing, setFx, loadFx,
    setRun, stop, setBpm, grab, swing, tapPendulum, release, holdStrip, dragStrip, freeStrip, resetSpeed,
    dice, clear, snapshot, restore,
    get handSteps() { return handSteps; },
    tick(dt) { tickPendulum(dt); },
    listen(fn) { listeners.push(fn); },
    sync, bind,
  };
}
