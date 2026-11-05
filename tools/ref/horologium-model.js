// Эталон модели Horologium: worlds/horologium/model.js до SDK D2 (как был; в вебе теперь фасад над ядром). Сверка ядра — tools/horo-scenarios.mjs.
// Horologium — модель: кольца II…IX, fx, ход часов clock (маятника и шкалы tempus больше нет: run и bpm). Только данные и алгоритм — без DOM, холста и Web Audio.
// Время — секунды (tick(dt)), случайность — rng, лад — scale { on, root }. Колесо (положение P и скорость F) крутится в horo-worklet.js:
// модель говорит, с какой скоростью ему идти. События слушателям (listen): 'all' — кольца, тоника и скорость; 'rings' — только кольца;
// 'speed' {F, B} — скорость (и тоника; B нет — только скорость); 'fx'; 'wake' — звук пошёл.
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
export const NR = 8;                                    // кольца II…IX
export const LENS = [16, 16, 12, 8, 6];                 // длины колец кубика
export const NAMES = [[[1, 2], 'diapason'], [[2, 3], 'diapente'], [[3, 4], 'diatessaron'], [[4, 5], 'ditonus'], [[5, 6], 'semiditonus'], [[8, 9], 'tonus'], [[4, 5, 6], 'trias harmonica'], [[10, 12, 15], 'trias mollis'], [[4, 5, 6, 7], 'septima naturalis'], [[3, 4, 5], 'trias harmonica'], [[2, 3, 4], 'diapente · diapason']];
export const noteName = (f) => { const m = Math.round(12 * Math.log2(f / 55)); return `${NOTES[((m % 12) + 12) % 12]}${Math.floor((m + 9) / 12) + 1}`; };

const underOf = (v) => (v === true ? 1 : v === 2 ? 2 : v === 1 ? 1 : 0);   // старые сцены: true / false

const fltOf = (v) => (typeof v === 'number' && !Number.isNaN(v) ? clamp(v) : 0.5);   // DJ-фильтр 0…1, 0.5 — выкл; нет, мусор, NaN → 0.5
const lenOf = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(clamp(v, 1, 16)) : 16);   // мусор → 16, иначе 1…16

export function createModel({ scale = { on: false, root: 0 }, rng = Math.random } = {}) {
  const rings = Array.from({ length: NR }, (_, i) => ({ n: i + 2, on: i < 3, under: 0, phi: 0, lvl: 0.8, len: 16, flt: 0.5 }));
  const fx = { aequalis: 0, materia: 0.35, concursus: 0.4, chance: 1, hall: 0 };   // 05.11: hall 0 по умолчанию, как в ядре
  const clock = { run: false, bpm: 100 };
  const state = { rings, fx, clock };
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };
  let sentF = -1, sentB = -1;              // что последним ушло в worklet: скорость и тоника

  const Ft = () => clock.bpm / 240;
  const Fnow = () => (clock.run ? Ft() : 0);
  const mOf = (r) => { const m = r.under === 1 ? 12 / r.n : r.n; if (fx.aequalis <= 0) return m; const et = 2 ** (Math.round(12 * Math.log2(m)) / 12); return m * (et / m) ** fx.aequalis; };
  const baseB = () => 55 * 2 ** ((scale.on ? scale.root : 0) / 12);
  const sounding = () => clock.run && rings.some((r) => r.on);
  function sendAll() { sentF = Fnow(); sentB = baseB(); emit({ t: 'all' }); }   // кольца, тоника, скорость — всё разом

  // ---------- кольца ----------
  function toggleRing(i) { const r = rings[i]; r.on = !r.on; sendAll(); if (r.on) emit({ t: 'wake' }); }
  function toggleUnder(i) { const r = rings[i]; r.under = (r.under + 1) % 3; r.on = true; sendAll(); emit({ t: 'wake' }); }   // двойной тап — унтертон
  function setPhase(i, phi) { rings[i].phi = phi; emit({ t: 'rings' }); }   // вдоль кольца — фаза
  function setRing(i, k, v) { const r = rings[i]; if (k === 'on') r.on = v >= 0.5; else if (k === 'under') r.under = v < 0.5 ? 0 : v < 1.5 ? 1 : 2; else if (k === 'flt') r.flt = fltOf(v); else r[k] = v; sendAll(); }   // плашка кольца
  function setFx(k, v) { fx[k] = v; emit({ t: 'fx' }); }
  function loadFx(o) { Object.assign(fx, o); emit({ t: 'fx' }); }

  // ---------- ход ----------
  function setRun(on) { clock.run = on; if (on) emit({ t: 'wake' }); }
  const stop = () => { clock.run = false; };
  const setBpm = (bpm) => { clock.bpm = bpm; };
  function tickClock() {
    const F = Fnow(), B = baseB();
    if (Math.abs(F - sentF) > Math.max(0.002, sentF * 0.004) || B !== sentB) { emit({ t: 'speed', F, B }); sentF = F; sentB = B; }
  }

  // ---------- что звучит: отношение и его имя ----------
  function ratio(F) {                                     // F — скорость колеса (что пришло из worklet)
    const act = rings.filter((r) => r.on);
    if (!act.length) return { a: 'quies', b: 'tap a ring' };
    const a = act.map((r) => (r.under === 1 ? `1/${ROMAN[r.n]}` : r.under === 2 ? `${ROMAN[r.n]}×2` : ROMAN[r.n])).join(' : ');
    const ms = act.map((r) => (r.under === 1 ? 12 / r.n : r.n)).sort((x, y) => x - y);
    let name = '';
    for (const [set, nm] of NAMES) if (set.length === ms.length && set.every((v, k) => Math.abs(v / set[0] - ms[k] / ms[0]) < 1e-6)) { name = nm; break; }
    const tone = F * ms[0] >= 20;
    const b = tone ? `tonus${name ? ` — ${name}` : ''} · ${ms.map((m) => noteName(m * F)).join(' ')}` : `rhythmus · ${ms.map((m) => +m.toFixed(2)).join(' · ')} ictus in circuitu${name ? ` · ${name}` : ''}`;
    return { a, b };
  }

  // ---------- патч ----------
  function dice() {                                       // три соседних кольца k…k+2 (k = 2…7), у каждого len и сдвиг; under общий; часы идут
    const R = rng, k = 2 + Math.floor(R() * 6), under = R() < 0.25 ? 1 : 0;
    rings.forEach((r) => { r.on = r.n >= k && r.n <= k + 2; r.under = under; r.phi = 0; r.lvl = 0.8; r.len = 16; r.flt = 0.5; });
    for (let n = k; n <= k + 2; n++) { const r = rings[n - 2]; r.len = LENS[Math.floor(R() * LENS.length)]; r.phi = Math.floor(R() * r.len) / r.len; }   // тройка по возрастанию: длина, затем сдвиг в шагах
    fx.materia = R();
    const pick = Math.floor(R() * 3), apply = R() < 0.5, low = R() < 0.5, q = R();   // фильтр — броски только после materia: кольцо из трёх, применять ли, знак (lowpass при < 0.5), глубина; не более одного кольца
    if (apply) rings[k - 2 + Math.min(pick, 2)].flt = low ? 0.30 + 0.17 * q : 0.53 + 0.12 * q;
    emit({ t: 'fx' }); sendAll(); setRun(true);
  }
  function clear() { for (const r of rings) { r.on = false; r.len = 16; r.flt = 0.5; } clock.run = false; sendAll(); }
  const snapshot = () => JSON.stringify({ r: rings.map(({ on, under, phi, lvl, len, flt }) => ({ on, under, phi, lvl, len, flt })), fx, bpm: clock.bpm, run: clock.run });
  function restore(js) {
    const st = JSON.parse(js);
    if (!st.r) return;                                   // снимок старого Horologium — не наш
    st.r.forEach((q, i) => Object.assign(rings[i], { len: 16 }, q, { under: underOf(q.under), len: lenOf(q.len), flt: fltOf(q.flt) }));
    Object.assign(fx, st.fx); clock.bpm = st.bpm; clock.run = st.run; emit({ t: 'fx' }); sendAll();
  }

  return {
    state, Ft, Fnow, mOf, baseB, ratio, sounding, sendAll,
    toggleRing, toggleUnder, setPhase, setRing, setFx, loadFx,
    setRun, stop, setBpm,
    dice, clear, snapshot, restore,
    tick() { tickClock(); },
    listen(fn) { listeners.push(fn); },
  };
}
