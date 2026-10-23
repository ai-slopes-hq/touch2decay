// Эталон: прежняя JS-модель Tria corpora (worlds/tria/model.js до SDK D4) — с ней сверяется ядро (core/worlds/tria), модель: три тела на блюде, тяга, leapfrog, энергия, аспекты и соединения. Только данные и алгоритм — без DOM, холста и Web Audio.
// Единицы блюда (радиус 1); время — секунды (tick(dt): физика — как у хоста, шаг кадра не больше DT_MAX), случайность — rng, лад — scale { on, root, snap }.
// Что должно прозвучать — события слушателям (listen): 'start' (генераторы), 'bell' {i, f, vel, pan}, 'thud' {i, vn}, 'burst' {f, pan, k}, 'drone' (кадр дрона), 'fx'.
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const EPS = 0.1, KC = 0.35;
export const EMIN = 0.6;                               // на единицу массы, при gravitas 50 %
export const DT_MAX = 0.05;                            // шаг кадра для физики и дрона — как обрезает хост
export const FX_DEF = { gravitas: 0.5, flux: 0.5, nexus: 0.35, aspectus: 0.6, decay: 0, hall: 0.35 };
export const BODY_KEYS = ['x', 'y', 'vx', 'vy', 'm', 'fixed', 'semi', 'level'];   // что тела сохраняется в снимке
const PENTA = [0, 2, 4, 7, 9];                         // без лада — пентатоника от тоники
const RINGS = [0.25, 0.5, 0.75];
export const rest = () => [0, 1, 2].map((i) => { const a = -Math.PI / 2 + (i * TAU) / 3; return { x: Math.cos(a) * 0.5, y: Math.sin(a) * 0.5 }; });

export function createModel({ scale = { on: false, root: 0, snap: (s) => s }, rng = Math.random } = {}) {
  const bodies = rest().map((p, i) => ({ ...p, vx: 0, vy: 0, m: 1, fixed: false, semi: [0, 7, 12][i], level: 0.8, trail: [], amp: 0, hz: 110 }));
  const fx = { ...FX_DEF };
  const pairK = [0, 0, 0], trem = [0, 0, 0], flashes = [];   // flashes: {x, y, i, t (с), kind, q}
  const state = { bodies, fx, still: true, lux: false, cadit: false, luxAt: 0, time: 0, pairK, trem, flashes };   // cadit — тяга выключена: всё падает на дно блюда
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };
  const start = () => emit({ t: 'start' });

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

  // ---------- физика ----------
  function accel(i, P) {
    const b = P[i];
    if (state.cadit) return [0, 1.4];                   // тяга выключена — всё падает вниз
    const lux = state.lux;
    let ax = -KC * b.x * (lux ? 0 : 1), ay = -KC * b.y * (lux ? 0 : 1);
    const eps2 = lux ? 1e-6 : EPS * EPS, g = Gc();
    for (let j = 0; j < 3; j++) {
      if (j === i) continue;
      const dx = P[j].x - b.x, dy = P[j].y - b.y, d2 = dx * dx + dy * dy + eps2, k = (g * bodies[j].m) / (d2 * Math.sqrt(d2));
      ax += dx * k; ay += dy * k;
    }
    return [ax, ay];
  }
  // энергия сохраняется: край упругий, скорость не срезается; leapfrog копит ошибку на близких пролётах — поэтому подшагов больше,
  // когда тела близко и быстры, и после кадра скорости чуть подправляются к энергии броска E0 (новая E0 — после любого вмешательства).
  // decay — единственный сток: трение, система медленно садится в клубок.
  let E0 = null, eKey = '', eDirty = true, fresh = true;   // fresh — новый бросок: энергия не ниже EMIN (иначе два тела почти всегда сцепляются в тесную пару)
  function energy() {
    const lux = state.lux, eps2 = lux ? 1e-6 : EPS * EPS, g = Gc();
    let K = 0, U = 0;
    bodies.forEach((b, i) => {
      if (!b.fixed) K += (b.m * (b.vx * b.vx + b.vy * b.vy)) / 2;
      if (!lux) U += (b.m * KC * (b.x * b.x + b.y * b.y)) / 2;
      for (let j = i + 1; j < 3; j++) { const q = bodies[j], d2 = (q.x - b.x) ** 2 + (q.y - b.y) ** 2 + eps2; U -= (g * b.m * q.m) / Math.sqrt(d2); }
    });
    return { K, U };
  }
  function keepEnergy(dt) {
    if (state.cadit) { E0 = null; return; }
    const key = `${Gc()}|${state.lux}|${bodies.map((b) => `${b.m},${b.fixed},${!!b.held}`).join(';')}`, any = bodies.some((b) => b.held);
    if (fx.decay > 0.005 && !any) { const f = Math.exp(-0.3 * fx.decay * fx.decay * dt); for (const b of bodies) { b.vx *= f; b.vy *= f; } eDirty = true; }   // decay: трение
    const { K, U } = energy();
    if (eDirty || any || key !== eKey || E0 == null) {
      E0 = K + U; eKey = key; eDirty = false;
      if (fresh && !any && !state.lux) { fresh = false; E0 = Math.max(E0, (EMIN * Gc() / 0.625) * bodies.reduce((a, b) => a + b.m, 0)); }
      if (Math.abs(E0 - K - U) < 1e-9) return;
    }
    const Kt = E0 - U;
    if (K > 1e-6) { const k = Math.min(1.04, Math.max(0.97, Math.sqrt(Math.max(0, Kt) / K))); for (const b of bodies) if (!b.fixed) { b.vx *= k; b.vy *= k; } }
  }
  const rims = [0, 0, 0];                              // удары о край за кадр: нормальная скорость
  function physics(dt) {                               // перешагивание (leapfrog), 8…64 подшага за кадр; блюдо держит тела
    if (state.still) return;
    const cadit = state.cadit;
    let dmin = 9, vmax = 0;
    for (let i = 0; i < 3; i++) { const a = bodies[i]; vmax = Math.max(vmax, Math.hypot(a.vx, a.vy)); for (let j = i + 1; j < 3; j++) dmin = Math.min(dmin, Math.hypot(bodies[j].x - a.x, bodies[j].y - a.y)); }
    const T0 = dt * (0.5 + fx.gravitas), n = Math.min(64, Math.max(8, Math.ceil((T0 * (vmax + 1) * 12) / Math.max(dmin, state.lux ? 0.02 : EPS)))), h = T0 / n;
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < 3; i++) { const b = bodies[i]; if (b.fixed || b.held) continue; const [ax, ay] = accel(i, bodies); b.vx += ax * h / 2; b.vy += ay * h / 2; }
      for (const b of bodies) { if (b.fixed || b.held) continue; b.x += b.vx * h; b.y += b.vy * h; }
      for (let i = 0; i < 3; i++) { const b = bodies[i]; if (b.fixed || b.held) continue; const [ax, ay] = accel(i, bodies); b.vx += ax * h / 2; b.vy += ay * h / 2; }
      if (cadit) for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {   // на дне тела не проходят друг сквозь друга
        const a = bodies[i], b = bodies[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-4, m = 0.19;
        if (d < m) { const push = (m - d) / 2, ux = dx / d, uy = dy / d; if (!a.fixed && !a.held) { a.x -= ux * push; a.y -= uy * push; } if (!b.fixed && !b.held) { b.x += ux * push; b.y += uy * push; } const rv = (b.vx - a.vx) * ux + (b.vy - a.vy) * uy; if (rv < 0) { a.vx += rv * ux * 0.5; a.vy += rv * uy * 0.5; b.vx -= rv * ux * 0.5; b.vy -= rv * uy * 0.5; } }
      }
      for (const b of bodies) {                         // край блюда: отскок с потерей; слишком быстрые — притормаживают
        const r = Math.hypot(b.x, b.y);
        if (r > 0.97) {
          const nx = b.x / r, ny = b.y / r, vn = b.vx * nx + b.vy * ny, k = cadit ? 1.35 : 2;   // без cadit — упруго
          if (vn > 0.25) rims[bodies.indexOf(b)] = Math.max(rims[bodies.indexOf(b)], vn);
          if (vn > 0) { b.vx -= k * vn * nx; b.vy -= k * vn * ny; }
          if (cadit) { b.vx *= 0.985; b.vy *= 0.985; }  // на дне — трение: тела скатываются и замирают
          b.x = nx * 0.97; b.y = ny * 0.97;
        }
        const v = Math.hypot(b.vx, b.vy); if (v > 14) { b.vx *= 14 / v; b.vy *= 14 / v; eDirty = true; }   // только от взрыва
      }
    }
    keepEnergy(T0);
  }
  function fiatLux() {                                  // восьмёрка Шенсине — Монтгомери: три равных тела гоняются друг за другом по одной кривой
    const s = 0.55, g = Gc(), k = Math.sqrt(g / s), x1 = [-0.97000436, 0.24308753], v3 = [-0.93240737, -0.86473146];
    const P = [[x1[0], x1[1]], [-x1[0], -x1[1]], [0, 0]], V = [[-v3[0] / 2, -v3[1] / 2], [-v3[0] / 2, -v3[1] / 2], v3];
    bodies.forEach((b, i) => { b.x = P[i][0] * s; b.y = P[i][1] * s; b.vx = V[i][0] * k; b.vy = V[i][1] * k; b.m = 1; b.fixed = false; b.trail = []; });
    state.lux = true; state.cadit = false; state.still = false; eDirty = true; start(); state.luxAt = state.time;
  }

  // ---------- аспекты: тело бьёт свою ноту, когда пересекает круг блюда или луч стихий (aspectus — сколько линий звучит) ----------
  const rays = () => (fx.aspectus < 0.34 ? 0 : fx.aspectus < 0.67 ? 4 : 8);
  const rings = () => (fx.aspectus < 0.01 ? [] : fx.aspectus < 0.34 ? [0.5] : RINGS);
  const prevP = bodies.map(() => null), lastHit = [-Infinity, -Infinity, -Infinity];
  function aspects(now) {
    bodies.forEach((b, i) => {
      const r = Math.hypot(b.x, b.y), a = Math.atan2(b.y, b.x), pv = prevP[i];
      prevP[i] = { r, a };
      if (!pv || state.still || b.held || b.fixed || now - lastHit[i] < 0.12) return;
      let hit = null;
      for (const q of rings()) if ((pv.r - q) * (r - q) < 0) { hit = { kind: 'ring', q }; break; }
      const n = rays();
      if (!hit && n) { const k0 = Math.floor((pv.a + Math.PI / 4) / (TAU / n)), k1 = Math.floor((a + Math.PI / 4) / (TAU / n)); if (k0 !== k1 && Math.abs(a - pv.a) < Math.PI) hit = { kind: 'ray', q: Math.round((a + Math.PI / 4) / (TAU / n)) * (TAU / n) - Math.PI / 4 }; }
      if (!hit) return;
      lastHit[i] = now;
      const v = Math.hypot(b.vx, b.vy);
      emit({ t: 'bell', i, f: hzOf(b), vel: clamp(0.25 + v * 0.3), pan: clamp(b.x, -1, 1) * 0.8 });
      flashes.push({ x: b.x, y: b.y, i, t: now, kind: hit.kind, q: hit.q });
    });
    rims.forEach((vn, i) => { if (vn > 0 && !state.still) { emit({ t: 'thud', i, vn }); flashes.push({ x: bodies[i].x, y: bodies[i].y, i, t: now, kind: 'rim' }); } rims[i] = 0; });
    if (flashes.length > 30) flashes.splice(0, flashes.length - 30);
  }
  const near = [false, false, false], conjAt = [-Infinity, -Infinity, -Infinity];
  function voice(dt, now) {                             // дрон пары: тело в тесной паре гудит своим тоном, пульсирует с частотой оборота пары
    aspects(now);
    const rate = [0, 0, 0], still = state.still;
    bodies.forEach((b, i) => {
      let dm = 9, jm = -1;
      for (let j = 0; j < 3; j++) if (j !== i) { const d = Math.hypot(b.x - bodies[j].x, b.y - bodies[j].y); if (d < dm) { dm = d; jm = j; } }
      const q = bodies[jm], rx = q.x - b.x, ry = q.y - b.y, w = Math.abs(rx * (q.vy - b.vy) - ry * (q.vx - b.vx)) / Math.max(0.004, dm * dm);   // угловая скорость пары
      rate[i] = clamp(w / TAU, 0.3, 9);
      const pk = still ? 0 : clamp((0.32 - dm) / 0.22);
      pairK[i] += (pk - pairK[i]) * (1 - Math.exp(-dt / 0.4));
      trem[i] += rate[i] * dt * TAU;
      const v = Math.hypot(b.vx, b.vy), target = still ? 0 : b.level * (0.05 + 0.55 * pairK[i]) * clamp(0.3 + v * 0.4);
      b.amp += (target - b.amp) * (1 - Math.exp(-dt / 0.08)); b.hz = hzOf(b);
    });
    for (let i = 0; i < 3; i++) {                       // близкий пролёт пары — соединение: обе ноты разом и шорох
      const a = bodies[i], j = (i + 1) % 3, b = bodies[j], d = Math.hypot(a.x - b.x, a.y - b.y), cl = d < 0.1;
      if (cl && !near[i] && !still && now - conjAt[i] > 0.4) { conjAt[i] = now; const pan = clamp((a.x + b.x) / 2, -1, 1); emit({ t: 'bell', i, f: a.hz, vel: 1, pan }); emit({ t: 'bell', i: j, f: b.hz, vel: 1, pan }); emit({ t: 'burst', f: Math.sqrt(a.hz * b.hz) * 2, pan, k: 0.6 }); flashes.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, i, t: now, kind: 'conj' }); }
      near[i] = cl;
    }
    emit({ t: 'drone' });
  }
  function tick(dt) {
    const now = (state.time += dt), h = Math.min(DT_MAX, dt);
    physics(h);
    voice(h, now);
    if (!state.still) for (const b of bodies) { b.trail.push(b.x, b.y); if (b.trail.length > 360) b.trail.splice(0, 2); }
  }

  // ---------- действия ----------
  function plumb() {                                    // отвес: тяга выкл — всё падает на дно; ещё раз — тяга снова
    state.cadit = !state.cadit; state.lux = false; if (state.still) { state.still = false; start(); }
  }
  function anchor(i) { const b = bodies[i]; b.fixed = !b.fixed; b.vx = b.vy = 0; }   // двойной тап — якорь
  function grab(i) { bodies[i].held = true; state.lux = false; }
  function drop(i) { bodies[i].held = false; }          // держишь без движения — открылась плашка: тело отпущено
  function drag(i, x, y) { const b = bodies[i]; b.x = x; b.y = y; b.vx = b.vy = 0; if (state.still) { state.still = false; start(); } }
  function release(i, v) {                              // v {vx, vy} — бросок (тело двигали), null — тап
    const b = bodies[i];
    b.held = false; eDirty = true; if (v) fresh = true;   // порог энергии — только у броска, не у тапа
    if (v && !b.fixed) { b.vx = v.vx; b.vy = v.vy; }
    if (state.still && v) { state.still = false; start(); }
  }
  function setBody(i, k, v) {                           // плашка тела: v — 0…1
    const b = bodies[i];
    if (k === 'm') b.m = 0.3 + v * 2.7; else if (k === 'semi') b.semi = Math.round(v * 36) - 12; else if (k === 'fixed') { b.fixed = v >= 0.5; if (b.fixed) b.vx = b.vy = 0; } else b.level = v;
  }
  function setFx(k, v) { fx[k] = v; emit({ t: 'fx' }); }
  function loadFx(o) { Object.assign(fx, o); emit({ t: 'fx' }); }
  function dice() {                                     // тела разбросаны и брошены, массы и ноты — аккорд
    const R = rng, chords = [[0, 7, 12], [0, 3, 7], [0, 5, 10], [-5, 0, 7], [0, 4, 11]], ch = chords[Math.floor(R() * chords.length)];
    bodies.forEach((b, i) => { const a = R() * TAU, r = 0.25 + R() * 0.55; b.x = Math.cos(a) * r; b.y = Math.sin(a) * r; b.vx = (R() - 0.5) * 1.6; b.vy = (R() - 0.5) * 1.6; b.m = 0.6 + R() * 1.2; b.semi = ch[i]; b.fixed = false; b.trail = []; });
    state.lux = false; state.cadit = false; state.still = false; eDirty = true; fresh = true; start();
  }
  function clear() { state.still = true; state.lux = false; state.cadit = false; bodies.forEach((b) => { b.vx = b.vy = 0; b.trail = []; }); }
  const snapshot = () => JSON.stringify({ b: bodies.map((b) => Object.fromEntries(BODY_KEYS.map((k) => [k, b[k]]))), fx, still: state.still, lux: state.lux, cadit: state.cadit });
  function restore(js) {
    const st = JSON.parse(js);
    st.b.forEach((q, i) => Object.assign(bodies[i], q, { trail: [] }));
    Object.assign(fx, st.fx); state.still = st.still; state.lux = st.lux; state.cadit = !!st.cadit; eDirty = true; emit({ t: 'fx' });
    if (!state.still) start();
  }

  return {
    state, hzOf, baseHz, tonic, rays, Gc,
    energy: () => { const e = energy(); return e.K + e.U; },
    fiatLux, plumb, anchor, grab, drop, drag, release, setBody, setFx, loadFx, dice, clear,
    tick, snapshot, restore, sounding: () => !state.still,
    listen(fn) { listeners.push(fn); },
  };
}
