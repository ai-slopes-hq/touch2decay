// Arcadia — мир XII: гравированная карта холмистой страны — горы, холмы, озёра, реки. Звук — синтез по рельефу
// (terrain-worklet.js): пейзаж — поверхность высот, а странник обходит по ней маленькую петлю со звуковой частотой —
// высоты под петлёй и есть форма волны. Тап по земле — странник (знак Δ), вокруг него петля-орбита; север — выше нота,
// юг — ниже (деления по левому краю карты — полутоны), а земля под петлёй — тембр: на ровном склоне почти синус, через хребет —
// богато. Тянешь край петли — шире или уже. Петля сама бродит (путь): стоит, кругом, наугад, вниз по реке к озеру или вверх
// к вершине. Тап по страннику — уходит, держишь — плашка. Кубик — новая страна и новые пути. FX: relief (складки), pace
// (как быстро ходят), wind (петли дрожат, озёра рябят), spread, hall. Солнце — четвертью в правом верхнем углу: тап — карта.
(() => {
  'use strict';
  const T = window.T2D;
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const INK = '40,46,32', PAPER = '224,221,198', BGC = `rgb(${PAPER})`, WATER = [46, 86, 104];   // гравюра на зеленоватой бумаге
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
  const GX = 80, GY = 160, ASP = 3.2, VMAX = 4, SEMIS = 24;   // страна вглубь в 3.2 раза длиннее, чем вширь: в перспективе она сжимается к горизонту
  const MONTES = ['Cyllene', 'Maenalus', 'Lycaeus', 'Erymanthus', 'Parthenius', 'Aroania', 'Artemisius', 'Ostracina'];
  const LACUS = ['Lacus Stymphalis', 'Lacus Pheneus', 'Lacus Orchomenius', 'Lacus Clitorius'];
  const FLUMINA = ['Ladon', 'Alpheus', 'Styx', 'Helisson', 'Tragus', 'Erymanthus'];
  const FIGS = ['circle', 'eight', 'knot'], PATHS = ['still', 'circuit', 'wander', 'river', 'summit'];

  // ---------- страна: горные цепи, холмы, озёра в котловинах, реки с гор вниз; сетка высот GX × GY, всё — из зерна ----------
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  // u — с запада на восток (−1…1), v — с юга на север (−1…1); по высоте карта в ASP раз длиннее — расстояния на местности: (du, dv·ASP)
  function bil(arr, u, v) {
    const gx = clamp((u + 1) * 0.5 * (GX - 1), 0, GX - 1.001), gy = clamp((v + 1) * 0.5 * (GY - 1), 0, GY - 1.001), i = gx | 0, j = gy | 0, fx = gx - i, fy = gy - j;
    return (arr[j * GX + i] * (1 - fx) + arr[j * GX + i + 1] * fx) * (1 - fy) + (arr[(j + 1) * GX + i] * (1 - fx) + arr[(j + 1) * GX + i + 1] * fx) * fy;
  }
  const dist = (u0, v0, u1, v1) => Math.hypot(u1 - u0, (v1 - v0) * ASP);
  const gradOf = (arr, u, v, e = 0.03) => [(bil(arr, u + e, v) - bil(arr, u - e, v)) / (2 * e), (bil(arr, u, v + e / ASP) - bil(arr, u, v - e / ASP)) / (2 * e)];   // уклон на местности
  const eachCell = (fn) => { for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) fn((i / (GX - 1)) * 2 - 1, (j / (GY - 1)) * 2 - 1, j * GX + i); };
  function genLand(seed) {
    const R = rng(seed), gs = [], lakes = [], rivers = [];
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
  let land = genLand(20261021);
  const zAt = (u, v) => bil(land.z, u, v);
  const lakeAt = (u, v) => bil(land.lake, u, v);
  function routeOf(t) {                                     // путь вниз (к воде) или вверх (к вершине) по склону от дома
    const dir = t.mode === 3 ? -1 : 1, pts = [t.u, t.v];
    let u = t.u, v = t.v;
    for (let k = 0; k < 90; k++) {
      const [gx, gy] = gradOf(land.z, u, v), gl = Math.hypot(gx, gy);
      if (gl < 0.04) break;
      u += (dir * 0.024 * gx) / gl; v += (dir * 0.024 * gy) / gl / ASP;
      if (Math.abs(u) > 0.96 || Math.abs(v) > 0.96) break;
      pts.push(u, v);
      if (dir < 0 && lakeAt(u, v) > 0.5) break;
    }
    return pts;
  }

  // ---------- странники ----------
  const travellers = [];                                   // {slot, u, v (дом), oct, r (орбита), fig, mode (путь), sp (размах), lvl, born, route}
  const fx = { relief: 0.3, pace: 0.35, wind: 0, spread: 0.6, hall: 0.4 };
  const root = () => (T.scaleOn ? T.scaleRoot : 0);
  const depthOf = (v) => { const q = 1 / (1 + K * (v + 1) / 2); return 1 - (q - Q1) / (1 - Q1); };   // 0 у нижней рамки … 1 на горизонте — ровно по экрану
  function semiOf(t) {                                     // вглубь — выше: две октавы от нижней рамки до горизонта, полутоны ровно по высоте экрана; с ладом — ступени
    let s = Math.round(depthOf(t.v) * SEMIS) + root();
    if (T.scaleOn) s = T.snapSemi(s + 12) - 12;
    return s;
  }
  const hzOf = (t) => 110 * 2 ** (semiOf(t) / 12) * 2 ** (t.oct || 0);
  const noteName = (f) => { const m = Math.round(12 * Math.log2(f / 55)); return `${NOTES[((m % 12) + 12) % 12]}${Math.floor((m + 9) / 12) + 1}`; };

  // ---------- геометрия: пейзаж в псевдоперспективе, как в Natura — горизонт сверху, ближе к нам крупнее ----------
  // u — поперёк (ширина не сходится), v — вглубь: v = −1 у нижней рамки, v = 1 на горизонте; K — сила перспективы
  const K = 2.4, Q1 = 1 / (1 + K);
  function geo() {
    const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, Ws = Math.min(W, (H - T.safeBot) * 0.62), cx = W / 2;
    const fx0 = cx - Ws / 2 + 7, fx1 = cx + Ws / 2 - 7, Wh = (fx1 - fx0) / 2 - 10;
    const hor = top + Math.max(64, (bot - top) * 0.17), gb = bot - 40;
    return { W, H, top, bot, cx, Ws, fx0, fx1, Wh, hor, gb, EL: (gb - hor) * 0.14, sun: { x: W, y: T.topY + 2, r: Math.min(42, W * 0.11) } };
  }
  function proj(G, u, v) { const t = (v + 1) / 2, q = 1 / (1 + K * t); return { x: G.cx + u * G.Wh, y: G.hor + ((G.gb - G.hor) * (q - Q1)) / (1 - Q1), s: q }; }
  function unproj(G, x, y) { const q = Q1 + clamp((y - G.hor) / (G.gb - G.hor)) * (1 - Q1); return { u: (x - G.cx) / G.Wh, v: 2 * ((1 / q - 1) / K) - 1 }; }
  const lift = (G, u, v, s) => Math.max(0, zAt(u, v)) * G.EL * s;   // земля поднимается холмами
  function at(G, u, v) { const p = proj(G, u, v); p.y -= lift(G, u, v, p.s); return p; }
  function pick(G, x, y) {                                  // что под пальцем: луч от нас вглубь до первой земли, что выше точки
    const u = clamp((x - G.cx) / G.Wh, -1, 1);
    for (let k = 0; k <= 300; k++) { const v = -1 + (2 * k) / 300; if (at(G, u, v).y <= y) return { u, v }; }
    return null;                                            // небо
  }

  // ---------- звук ----------
  let actx = null, node = null, bus = null, ready = false, started = false, lastSound = 0;
  let centers = Array.from({ length: VMAX }, () => [0, 0, 0.2]), gains = new Array(VMAX).fill(0);
  const queue = [];
  const send = (m) => { if (node && ready) node.port.postMessage(m); else queue.push(m); };
  const VER = (document.currentScript && new URL(document.currentScript.src, location.href).searchParams.get('v')) || '0';
  function build(ctx, input) {
    actx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const pre = g(1), out = g(1.5), hallSend = g(0), h = T.hall();
    pre.connect(out); pre.connect(hallSend); hallSend.connect(h.input); h.out.connect(g(0.9)).connect(out);
    bus = { pre, out, hallSend, hall: h, input, live: false };
    ready = false; node = null; started = false;
    applyFx();
  }
  function start() {                                       // модуль рельефа — только когда в мир впервые зашли
    if (started || !actx) return;
    started = true;
    actx.audioWorklet.addModule(`terrain-worklet.js?v=${VER}`).then(() => {
      node = new AudioWorkletNode(actx, 'terrain', { numberOfInputs: 0, outputChannelCount: [2] });
      node.connect(bus.pre);
      node.port.onmessage = (e) => { const d = e.data; if (d.t === 'p') { centers = d.c; gains = d.g; } };
      ready = true;
      node.port.postMessage({ t: 'terrain', z: land.z, lake: land.lake, gx: GX, gy: GY, asp: ASP, now: true });
      applyFx();
      for (const t of travellers) sendT(t);
      while (queue.length) node.port.postMessage(queue.shift());
    }).catch(() => { started = false; });
  }
  function setLive(on) {
    if (!bus || bus.live === on) return;
    bus.live = on;
    if (on) bus.out.connect(bus.input); else bus.out.disconnect();
  }
  setInterval(() => {
    if (!bus) return;
    if (travellers.length || gains.some((x) => x > 0.002)) lastSound = performance.now();
    else if (performance.now() - lastSound > 8000) setLive(false);
  }, 1000);
  function applyFx() {
    if (!bus) return;
    const t = actx.currentTime;
    bus.hallSend.gain.setTargetAtTime(fx.hall * fx.hall * 1.4, t, 0.05);
    for (const l of bus.hall.lines) l.g.gain.setTargetAtTime(10 ** ((-3 * l.len) / (1.5 + fx.hall * 4.5)), t, 0.05);
    send({ t: 'params', relief: fx.relief, speed: 0.01 * 40 ** fx.pace, wind: fx.wind, spread: fx.spread });
  }
  function sendT(t, on = true, withRoute = true) {
    const m = { t: 'voice', i: t.slot, on, f: hzOf(t), hx: t.u, hy: t.v, r: t.r, fig: t.fig, lvl: t.lvl * 0.7, mode: t.mode, sp: t.sp, pan: t.u * 0.8 };
    if (withRoute) { t.route = t.mode >= 3 ? routeOf(t) : null; m.route = t.route; }
    send(m);
    if (on) { setLive(true); lastSound = performance.now(); }
  }
  function addT(u, v, o = {}) {
    const used = new Set(travellers.map((t) => t.slot)), slot = [...Array(VMAX).keys()].find((k) => !used.has(k));
    if (slot == null) return null;
    start();
    const t = { slot, u, v, oct: 0, r: 0.16, fig: 0, mode: 2, sp: 0.22, lvl: 0.8, born: performance.now(), route: null, trail: [], ...o };
    travellers.push(t); sendT(t);
    return t;
  }
  function dropT(t) { T.lfoClear(`arc-t${t.slot}-${t.born}`); sendT(t, false, false); travellers.splice(travellers.indexOf(t), 1); }
  function newLand(seed) {
    land = genLand(seed);
    send({ t: 'terrain', z: land.z, lake: land.lake, gx: GX, gy: GY, asp: ASP });
    for (const t of travellers) sendT(t);
  }
  const sounding = () => travellers.length > 0;

  // ---------- касания ----------
  const touches = new Map();
  const flagAt = (G, t) => at(G, t.u, t.v);
  function homeAt(G, x, y) {                                // флажок странника: древко над точкой
    let best = null, bd = 24;
    for (const t of travellers) { const p = flagAt(G, t), d = Math.min(Math.hypot(x - p.x, y - p.y), Math.hypot(x - p.x - 4, y - p.y + 14)); if (d < bd) { bd = d; best = t; } }
    return best;
  }
  function loopPts(G, t, n = 72) {                          // петля на земле: по кругу (восьмёркой, узлом), поднята холмами
    const cc = centers[t.slot] || [t.u, t.v, t.r], r = cc[2] || t.r, out = [];
    for (let k = 0; k <= n; k++) { const [du, dv] = figPt(t.fig, (k / n) * TAU), u = cc[0] + r * du, v = cc[1] + (r * dv) / ASP; out.push(at(G, u, v)); }
    return out;
  }
  function rimAt(G, x, y) {                                 // край петли: тянешь — шире или уже
    for (const t of travellers) { if (t.r < 0.06) continue; for (const p of loopPts(G, t, 48)) if (Math.hypot(x - p.x, y - p.y) < 12) return t; }
    return null;
  }
  function down(f) {
    start();
    const G = geo(), now = performance.now(), h = homeAt(G, f.x, f.y), rim = rimAt(G, f.x, f.y);
    const hd = h ? Math.hypot(f.x - flagAt(G, h).x, f.y - flagAt(G, h).y) : 99;
    if (rim && hd > 12) { touches.set(f.id, { kind: 'rim', t: rim, x0: f.x, y0: f.y }); return; }   // край петли важнее, если не прямо во флажок
    if (h) { touches.set(f.id, { kind: 'home', t: h, x0: f.x, y0: f.y, t0: now, moved: false }); return; }
    const q = f.x > G.fx0 && f.x < G.fx1 && f.y < G.bot ? pick(G, f.x, f.y) : null;
    if (q) {
      const t = addT(q.u, clamp(q.v, -0.98, 0.98));
      touches.set(f.id, t ? { kind: 'home', t, x0: f.x, y0: f.y, t0: now, moved: false, fresh: true } : { kind: 'none' });
      return;
    }
    touches.set(f.id, { kind: 'none' });
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t || t.kind === 'none' || t.sheet) return;
    const G = geo();
    if (t.kind === 'rim') {
      const q = unproj(G, f.x, f.y), c = centers[t.t.slot] || [t.t.u, t.t.v];
      t.t.r = clamp(dist(c[0], c[1], q.u, q.v), 0.03, 0.6); sendT(t.t, true, false); return;
    }
    if (Math.hypot(f.x - t.x0, f.y - t.y0) > 8) t.moved = true;
    if (!t.moved) return;
    const q = pick(G, clamp(f.x, G.fx0, G.fx1), Math.max(f.y, G.hor - 30)) || unproj(G, f.x, G.hor);
    t.t.u = clamp(q.u, -0.98, 0.98); t.t.v = clamp(q.v, -0.98, 0.98); t.t.trail = [];
    sendT(t.t);
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (t && t.kind === 'home' && !t.moved && !t.fresh && !t.sheet && performance.now() - t.t0 < 300 && travellers.includes(t.t)) dropT(t.t);   // тап по страннику — уходит
  }
  function tSheet(t) {
    T.openSheet({
      title: 'viator', hint: 'wanderer — tap outside to close',
      rows: [{ key: 'oct', label: 'octave' }, { key: 'r', label: 'orbit' }, { key: 'fig', label: 'figure' }, { key: 'mode', label: 'path' }, { key: 'sp', label: 'range' }, { key: 'lvl', label: 'level' }],
      lfo: { id: `arc-t${t.slot}-${t.born}`, keys: ['r', 'sp', 'lvl'], shapes: 'random' },   // «~» на orbit — петля дышит, тембр то проще, то богаче
      get: (k) => (k === 'oct' ? (t.oct + 1) / 2 : k === 'r' ? (t.r - 0.03) / 0.57 : k === 'fig' ? t.fig / 2 : k === 'mode' ? t.mode / 4 : k === 'sp' ? t.sp / 0.6 : t.lvl),
      set: (k, v) => {
        if (!travellers.includes(t)) return;
        if (k === 'oct') t.oct = Math.round(v * 2) - 1; else if (k === 'r') t.r = 0.03 + v * 0.57; else if (k === 'fig') t.fig = Math.round(v * 2);
        else if (k === 'mode') t.mode = Math.round(v * 4); else if (k === 'sp') t.sp = v * 0.6; else t.lvl = v;
        sendT(t, true, k === 'mode');
      },
      text: (k) => (k === 'oct' ? ['octave −1', 'octave 0', 'octave +1'][t.oct + 1] : k === 'fig' ? FIGS[t.fig] : k === 'mode' ? PATHS[t.mode] : k === 'r' ? `${Math.round(t.r * 100)}%` : `${Math.round((k === 'sp' ? t.sp / 0.6 : t.lvl) * 100)}%`),
    });
  }
  function tick(now) {
    for (const t of touches.values()) if (t.kind === 'home' && !t.moved && !t.sheet && !t.fresh && now - t.t0 > T.HOLD_MS) { t.sheet = true; tSheet(t.t); }
    if (now - (tick.at || 0) > 120) {                     // след блуждания — последние ~5 с
      tick.at = now;
      for (const t of travellers) { const c = centers[t.slot]; if (!c || t.mode !== 2) { t.trail.length = 0; continue; } t.trail.push([c[0], c[1]]); if (t.trail.length > 40) t.trail.shift(); }
    }
  }

  // ---------- рисование: гравюра — горы и холмы рядами от горизонта к нам, леса, озёра штриховкой, реки ----------
  const ink = (a) => `rgba(${INK},${a})`;
  let wallC = null, wallKey = '';
  function mountain(x, X, Y, h, w, s, lean, snow) {          // гора: два склона к вершине, правый в тени — штрихи, на высоких — снег
    const px = X + lean * w * 0.15, py = Y - h;
    x.fillStyle = `rgb(${PAPER})`; x.strokeStyle = ink(0.85); x.lineWidth = 0.7 + 0.5 * s;
    x.beginPath(); x.moveTo(X - w / 2, Y); x.quadraticCurveTo(X - w * 0.2, Y - h * 0.45, px, py); x.quadraticCurveTo(X + w * 0.18, Y - h * 0.5, X + w / 2, Y); x.fill(); x.stroke();
    x.lineWidth = 0.5 + 0.3 * s; x.strokeStyle = ink(0.55); x.beginPath();
    const n = 2 + Math.round(5 * s);
    for (let k = 1; k <= n; k++) { const f = k / (n + 1), ex = px + (X + w / 2 - px) * f, ey = py + (Y - py) * f; x.moveTo(ex - 0.8, ey + 0.5); x.lineTo(ex - w * 0.12 * (1 - f * 0.4), Y - 0.5); }
    x.stroke();
    if (snow) { x.strokeStyle = ink(0.7); x.beginPath(); x.moveTo(px - h * 0.18, py + h * 0.24); x.lineTo(px - h * 0.07, py + h * 0.16); x.lineTo(px, py + h * 0.26); x.lineTo(px + h * 0.08, py + h * 0.17); x.lineTo(px + h * 0.17, py + h * 0.25); x.stroke(); }
  }
  function hill(x, X, Y, h, w, s) {                         // холм: горб, тень двумя дужками справа
    x.fillStyle = `rgb(${PAPER})`; x.strokeStyle = ink(0.72); x.lineWidth = 0.6 + 0.4 * s;
    x.beginPath(); x.moveTo(X - w / 2, Y); x.quadraticCurveTo(X - w * 0.05, Y - h * 2, X + w / 2, Y); x.fill(); x.stroke();
    x.strokeStyle = ink(0.4); x.lineWidth = 0.5; x.beginPath();
    for (const f of [0.55, 0.78]) { x.moveTo(X + w * (f - 0.5) * 0.9, Y - h * (1 - f) * 1.5); x.quadraticCurveTo(X + w * (f - 0.45), Y - h * (1 - f) * 0.6, X + w * (f - 0.42), Y - 0.3); }
    x.stroke();
  }
  function tree(x, X, Y, s, fir) {                          // дерево: ель — треугольник ярусами, лиственное — крона кругом со штрихом тени
    const h = 4 + 9 * s;
    x.strokeStyle = ink(0.75); x.lineWidth = 0.5 + 0.4 * s; x.fillStyle = `rgb(${PAPER})`;
    if (fir) {
      x.beginPath(); x.moveTo(X, Y - h); x.lineTo(X + h * 0.32, Y - h * 0.15); x.lineTo(X - h * 0.32, Y - h * 0.15); x.closePath(); x.fill(); x.stroke();
      x.beginPath(); x.moveTo(X, Y - h * 0.15); x.lineTo(X, Y); x.stroke();
      return;
    }
    x.beginPath(); x.moveTo(X, Y); x.lineTo(X, Y - h * 0.45); x.stroke();
    x.beginPath(); x.arc(X, Y - h * 0.62, h * 0.32, 0, TAU); x.fill(); x.stroke();
    x.strokeStyle = ink(0.4); x.beginPath(); x.arc(X, Y - h * 0.62, h * 0.2, -0.6, 0.9); x.stroke();
  }
  function tuft(x, X, Y, s) {
    x.strokeStyle = ink(0.32); x.lineWidth = 0.5; x.beginPath();
    for (const d of [-1, 0, 1]) { x.moveTo(X + d * 0.6, Y); x.quadraticCurveTo(X + d * 1.2 * s, Y - 3 * s, X + d * 2.6 * s, Y - (5 - Math.abs(d)) * s); }
    x.stroke();
  }
  const forest = (u, v, sd) => 0.6 * Math.sin(3.1 * u + sd) * Math.sin(2.7 * v * ASP + sd * 1.3) + 0.4 * Math.sin(7.3 * u - 1 + sd) * Math.sin(6.1 * v * ASP + 2);
  function wall(G) {
    const pcs = T.scalePCs, key = `${G.W}x${G.H}x${T.DPR}|${G.hor}|${G.gb}|${G.Wh}|${land.seed}|${pcs ? pcs.join(',') : '-'}|${root()}`;
    if (wallC && key === wallKey) return wallC;
    wallKey = key;
    wallC = document.createElement('canvas');
    wallC.width = Math.round(G.W * T.DPR); wallC.height = Math.round(G.H * T.DPR);
    const x = wallC.getContext('2d');
    x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0);
    x.fillStyle = `rgb(${PAPER})`; x.fillRect(0, 0, G.W, G.H);
    let sd = (land.seed % 2147483646) + 1; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    x.fillStyle = ink(0.05); for (let i = 0; i < 260; i++) { x.beginPath(); x.arc(rnd() * G.W, rnd() * G.H, rnd() * 1.1, 0, TAU); x.fill(); }   // крап старой бумаги
    const { fx0, fx1, hor, gb } = G, b = G.bot;
    x.save(); x.beginPath(); x.rect(fx0 + 6, G.top - 4, fx1 - fx0 - 12, b - G.top - 2); x.clip();
    x.strokeStyle = ink(0.14); x.lineWidth = 0.7; x.beginPath();                                   // небо: несколько гравированных облаков
    for (const [cx0, cy0, w] of [[0.28, 0.42, 0.22], [0.66, 0.66, 0.3], [0.45, 0.85, 0.16]]) {
      const X = fx0 + (fx1 - fx0) * cx0, Y = G.top + (hor - G.top) * cy0, L = (fx1 - fx0) * w;
      for (let k = 0; k < 3; k++) { x.moveTo(X - L / 2 + k * 6, Y + k * 3.5); x.bezierCurveTo(X - L / 4, Y + k * 3.5 - 4, X + L / 4, Y + k * 3.5 + 3, X + L / 2 - k * 7, Y + k * 3.5); }
    }
    x.stroke();
    let rs = 5; const rr = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);                // дальние горы за горизонтом — бледный хребет
    for (const [a, hk] of [[0.18, 0.75], [0.36, 1]]) {                                            // два ряда: дальний бледнее и выше
      x.fillStyle = `rgb(${PAPER})`; x.strokeStyle = ink(a); x.lineWidth = 0.8; x.beginPath(); x.moveTo(fx0, hor);
      let X = fx0 - rr() * 30;
      while (X < fx1) { const w = 22 + rr() * 46, h = (4 + rr() * 16) * hk * (a > 0.2 ? 1 : 1.4); x.quadraticCurveTo(X + w * 0.3, hor - h * 0.4, X + w * 0.5, hor - h); x.quadraticCurveTo(X + w * 0.75, hor - h * 0.35, X + w, hor - rr() * 3); X += w; }
      x.lineTo(fx1, hor); x.fill(); x.stroke();
    }
    x.strokeStyle = ink(0.07); x.beginPath();                                                     // земля: борозды, к нам реже
    for (let k = 0; k < 26; k++) { const y = proj(G, 0, 1 - (k / 26) * 2).y; x.moveTo(fx0, y); x.lineTo(fx1, y); }
    x.stroke();
    x.strokeStyle = rgba(WATER, 0.45); x.lineWidth = 0.7; x.beginPath();                         // озёра: вода — горизонтальная штриховка
    for (let y = hor + 1; y < gb; y += 2.2) {
      const v = unproj(G, 0, y).v; let inside = false, x0 = 0;
      for (let px = fx0; px <= fx1 + 1; px += 1) {
        const m = px <= fx1 && lakeAt((px - G.cx) / G.Wh, v) > 0.5;
        if (m && !inside) { inside = true; x0 = px; } else if (!m && inside) { inside = false; x.moveTo(x0 + 1, y); x.lineTo(px - 1, y); }
      }
    }
    x.stroke();
    const SC = 3, sw = Math.ceil((fx1 - fx0) / SC) + 1, sh = Math.ceil((gb - hor) / SC) + 1, LM = new Float32Array(sw * sh);   // берег — изолиния по экрану (мелкая сетка)
    for (let j = 0; j < sh; j++) { const v = unproj(G, 0, hor + j * SC).v; for (let i = 0; i < sw; i++) LM[j * sw + i] = lakeAt((fx0 + i * SC - G.cx) / G.Wh, v); }
    const shore = (lvl) => {
      for (let j = 0; j < sh - 1; j++) for (let i = 0; i < sw - 1; i++) {
        const q = j * sw + i, a = LM[q], b2 = LM[q + 1], c = LM[q + sw + 1], d = LM[q + sw], X0 = fx0 + i * SC, Y0 = hor + j * SC, pts = [];
        if ((a > lvl) === (b2 > lvl) && (b2 > lvl) === (c > lvl) && (c > lvl) === (d > lvl)) continue;
        if ((a > lvl) !== (b2 > lvl)) pts.push([X0 + SC * (lvl - a) / (b2 - a), Y0]);
        if ((b2 > lvl) !== (c > lvl)) pts.push([X0 + SC, Y0 + SC * (lvl - b2) / (c - b2)]);
        if ((c > lvl) !== (d > lvl)) pts.push([X0 + SC * (1 - (lvl - c) / (d - c)), Y0 + SC]);
        if ((d > lvl) !== (a > lvl)) pts.push([X0, Y0 + SC * (1 - (lvl - d) / (a - d))]);
        for (let k = 0; k + 1 < pts.length; k += 2) { x.moveTo(...pts[k]); x.lineTo(...pts[k + 1]); }
      }
    };
    x.lineWidth = 1.1; x.strokeStyle = rgba(WATER, 0.9); x.beginPath(); shore(0.5); x.stroke();   // берег и тень берега
    x.lineWidth = 0.7; x.strokeStyle = rgba(WATER, 0.3); x.beginPath(); shore(0.15); x.stroke();
    for (const rv of land.rivers) {                                                               // реки: тонко у истока, к устью шире; ближе — толще
      const n = rv.pts.length;
      x.strokeStyle = rgba(WATER, 0.9);
      for (let k = 1; k < n; k++) { const a = proj(G, ...rv.pts[k - 1]), c = proj(G, ...rv.pts[k]); x.lineWidth = (0.5 + 1.8 * (k / n)) * (0.3 + 0.7 * c.s); x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(c.x, c.y); x.stroke(); }
    }
    const fsd = (land.seed % 97) * 0.13;                                                           // рельеф: ряды значков от горизонта к нам
    let v = 1;
    while (v > -1.03) {
      const p = proj(G, 0, v), s = p.s, step = (4.5 + 9.5 * s) / G.Wh;
      for (let u = -1.04 + rnd() * step; u < 1.04; u += step * (0.8 + 0.4 * rnd())) {
        const uu = clamp(u, -1, 1), vv = clamp(v + (rnd() - 0.5) * 0.012, -1, 1), z = zAt(uu, vv), q = proj(G, uu, vv);
        if (lakeAt(uu, vv) > 0.25 || q.x < fx0 + 8 || q.x > fx1 - 8) continue;
        if (z > 0.48) { if (rnd() < 0.3) { const h = z * G.EL * s * 1.05 + 2, w = h * (1.6 + 0.6 * rnd()); mountain(x, q.x, q.y, h, w, s, rnd() - 0.5, z > 0.8); } }   // горы — редко и крупно: хребет из нескольких вершин
        else if (z > 0.2) { if (rnd() < 0.45) { const h = z * G.EL * s * 0.9 + 1, w = h * 1.9 + 4 * s; hill(x, q.x, q.y, h, w, s); } }
        else if (z > -0.2 && forest(uu, vv, fsd) > 0.38 && rnd() < 0.8) tree(x, q.x, q.y, s, z > 0.05 || rnd() < 0.3);
        else if (rnd() < 0.012 + 0.02 * s) tuft(x, q.x, q.y, 0.6 + 0.6 * s);
      }
      const p2 = proj(G, 0, v - 0.01), dydv = (p2.y - p.y) / 0.01;
      v -= (2.2 + 6 * s) / dydv;
    }
    x.font = `italic 10.5px ${T.MAP}`; x.textAlign = 'center'; x.textBaseline = 'middle';         // имена, как на старых картах
    const placed = [], free = (X, Y, w) => placed.every((r) => Math.abs(r[0] - X) > (r[2] + w) / 2 + 4 || Math.abs(r[1] - Y) > 13);   // имена не налезают друг на друга
    const label = (s2, X, Y, col) => { const w = x.measureText(s2).width; if (!free(X, Y, w)) return; placed.push([X, Y, w]); x.fillStyle = `rgba(${PAPER},0.85)`; x.fillRect(X - w / 2 - 2, Y - 6, w + 4, 12); x.fillStyle = col; x.fillText(s2, X, Y); };
    for (const p of land.peaks) if (p.name) { const q = proj(G, p.u, p.v); label(p.name, q.x, q.y + 8, ink(0.7)); }
    for (const l of land.lakes) if (l.name) { const q = proj(G, l.u, l.v); label(l.name, q.x, q.y, rgba(WATER, 0.95)); }
    for (const rv of land.rivers) {
      const k = Math.floor(rv.pts.length * 0.7), a = proj(G, ...rv.pts[k - 2]), c = proj(G, ...rv.pts[Math.min(rv.pts.length - 1, k + 2)]), q = proj(G, ...rv.pts[k]);
      let ang = Math.atan2(c.y - a.y, c.x - a.x); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
      const w = x.measureText(rv.name).width; if (!free(q.x, q.y - 7, w)) continue; placed.push([q.x, q.y - 7, w]);
      x.save(); x.translate(q.x, q.y); x.rotate(ang); x.fillStyle = rgba(WATER, 0.85); x.fillText(rv.name, 0, -7); x.restore();
    }
    x.restore();
    x.strokeStyle = ink(0.9); x.lineWidth = 1.6; x.strokeRect(fx0, G.top - 4, fx1 - fx0, b - G.top + 2);   // рамка карты Таро, как у Natura
    x.strokeStyle = ink(0.55); x.lineWidth = 0.9; x.strokeRect(fx0 + 5.5, G.top + 1.5, fx1 - fx0 - 11, b - G.top - 9);
    x.strokeStyle = ink(0.6); x.lineWidth = 0.8; x.beginPath(); x.moveTo(fx0 + 6, hor + 0.5); x.lineTo(fx1 - 6, hor + 0.5); x.stroke();   // горизонт
    const ny = b - 22;                                                                            // подпись внизу
    x.fillStyle = `rgb(${PAPER})`; x.fillRect(fx0 + 6, ny - 9, fx1 - fx0 - 12, 18);
    x.strokeStyle = ink(0.8); x.lineWidth = 1; x.beginPath(); x.moveTo(fx0 + 6, ny - 9.5); x.lineTo(fx1 - 6, ny - 9.5); x.stroke();
    x.font = `15px ${T.MAP}`; x.fillStyle = ink(0.95); x.fillText('A R C A D I A', G.cx, ny + 1);
    for (let k = 0; k <= SEMIS; k++) {                                                            // полутоны по левой рамке — вглубь выше; ступени лада длиннее
      const pc = (k + root()) % 12, on = !pcs || pcs.includes(pc), y = gb - (k / SEMIS) * (gb - hor), l = on ? 6 : 3;
      x.strokeStyle = ink(on ? 0.6 : 0.25); x.lineWidth = 0.8; x.beginPath(); x.moveTo(fx0 + 5.5, y); x.lineTo(fx0 + 5.5 + l, y); x.stroke();
    }
    return wallC;
  }
  const figPt = (fig, a) => (fig === 1 ? [Math.sin(a), 0.55 * Math.sin(2 * a)] : fig === 2 ? [Math.sin(2 * a), 0.8 * Math.sin(3 * a + 0.7)] : [Math.cos(a), Math.sin(a)]);
  function drawT(c, G, t, now, held) {
    const home = flagAt(G, t), cc = centers[t.slot] || [t.u, t.v, t.r], cen = at(G, cc[0], cc[1]), g = clamp((gains[t.slot] || 0) * 1.3);
    c.lineWidth = 0.9; c.setLineDash([1.5, 3.5]); c.strokeStyle = ink(0.4);                      // путь: куда бродит петля
    const path = (pts) => { c.beginPath(); pts.forEach(([u, v], k) => { const p = at(G, u, v); k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }); c.stroke(); };
    if (t.mode === 1) path(Array.from({ length: 49 }, (_, k) => [t.u + t.sp * Math.cos((k / 48) * TAU), t.v + (t.sp * Math.sin((k / 48) * TAU)) / ASP]));
    else if (t.mode >= 3 && t.route && t.route.length >= 4) { c.strokeStyle = t.mode === 3 ? rgba(WATER, 0.7) : ink(0.5); path(Array.from({ length: t.route.length / 2 }, (_, k) => [t.route[2 * k], t.route[2 * k + 1]])); }
    else if (t.mode === 2 && t.trail.length > 2) path(t.trail);
    c.setLineDash([2, 4]); c.strokeStyle = ink(0.3); c.beginPath(); c.moveTo(home.x, home.y); c.lineTo(cen.x, cen.y); c.stroke(); c.setLineDash([]);
    const pts = loopPts(G, t, 120);                                                               // петля, поднятая холмами: её горбы — то, что слышно
    c.strokeStyle = ink(0.5 + 0.45 * g); c.lineWidth = 1 + 0.6 * g; c.beginPath(); pts.forEach((p, k) => (k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.stroke();
    c.strokeStyle = ink(0.16); c.lineWidth = 0.7; c.beginPath();                                    // тень петли на земле — ровная, без холмов
    for (let k = 0; k <= 60; k++) { const [du, dv] = figPt(t.fig, (k / 60) * TAU), p = proj(G, cc[0] + (cc[2] || t.r) * du, cc[1] + ((cc[2] || t.r) * dv) / ASP); k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }
    c.stroke();
    const ph = (now * 0.00022 * Math.sqrt(hzOf(t) / 55)) % 1, sp = pts[Math.floor(ph * 120)];       // сканер бежит по петле
    c.fillStyle = ink(0.95); c.beginPath(); c.arc(sp.x, sp.y, 2.3, 0, TAU); c.fill();
    const s = home.s, ph2 = now * 0.004 + t.slot, fh = 15 + 8 * s;                                // флажок странника на древке
    c.strokeStyle = ink(0.95); c.lineWidth = 1; c.beginPath(); c.moveTo(home.x, home.y); c.lineTo(home.x, home.y - fh); c.stroke();
    c.fillStyle = `rgb(${PAPER})`; c.beginPath(); c.moveTo(home.x, home.y - fh); c.quadraticCurveTo(home.x + 6, home.y - fh + 1 + Math.sin(ph2) * 1.5, home.x + 11, home.y - fh + 3.5); c.lineTo(home.x, home.y - fh + 7); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = ink(0.95); c.beginPath(); c.ellipse(home.x, home.y, 3, 1.4, 0, 0, TAU); c.fill();
    if (held) {
      const f = hzOf(t), y = proj(G, -1, t.v).y;
      T.mapText(`${noteName(f)} · ${Math.round(f)} Hz`, home.x, home.y - fh - 22, 14, 0.95, 'center');
      T.mapText(held === 'rim' ? `orbit ${Math.round(t.r * 100)}%` : `${PATHS[t.mode]} · ${FIGS[t.fig]}`, home.x, home.y - fh - 8, 11, 0.65, 'center');
      c.strokeStyle = ink(0.95); c.lineWidth = 1.6; c.beginPath(); c.moveTo(G.fx0 + 5.5, y); c.lineTo(G.fx0 + 18, y); c.stroke(); c.lineWidth = 1;   // своя нота на шкале слева
    }
  }
  let noSun = false;
  function draw(now) {
    const c = T.g, G = geo();
    c.drawImage(wall(G), 0, 0, T.W, T.H);
    const held = new Map([...touches.values()].filter((t) => t.kind === 'home' || t.kind === 'rim').map((t) => [t.t, t.kind]));
    const order = [...travellers].sort((a, b) => b.v - a.v);                                       // дальние — раньше
    for (const t of order) drawT(c, G, t, now, held.get(t) || false);
    if (!noSun) T.quarterSun(c, G.sun.x, G.sun.y, G.sun.r, -1, now, INK, `rgb(${PAPER})`);
  }

  // ---------- мир ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [{ key: 'relief', label: 'relief', ang: deg(190) }, { key: 'pace', label: 'pace', ang: deg(160) }, { key: 'wind', label: 'wind', ang: deg(130) }, { key: 'spread', label: 'spread', ang: deg(105) }, { key: 'hall', label: 'hall', ang: deg(80) }],
    get: (k) => fx[k], set: (k, v) => { fx[k] = v; applyFx(); },
    text: (k) => (k === 'pace' ? `${(1 / (0.01 * 40 ** fx.pace)).toFixed(0)} s` : k === 'wind' && fx.wind < 0.01 ? 'calm' : `${Math.round(fx[k] * 100)}%`),
    lfo: { keys: ['relief', 'pace', 'wind', 'spread', 'hall'], shapes: 'random' },
    arc: () => fx.hall, save: () => ({ ...fx }), load: (o) => { Object.assign(fx, o); applyFx(); },
  };
  function dice() {                                       // новая страна; два-три странника на ступенях лада, пути и петли — вразброс
    const R = Math.random;
    while (travellers.length) dropT(travellers[0]);
    newLand((R() * 2147483646) | 0);
    const n = 2 + Math.floor(R() * 2);
    for (let k = 0; k < n; k++) {
      let u = 0, v = 0;
      for (let tries = 0; tries < 20; tries++) { u = R() * 1.6 - 0.8; v = R() * 1.5 - 0.75; if (lakeAt(u, v) < 0.2) break; }
      addT(u, v, { r: 0.08 + R() * 0.3, fig: R() < 0.6 ? 0 : 1 + Math.floor(R() * 2), mode: 1 + Math.floor(R() * 4), sp: 0.12 + R() * 0.3, oct: R() < 0.25 ? -1 : 0 });
    }
  }
  const arc = {
    n: 'XII', title: 'Arcadia', sub: 'montes · lacus · flumina', theme: { ink: INK, bg: BGC, paper: PAPER },
    corner: { hit: (f) => { const G = geo(); return f.y > G.sun.y && Math.hypot(f.x - G.sun.x, f.y - G.sun.y) < G.sun.r + 12; }, draw: () => {} },   // солнце — карта
    fx: fxw,
    legend: [['tap', 'tap the land', 'a wanderer · its orbit scans the hills — the sound'], ['up', 'drag a wanderer', 'north — higher, south — lower · the land under it — timbre'],
      ['drag', 'drag the rim of an orbit', 'wide — rich, small — almost a sine'], ['tap', 'tap a wanderer', 'it leaves'],
      ['hold', 'hold a wanderer', 'its sheet: octave, orbit, figure, path, range, level'], ['tap', 'the dice', 'a new land and new paths'], ['tap', 'tap the sun', 'map of worlds']],
    build, tick, draw, down, move, up, dice, enter: start,
    clear() { while (travellers.length) dropT(travellers[0]); },
    snapshot: () => JSON.stringify({ seed: land.seed, t: travellers.map(({ u, v, oct, r, fig, mode, sp, lvl }) => ({ u, v, oct, r, fig, mode, sp, lvl })), fx }),
    restore(js) {
      const st = JSON.parse(js);
      while (travellers.length) dropT(travellers[0]);
      if (st.seed !== land.seed) newLand(st.seed);
      for (const q of st.t) addT(q.u, q.v, q);
      Object.assign(fx, st.fx); applyFx();
    },
    sounding, mapShot(on) { noSun = on; },
  };
  T.registerWorld(12, arc);
  window.t2d.arc = {
    travellers, fx, geo, setFx: (k, v) => fxw.set(k, v), get land() { return land; }, get ready() { return ready; }, get centers() { return centers; }, get gains() { return gains; }, hz: hzOf,
    at: (u, v) => at(geo(), u, v), ground: (u, v) => proj(geo(), u, v), loop: (i) => loopPts(geo(), travellers[i], 48), z: zAt, newLand, routeOf,
  };
})();
