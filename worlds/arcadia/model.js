// Arcadia — модель: страна из зерна (genLand — чистая функция зерна) и странники с их путями. Только данные и алгоритм — без DOM, холста и Web Audio.
// Время — секунды (tick(dt)), случайность — rng (кубик), лад — scale { on, snap, root }. Петли бродят в worklet: где их центры, модели сообщает склейка (track).
// Что должно прозвучать — события слушателям (listen): { t: 'trav', tr, on, route, added? } — странник целиком (route — путь пересчитан), 'land' — новая страна, 'fx'.
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const GX = 80, GY = 160, ASP = 3.2, VMAX = 4, SEMIS = 24;   // страна вглубь в 3.2 раза длиннее, чем вширь: в перспективе она сжимается к горизонту
export const K = 2.4, Q1 = 1 / (1 + K);                  // сила перспективы: нота ровно по высоте экрана (depthOf) — та же мера, что у картинки
export const MONTES = ['Cyllene', 'Maenalus', 'Lycaeus', 'Erymanthus', 'Parthenius', 'Aroania', 'Artemisius', 'Ostracina'];
export const LACUS = ['Lacus Stymphalis', 'Lacus Pheneus', 'Lacus Orchomenius', 'Lacus Clitorius'];
export const FLUMINA = ['Ladon', 'Alpheus', 'Styx', 'Helisson', 'Tragus', 'Erymanthus'];
export const FIGS = ['circle', 'eight', 'knot'], PATHS = ['still', 'circuit', 'wander', 'river', 'summit'];
export const T_KEYS = ['u', 'v', 'oct', 'r', 'fig', 'mode', 'sp', 'lvl'];   // что странника сохраняется в снимке
export const FX_DEF = { relief: 0.3, pace: 0.35, wind: 0, chorus: 0.35, phaser: 0, spread: 0.6, hall: 0.4 };
export const SEED0 = 20261021;

// ---------- страна: горные цепи, холмы, озёра в котловинах, реки с гор вниз; сетка высот GX × GY, всё — из зерна ----------
export function seedRng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// u — с запада на восток (−1…1), v — с юга на север (−1…1); по высоте карта в ASP раз длиннее — расстояния на местности: (du, dv·ASP)
export function bil(arr, u, v) {
  const gx = clamp((u + 1) * 0.5 * (GX - 1), 0, GX - 1.001), gy = clamp((v + 1) * 0.5 * (GY - 1), 0, GY - 1.001), i = gx | 0, j = gy | 0, fx = gx - i, fy = gy - j;
  return (arr[j * GX + i] * (1 - fx) + arr[j * GX + i + 1] * fx) * (1 - fy) + (arr[(j + 1) * GX + i] * (1 - fx) + arr[(j + 1) * GX + i + 1] * fx) * fy;
}
export const dist = (u0, v0, u1, v1) => Math.hypot(u1 - u0, (v1 - v0) * ASP);
export const gradOf = (arr, u, v, e = 0.03) => [(bil(arr, u + e, v) - bil(arr, u - e, v)) / (2 * e), (bil(arr, u, v + e / ASP) - bil(arr, u, v - e / ASP)) / (2 * e)];   // уклон на местности
const eachCell = (fn) => { for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) fn((i / (GX - 1)) * 2 - 1, (j / (GY - 1)) * 2 - 1, j * GX + i); };
export function genLand(seed) {
  const R = seedRng(seed), gs = [], lakes = [], rivers = [];
  const ranges = 3 + Math.floor(R() * 2);
  for (let r = 0; r < ranges; r++) {                    // горная цепь: несколько вершин вдоль изогнутой линии
    let u = R() * 1.2 - 0.6, v = (r / ranges) * 1.7 - 0.85 + R() * 0.25, a = R() * TAU;
    const n = 3 + Math.floor(R() * 3);
    for (let k = 0; k < n; k++) {
      gs.push({ u, v, h: 0.55 + 0.45 * R(), s: 0.075 + 0.07 * R() });
      const st = 0.12 + 0.07 * R();
      u = clamp(u + Math.cos(a) * st, -0.9, 0.9); v = clamp(v + (Math.sin(a) * st) / ASP, -0.92, 0.92); a += (R() - 0.5) * 1.1;
    }
  }
  const hills = 16 + Math.floor(R() * 8);
  for (let k = 0; k < hills; k++) gs.push({ u: R() * 1.9 - 0.95, v: R() ** 1.6 * 1.9 - 0.95, h: 0.08 + 0.26 * R(), s: 0.07 + 0.16 * R() });   // холмов больше ближе к нам — там просторнее
  const waves = Array.from({ length: 6 }, (_, k) => { const a = R() * TAU, f = 2.2 + k * 1.3 + R(); return { fx: Math.cos(a) * f, fy: Math.sin(a) * f, ph: R() * TAU, amp: 0.07 / (1 + k * 0.45) }; });   // пологие складки — равнина не плоская
  const nl = 2 + (R() < 0.5 ? 1 : 0);
  for (let k = 0; k < nl; k++) {                         // озеро — котловина подальше от гор
    let best = null;
    for (let tries = 0; tries < 24; tries++) {
      const u = R() * 1.4 - 0.7, v = R() * 1.7 - 0.85, d = Math.min(...gs.filter((g) => g.h > 0.5).map((g) => dist(g.u, g.v, u, v)), ...lakes.map((l) => dist(l.u, l.v, u, v) * 0.8));
      if (!best || d > best.d) best = { u, v, d };
    }
    const w = 0.16 + 0.1 * R();
    lakes.push({ u: best.u, v: best.v, w, name: LACUS[(seed + k) % LACUS.length] });
    gs.push({ u: best.u, v: best.v, h: -0.5, s: w * 0.8 });
    for (let j = 0; j < 2; j++) { const a = R() * TAU; gs.push({ u: best.u + Math.cos(a) * w * 0.55, v: best.v + (Math.sin(a) * w * 0.55) / ASP, h: -0.3, s: w * (0.45 + 0.25 * R()) }); }   // котловина неровная — берег не круглый
  }
  const z = new Float32Array(GX * GY), lake = new Float32Array(GX * GY);
  eachCell((u, v, q) => {
    let h = 0;
    for (const w of waves) h += w.amp * Math.sin(w.fx * u + w.fy * v * ASP + w.ph);
    for (const g of gs) { const d2 = (u - g.u) ** 2 + ((v - g.v) * ASP) ** 2; if (d2 < 18 * g.s * g.s) h += g.h * Math.exp(-d2 / (2 * g.s * g.s)); }
    z[q] = h;
  });
  const grad = (u, v) => gradOf(z, u, v);
  const tops = gs.filter((g) => g.h > 0.5).sort((a, b) => b.h - a.h);
  const nr = 2 + (R() < 0.4 ? 1 : 0);
  for (let k = 0; k < Math.min(nr, tops.length); k++) {  // река: с горы вниз по склону, с излучинами, до озера или края
    const src = tops[k === 0 ? 0 : Math.min(tops.length - 1, 2 + Math.floor(R() * 2))];
    let u = src.u + (R() - 0.5) * 0.08, v = src.v + (R() - 0.5) * 0.08, du = 0, dv = 0, ph = R() * TAU;
    const pts = [[u, v]];
    let pond = false;
    for (let s = 0; s < 190; s++) {
      const [gx, gy] = grad(u, v), gl = Math.hypot(gx, gy) || 1;
      let nx = -gx / gl, ny = -gy / gl;
      if (s) { nx = du * 0.6 + nx * 0.4; ny = dv * 0.6 + ny * 0.4; }
      const m = Math.sin(s * 0.42 + ph) * 0.45;                  // излучины
      let mx = nx - ny * m, my = ny + nx * m; const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
      u += mx * 0.022; v += (my * 0.022) / ASP; du = mx; dv = my;
      pts.push([u, v]);
      if (Math.abs(u) > 0.99 || Math.abs(v) > 0.99) break;
      if (lakes.some((l) => dist(u, v, l.u, l.v) < l.w * 0.6)) break;
      if (s > 14) { const b = pts[pts.length - 13]; if (dist(u, v, b[0], b[1]) < 0.11) { pond = true; break; } }   // застряла в ложбине — там пруд
    }
    if (pond) { const e = pts[pts.length - 1]; let cut = pts.findIndex((p) => dist(p[0], p[1], e[0], e[1]) < 0.06); if (cut < 1) cut = pts.length - 1; pts.length = cut + 1; lakes.push({ u: e[0], v: e[1], w: 0.07, name: '', pond: true }); }
    if (pts.length > 12) rivers.push({ pts, name: FLUMINA[(seed + k * 3) % FLUMINA.length] });
  }
  for (const rv of rivers) {                             // русло: долина вдоль реки, к устью глубже и шире
    const P = rv.pts, n = P.length;
    eachCell((u, v, q) => {
      let bd = 9, bk = 0;
      for (let k = 0; k < n; k += 2) { const d = (u - P[k][0]) ** 2 + ((v - P[k][1]) * ASP) ** 2; if (d < bd) { bd = d; bk = k; } }
      const t = bk / (n - 1), s = 0.028 + 0.02 * t;
      z[q] -= (0.08 + 0.12 * t) * Math.exp(-bd / (2 * s * s));
    });
  }
  for (const l of lakes) {                               // вода в котловине — до уровня берега: берег идёт по горизонтали
    let lev = 0; for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; lev += bil(z, l.u + Math.cos(a) * l.w, l.v + (Math.sin(a) * l.w) / ASP); }
    lev = lev / 16 - 0.03; l.level = lev;
    eachCell((u, v, q) => {
      const d = dist(u, v, l.u, l.v);
      if (d > l.w * 1.5) return;
      const m = clamp((lev - z[q]) / 0.035) * clamp((l.w * 1.5 - d) / (l.w * 0.3));
      if (m > lake[q]) { lake[q] = m; z[q] = z[q] * (1 - m) + lev * m; }
    });
  }
  let mean = 0, mx = 1e-6;
  for (let q = 0; q < z.length; q++) mean += z[q];
  mean /= z.length;
  for (let q = 0; q < z.length; q++) { z[q] -= mean; mx = Math.max(mx, Math.abs(z[q])); }
  for (let q = 0; q < z.length; q++) z[q] /= mx;
  const peaks = [];                                      // вершины: локальные максимумы повыше, не теснее 0.25
  for (let j = 1; j < GY - 1; j++) for (let i = 1; i < GX - 1; i++) {
    const q = j * GX + i, h = z[q];
    if (h < 0.4) continue;
    let top = true; for (let dj = -1; dj <= 1 && top; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && z[q + dj * GX + di] > h) { top = false; break; }
    if (top) peaks.push({ u: (i / (GX - 1)) * 2 - 1, v: (j / (GY - 1)) * 2 - 1, h });
  }
  peaks.sort((a, b) => b.h - a.h);
  const kept = [];
  for (const p of peaks) if (kept.every((k) => dist(k.u, k.v, p.u, p.v) > 0.25)) kept.push(p);
  kept.slice(0, 8).forEach((p, k) => { p.name = k < 3 ? MONTES[(seed + k * 5) % MONTES.length] : ''; });
  return { seed, z, lake, peaks: kept.slice(0, 8), lakes, rivers };
}
export const figPt = (fig, a) => (fig === 1 ? [Math.sin(a), 0.55 * Math.sin(2 * a)] : fig === 2 ? [Math.sin(2 * a), 0.8 * Math.sin(3 * a + 0.7)] : [Math.cos(a), Math.sin(a)]);   // петля: круг, восьмёрка, узел 2 : 3
export const depthOf = (v) => { const q = 1 / (1 + K * (v + 1) / 2); return 1 - (q - Q1) / (1 - Q1); };   // 0 у нижней рамки … 1 на горизонте — ровно по экрану

export function createModel({ scale = { on: false, snap: (s) => s, root: 0 }, rng = Math.random } = {}) {
  const travellers = [];                                 // {slot, id, u, v (дом), oct, r (орбита), fig, mode (путь), sp (размах), lvl, route, trail}
  const fx = { ...FX_DEF };
  const state = { travellers, fx, land: genLand(SEED0), time: 0 };
  let seen = Array.from({ length: VMAX }, () => [0, 0, 0.2]), trailAt = -Infinity, serial = 0;   // seen — центры петель, как их сообщил worklet
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };

  const zAt = (u, v) => bil(state.land.z, u, v);
  const lakeAt = (u, v) => bil(state.land.lake, u, v);
  function routeOf(t) {                                  // путь вниз (к воде) или вверх (к вершине) по склону от дома
    const dir = t.mode === 3 ? -1 : 1, pts = [t.u, t.v];
    let u = t.u, v = t.v;
    for (let k = 0; k < 90; k++) {
      const [gx, gy] = gradOf(state.land.z, u, v), gl = Math.hypot(gx, gy);
      if (gl < 0.04) break;
      u += (dir * 0.024 * gx) / gl; v += (dir * 0.024 * gy) / gl / ASP;
      if (Math.abs(u) > 0.96 || Math.abs(v) > 0.96) break;
      pts.push(u, v);
      if (dir < 0 && lakeAt(u, v) > 0.5) break;
    }
    return pts;
  }
  const root = () => (scale.on ? scale.root : 0);
  function semiOf(t) {                                   // вглубь — выше: две октавы от нижней рамки до горизонта, полутоны ровно по высоте экрана; с ладом — ступени
    let s = Math.round(depthOf(t.v) * SEMIS) + root();
    if (scale.on) s = scale.snap(s + 12) - 12;
    return s;
  }
  const hzOf = (t) => 110 * 2 ** (semiOf(t) / 12) * 2 ** (t.oct || 0);

  function voice(t, on = true, route = true, added = false) {   // странник → звук; route — путь пересчитать (дом, страна или путь сменились)
    if (route) t.route = t.mode >= 3 ? routeOf(t) : null;
    emit(added ? { t: 'trav', tr: t, on, route, added } : { t: 'trav', tr: t, on, route });
  }
  function addT(u, v, o = {}) {
    const used = new Set(travellers.map((t) => t.slot)), slot = [...Array(VMAX).keys()].find((k) => !used.has(k));
    if (slot == null) return null;
    const t = { slot, id: ++serial, u, v, oct: 0, r: 0.16, fig: 0, mode: 2, sp: 0.22, lvl: 0.8, route: null, trail: [], ...o };
    travellers.push(t); voice(t, true, true, true);
    return t;
  }
  function dropT(t) { voice(t, false, false); travellers.splice(travellers.indexOf(t), 1); }
  function moveT(t, u, v) { t.u = u; t.v = v; t.trail = []; voice(t); }
  function setT(t, patch, route = false) { if (!travellers.includes(t)) return; Object.assign(t, patch); voice(t, true, route); }
  function setFx(k, v) { fx[k] = v; emit({ t: 'fx' }); }
  function loadFx(o) { Object.assign(fx, o); emit({ t: 'fx' }); }
  function newLand(seed) {
    state.land = genLand(seed);
    emit({ t: 'land', land: state.land });
    for (const t of travellers) voice(t);
  }
  function clear() { while (travellers.length) dropT(travellers[0]); }
  function track(c) { seen = c; }                       // где сейчас центры петель (из worklet)
  function tick(dt) {                                    // след блуждания — последние ~5 с, отметка раз в 0.12 с
    state.time += dt;
    if (state.time - trailAt <= 0.12) return;
    trailAt = state.time;
    for (const t of travellers) { const c = seen[t.slot]; if (!c || t.mode !== 2) { t.trail.length = 0; continue; } t.trail.push([c[0], c[1]]); if (t.trail.length > 40) t.trail.shift(); }
  }
  function dice() {                                     // новая страна; два-три странника на ступенях лада, пути и петли — вразброс
    const R = rng;
    clear();
    newLand((R() * 2147483646) | 0);
    const n = 2 + Math.floor(R() * 2);
    for (let k = 0; k < n; k++) {
      let u = 0, v = 0;
      for (let tries = 0; tries < 20; tries++) { u = R() * 1.6 - 0.8; v = R() * 1.5 - 0.75; if (lakeAt(u, v) < 0.2) break; }
      addT(u, v, { r: 0.08 + R() * 0.3, fig: R() < 0.6 ? 0 : 1 + Math.floor(R() * 2), mode: 1 + Math.floor(R() * 4), sp: 0.12 + R() * 0.3, oct: R() < 0.25 ? -1 : 0 });
    }
  }
  const snapshot = () => JSON.stringify({ seed: state.land.seed, t: travellers.map((t) => Object.fromEntries(T_KEYS.map((k) => [k, t[k]]))), fx });
  function restore(js) {
    const st = JSON.parse(js);
    clear();
    if (st.seed !== state.land.seed) newLand(st.seed);
    for (const q of st.t) addT(q.u, q.v, q);
    loadFx(st.fx);
  }

  return {
    state, zAt, lakeAt, routeOf, root, semiOf, hzOf,
    addT, dropT, moveT, setT, setFx, loadFx, newLand, clear, dice,
    track, tick, snapshot, restore, sounding: () => travellers.length > 0,
    listen(fn) { listeners.push(fn); },
  };
}
