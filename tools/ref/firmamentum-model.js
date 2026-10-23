// Эталон модели Firmamentum — прежняя JS-модель (worlds/firmamentum/model.js до SDK A): с ней сверяется модель ядра (core/worlds/firmamentum,
// tools/models/firmamentum.test.mjs — до 1e-9) и звук мира SDK (tools/firm-scenarios.mjs). В вебе вместо неё — фасад над ядром.
// Firmamentum — модель: звёзды-проколы на своде, общие FX, комета. Только данные и алгоритм — без DOM, холста и Web Audio.
// Время — секунды (tick(dt)), случайность — rng, лад — scale { on, snap }, расстояние до кометы — place(sky) → точка на экране.
// Что должно прозвучать — события слушателям (listen): { t: 'star', s, on, added? } — звезда целиком, 'fp' / 'ff' — одна её частота, 'fx'.
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const SMAX = 6;
export const FP_LO = 0.7, FP_HI = 520, FF_LO = 140, FF_HI = 4800;
export const LIMEN = Math.log(20 / FP_LO) / Math.log(FP_HI / FP_LO);   // высота, где ритм становится тоном
export const STAR_KEYS = ['h', 'u', 'cyc', 'win', 'mask', 'lvl'];      // что звезды сохраняется в снимке
export const FX_DEF = { scintilla: 0.1, drift: 0.2, cometa: 0, crepitus: 0, fulgur: 0, spread: 0.6, hall: 0.45 };

export function createModel({ scale = { on: false, snap: (s) => s }, rng = Math.random, place = (s) => ({ x: s.u, y: -s.h }) } = {}) {
  const stars = [];                                     // {slot, id, h (0 горизонт … 1 зенит), u (−1 … 1 по своду), cyc, win, mask, lvl, dr, ph, cm}
  const fx = { ...FX_DEF };
  const state = { stars, fx, comet: null, comets: 0, time: 0 };   // comet {a, b — точки свода, t0, dur — с}
  let cometNext = 0, cometSent = 0, driftAt = 0, serial = 0;
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };

  function fp(s) {                                      // высота — частота пульсаций; в области тона с ладом — по ступеням
    let f = FP_LO * (FP_HI / FP_LO) ** s.h;
    if (scale.on && f > 27.5) { const st = 12 * Math.log2(f / 55); f = 55 * 2 ** ((scale.snap(Math.round(st) + 24) - 24) / 12); }
    return f * (s.cm || 1);
  }
  const ff = (s) => FF_LO * (FF_HI / FF_LO) ** ((s.u + 1) / 2) * 2 ** (s.dr || 0);

  function addStar(h, u) {
    const used = new Set(stars.map((s) => s.slot)), slot = [...Array(SMAX).keys()].find((k) => !used.has(k));
    if (slot == null) return null;
    const s = { slot, id: ++serial, h, u, cyc: 3, win: 0.2, mask: 0, lvl: 0.8, dr: 0, ph: rng() * TAU };
    stars.push(s); emit({ t: 'star', s, on: true, added: true });
    return s;
  }
  function closeStar(s) { emit({ t: 'star', s, on: false }); stars.splice(stars.indexOf(s), 1); }
  function moveStar(s, h, u) { s.h = h; s.u = u; emit({ t: 'star', s, on: true }); }
  function setStar(s, patch) { if (!stars.includes(s)) return; Object.assign(s, patch); emit({ t: 'star', s, on: true }); }
  function setFx(k, v) { fx[k] = v; emit({ t: 'fx' }); }
  function loadFx(o) { Object.assign(fx, o); emit({ t: 'fx' }); }
  function clear() { while (stars.length) closeStar(stars[0]); }

  function tick(dt) {
    const now = (state.time += dt);
    if (fx.drift > 0.01 && now - driftAt > 0.1) {       // drift: форманты медленно плывут, у каждой звезды своя фаза
      driftAt = now;
      for (const s of stars) { s.dr = 0.6 * fx.drift * Math.sin(now * 0.21 + s.ph) + 0.25 * fx.drift * Math.sin(now * 0.57 + s.ph * 2); emit({ t: 'ff', s }); }
    }
    cometTick(now);
  }
  // комета — рампа: пролетает по своду и разгоняет пульсацию звёзд, мимо которых летит
  function cometTick(now) {
    if (!state.comet && fx.cometa > 0.01 && stars.length) {   // новая комета: от края свода вниз через небо, раз в 4…24 с (чаще с cometa)
      if (!cometNext) cometNext = now + 1.5;
      if (now > cometNext) {
        const dir = rng() < 0.5 ? -1 : 1, a = { h: 0.55 + rng() * 0.4, u: -0.9 * dir }, b = { h: 0.05 + rng() * 0.35, u: 0.9 * dir };
        state.comet = { a, b, t0: now, dur: 3.5 + rng() * 3 }; state.comets++;
      }
    }
    const c = state.comet, at = c && cometAt(now);
    let changed = false;
    for (const s of stars) {                            // звезда рядом с кометой — пульсация разгоняется (до двух октав), потом отпускает
      let cm = 1;
      if (at) { const p = place(s), d = Math.hypot(p.x - at.x, p.y - at.y); cm = 2 ** (2 * fx.cometa * Math.max(0, 1 - d / 90)); }
      if (Math.abs(cm - (s.cm || 1)) > 0.01) { s.cm = cm; changed = true; }
    }
    if (changed && now - cometSent > 0.033) { cometSent = now; for (const s of stars) emit({ t: 'fp', s }); }
    if (c && now - c.t0 > c.dur) {
      state.comet = null; cometNext = now + (24 - 20 * fx.cometa) * (0.6 + 0.8 * rng());
      for (const s of stars) { s.cm = 1; emit({ t: 'fp', s }); }
    }
  }
  function cometAt(now = state.time) {                  // где комета: k — доля пути, x, y — на экране (линейно между концами, как летит)
    const c = state.comet;
    if (!c) return null;
    const k = Math.min(1, (now - c.t0) / c.dur), A = place(c.a), B = place(c.b);
    return { k, x: A.x + (B.x - A.x) * k, y: A.y + (B.y - A.y) * k, A, B };
  }

  function dice() {                                     // одна звезда — ритм у горизонта, две-три — тоны выше; окна и циклы вразброс
    const R = rng;
    clear();
    const s0 = addStar(0.08 + R() * (LIMEN - 0.12), R() * 1.6 - 0.8); if (s0) setStar(s0, { cyc: 1 + Math.floor(R() * 3), win: 0.4 + R() * 0.3 });
    const n = 2 + Math.floor(R() * 2);
    for (let k = 0; k < n; k++) { const s = addStar(LIMEN + 0.08 + R() * 0.45, R() * 1.8 - 0.9); if (s) setStar(s, { cyc: 2 + Math.floor(R() * 6), win: R() * 0.6, mask: R() < 0.3 ? 0.3 : 0 }); }
  }
  const snapshot = () => JSON.stringify({ s: stars.map((s) => Object.fromEntries(STAR_KEYS.map((k) => [k, s[k]]))), fx });
  function restore(js) {
    const st = JSON.parse(js);
    clear();
    for (const q of st.s) { const s = addStar(q.h, q.u); if (s) setStar(s, q); }
    loadFx(st.fx);
  }

  return {
    state, fp, ff, LIMEN, cometAt,
    addStar, closeStar, moveStar, setStar, setFx, loadFx, clear, dice,
    tick, snapshot, restore, sounding: () => stars.length > 0,
    listen(fn) { listeners.push(fn); },
    launch() { cometNext = -1; },                       // для тестов: комета — на следующем шаге
  };
}
