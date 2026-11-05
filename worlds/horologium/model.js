// Horologium — фасад модели. Кольца, fx, ход часов (пуск и bpm), колесо и замок к такту MIDI живут в ядре (core/worlds/horologium →
// t2d.wasm, слот 9); здесь — их зеркало и действия касаний. Маятника и шкалы tempus больше нет.
// API — прежней JS-модели (эталон — tools/ref/horologium-model.js), без DOM, холста и Web Audio. Действия — сразу в state и в ядро (send →
// номер сообщения); зеркало ~60/с с числом применённых сообщений не перетирает то, что здесь правили, а ядро ещё не видело. Колесо (P, F,
// удары) — state.wheel, из зеркала. flt кольца (DJ-фильтр 0…1, 0.5 — выкл) хранится и уходит в ядро, но в вебе без интерфейса.
// События listen — как у прежней модели: 'all', 'rings', 'fx', 'wake'.
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
export const NR = 8;                                    // кольца II…IX
export const LENS = [16, 16, 12, 8, 6];                 // длины колец кубика
export const NAMES = [[[1, 2], 'diapason'], [[2, 3], 'diapente'], [[3, 4], 'diatessaron'], [[4, 5], 'ditonus'], [[5, 6], 'semiditonus'], [[8, 9], 'tonus'], [[4, 5, 6], 'trias harmonica'], [[10, 12, 15], 'trias mollis'], [[4, 5, 6, 7], 'septima naturalis'], [[3, 4, 5], 'trias harmonica'], [[2, 3, 4], 'diapente · diapason']];
export const noteName = (f) => { const m = Math.round(12 * Math.log2(f / 55)); return `${NOTES[((m % 12) + 12) % 12]}${Math.floor((m + 9) / 12) + 1}`; };

// ядро: слот, коды action, ключи, раскладка зеркала — core/worlds/horologium/world.hpp
export const SLOT = 9;
export const ACT = { ring: 0, fx: 1, run: 2, bpm: 5, clear: 7 };   // 3, 4, 6 (held / step / speed) выведены, ядро их игнорирует
export const FX_KEYS = ['aequalis', 'materia', 'concursus', 'chance', 'hall'], RING_KEYS = ['on', 'under', 'phi', 'lvl', 'inst', 'len', 'flt'];
export const HEAD = FX_KEYS.length + 6, M = { run: 5, bpm: 6, P: 7, F: 8, strikes: 9, locked: 10 };   // кольцо в зеркале: on, under, phi, lvl, inst, len, flt

const fltOf = (v) => (typeof v === 'number' && !Number.isNaN(v) ? clamp(v) : 0.5);   // DJ-фильтр 0…1, 0.5 — выкл; нет, мусор, NaN → 0.5
const lenOf = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(clamp(v, 1, 16)) : 16);   // мусор → 16, иначе 1…16
export const euclid = (j, k, L) => (j * k) % L < k;        // k ударов на L гнёзд (Эвклид): гнездо j бьёт?
export const rotOf = (phi, L) => (typeof phi === 'number' && Number.isFinite(phi) ? (((Math.floor(phi * L + 0.5) % L) + L) % L) : 0);   // фаза → сдвиг рисунка в шагах
export const stepsOf = (r) => (r.under ? 8 : 16);          // шагов на оборот: шестнадцатая, унтертон — восьмая
export const slotOf = (r, P) => {                          // текущее гнездо кольца, 0…L−1
  const L = lenOf(r.len);
  if (typeof P !== 'number' || !Number.isFinite(P)) return 0;
  return (((Math.floor(P * stepsOf(r)) + rotOf(r.phi, L)) % L) + L) % L;
};

export function createModel({ scale = { on: false, root: 0 }, rng = Math.random, send = () => 0 } = {}) {
  const rings = Array.from({ length: NR }, (_, i) => ({ n: i + 2, on: i < 3, under: false, phi: 0, lvl: 0.8, len: 16, inst: i, flt: 0.5 }));
  const fx = { aequalis: 0, materia: 0.35, concursus: 0.4, chance: 1, hall: 0 };
  const clock = { run: false, bpm: 100 };                 // оборот колеса = такт
  const wheel = { P: 0, F: 0, strikes: 0, locked: false };   // колесо — из зеркала ядра
  const state = { rings, fx, clock, wheel };
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };
  let post = send, fxAt = 0, clockAt = 0, wipe = 0;
  const ringAt = new Array(NR).fill(0);
  const act = (kind, i = 0, a = []) => post({ t: 'action', slot: SLOT, kind, i, a });
  const sendRing = (i) => { const r = rings[i]; RING_KEYS.forEach((k, j) => { ringAt[i] = act(ACT.ring, i, [j, typeof r[k] === 'boolean' ? (r[k] ? 1 : 0) : r[k]]); }); };
  const sendRun = () => { clockAt = act(ACT.run, 0, [clock.run ? 1 : 0]); };

  const Ft = () => clock.bpm / 240;
  const Fnow = () => (clock.run ? Ft() : 0);
  const mOf = (r) => { const m = r.under ? 12 / r.n : r.n; if (fx.aequalis <= 0) return m; const et = 2 ** (Math.round(12 * Math.log2(m)) / 12); return m * (et / m) ** fx.aequalis; };
  const baseB = () => 55 * 2 ** ((scale.on ? scale.root : 0) / 12);
  const sounding = () => clock.run && rings.some((r) => r.on);
  function sendAll() { emit({ t: 'all' }); }            // прежний API: всё разом (в ядро всё уходит действиями сразу)

  // ---------- кольца ----------
  function toggleRing(i) { const r = rings[i]; r.on = !r.on; sendRing(i); sendAll(); if (r.on) emit({ t: 'wake' }); }
  function toggleUnder(i) { const r = rings[i]; r.under = !r.under; r.on = true; sendRing(i); sendAll(); emit({ t: 'wake' }); }   // двойной тап — унтертон
  function setPhase(i, phi) { rings[i].phi = phi; ringAt[i] = act(ACT.ring, i, [2, phi]); emit({ t: 'rings' }); }   // вдоль кольца — фаза
  function setRing(i, k, v) { const r = rings[i]; if (k === 'on' || k === 'under') r[k] = v >= 0.5; else if (k === 'flt') r.flt = fltOf(v); else r[k] = v; sendRing(i); sendAll(); }   // плашка кольца
  function setFx(k, v) { const i = FX_KEYS.indexOf(k); if (i < 0) return; fx[k] = v; fxAt = act(ACT.fx, i, [v]); emit({ t: 'fx' }); }
  function loadFx(o) { for (const [k, v] of Object.entries(o || {})) { const i = FX_KEYS.indexOf(k); if (i >= 0) { fx[k] = v; fxAt = act(ACT.fx, i, [v]); } } emit({ t: 'fx' }); }

  // ---------- ход ----------
  function setRun(on) { clock.run = on; sendRun(); if (on) emit({ t: 'wake' }); }
  const stop = () => { clock.run = false; sendRun(); };
  const setBpm = (bpm) => { clock.bpm = bpm; clockAt = act(ACT.bpm, 0, [bpm]); };

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
  const scene = () => JSON.stringify({ r: rings.map(({ on, under, phi, lvl, inst, len, flt }) => ({ on, under, phi, lvl, inst, len, flt })), fx, bpm: clock.bpm, run: clock.run });
  function sendScene() { wipe = fxAt = clockAt = post({ t: 'restore', slot: SLOT, js: scene() }); ringAt.fill(wipe); }
  function dice() {                                       // три соседних кольца k…k+2 (k = 2…7), у каждого len и сдвиг; under общий; часы идут
    const R = rng, k = 2 + Math.floor(R() * 6), under = R() < 0.25;
    rings.forEach((r) => { r.on = r.n >= k && r.n <= k + 2; r.under = under; r.phi = 0; r.lvl = 0.8; r.len = 16; r.flt = 0.5; });
    for (let n = k; n <= k + 2; n++) { const r = rings[n - 2]; r.len = LENS[Math.floor(R() * LENS.length)]; r.phi = Math.floor(R() * r.len) / r.len; }   // тройка по возрастанию: длина, затем сдвиг в шагах
    fx.materia = R(); clock.run = true;
    const pick = Math.floor(R() * 3), apply = R() < 0.5, low = R() < 0.5, q = R();   // фильтр — броски только после materia: кольцо из трёх, применять ли, знак (lowpass при < 0.5), глубина; не более одного кольца
    if (apply) rings[k - 2 + Math.min(pick, 2)].flt = low ? 0.30 + 0.17 * q : 0.53 + 0.12 * q;
    sendScene();
    emit({ t: 'fx' }); sendAll(); emit({ t: 'wake' });
  }
  function clear() { rings.forEach((r, i) => { r.on = false; r.inst = i; r.len = 16; r.flt = 0.5; }); clock.run = false; wipe = act(ACT.clear); ringAt.fill(wipe); clockAt = wipe; sendAll(); }
  const snapshot = scene;
  function restore(js) {
    const st = JSON.parse(js);
    if (!st.r) return;                                   // снимок старого Horologium — не наш
    st.r.forEach((q, i) => Object.assign(rings[i], { inst: i, len: 16 }, q, { len: lenOf(q.len), flt: fltOf(q.flt) }));   // u / uT старого снимка игнорируем
    Object.assign(fx, st.fx); clock.bpm = st.bpm; clock.run = st.run;
    sendScene(); emit({ t: 'fx' }); sendAll();
  }

  function sync(m, applied) {                           // зеркало ядра → state; applied — сколько сообщений ядро уже применило
    if (applied >= fxAt) { let ch = false; FX_KEYS.forEach((k, i) => { if (fx[k] !== m[i]) { fx[k] = m[i]; ch = true; } }); if (ch) emit({ t: 'fx' }); }
    if (applied >= clockAt) { clock.run = m[M.run] !== 0; clock.bpm = m[M.bpm]; }
    wheel.P = m[M.P]; wheel.F = m[M.F]; wheel.strikes = m[M.strikes]; wheel.locked = m[M.locked] !== 0;
    let ch = false;
    for (let i = 0; i < NR; i++) {
      if (applied < ringAt[i] || applied < wipe) continue;
      const r = rings[i], o = HEAD + i * RING_KEYS.length;
      const on = m[o] !== 0, under = m[o + 1] !== 0;
      if (r.on !== on || r.under !== under || r.phi !== m[o + 2] || r.lvl !== m[o + 3] || r.inst !== m[o + 4] || r.len !== m[o + 5] || r.flt !== m[o + 6]) { r.on = on; r.under = under; r.phi = m[o + 2]; r.lvl = m[o + 3]; r.inst = m[o + 4]; r.len = m[o + 5]; r.flt = m[o + 6]; ch = true; }
    }
    if (ch) emit({ t: 'rings' });
  }
  function bind(fn) { post = fn; sendScene(); }   // новый узел ядра: сцена целиком

  return {
    state, Ft, Fnow, mOf, baseB, ratio, sounding, sendAll,
    toggleRing, toggleUnder, setPhase, setRing, setFx, loadFx,
    setRun, stop, setBpm,
    dice, clear, snapshot, restore,
    tick() {},
    listen(fn) { listeners.push(fn); },
    sync, bind,
  };
}
