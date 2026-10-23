// Tria corpora — фасад модели. Тела, физика (шаг — блок звука, без кадров), энергия, аспекты, дрон пары и звук живут в ядре
// (core/worlds/tria → t2d.wasm, слот 11); здесь — их зеркало, действия касаний и картинка: следы (из зеркала), вспышки (из
// «услышанного», время — фасада), Fiat lux (luxAt), кубик (rng), energy / hzOf / baseHz — те же формулы по зеркалу.
// API — прежней JS-модели (эталон — tools/ref/tria-model.js), без DOM, холста и Web Audio. Действия — сразу в state и в ядро (send →
// номер сообщения); зеркало ~60/с с числом применённых сообщений не перетирает то, что здесь правили, а ядро ещё не видело, и тело
// в руке (оно — под пальцем). События listen — как у прежней модели: 'start', 'fx' (звука здесь нет — колокола и дрон в ядре).
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const EPS = 0.1, KC = 0.35;
export const EMIN = 0.6;                               // на единицу массы, при gravitas 50 %
export const FX_DEF = { gravitas: 0.5, flux: 0.5, nexus: 0.35, aspectus: 0.6, decay: 0, hall: 0.35 };
export const BODY_KEYS = ['x', 'y', 'vx', 'vy', 'm', 'fixed', 'semi', 'level'];   // что тела сохраняется в снимке
const PENTA = [0, 2, 4, 7, 9];                         // без лада — пентатоника от тоники
export const rest = () => [0, 1, 2].map((i) => { const a = -Math.PI / 2 + (i * TAU) / 3; return { x: Math.cos(a) * 0.5, y: Math.sin(a) * 0.5 }; });

// ядро: слот, коды action, раскладка зеркала и услышанного — core/worlds/tria/world.hpp
export const SLOT = 11;
export const ACT = { grab: 0, drop: 1, drag: 2, release: 3, anchor: 4, set: 5, fx: 6, lux: 7, plumb: 8, dice: 9, clear: 10 };
export const FX_KEYS = Object.keys(FX_DEF), SET_KEYS = ['m', 'semi', 'fixed', 'level'];
export const HEAD = FX_KEYS.length + 5, BODY_M = 12, KINDS = ['ring', 'ray', 'rim', 'conj'];
const TRAIL = 360;                                     // след: 180 точек, по кадру (как было)

export function createModel({ scale = { on: false, root: 0, snap: (s) => s }, rng = Math.random, send = () => 0 } = {}) {
  const bodies = rest().map((p, i) => ({ ...p, vx: 0, vy: 0, m: 1, fixed: false, semi: [0, 7, 12][i], level: 0.8, trail: [], amp: 0, hz: 110 }));
  const fx = { ...FX_DEF };
  const pairK = [0, 0, 0], trem = [0, 0, 0], flashes = [];   // flashes: {x, y, i, t (с), kind, q}
  const counts = { strikes: 0, encounters: 0 };              // из зеркала: сколько колоколов и шорохов сыграло ядро
  const state = { bodies, fx, still: true, lux: false, cadit: false, luxAt: 0, time: 0, pairK, trem, flashes, counts };
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };
  const start = () => emit({ t: 'start' });
  let post = send, fxAt = 0, flagAt = 0, wipe = 0;
  const bAt = [0, 0, 0];
  const act = (kind, i = 0, a = []) => post({ t: 'action', slot: SLOT, kind, i, a });
  const all = (n) => { bAt.fill(n); flagAt = n; return n; };

  const Gc = () => 0.25 + 0.75 * fx.gravitas;
  const tonic = () => (scale.on ? scale.root : 0);
  function snap(s) {
    if (scale.on) return scale.snap(Math.round(s) + 24) - 24;
    const r = Math.round(s), o = Math.floor(r / 12), pc = r - 12 * o;
    let best = 0; for (const q of [...PENTA, 12]) if (Math.abs(q - pc) < Math.abs(best - pc)) best = q;
    return 12 * o + best;
  }
  const omega = (b) => { const r2 = Math.max(0.01, b.x * b.x + b.y * b.y); return Math.abs(b.x * b.vy - b.y * b.vx) / r2; };   // угловая скорость вокруг земли
  function hzOf(b) {                                   // Кеплер, Harmonices mundi: быстрее обходит землю — выше (flux — сколько октав); всегда по ступеням
    const w = clamp(omega(b), 0.15, 40), s = b.semi + tonic() + 12 + clamp(12 * Math.log2(w / 3) * (0.4 + 1.2 * fx.flux), -24, 24);
    return 110 * 2 ** (snap(s) / 12);
  }
  const baseHz = (b) => 110 * 2 ** (snap(b.semi + tonic() - 12) / 12);   // дрон пары — основной тон тела, октавой ниже
  const rays = () => (fx.aspectus < 0.34 ? 0 : fx.aspectus < 0.67 ? 4 : 8);
  function energy() {                                   // K + U — как в ядре (земля KC, смягчение; на восьмёрке — без них)
    const lux = state.lux, eps2 = lux ? 1e-6 : EPS * EPS, g = Gc();
    let K = 0, U = 0;
    bodies.forEach((b, i) => {
      if (!b.fixed) K += (b.m * (b.vx * b.vx + b.vy * b.vy)) / 2;
      if (!lux) U += (b.m * KC * (b.x * b.x + b.y * b.y)) / 2;
      for (let j = i + 1; j < 3; j++) { const q = bodies[j], d2 = (q.x - b.x) ** 2 + (q.y - b.y) ** 2 + eps2; U -= (g * b.m * q.m) / Math.sqrt(d2); }
    });
    return K + U;
  }

  // ---------- действия: сразу в state, в ядро — действием ----------
  function fiatLux() {                                  // восьмёрка Шенсине — Монтгомери: три равных тела гоняются друг за другом по одной кривой
    const s = 0.55, g = Gc(), k = Math.sqrt(g / s), x1 = [-0.97000436, 0.24308753], v3 = [-0.93240737, -0.86473146];
    const P = [[x1[0], x1[1]], [-x1[0], -x1[1]], [0, 0]], V = [[-v3[0] / 2, -v3[1] / 2], [-v3[0] / 2, -v3[1] / 2], v3];
    bodies.forEach((b, i) => { b.x = P[i][0] * s; b.y = P[i][1] * s; b.vx = V[i][0] * k; b.vy = V[i][1] * k; b.m = 1; b.fixed = false; b.trail = []; });
    state.lux = true; state.cadit = false; state.still = false; all(act(ACT.lux)); start(); state.luxAt = state.time;
  }
  function plumb() {                                    // отвес: тяга выкл — всё падает на дно; ещё раз — тяга снова
    state.cadit = !state.cadit; state.lux = false; const was = state.still; state.still = false;
    flagAt = act(ACT.plumb); if (was) start();
  }
  function anchor(i) { const b = bodies[i]; b.fixed = !b.fixed; b.vx = b.vy = 0; bAt[i] = act(ACT.anchor, i); }   // двойной тап — якорь
  function grab(i) { bodies[i].held = true; state.lux = false; flagAt = bAt[i] = act(ACT.grab, i); }
  function drop(i) { bodies[i].held = false; bAt[i] = act(ACT.drop, i); }   // держишь без движения — открылась плашка: тело отпущено
  function drag(i, x, y) {
    const b = bodies[i]; b.x = x; b.y = y; b.vx = b.vy = 0;
    const was = state.still; state.still = false;
    flagAt = bAt[i] = act(ACT.drag, i, [x, y]); if (was) start();
  }
  function release(i, v) {                              // v {vx, vy} — бросок (тело двигали), null — тап
    const b = bodies[i];
    b.held = false;
    if (v && !b.fixed) { b.vx = v.vx; b.vy = v.vy; }
    const go = state.still && v; if (go) state.still = false;
    flagAt = bAt[i] = act(ACT.release, i, v ? [v.vx, v.vy] : []);
    if (go) start();
  }
  function setBody(i, k, v) {                           // плашка тела: v — 0…1
    const b = bodies[i];
    if (k === 'm') b.m = 0.3 + v * 2.7; else if (k === 'semi') b.semi = Math.round(v * 36) - 12; else if (k === 'fixed') { b.fixed = v >= 0.5; if (b.fixed) b.vx = b.vy = 0; } else b.level = v;
    bAt[i] = act(ACT.set, i, [SET_KEYS.indexOf(k) < 0 ? 3 : SET_KEYS.indexOf(k), v]);
  }
  function setFx(k, v) { fx[k] = v; const i = FX_KEYS.indexOf(k); if (i >= 0) fxAt = act(ACT.fx, i, [v]); emit({ t: 'fx' }); }
  function loadFx(o) { Object.assign(fx, o); for (const [k, v] of Object.entries(o || {})) { const i = FX_KEYS.indexOf(k); if (i >= 0) fxAt = act(ACT.fx, i, [v]); } emit({ t: 'fx' }); }
  function dice() {                                     // тела разбросаны и брошены, массы и ноты — аккорд
    const R = rng, chords = [[0, 7, 12], [0, 3, 7], [0, 5, 10], [-5, 0, 7], [0, 4, 11]], ch = chords[Math.floor(R() * chords.length)];
    bodies.forEach((b, i) => { const a = R() * TAU, r = 0.25 + R() * 0.55; b.x = Math.cos(a) * r; b.y = Math.sin(a) * r; b.vx = (R() - 0.5) * 1.6; b.vy = (R() - 0.5) * 1.6; b.m = 0.6 + R() * 1.2; b.semi = ch[i]; b.fixed = false; b.trail = []; });
    state.lux = false; state.cadit = false; state.still = false;
    all(act(ACT.dice, 0, bodies.flatMap((b) => [b.x, b.y, b.vx, b.vy, b.m, b.semi]))); start();
  }
  function clear() { state.still = true; state.lux = false; state.cadit = false; bodies.forEach((b) => { b.vx = b.vy = 0; b.trail = []; }); all(act(ACT.clear)); }
  const snapshot = () => JSON.stringify({ b: bodies.map((b) => Object.fromEntries(BODY_KEYS.map((k) => [k, b[k]]))), fx, still: state.still, lux: state.lux, cadit: state.cadit });
  function restore(js) {
    const st = JSON.parse(js);
    st.b.forEach((q, i) => Object.assign(bodies[i], q, { trail: [] }));
    Object.assign(fx, st.fx); state.still = st.still; state.lux = st.lux; state.cadit = !!st.cadit;
    sendScene(); emit({ t: 'fx' });
    if (!state.still) start();
  }
  function sendScene() { wipe = fxAt = all(post({ t: 'restore', slot: SLOT, js: snapshot() })); }

  function tick(dt) {                                   // часы картинки (вспышки, Fiat lux) и следы — по кадру, из зеркала; физика — в ядре
    state.time += dt;
    if (!state.still) for (const b of bodies) { b.trail.push(b.x, b.y); if (b.trail.length > TRAIL) b.trail.splice(0, 2); }
  }
  function sync(m, applied, heard = []) {               // зеркало ядра → state; applied — сколько сообщений ядро уже применило; heard — вспышки
    if (applied >= fxAt) { let ch = false; FX_KEYS.forEach((k, i) => { if (fx[k] !== m[i]) { fx[k] = m[i]; ch = true; } }); if (ch) emit({ t: 'fx' }); }
    const F = FX_KEYS.length;
    if (applied >= flagAt && applied >= wipe) { state.still = m[F] === 1; state.lux = m[F + 1] === 1; state.cadit = m[F + 2] === 1; }
    counts.strikes = m[F + 3]; counts.encounters = m[F + 4];
    bodies.forEach((b, i) => {
      const o = HEAD + i * BODY_M;
      b.amp = m[o + 8]; b.hz = m[o + 9]; pairK[i] = m[o + 10]; trem[i] = m[o + 11];
      if (!b.held && applied >= bAt[i] && applied >= wipe) {
        b.x = m[o]; b.y = m[o + 1]; b.vx = m[o + 2]; b.vy = m[o + 3]; b.m = m[o + 4]; b.fixed = m[o + 5] === 1; b.semi = m[o + 6]; b.level = m[o + 7];
      }
    });
    for (const h of heard) {                            // запись блока: [число, (i, вид, x, y, q)…]
      for (let k = 0; k < (h[0] | 0); k++) { const p = 1 + k * 5; flashes.push({ x: h[p + 2], y: h[p + 3], i: h[p], t: state.time, kind: KINDS[h[p + 1]], q: h[p + 4] }); }
    }
    if (flashes.length > 30) flashes.splice(0, flashes.length - 30);
  }
  function bind(fn) { post = fn; sendScene(); }        // новый узел ядра: сцена целиком

  return {
    state, hzOf, baseHz, tonic, rays, Gc, energy,
    fiatLux, plumb, anchor, grab, drop, drag, release, setBody, setFx, loadFx, dice, clear,
    tick, snapshot, restore, sounding: () => !state.still,
    listen(fn) { listeners.push(fn); },
    sync, bind,
  };
}
