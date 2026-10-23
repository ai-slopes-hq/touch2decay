// Horologium — модель: кольца II…IX, fx, ход часов clock и маятник pend с его физикой. Только данные и алгоритм — без DOM, холста и Web Audio.
// Время — секунды (tick(dt)), случайность — rng, лад — scale { on, root }. Колесо (положение P и скорость F) крутится в horo-worklet.js:
// модель говорит, с какой скоростью ему идти. События слушателям (listen): 'all' — кольца, тоника и скорость; 'rings' — только кольца;
// 'speed' {F, B} — скорость (и тоника; B нет — только скорость); 'step' {d} — спуск руками, колесо на d оборота; 'fx'; 'wake' — звук пошёл.
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

export function createModel({ scale = { on: false, root: 0 }, rng = Math.random } = {}) {
  const rings = Array.from({ length: NR }, (_, i) => ({ n: i + 2, on: [4, 5, 6].includes(i + 2), under: false, phi: 0, lvl: 0.8 }));
  const fx = { aequalis: 0, materia: 0.35, concursus: 0.4, chance: 1, hall: 0.35 };
  const clock = { run: false, u: 0, uT: 0, bpm: 100, strip: false };   // u — во сколько октав быстрее темпа (оборот колеса = такт); uT — куда успокаивается (шкала tempus)
  const pend = { th: 0, ph: 0, spin: false, held: false };
  const state = { rings, fx, clock, pend };
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };
  let sentF = -1, sentB = -1, handSteps = 0;              // что последним ушло в worklet: скорость и тоника

  const Ft = () => clock.bpm / 240;
  const Fnow = () => (clock.run && !pend.held ? Ft() * 2 ** clock.u : 0);
  const mOf = (r) => { const m = r.under ? 12 / r.n : r.n; if (fx.aequalis <= 0) return m; const et = 2 ** (Math.round(12 * Math.log2(m)) / 12); return m * (et / m) ** fx.aequalis; };
  const baseB = () => 55 * 2 ** ((scale.on ? scale.root : 0) / 12);
  const sounding = () => (clock.run || pend.held) && rings.some((r) => r.on);
  function sendAll() { sentF = Fnow(); sentB = baseB(); emit({ t: 'all' }); }   // кольца, тоника, скорость — всё разом

  // ---------- кольца ----------
  function toggleRing(i) { const r = rings[i]; r.on = !r.on; sendAll(); if (r.on) emit({ t: 'wake' }); }
  function toggleUnder(i) { const r = rings[i]; r.under = !r.under; r.on = true; sendAll(); emit({ t: 'wake' }); }   // двойной тап — унтертон
  function setPhase(i, phi) { rings[i].phi = phi; emit({ t: 'rings' }); }   // вдоль кольца — фаза
  function setRing(i, k, v) { const r = rings[i]; if (k === 'on' || k === 'under') r[k] = v >= 0.5; else r[k] = v; sendAll(); }   // плашка кольца
  function setFx(k, v) { fx[k] = v; emit({ t: 'fx' }); }
  function loadFx(o) { Object.assign(fx, o); emit({ t: 'fx' }); }

  // ---------- маятник и ход ----------
  function setRun(on, u = clock.uT) { clock.run = on; clock.u = u; if (on) { emit({ t: 'wake' }); const A = Math.acos(1 - Math.min(1.9, eOfU(u))); pend.ph = Math.asin(clamp(pend.th / A, -1, 1)); } }
  const stop = () => { clock.run = false; };
  const setBpm = (bpm) => { clock.bpm = bpm; };
  function grab(th) { pend.held = true; pend.spin = false; pend.th = th; emit({ t: 'speed', F: 0 }); sentF = 0; emit({ t: 'wake' }); }   // схватил маятник — колесо стоит
  function swing(prev, th) {                              // ведёшь маятник: каждый проход через низ — спуск, колесо на 1/Z оборота
    if (Math.sign(th) !== Math.sign(prev) && Math.abs(th) < Math.PI / 2 && Math.abs(prev) < Math.PI / 2) { emit({ t: 'step', d: 1 / Z }); handSteps++; }
    pend.th = th;
  }
  function tapPendulum(was) { pend.held = false; if (was) clock.run = false; else setRun(true); }   // тап — пуск / стоп
  function release(th, om) {                               // отпустил маятник: энергия броска → скорость хода
    const e = (om / OM0) ** 2 / 2 + (1 - Math.cos(th));
    pend.held = false;
    if (e < ET / 6 || (Math.abs(om) < 0.3 && Math.abs(th) < 0.45)) { clock.run = false; return; }   // поймал и отпустил у низа — стоп; поднял повыше и отпустил — пошёл
    clock.run = true; clock.u = uOfE(e); emit({ t: 'wake' });
    pend.spin = e >= 1.95;
    if (!pend.spin) { const A = Math.acos(1 - e); pend.ph = om >= 0 ? Math.asin(clamp(th / A, -1, 1)) : Math.PI - Math.asin(clamp(th / A, -1, 1)); }
  }
  function holdStrip(u) { clock.strip = true; clock.uT = clock.u = clamp(u, -8, 8.5); if (!clock.run) setRun(true, clock.u); }   // палец на шкале tempus — скорость
  function dragStrip(u) { clock.uT = clock.u = clamp(u, -8, 8.5); }
  function freeStrip() { clock.strip = false; }
  function resetSpeed() { clock.uT = 0; clock.u = 0; }  // двойной тап по шкале — назад к темпу
  function tickClock(dt) {
    if (clock.run && !pend.held) {
      const d = clock.u - clock.uT;
      if (clock.strip) { /* палец на шкале — скорость стоит */ }
      else if (d > 0) clock.u -= d * dt / 6;               // раскачанный — медленно успокаивается к своей скорости
      else clock.u -= d * dt / 1.5;                        // слабый — спуск подталкивает
      if (!clock.strip && Math.abs(clock.u - clock.uT) < 1e-3) clock.u = clock.uT;   // экспонента не доходит до цели — без этого `u === 0` (замок к такту MIDI) не наступил бы и за час
      const e = eOfU(clock.u), F = Fnow();
      if (e < 1.95) {
        const A = Math.acos(1 - e);
        if (pend.spin) { pend.spin = false; pend.ph = Math.asin(clamp(Math.sin(pend.th) / A, -1, 1)); }
        pend.ph += TAU * (Z * F / 2) * dt; pend.th = A * Math.sin(pend.ph);
      } else { pend.spin = true; pend.th = ((pend.th + TAU * Z * F * dt / 2 + Math.PI) % TAU + TAU) % TAU - Math.PI; }
    } else if (!pend.held) { pend.th *= Math.exp(-dt * 3); }   // стоит — повисает отвесно
    const F = Fnow(), B = baseB();
    if (Math.abs(F - sentF) > Math.max(0.002, sentF * 0.004) || B !== sentB) { emit({ t: 'speed', F, B }); sentF = F; sentB = B; }
  }

  // ---------- что звучит: отношение и его имя ----------
  function ratio(F) {                                     // F — скорость колеса (что пришло из worklet)
    const act = rings.filter((r) => r.on);
    if (!act.length) return { a: 'quies', b: 'tap a ring' };
    const a = act.map((r) => (r.under ? `1/${ROMAN[r.n]}` : ROMAN[r.n])).join(' : ');
    const ms = act.map((r) => (r.under ? 12 / r.n : r.n)).sort((x, y) => x - y);
    let name = '';
    for (const [set, nm] of NAMES) if (set.length === ms.length && set.every((v, k) => Math.abs(v / set[0] - ms[k] / ms[0]) < 1e-6)) { name = nm; break; }
    const tone = F * ms[0] >= 20;
    const b = tone ? `tonus${name ? ` — ${name}` : ''} · ${ms.map((m) => noteName(m * F)).join(' ')}` : `rhythmus · ${ms.map((m) => +m.toFixed(2)).join(' · ')} ictus in circuitu${name ? ` · ${name}` : ''}`;
    return { a, b };
  }

  // ---------- патч ----------
  function dice() {                                       // волшебное отношение, иногда — унтертонами; фаза — у одного кольца; часы идут
    const R = rng, set = MAGIC[Math.floor(R() * MAGIC.length)], under = R() < 0.25;
    rings.forEach((r) => { r.on = set.includes(r.n); r.under = under; r.phi = 0; r.lvl = 0.8; });
    if (R() < 0.4) { const on = rings.filter((r) => r.on); on[Math.floor(R() * on.length)].phi = [0.25, 0.5, 0.75][Math.floor(R() * 3)]; }
    fx.materia = R(); emit({ t: 'fx' }); sendAll(); clock.uT = 0; setRun(true, 0);
  }
  function clear() { for (const r of rings) r.on = false; clock.run = false; sendAll(); }
  const snapshot = () => JSON.stringify({ r: rings.map(({ on, under, phi, lvl }) => ({ on, under, phi, lvl })), fx, bpm: clock.bpm, run: clock.run, u: clock.u, uT: clock.uT });
  function restore(js) {
    const st = JSON.parse(js);
    if (!st.r) return;                                   // снимок старого Horologium — не наш
    st.r.forEach((q, i) => Object.assign(rings[i], q));
    Object.assign(fx, st.fx); clock.bpm = st.bpm; clock.run = st.run; clock.u = st.u || 0; clock.uT = st.uT || 0; emit({ t: 'fx' }); sendAll();
  }

  return {
    state, Ft, Fnow, mOf, baseB, ratio, sounding, sendAll,
    toggleRing, toggleUnder, setPhase, setRing, setFx, loadFx,
    setRun, stop, setBpm, grab, swing, tapPendulum, release, holdStrip, dragStrip, freeStrip, resetSpeed,
    dice, clear, snapshot, restore,
    get handSteps() { return handSteps; },
    tick(dt) { tickClock(dt); },
    listen(fn) { listeners.push(fn); },
  };
}
